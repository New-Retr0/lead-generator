"""Frozen portal task prompts for Firecrawl owner-chain agent.

Only search values use @{{param}} placeholders; portal URLs are template params.
"""

from __future__ import annotations

from pallares_leads.utils.safe_url import sanitize_task_param

SOS_BIZFILE_TASK = (
    "Go to @{{portal_url}} and search for the entity "
    "@{{entity_name}}. Open the best matching active @{{state_name}} business record. "
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
    "@{{city}}, @{{state_name}}. Return APN, situs address, owner name if shown online, "
    "mailing address if shown, and assessed owner type. Stop if owner names are hidden."
)

LOOPNET_TASK = (
    "Go to https://www.loopnet.com/ and search for commercial property listings matching "
    "@{{search_query}} in @{{city}}, @{{state_name}}. Open the best matching property listing. "
    "Return listing URL, listed-by brokers with name company and phone, and property facts "
    "including building square feet lot square feet and property type."
)


CREXI_TASK = (
    "Go to https://www.crexi.com/ and search for commercial property listings matching "
    "@{{search_query}} in @{{city}}, @{{state_name}}. Open the best matching property listing. "
    "Return listing URL, listed-by brokers with name company and phone, and property facts "
    "including building square feet lot square feet and property type."
)

FBN_TASK = (
    "Go to @{{fbn_url}} and search for the fictitious business name @{{business_name}}. "
    "Return the registrant / owner name, filing number if shown, and mailing address if shown. "
    "Use free public index results only."
)


# Backward-compatible alias for tests referencing the CA template name.
CA_BIZFILE_TASK = SOS_BIZFILE_TASK


def render_task(template: str, **params: str) -> str:
    """Replace @{{key}} placeholders with supplied values."""
    rendered = template
    for key, value in params.items():
        rendered = rendered.replace(f"@{{{{{key}}}}}", sanitize_task_param(value))
    return rendered
