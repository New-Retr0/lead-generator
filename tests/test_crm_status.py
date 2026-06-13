"""Tests for CRM status storage."""

from pallares_leads.db.store import CRM_STATUSES, normalize_crm_status


def test_normalize_crm_status():
    assert normalize_crm_status("contacted") == "Contacted"
    assert normalize_crm_status(" QUOTE  SENT ") == "Quote Sent"
    assert normalize_crm_status("Ready to call") is None
    assert normalize_crm_status(None) is None


def test_status_default_and_roundtrip(tmp_path):
    from pallares_leads.db.store import LeadStore

    store = LeadStore(tmp_path / "t.db")
    store.upsert_sales_feedback("p1", addressed=True)
    assert store.get_crm_statuses()["p1"] == "New"
    store.upsert_sales_feedback("p1", status="won")
    assert store.get_crm_statuses()["p1"] == "Won"
    store.upsert_sales_feedback("p1", status="garbage")
    assert store.get_crm_statuses()["p1"] == "Won"
    assert "Won" in CRM_STATUSES
    store.close()
