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


NOT_FOUND = "Not found"


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


class SiteContact(BaseModel):
    """Someone reachable at the property — from website / Firecrawl."""

    label: str = ""
    name: str = ""
    phone: str = ""
    email: str = ""
    priority: str = ""  # best | good | fallback


class ExtractedContact(BaseModel):
    contact_type: str
    name: str | None = None
    role: str | None = None
    phone: str | None = None
    email_or_form: str | None = None
    source_url: str | None = None


class EnrichedLead(RawLead):
    """Lead after Firecrawl investigation."""

    best_contact_type: str = NOT_FOUND
    best_contact_name: str = NOT_FOUND
    best_contact_role: str = NOT_FOUND
    best_contact_phone: str = NOT_FOUND
    best_contact_email_or_form: str = NOT_FOUND
    contact_source_url: str = NOT_FOUND
    property_manager_or_ownership_clue: str = NOT_FOUND
    management_source_url: str = NOT_FOUND
    exterior_cleaning_need_signals: str = ""
    why_this_is_a_good_fit: str = ""
    sales_talking_points: str = ""
    site_contacts: list[SiteContact] = Field(default_factory=list)
    evidence_urls: list[str] = Field(default_factory=list)
    confidence: Confidence = Confidence.LOW
    notes: str = ""
    source_tool: str = "google_places+firecrawl"
    investigation_status: InvestigationStatus = InvestigationStatus.DISCOVERED

    def sales_status(self) -> str:
        has_outreach = bool(self._callable_contacts())
        if self.investigation_status == InvestigationStatus.ENRICHED and has_outreach:
            return "Ready to call"
        if self.main_phone and has_outreach:
            return "Ready to call"
        return "Needs research"

    def _callable_contacts(self) -> list[SiteContact]:
        found: list[SiteContact] = []
        for contact in self.site_contacts:
            if contact.phone or (contact.email and "@" in contact.email):
                found.append(contact)
        if found:
            return found
        if self.best_contact_phone not in ("", NOT_FOUND) or (
            self.best_contact_email_or_form not in ("", NOT_FOUND)
            and "@" in self.best_contact_email_or_form
        ):
            return [SiteContact()]
        return []


class SalesExportRow(BaseModel):
    """Slim sales-outreach export schema."""

    addressed: str = ""
    confidence: Literal["High", "Medium", "Low"]
    status: str
    date: str
    business: str
    category: str
    city: str
    address: str
    phone: str
    contacts: str
    why_call: str
    talking_points: str
    exterior_notes: str
    website: str
    maps: str
    notes: str
    place_id: str = Field(serialization_alias="_place_id")

    @classmethod
    def from_enriched(cls, lead: EnrichedLead) -> SalesExportRow:
        from pallares_leads.enrich.contacts_format import format_contacts_block, primary_phone
        from pallares_leads.enrich.website_discover import website_link_url

        return cls(
            confidence=lead.confidence.value,
            status=lead.sales_status(),
            date=lead.date_found.isoformat(),
            business=lead.business_name,
            category=lead.lead_category,
            city=lead.city,
            address=lead.formatted_address,
            phone=primary_phone(lead),
            contacts=format_contacts_block(lead),
            why_call=lead.why_this_is_a_good_fit,
            talking_points=lead.sales_talking_points,
            exterior_notes=lead.exterior_cleaning_need_signals,
            website=website_link_url(lead),
            maps=lead.google_maps_url or "",
            notes=lead.notes,
            place_id=lead.place_id,
        )

    @classmethod
    def csv_headers(cls) -> list[str]:
        return [
            "addressed", "confidence", "status", "date", "business", "category", "city",
            "address", "phone", "contacts", "why_call", "talking_points", "exterior_notes",
            "website", "maps", "notes", "_place_id",
        ]
