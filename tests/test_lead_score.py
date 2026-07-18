from pallares_leads.resolve.lead_score import compute_lead_score, is_decision_maker_contact
from pallares_leads.schemas import NOT_FOUND, EnrichedLead, InvestigationStatus, SiteContact


def _base_lead(**kwargs) -> EnrichedLead:
    data = dict(
        place_id="test",
        business_name="Test Plaza",
        formatted_address="100 Main St",
        city="Reedley",
        state="CA",
        property_type="strip_mall",
        lead_category="Strip Mall",
        investigation_status=InvestigationStatus.ENRICHED,
    )
    data.update(kwargs)
    return EnrichedLead(**data)


def test_owner_contact_scores_higher_than_front_desk() -> None:
    front_desk = _base_lead(
        best_contact_role="Reception",
        best_contact_phone="(559) 555-0100",
        main_phone="(559) 555-0100",
    )
    owner = _base_lead(
        best_contact_role="Property Manager",
        best_contact_phone="(559) 555-0200",
        exterior_cleaning_need_signals="parking lot, storefront canopy",
        site_contacts=[
            SiteContact(label="Property Manager", name="Jane Doe", phone="(559) 555-0200")
        ],
    )
    assert compute_lead_score(owner) > compute_lead_score(front_desk)


def test_osm_area_boosts_parking_score() -> None:
    small = _base_lead(property_type="parking_small", osm_area_m2=600)
    large = _base_lead(property_type="parking_large_private", osm_area_m2=12_000)
    assert compute_lead_score(large) >= compute_lead_score(small)


def test_decision_maker_detection() -> None:
    lead = _base_lead(
        best_contact_role="Facilities Director",
        best_contact_phone="(559) 555-0300",
    )
    assert is_decision_maker_contact(lead)

    generic = _base_lead(best_contact_role=NOT_FOUND, main_phone="(559) 555-0400")
    assert not is_decision_maker_contact(generic)


def test_score_breakdown_sums_to_lead_score() -> None:
    lead = _base_lead(
        best_contact_role="Property Manager",
        best_contact_phone="(559) 555-0200",
        exterior_cleaning_need_signals="parking lot, storefront canopy",
    )
    score = compute_lead_score(lead)
    assert lead.score_breakdown
    assert sum(lead.score_breakdown.values()) == score
    assert lead.why_now


def test_google_main_line_only_penalized_on_multi_tenant() -> None:
    google_only = _base_lead(
        main_phone="(559) 555-0100",
        best_contact_phone="(559) 555-0100",
        best_contact_role=NOT_FOUND,
        verification_level="unverified",
    )
    verified_dm = _base_lead(
        main_phone="(559) 555-0100",
        best_contact_role="Property Manager",
        best_contact_phone="(559) 555-0999",
        verification_level="verified",
        site_contacts=[
            SiteContact(
                label="Property Manager",
                name="Jane Doe",
                phone="(559) 555-0999",
                verification="verified",
            )
        ],
    )
    assert compute_lead_score(verified_dm) > compute_lead_score(google_only)


def test_property_manager_has_ticket_weight() -> None:
    pm = _base_lead(property_type="property_manager", lead_category="Property Manager")
    gas = _base_lead(property_type="gas_station", lead_category="Gas Station")
    compute_lead_score(pm)
    compute_lead_score(gas)
    assert pm.score_breakdown["ticket"] >= gas.score_breakdown["ticket"]

