"""Dud gate — refuse to spend on leads that can never yield a callable named DM.

A "dud" is a discovered place that cannot become a Ready lead. The gate runs at two
points:

* **discovery admission** (`discovery_dud_reason`) — before any paid enrichment, off
  the raw Google Places signals. Permanently-closed and pure service-area places are
  already dropped upstream in ``discover.places._skip_place``; the remaining
  discovery dud is a temporarily-closed storefront (soft — it may reopen).
* **terminal** (`terminal_dud_reason`) — after the enrichment ladder finishes below
  the contact bar, to classify a genuinely unreachable outcome (no callable phone
  anywhere and no live website) so it is stored once and never re-scraped.

Duds are persisted with their reason via ``LeadStore.mark_dud``. Permanent reasons
never reopen; time-boxed reasons reopen after ``settings.dud_reopen_days`` so a
storefront that reopens or finally publishes a site is reconsidered later.
"""

from __future__ import annotations

from pallares_leads.enrich.contact_requirements import is_callable_phone
from pallares_leads.schemas import EnrichedLead, RawLead

# Reason codes (stored in leads.dud_reason).
DUD_CLOSED_PERMANENTLY = "closed_permanently"
DUD_CLOSED_TEMPORARILY = "closed_temporarily"
DUD_SERVICE_AREA = "service_area_no_premise"
DUD_DEAD_SITE_NO_PHONE = "dead_website_no_phone"
DUD_OPT_OUT = "opt_out"
DUD_TAKEDOWN = "takedown"

# Reasons that must never be re-discovered. Everything else is time-boxed and
# reopens after settings.dud_reopen_days.
PERMANENT_DUD_REASONS = frozenset(
    {DUD_CLOSED_PERMANENTLY, DUD_SERVICE_AREA, DUD_OPT_OUT, DUD_TAKEDOWN}
)


def discovery_dud_reason(raw: RawLead) -> str | None:
    """Reason to dud a freshly discovered place before spending, or None to proceed.

    CLOSED_PERMANENTLY and pure service-area businesses are already filtered in
    ``discover.places._skip_place`` (they never reach here). A temporarily-closed
    storefront is a soft dud — Google's flag is often stale, so it reopens after
    the time-box rather than being dropped forever.
    """
    if (raw.business_status or "").upper() == "CLOSED_TEMPORARILY":
        return DUD_CLOSED_TEMPORARILY
    return None


def _has_any_callable_phone(enriched: EnrichedLead) -> bool:
    if is_callable_phone(enriched.main_phone):
        return True
    if is_callable_phone(enriched.best_contact_phone):
        return True
    return any(is_callable_phone(contact.phone) for contact in enriched.site_contacts)


def terminal_dud_reason(enriched: EnrichedLead, *, website_alive: bool) -> str | None:
    """Reason to dud a lead whose enrichment finished without reaching the bar.

    Only the genuinely unreachable outcome is a dud: no callable phone anywhere AND
    no live website — there is no path left to a decision-maker, so re-scraping would
    only re-spend. Everything else stays a normal "researched miss" that can reopen
    on the shorter researched-miss window. Time-boxed (a site may appear later).
    """
    if _has_any_callable_phone(enriched):
        return None
    if website_alive:
        return None
    return DUD_DEAD_SITE_NO_PHONE
