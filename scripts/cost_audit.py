"""Read-only Firecrawl / pipeline cost audit against data/pallares.db."""

from __future__ import annotations

import sqlite3
from pathlib import Path

DB = Path(__file__).resolve().parents[1] / "data" / "pallares.db"


def _connect() -> sqlite3.Connection:
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    return con


def _print_provider_totals(con: sqlite3.Connection) -> None:
    print("=== Totals by provider ===")
    rows = con.execute(
        """
        SELECT provider,
               COALESCE(SUM(units), 0) AS units,
               COALESCE(SUM(usd), 0) AS usd,
               COUNT(*) AS events
        FROM cost_events
        GROUP BY provider
        ORDER BY usd DESC, provider
        """
    ).fetchall()
    print(f"{'provider':<18}{'units':>12}{'usd':>12}{'events':>10}")
    for row in rows:
        print(
            f"{row['provider']:<18}"
            f"{float(row['units']):>12.1f}"
            f"${float(row['usd']):>10.2f}"
            f"{int(row['events']):>10}"
        )
    if not rows:
        print("(no cost events)")


def _print_market_breakdown(con: sqlite3.Connection) -> None:
    print("\n=== Per market (Firecrawl) ===")
    rows = con.execute(
        """
        SELECT COALESCE(r.market_key, '?') AS market_key,
               COUNT(DISTINCT l.place_id) AS leads,
               COALESCE(SUM(c.units), 0) AS credits,
               COALESCE(SUM(c.usd), 0) AS usd
        FROM cost_events c
        LEFT JOIN runs r ON r.run_id = c.run_id
        LEFT JOIN leads l ON l.place_id = c.place_id
        WHERE c.provider = 'firecrawl'
        GROUP BY COALESCE(r.market_key, '?')
        ORDER BY usd DESC
        """
    ).fetchall()
    print(f"{'market':<18}{'leads':>8}{'credits':>10}{'usd':>10}{'usd/lead':>12}")
    for row in rows:
        leads = int(row["leads"])
        usd = float(row["usd"])
        per = usd / leads if leads else 0.0
        print(
            f"{row['market_key']:<18}"
            f"{leads:>8}"
            f"{float(row['credits']):>10.0f}"
            f"${usd:>9.2f}"
            f"${per:>10.2f}"
        )


def _print_top_leads(con: sqlite3.Connection) -> None:
    print("\n=== Top 15 expensive place_ids (Firecrawl USD) ===")
    rows = con.execute(
        """
        SELECT c.place_id,
               COALESCE(l.business_name, c.place_id) AS name,
               COALESCE(SUM(c.units), 0) AS credits,
               COALESCE(SUM(c.usd), 0) AS usd
        FROM cost_events c
        LEFT JOIN leads l ON l.place_id = c.place_id
        WHERE c.provider = 'firecrawl' AND c.place_id IS NOT NULL
        GROUP BY c.place_id
        ORDER BY usd DESC
        LIMIT 15
        """
    ).fetchall()
    print(f"{'place_id':<28}{'name':<32}{'credits':>10}{'usd':>10}")
    for row in rows:
        name = (row["name"] or "")[:30]
        print(
            f"{row['place_id']:<28}"
            f"{name:<32}"
            f"{float(row['credits']):>10.0f}"
            f"${float(row['usd']):>9.2f}"
        )


def _print_waste(con: sqlite3.Connection) -> None:
    print("\n=== Waste (failed or zero-enriched runs with Firecrawl spend) ===")
    rows = con.execute(
        """
        SELECT r.run_id,
               r.market_key,
               r.category_key,
               r.status,
               r.enriched_count,
               COALESCE(SUM(c.units), 0) AS credits,
               COALESCE(SUM(c.usd), 0) AS usd
        FROM runs r
        JOIN cost_events c ON c.run_id = r.run_id AND c.provider = 'firecrawl'
        WHERE r.status = 'failed' OR COALESCE(r.enriched_count, 0) = 0
        GROUP BY r.run_id
        ORDER BY usd DESC
        """
    ).fetchall()
    total_credits = 0.0
    total_usd = 0.0
    print(
        f"{'run_id':<38}{'market/cat':<28}{'status':<10}"
        f"{'enriched':>9}{'credits':>10}{'usd':>10}"
    )
    for row in rows:
        mc = f"{row['market_key'] or '?'}/{row['category_key'] or '?'}"
        credits = float(row["credits"])
        usd = float(row["usd"])
        total_credits += credits
        total_usd += usd
        print(
            f"{row['run_id']:<38}"
            f"{mc:<28}"
            f"{row['status']:<10}"
            f"{int(row['enriched_count'] or 0):>9}"
            f"{credits:>10.0f}"
            f"${usd:>9.2f}"
        )
    print(f"\nWaste subtotal: {total_credits:.0f} credits, ${total_usd:.2f}")


def _print_duplicate_runs(con: sqlite3.Connection) -> None:
    print("\n=== Duplicate runs (same market+category within 10 minutes) ===")
    rows = con.execute(
        """
        SELECT a.market_key,
               a.category_key,
               a.run_id,
               b.run_id AS dup_run_id,
               a.started_at,
               b.started_at AS dup_started_at
        FROM runs a
        JOIN runs b
          ON a.market_key = b.market_key
         AND a.category_key = b.category_key
         AND a.run_id < b.run_id
         AND ABS(strftime('%s', a.started_at) - strftime('%s', b.started_at)) < 600
        ORDER BY a.started_at
        """
    ).fetchall()
    if not rows:
        print("(none)")
        return
    for row in rows:
        print(
            f"{row['market_key']}/{row['category_key']}: "
            f"{row['run_id']} + {row['dup_run_id']} "
            f"({row['started_at']} / {row['dup_started_at']})"
        )


def main() -> None:
    if not DB.is_file():
        raise SystemExit(f"Database not found: {DB}")
    con = _connect()
    try:
        _print_provider_totals(con)
        _print_market_breakdown(con)
        _print_top_leads(con)
        _print_waste(con)
        _print_duplicate_runs(con)
    finally:
        con.close()


if __name__ == "__main__":
    main()
