from __future__ import annotations

import asyncio
import logging
import time
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, Field

from pallares_leads.db.raw_archive import record_capture
from pallares_leads.enrich.task_templates import (
    LOOPNET_TASK,
    PARCELQUEST_TASK,
    SOS_BIZFILE_TASK,
    TYLER_EAGLE_TASK,
    render_task,
)
from pallares_leads.progress import emit as progress_emit
from pallares_leads.utils.normalize import normalize_entity_name

if TYPE_CHECKING:
    from pallares_leads.config_loader import CountyJurisdictionConfig, StateJurisdictionConfig
    from pallares_leads.db.store import LeadStore
    from pallares_leads.settings import Settings

logger = logging.getLogger(__name__)

_WORKSPACE_STATE_KEY = "browser_use_owner_chain_workspace_id"

_STATE_DISPLAY_NAMES: dict[str, str] = {
    "ca": "California",
    "hi": "Hawaii",
    "or": "Oregon",
    "wa": "Washington",
    "nm": "New Mexico",
    "nv": "Nevada",
    "az": "Arizona",
}


def _state_display_name_for_county(county_cfg: CountyJurisdictionConfig) -> str:
    return _STATE_DISPLAY_NAMES.get(county_cfg.state.lower(), county_cfg.state.upper())


class OfficerRecord(BaseModel):
    name: str = ""
    title: str = ""


class SosEntityCandidate(BaseModel):
    entity_name: str = ""
    entity_number: str = ""
    status: str = ""
    principal_address: str = ""


class SosEntityResult(BaseModel):
    entity_name: str = ""
    entity_number: str = ""
    status: str = ""
    registered_agent: str = ""
    principal_address: str = ""
    officers: list[OfficerRecord] = Field(default_factory=list)
    search_candidates: list[SosEntityCandidate] = Field(default_factory=list)


class RecorderPartyMatch(BaseModel):
    party_name: str = ""
    document_type: str = ""
    recording_date: str = ""


class RecorderResult(BaseModel):
    matches: list[RecorderPartyMatch] = Field(default_factory=list)


class ParcelOwnerResult(BaseModel):
    apn: str = ""
    situs_address: str = ""
    owner_name: str = ""
    mailing_address: str = ""
    owner_kind: str = ""


class LoopNetBroker(BaseModel):
    name: str = ""
    company: str = ""
    phone: str = ""


class LoopNetPropertyFacts(BaseModel):
    building_sf: str = ""
    lot_sf: str = ""
    property_type: str = ""


class LoopNetResult(BaseModel):
    listing_url: str = ""
    listed_by: list[LoopNetBroker] = Field(default_factory=list)
    property_facts: LoopNetPropertyFacts = Field(default_factory=LoopNetPropertyFacts)


