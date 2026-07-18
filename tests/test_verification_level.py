from pallares_leads.resolve.verification import compute_verification_level
from pallares_leads.schemas import EnrichedLead, LeadFact, SiteContact


def test_verified_when_person_and_phone_grounded():
    lead = EnrichedLead(
        place_id="x",
        business_name="Test",
        formatted_address="1 Main",
        city="Reedley",
        state="CA",
        property_type="auto_dealer",
        lead_category="auto_dealer",
        main_phone="(559) 743-7184",
        site_contacts=[
            SiteContact(
                name="Ahmad A. Jaber",
                phone="(559) 743-7184",
                label="Facilities Manager",
                verification="verified",
                source_url="https://bbb.org/profile",
            ),
        ],
    )
    assert compute_verification_level(lead) == "verified"


def test_partial_when_phone_only():
    lead = EnrichedLead(
        place_id="x",
        business_name="Test",
        formatted_address="1 Main",
        city="Reedley",
        state="CA",
        property_type="auto_dealer",
        lead_category="auto_dealer",
        site_contacts=[
            SiteContact(
                phone="(559) 743-7184",
                label="Main line",
                verification="verified",
            ),
        ],
    )
    assert compute_verification_level(lead) == "partial"


def test_bbb_person_fact_with_nameless_phone_is_partial():
    """BBB/SOS person facts alone must not upgrade to verified."""
    lead = EnrichedLead(
        place_id="x",
        business_name="Test",
        formatted_address="1 Main",
        city="Reedley",
        state="CA",
        property_type="auto_dealer",
        lead_category="auto_dealer",
        site_contacts=[
            SiteContact(phone="(559) 743-7184", verification="verified"),
        ],
        facts=[
            LeadFact(
                fact_kind="person",
                value={"name": "Ahmad A. Jaber", "title": "President"},
                source_kind="bbb",
                verification="verified",
            ),
        ],
    )
    assert compute_verification_level(lead) == "partial"


def test_unverified_when_nothing_grounded():
    lead = EnrichedLead(
        place_id="x",
        business_name="Test",
        formatted_address="1 Main",
        city="Reedley",
        state="CA",
        property_type="auto_dealer",
        lead_category="auto_dealer",
    )
    assert compute_verification_level(lead) == "unverified"


def test_google_main_phone_only_is_partial():
    lead = EnrichedLead(
        place_id="x",
        business_name="Test",
        formatted_address="1 Main",
        city="Reedley",
        state="CA",
        property_type="auto_dealer",
        lead_category="auto_dealer",
        main_phone="(559) 743-7184",
    )
    assert compute_verification_level(lead) == "partial"
