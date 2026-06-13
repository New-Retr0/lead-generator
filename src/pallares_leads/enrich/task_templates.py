"""Frozen Browser Use task prompts — byte-stable for Cloud deterministic-rerun cache keys.

Only search values use @{{param}} placeholders; portal URLs are literal text.
Do not reword these constants without invalidating cached scripts.
"""

from __future__ import annotations

from pallares_leads.utils.safe_url import sanitize_task_param

CA_BIZFILE_TASK = (
    "Go to https://bizfileonline.sos.ca.gov/search/business and search for the entity "
    "@{{entity_name}}. Open the best matching active California business record. "
    "Return entity name, entity number, status, registered agent name and address, "
    "principal address, and officers or members with name and title. "
    "Do not purchase documents; use free public filing views only."
)

TYLER_EAGLE_TASK = (
    "Go to @{{recorder_url}} and open the grantor/grantee or party name search. "
    "Search for @{{party_name}}. Return matching party names and the most recent "
    "document type and recording date for each. Do not open or purchase paid deed images."
)

PARCELQUEST_TASK = (
    "Go to @{{parcel_url}} and search by street address for @{{address}} in "
    "@{{city}}, California. Return APN, situs address, owner name if shown online, "
    "mailing address if shown, and assessed owner type. Stop if owner names are hidden."
)

LOOPNET_TASK = (
    "Go to https://www.loopnet.com/ and search for commercial property listings matching "
    "@{{search_query}} in @{{city}}, California. Open the best matching property listing. "
    "Return listing URL, listed-by brokers with name company and phone, and property facts "
    "including building square feet lot square feet and property type."
)


def render_task(template: str, **params: str) -> str:
    """Replace @{{key}} placeholders with supplied values."""
    rendered = template
    for key, value in params.items():
        rendered = rendered.replace(f"@{{{{{key}}}}}", sanitize_task_param(value))
    return rendered