class BrowserUseClient:
    """Browser Use Cloud v3 client with sync wrappers and graceful degradation."""

    def __init__(
        self,
        settings: Settings,
        *,
        store: LeadStore | None = None,
        run_id: str | None = None,
        place_id: str | None = None,
    ) -> None:
        self.settings = settings
        self.store = store
        self.run_id = run_id
        self.place_id = place_id
        self.last_task_cost_usd: float = 0.0
        self.total_cost_usd: float = 0.0
        self.last_skip_reason: str = ""

    def is_available(self) -> bool:
        if not self.settings.browser_use_enabled:
            self.last_skip_reason = "browser_use_enabled is false"
            return False
        if not self.settings.browser_use_api_key:
            self.last_skip_reason = "BROWSER_USE_API_KEY missing"
            return False
        if self.settings.browser_use_backend != "cloud":
            self.last_skip_reason = f"unsupported backend {self.settings.browser_use_backend!r}"
            return False
        return True

    def sos_entity_lookup(
        self,
        entity_name: str,
        state_cfg: StateJurisdictionConfig,
        *,
        state_code: str = "",
        collect_candidates: bool = False,
    ) -> SosEntityResult | None:
        if not entity_name.strip():
            return None
        if not self.is_available():
            logger.debug("Skipping SOS lookup: %s", self.last_skip_reason)
            return None
        state_name = _STATE_DISPLAY_NAMES.get(state_code.lower(), "state")
        task = render_task(
            SOS_BIZFILE_TASK,
            portal_url=state_cfg.sos_business_search.url,
            entity_name=entity_name.strip(),
            state_name=state_name,
        )
        if collect_candidates:
            task += (
                " If the search results page lists multiple entities, populate search_candidates "
                "with up to 5 rows (entity_name, entity_number, status, principal_address) before "
                "opening the best match."
            )
        return self._run_cloud_task(task, SosEntityResult, stage="sos_entity_lookup")

    def recorder_party_search(
        self,
        party_name: str,
        county_cfg: CountyJurisdictionConfig,
    ) -> RecorderResult | None:
        if not party_name.strip() or county_cfg.recorder is None:
            return None
        if not self.is_available():
            logger.debug("Skipping recorder lookup: %s", self.last_skip_reason)
            return None
        task = render_task(
            TYLER_EAGLE_TASK,
            recorder_url=county_cfg.recorder.url,
            party_name=party_name.strip(),
        )
        return self._run_cloud_task(task, RecorderResult, stage="recorder_party_search")

    def parcel_owner_lookup(
        self,
        address: str,
        city: str,
        county_cfg: CountyJurisdictionConfig,
    ) -> ParcelOwnerResult | None:
        portal = county_cfg.parcel_portal
        if not address.strip() or portal is None:
            return None
        if portal.owner_names_online is False:
            logger.debug("Parcel portal hides owner names for county")
            return None
        if not self.is_available():
            logger.debug("Skipping parcel lookup: %s", self.last_skip_reason)
            return None
        task = render_task(
            PARCELQUEST_TASK,
            parcel_url=portal.url,
            address=address.strip(),
            city=city.strip(),
            state_name=_state_display_name_for_county(county_cfg),
        )
        return self._run_cloud_task(task, ParcelOwnerResult, stage="parcel_owner_lookup")

    def loopnet_listing_lookup(
        self,
        search_query: str,
        city: str,
        state: str = "",
    ) -> LoopNetResult | None:
        if not search_query.strip():
            return None
        if not self.is_available():
            logger.debug("Skipping LoopNet lookup: %s", self.last_skip_reason)
            return None
        state_name = _STATE_DISPLAY_NAMES.get(state.lower(), state or "United States")
        task = render_task(
            LOOPNET_TASK,
            search_query=search_query.strip(),
            city=city.strip(),
            state_name=state_name,
        )
        return self._run_cloud_task(task, LoopNetResult, stage="loopnet_listing_lookup")

    def health_check(self) -> tuple[bool, str]:
        """Validate API key and fetch remaining USD balance."""
        if not self.settings.browser_use_api_key:
            return False, "MISSING — set BROWSER_USE_API_KEY in .env (key starts with bu_)"
        if not self.settings.browser_use_enabled:
            return False, "disabled — set BROWSER_USE_ENABLED=true to run owner-chain lookups"
        balance = self.account_balance()
        if balance is None:
            return False, self.last_skip_reason or "balance check failed"
        total = float(balance.get("total_credits_balance_usd") or 0.0)
        plan_info = balance.get("plan_info") or {}
        plan = plan_info.get("plan_name") or "unknown plan"
        return True, f"OK — ${total:.2f} USD balance remaining ({plan})"

    def account_balance(self) -> dict[str, Any] | None:
        """Fetch Browser Use credit balance and snapshot it into credit_snapshots."""
        if not self.settings.browser_use_api_key:
            self.last_skip_reason = "BROWSER_USE_API_KEY missing"
            return None
        try:
            from browser_use_sdk.v3 import BrowserUse

            client = BrowserUse(api_key=self.settings.browser_use_api_key)
            account = client.billing.account()
        except ImportError:
            self.last_skip_reason = "browser-use-sdk not installed"
            return None
        except Exception as exc:
            self.last_skip_reason = str(exc)[:200]
            logger.warning("Browser Use balance check failed: %s", exc)
            return None

        payload = account.model_dump(mode="json")
        if self.store is not None:
            self.store.record_credit_snapshot(
                provider="browser_use",
                remaining_credits=float(account.total_credits_balance_usd or 0.0),
                snapshot=payload,
            )
        return payload

    def _run_cloud_task(
        self,
        task: str,
        schema: type[BaseModel],
        *,
        stage: str,
    ) -> BaseModel | None:
        self.last_task_cost_usd = 0.0
        try:
            return asyncio.run(self._run_cloud_task_async(task, schema, stage=stage))
        except ImportError:
            self.last_skip_reason = "browser-use-sdk not installed"
            logger.warning(
                "browser-use-sdk not installed — install with: pip install browser-use-sdk"
            )
            return None
        except asyncio.TimeoutError:
            timeout_s = self.settings.browser_use_task_timeout_s
            self.last_skip_reason = f"task timed out after {timeout_s}s"
            logger.warning("Browser Use task timed out (%s) after %ss", stage, timeout_s)
            progress_emit(
                "owner_chain_failed",
                place_id=self.place_id,
                run_id=self.run_id,
                stage=stage,
                reason=self.last_skip_reason,
            )
            return None
        except Exception:
            logger.exception("Browser Use task failed (%s)", stage)
            return None

    async def _run_cloud_task_async(
        self,
        task: str,
        schema: type[BaseModel],
        *,
        stage: str,
    ) -> BaseModel | None:
        from browser_use_sdk.v3 import AsyncBrowserUse

        client = AsyncBrowserUse(api_key=self.settings.browser_use_api_key)
        workspace_id = await self._ensure_workspace(client)
        run_coro = client.run(
            task,
            output_schema=schema,
            workspace_id=workspace_id,
        )
        timeout_s = self.settings.browser_use_task_timeout_s
        started = time.perf_counter()
        if timeout_s > 0:
            result = await asyncio.wait_for(run_coro, timeout=timeout_s)
        else:
            result = await run_coro
        duration_ms = int((time.perf_counter() - started) * 1000)
        self._record_task_cost(result, stage=stage, duration_ms=duration_ms)
        output = getattr(result, "output", None)
        if output is None:
            return None
        if isinstance(output, schema):
            return output
        if isinstance(output, dict):
            return schema.model_validate(output)
        return schema.model_validate(output)

    def _record_task_cost(
        self, result: Any, *, stage: str, duration_ms: int | None = None
    ) -> None:
        """Persist one cost event per cloud task so every stage shows up in cost_events."""
        cost = float(
            getattr(result, "total_cost_usd", 0.0) or getattr(result, "llm_cost_usd", 0.0) or 0.0
        )
        self.last_task_cost_usd = cost
        self.total_cost_usd += cost
        if self.store is None or cost <= 0:
            return
        session = getattr(result, "session", result)
        status = getattr(session, "status", None)
        meta: dict[str, Any] = {
            "session_id": str(getattr(session, "id", "") or ""),
            "status": getattr(status, "value", str(status or "")),
            "step_count": getattr(session, "step_count", None),
            "llm_cost_usd": float(getattr(result, "llm_cost_usd", 0.0) or 0.0),
            "browser_cost_usd": float(getattr(result, "browser_cost_usd", 0.0) or 0.0),
            "proxy_cost_usd": float(getattr(result, "proxy_cost_usd", 0.0) or 0.0),
            "stage": stage,
        }
        if duration_ms is not None:
            meta["duration_ms"] = duration_ms
        self.store.record_cost_event(
            provider="browser_use",
            operation=stage,
            units=cost,
            unit_type="usd",
            usd=cost,
            run_id=self.run_id,
            place_id=self.place_id,
            model=str(getattr(session, "model", "") or "") or None,
            meta=meta,
        )
        self.store.commit_cost_events()
        session_payload: dict[str, Any] = dict(meta)
        if hasattr(result, "model_dump"):
            session_payload["result"] = result.model_dump(mode="json")
        session = getattr(result, "session", None)
        if session is not None and hasattr(session, "model_dump"):
            session_payload["session"] = session.model_dump(mode="json")
        steps = getattr(result, "steps", None)
        if steps is not None:
            session_payload["steps"] = steps
        record_capture(
            self.settings,
            "browser_use",
            stage,
            place_id=self.place_id,
            run_id=self.run_id,
            request={"task_stage": stage},
            response=session_payload,
            duration_ms=duration_ms,
        )

    async def _ensure_workspace(self, client: Any) -> str | None:
        if self.store is None:
            return None
        existing = self.store.get_app_state(_WORKSPACE_STATE_KEY)
        if existing:
            return existing
        workspaces = getattr(client, "workspaces", None)
        if workspaces is None or not hasattr(workspaces, "create"):
            return None
        created = await workspaces.create(name="pallares-owner-chain")
        workspace_id = str(getattr(created, "id", None) or created)
        self.store.set_app_state(_WORKSPACE_STATE_KEY, workspace_id)
        return workspace_id


__all__ = [
    "BrowserUseClient",
    "LoopNetBroker",
    "LoopNetPropertyFacts",
    "LoopNetResult",
    "OfficerRecord",
    "ParcelOwnerResult",
    "RecorderPartyMatch",
    "RecorderResult",
    "SosEntityCandidate",
    "SosEntityResult",
    "normalize_entity_name",
]
