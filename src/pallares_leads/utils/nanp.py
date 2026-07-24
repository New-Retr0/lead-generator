"""North American Numbering Plan (NANP) area-code → state lookup.

Used to tell whether a discovered phone number's area code is local to the market
we found it in. The product sells a *local callable* decision-maker phone, so a
national call-center / corporate-reservation number carrying an out-of-state area
code must not be trusted as the local line.

Coverage is the operating footprint (CA + expansion states). The verdict is
"unknown" (None) only when the market state is outside our coverage or the number
cannot be parsed — callers must NOT downgrade on None. Within a covered state, a
parseable number whose area code is not one of that state's codes is treated as
out-of-state (a corporate call-center line), which only *forbids the phone-only
fast path* — the lead still goes through full enrichment and can keep the number,
so there is no lead loss even on the rare miss of a newly added in-state code.
"""

from __future__ import annotations

from pallares_leads.utils.normalize import phone_digits

# Complete area-code sets for the operating states (established + known overlays).
STATE_NPAS: dict[str, frozenset[str]] = {
    "CA": frozenset(
        {
            "209", "213", "279", "310", "323", "341", "350", "408", "415", "424",
            "442", "510", "530", "559", "562", "619", "626", "628", "650", "657",
            "661", "669", "707", "714", "747", "760", "805", "818", "820", "831",
            "840", "858", "909", "916", "925", "949", "951",
        }
    ),
    "HI": frozenset({"808"}),
    "OR": frozenset({"458", "503", "541", "971"}),
    "WA": frozenset({"206", "253", "360", "425", "509", "564"}),
    "AZ": frozenset({"480", "520", "602", "623", "928"}),
    "NV": frozenset({"702", "725", "775"}),
    "NM": frozenset({"505", "575"}),
}


def phone_npa(value: str | None) -> str | None:
    """Return the 3-digit area code (NPA) of a US phone, or None if not parseable."""
    digits = phone_digits(value)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) != 10:
        return None
    return digits[:3]


def is_phone_local_to_state(value: str | None, state: str | None) -> bool | None:
    """True/False when we can judge; None when the NPA or state is not covered.

    None means "do not judge" — the caller must treat it as neutral, never as a
    downgrade.
    """
    npa = phone_npa(value)
    if not npa:
        return None
    npas = STATE_NPAS.get((state or "").strip().upper())
    if not npas:
        return None
    return npa in npas


def is_phone_out_of_state(value: str | None, state: str | None) -> bool:
    """True only when we are confident the number's area code is out-of-state.

    Confident = the state is in our coverage AND the NPA is recognized but not in
    that state's set. Unknown NPAs / uncovered states return False (never block).
    """
    return is_phone_local_to_state(value, state) is False
