from pallares_leads.enrich.contacts_format import format_contacts_block, primary_phone
from pallares_leads.pipeline.export_sheets import _safe_sheet_text
from pallares_leads.schemas import EnrichedLead, SiteContact


def test_safe_sheet_text_escapes_plus_phone() -> None:
    assert _safe_sheet_text("+1 559-638-5413") == "'+1 559-638-5413"


def test_format_contacts_block_lists_labeled_contacts() -> None:
    lead = EnrichedLead(
        place_id="x",
        business_name="Test",
        formatted_address="1 Main",
        city="Reedley",
        state="CA",
        property_type="gas_station",
        lead_category="Gas Station",
        site_contacts=[
            SiteContact(label="Store Manager", name="Jane Doe", phone="(559) 638-0100", priority="best"),
            SiteContact(label="Main line", phone="(559) 638-0200", priority="fallback"),
        ],
    )
    block = format_contacts_block(lead)
    assert "★ Store Manager" in block
    assert "Jane Doe" in block
    assert "638-0200" in block
    assert primary_phone(lead) == "(559) 638-0100"
