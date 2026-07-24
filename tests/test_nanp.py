from __future__ import annotations

from pallares_leads.utils.nanp import (
    is_phone_local_to_state,
    is_phone_out_of_state,
    phone_npa,
)


def test_phone_npa_parsing() -> None:
    assert phone_npa("(559) 638-1234") == "559"
    assert phone_npa("559-638-1234") == "559"
    assert phone_npa("+1 559 638 1234") == "559"
    assert phone_npa("18008675309") == "800"
    assert phone_npa("638-1234") is None
    assert phone_npa(None) is None
    assert phone_npa("not a phone") is None


def test_local_to_state_confident_cases() -> None:
    assert is_phone_local_to_state("559-638-1234", "CA") is True
    assert is_phone_local_to_state("808-555-1234", "HI") is True
    # 212 is a New York area code — confidently NOT local to a CA market.
    assert is_phone_local_to_state("212-555-1234", "CA") is False


def test_local_to_state_unknown_returns_none() -> None:
    # NY is outside our coverage — we must not judge.
    assert is_phone_local_to_state("212-638-1234", "NY") is None
    # Unparseable number — cannot judge.
    assert is_phone_local_to_state("bad", "CA") is None


def test_unrecognized_npa_in_covered_state_is_not_local() -> None:
    # A parseable area code that is not one of CA's codes is treated as not-local,
    # which only forbids the phone-only fast path (safe soft signal).
    assert is_phone_local_to_state("999-638-1234", "CA") is False
    assert is_phone_out_of_state("999-638-1234", "CA") is True


def test_out_of_state_only_true_when_confident() -> None:
    assert is_phone_out_of_state("212-638-1234", "CA") is True  # NY number, CA market
    assert is_phone_out_of_state("559-638-1234", "CA") is False  # local
    assert is_phone_out_of_state("212-638-1234", "NY") is False  # uncovered state
    assert is_phone_out_of_state(None, "CA") is False  # no number
    assert is_phone_out_of_state("559-638-1234", None) is False  # no state
