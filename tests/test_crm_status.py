"""Tests for CRM status storage."""

import uuid

from helpers import ensure_lead

from pallares_leads.db.store import CRM_STATUSES, LeadStore, normalize_crm_status


def test_normalize_crm_status():
    assert normalize_crm_status("contacted") == "Contacted"
    assert normalize_crm_status(" QUOTE  SENT ") == "Quote Sent"
    assert normalize_crm_status("Ready to call") is None
    assert normalize_crm_status(None) is None


def test_status_default_and_roundtrip(store: LeadStore) -> None:
    place_id = f"places/crm-{uuid.uuid4().hex[:12]}"
    ensure_lead(store, place_id)
    store.upsert_sales_feedback(place_id, addressed=True)
    assert store.get_crm_statuses([place_id])[place_id] == "New"
    store.upsert_sales_feedback(place_id, status="won")
    assert store.get_crm_statuses([place_id])[place_id] == "Won"
    store.upsert_sales_feedback(place_id, status="garbage")
    assert store.get_crm_statuses([place_id])[place_id] == "Won"
    assert "Won" in CRM_STATUSES
