"""Correlate lead features with outcomes and produce insight reports."""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml

from pallares_leads.db.store import LeadStore
from pallares_leads.settings import Settings

logger = logging.getLogger(__name__)

MIN_LABELS_LOGISTIC = 50
MIN_LABELS_FIT_SCORE = 150
LAPLACE_ALPHA = 2.0


def _require_analysis_deps() -> tuple[Any, Any, Any]:
    try:
        import pandas as pd
        from scipy import stats
        from sklearn.linear_model import LogisticRegression
        from sklearn.preprocessing import StandardScaler
    except ImportError as exc:
        raise SystemExit(
            "Install analysis extras: pip install -e '.[analysis]'"
        ) from exc
    return pd, stats, (LogisticRegression, StandardScaler)


def _load_feature_outcomes(store: LeadStore) -> Any:
    pd, _, _ = _require_analysis_deps()
    rows = store._conn.execute(
        """
        SELECT place_id, features, label_good, engagement_ladder, outcome,
               reached_dm, deal_value_usd, crm_status
        FROM feature_outcomes
        """
    ).fetchall()
    records: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        features = item.pop("features") or {}
        if isinstance(features, str):
            features = json.loads(features)
        item.update(features if isinstance(features, dict) else {})
        records.append(item)
    return pd.DataFrame(records)


def _numeric_correlations(df: Any, label_col: str = "label_good") -> list[dict[str, Any]]:
    pd, stats, _ = _require_analysis_deps()
    labeled = df[df[label_col].notna()]
    if labeled.empty:
        return []
    results: list[dict[str, Any]] = []
    skip = {
        label_col,
        "place_id",
        "outcome",
        "crm_status",
        "category_key",
        "market_key",
        "feat_category",
        "feat_market",
        "business_status",
        "verification_level",
        "confidence",
        "price_level",
        "website_kind",
        "phone_source",
        "owner_kind",
        "source_tool",
        "tier_reached",
        "profile_key",
        "model",
        "discovery_method",
        "primary_type",
        "bbb_rating",
    }
    for col in labeled.columns:
        if col in skip or col.startswith("feat_"):
            continue
        series = labeled[col]
        if series.dtype == object or str(series.dtype) == "string":
            continue
        try:
            numeric = pd.to_numeric(series, errors="coerce")
        except Exception:
            continue
        if numeric.notna().sum() < 10:
            continue
        subset = labeled[numeric.notna()]
        if subset[label_col].nunique() < 2:
            continue
        r, p = stats.pointbiserialr(subset[label_col], numeric[numeric.notna()])
        won = subset[subset[label_col] == 1][col]
        lost = subset[subset[label_col] == 0][col]
        results.append(
            {
                "feature": col,
                "correlation": float(r),
                "p_value": float(p),
                "mean_won": float(pd.to_numeric(won, errors="coerce").mean() or 0),
                "mean_lost": float(pd.to_numeric(lost, errors="coerce").mean() or 0),
                "n": int(len(subset)),
            }
        )
    results.sort(key=lambda item: abs(item["correlation"]), reverse=True)
    return results


def _win_rate_table(df: Any, column: str, *, alpha: float = LAPLACE_ALPHA) -> list[dict[str, Any]]:
    pd, _, _ = _require_analysis_deps()
    if column not in df.columns:
        return []
    labeled = df[df["label_good"].notna()]
    if labeled.empty:
        return []
    rows: list[dict[str, Any]] = []
    for key, group in labeled.groupby(column):
        wins = int((group["label_good"] == 1).sum())
        total = int(len(group))
        smoothed = (wins + alpha) / (total + 2 * alpha)
        rows.append(
            {
                "bucket": str(key),
                "wins": wins,
                "total": total,
                "smoothed_win_rate": round(smoothed, 4),
            }
        )
    rows.sort(key=lambda item: item["smoothed_win_rate"], reverse=True)
    return rows


