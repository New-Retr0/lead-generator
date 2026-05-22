from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class Confidence(str, Enum):
    HIGH = "High"
    MEDIUM = "Medium"
    LOW = "Low"


class InvestigationStatus(str, Enum):
    DISCOVERED = "discovered"
    ENRICHED = "enriched"
    NEEDS_MANUAL = "needs_manual"
    SKIPPED = "skipped"


class RawLead(BaseModel):
    """Lead record after Google Places discovery."""

    place_id: str
    business_name: str
    formatted_address: str
    city: str
    state: str
    zip_code: str = ""
    latitude: float | None = None
    longitude: float | None = None
    property_type: str
    lead_category: str
    website: str | None = None
    google_maps_url: str | None = None
    main_phone: str | None = None
    google_types: list[str] = Field(default_factory=list)
    discovery_query: str = ""
    market_key: str = ""
    date_found: date = Field(default_factory=date.today)


class ExtractedContact(BaseModel):
    contact_type: str
    name: str | None = None
    role: str | None = None
    phone: str | None = None
    email_or_form: str | None = None
    source_url: str | None = None


class EnrichedLead(RawLead):
    """Lead after website scrape + contact resolution."""

    best_contact_type: str = "Not found"
    best_contact_name: str = "Not found"
    best_contact_role: str = "Not found"
    best_contact_phone: str = "Not found"
    best_contact_email_or_form: str = "Not found"
    contact_source_url: str = "Not found"
    property_manager_or_ownership_clue: str = "Not found"
    management_source_url: str = "Not found"
    exterior_cleaning_need_signals: str = ""
    why_this_is_a_good_fit: str = ""
    evidence_urls: list[str] = Field(default_factory=list)
    confidence: Confidence = Confidence.LOW
    notes: str = ""
    source_tool: str = "google_places+firecrawl"
    investigation_status: InvestigationStatus = InvestigationStatus.DISCOVERED


class ExportRow(BaseModel):
    """Flat CSV row — matches agreed schema."""

    lead_id: str
    business_name: str
    property_or_center_name: str
    address: str
    city: str
    state: str
    zip: str
    property_type: str
    lead_category: str
    website: str
    google_maps_url: str
    google_place_id: str
    main_phone: str
    best_contact_type: str
    best_contact_name: str
    best_contact_role: str
    best_contact_phone: str
    best_contact_email_or_form: str
    contact_source_url: str
    property_manager_or_ownership_clue: str
    management_source_url: str
    exterior_cleaning_need_signals: str
    why_this_is_a_good_fit: str
    evidence_urls: str
    confidence: Literal["High", "Medium", "Low"]
    notes: str
    date_found: str
    source_tool: str
    investigation_status: str

    @classmethod
    def from_enriched(cls, lead: EnrichedLead) -> ExportRow:
        return cls(
            lead_id=lead.place_id,
            business_name=lead.business_name,
            property_or_center_name=lead.business_name,
            address=lead.formatted_address,
            city=lead.city,
            state=lead.state,
            zip=lead.zip_code,
            property_type=lead.property_type,
            lead_category=lead.lead_category,
            website=lead.website or "Not found",
            google_maps_url=lead.google_maps_url or "Not found",
            google_place_id=lead.place_id,
            main_phone=lead.main_phone or "Not found",
            best_contact_type=lead.best_contact_type,
            best_contact_name=lead.best_contact_name,
            best_contact_role=lead.best_contact_role,
            best_contact_phone=lead.best_contact_phone,
            best_contact_email_or_form=lead.best_contact_email_or_form,
            contact_source_url=lead.contact_source_url,
            property_manager_or_ownership_clue=lead.property_manager_or_ownership_clue,
            management_source_url=lead.management_source_url,
            exterior_cleaning_need_signals=lead.exterior_cleaning_need_signals,
            why_this_is_a_good_fit=lead.why_this_is_a_good_fit,
            evidence_urls=" | ".join(lead.evidence_urls) if lead.evidence_urls else "Not found",
            confidence=lead.confidence.value,
            notes=lead.notes,
            date_found=lead.date_found.isoformat(),
            source_tool=lead.source_tool,
            investigation_status=lead.investigation_status.value,
        )

    @classmethod
    def csv_headers(cls) -> list[str]:
        return list(cls.model_fields.keys())
