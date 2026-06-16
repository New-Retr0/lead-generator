from __future__ import annotations

from pallares_leads.db.store import LeadStore
from pallares_leads.schemas import RawLead


def ensure_lead(store: LeadStore, place_id: str, *, business_name: str = "Test Lead") -> None:
    raw = RawLead(
        place_id=place_id,
        business_name=business_name,
        formatted_address="123 Main",
        city="Reedley",
        state="CA",
        property_type="gas_station",
        lead_category="Gas Station",
    )
    store.touch_discovered(
        raw,
        market_key="reedley",
        category_key="gas_station",
        run_id="test-run",
    )