def _score_calibration(df: Any) -> list[dict[str, Any]]:
    pd, _, _ = _require_analysis_deps()
    labeled = df[df["label_good"].notna()].copy()
    if labeled.empty:
        return []
    labeled["score"] = pd.to_numeric(labeled.get("lead_score"), errors="coerce")
    labeled = labeled[labeled["score"].notna()]
    if len(labeled) < 10:
        return []
    q = min(10, labeled["score"].nunique())
    labeled["decile"] = pd.qcut(labeled["score"], q=q, duplicates="drop")
    rows: list[dict[str, Any]] = []
    for decile, group in labeled.groupby("decile", observed=True):
        wins = int((group["label_good"] == 1).sum())
        total = int(len(group))
        rows.append(
            {
                "score_band": str(decile),
                "score_min": float(group["score"].min()),
                "score_max": float(group["score"].max()),
                "wins": wins,
                "total": total,
                "win_rate": round(wins / total, 4) if total else 0.0,
            }
        )
    return rows


def _cost_per_win(df: Any) -> list[dict[str, Any]]:
    pd, _, _ = _require_analysis_deps()
    wins = df[df["label_good"] == 1]
    if wins.empty:
        return []
    rows: list[dict[str, Any]] = []
    for column in ("market_key", "category_key"):
        if column not in wins.columns:
            continue
        for key, group in wins.groupby(column):
            usd = pd.to_numeric(group.get("usd_total"), errors="coerce").sum()
            count = int(len(group))
            if count == 0:
                continue
            rows.append(
                {
                    "dimension": column,
                    "bucket": str(key),
                    "won_count": count,
                    "total_usd": float(usd or 0),
                    "usd_per_win": round(float(usd or 0) / count, 4),
                }
            )
    return rows


def _fit_logistic(df: Any) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    pd, _, (LogisticRegression, StandardScaler) = _require_analysis_deps()
    labeled = df[df["label_good"].notna()].copy()
    if len(labeled) < MIN_LABELS_LOGISTIC:
        warn = f"Need at least {MIN_LABELS_LOGISTIC} labels for logistic regression"
        return [], {"warning": warn}
    numeric_cols: list[str] = []
    for col in labeled.columns:
        if col in ("label_good", "place_id", "outcome"):
            continue
        converted = pd.to_numeric(labeled[col], errors="coerce")
        if converted.notna().sum() >= max(10, len(labeled) // 4):
            labeled[col] = converted
            numeric_cols.append(col)
    if not numeric_cols:
        return [], {"warning": "No numeric features for regression"}
    x = labeled[numeric_cols].fillna(0)
    y = labeled["label_good"].astype(int)
    scaler = StandardScaler()
    x_scaled = scaler.fit_transform(x)
    model = LogisticRegression(max_iter=1000, class_weight="balanced")
    model.fit(x_scaled, y)
    coefs = [
        {"feature": col, "coefficient": float(coef)}
        for col, coef in sorted(
            zip(numeric_cols, model.coef_[0], strict=True),
            key=lambda item: abs(item[1]),
            reverse=True,
        )
    ]
    metrics = {
        "accuracy": float(model.score(x_scaled, y)),
        "n_labels": int(len(labeled)),
        "features": numeric_cols,
    }
    return coefs, metrics


def _write_learned_score(
    coef_rows: list[dict[str, Any]],
    metrics: dict[str, Any],
    *,
    config_dir: Path,
    labeled_count: int,
) -> None:
    payload = {
        "version": 1,
        "fitted_at": datetime.now(tz=UTC).isoformat(),
        "labeled_count": labeled_count,
        "min_labels_gate": MIN_LABELS_FIT_SCORE,
        "metrics": metrics,
        "coefficients": {row["feature"]: row["coefficient"] for row in coef_rows[:40]},
        "intercept": 0.0,
    }
    path = config_dir / "learned_score.yaml"
    path.write_text(yaml.safe_dump(payload, sort_keys=False), encoding="utf-8")
    logger.info("Wrote learned score coefficients to %s", path)


def _render_markdown(report: dict[str, Any]) -> str:
    lines = [
        f"# Lead Intelligence Report ({report['generated_at'][:10]})",
        "",
        f"- Sample size: **{report['sample_size']}**",
        f"- Labeled outcomes: **{report['labeled_count']}**",
        "",
    ]
    if report["labeled_count"] < 20:
        lines.append(
            "> Few labeled outcomes — treat correlations as directional only until "
            f"you have at least 20 closed labels ({20 - report['labeled_count']} more needed)."
        )
        lines.append("")
    pos = report.get("top_positive_predictors") or []
    neg = report.get("top_negative_predictors") or []
    if pos:
        lines.append("## Top positive predictors")
        for row in pos[:10]:
            lines.append(
                f"- `{row['feature']}` r={row['correlation']:.3f} "
                f"(won {row['mean_won']:.2f} vs lost {row['mean_lost']:.2f}, n={row['n']})"
            )
        lines.append("")
    if neg:
        lines.append("## Top negative predictors")
        for row in neg[:10]:
            lines.append(
                f"- `{row['feature']}` r={row['correlation']:.3f} "
                f"(won {row['mean_won']:.2f} vs lost {row['mean_lost']:.2f}, n={row['n']})"
            )
        lines.append("")
    cal = report.get("score_calibration") or []
    if cal:
        lines.append("## Score calibration (deciles vs win rate)")
        for row in cal:
            lines.append(
                f"- {row['score_min']:.0f}–{row['score_max']:.0f}: "
                f"{row['win_rate']*100:.1f}% ({row['wins']}/{row['total']})"
            )
        lines.append("")
    return "\n".join(lines)


def run_insights(
    store: LeadStore,
    settings: Settings,
    *,
    fit_score: bool = False,
) -> dict[str, Any]:
    df = _load_feature_outcomes(store)
    sample_size = int(len(df))
    labeled_count = int(df["label_good"].notna().sum()) if sample_size else 0
    correlations = _numeric_correlations(df)
    positive = [row for row in correlations if row["correlation"] > 0][:15]
    negative = [row for row in correlations if row["correlation"] < 0][:15]
    coefs, model_metrics = _fit_logistic(df)
    report: dict[str, Any] = {
        "generated_at": datetime.now(tz=UTC).isoformat(),
        "sample_size": sample_size,
        "labeled_count": labeled_count,
        "top_positive_predictors": positive,
        "top_negative_predictors": negative,
        "win_rate_by_category": _win_rate_table(df, "category_key"),
        "win_rate_by_market": _win_rate_table(df, "market_key"),
        "win_rate_by_role_rank": _win_rate_table(df, "best_contact_role_rank"),
        "score_calibration": _score_calibration(df),
        "cost_per_win": _cost_per_win(df),
        "logistic_coefficients": coefs,
        "engagement_correlations": _numeric_correlations(df, label_col="engagement_ladder"),
    }
    markdown = _render_markdown(report)
    out_dir = settings.data_dir / "insights"
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(tz=UTC).strftime("%Y%m%d")
    md_path = out_dir / f"{stamp}_insights.md"
    md_path.write_text(markdown, encoding="utf-8")
    report_id = store.record_insight_report(
        sample_size=sample_size,
        labeled_count=labeled_count,
        report_json=report,
        model_metrics=model_metrics,
    )
    report["report_id"] = report_id
    report["markdown_path"] = str(md_path)
    if fit_score:
        if labeled_count >= MIN_LABELS_FIT_SCORE and coefs:
            _write_learned_score(
                coefs,
                model_metrics,
                config_dir=settings.config_dir,
                labeled_count=labeled_count,
            )
            report["learned_score_written"] = True
        else:
            report["learned_score_written"] = False
            report["learned_score_skip_reason"] = (
                f"Need >= {MIN_LABELS_FIT_SCORE} labeled outcomes (have {labeled_count})"
            )
    return report
