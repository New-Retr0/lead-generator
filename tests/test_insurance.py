"""Tests for vendor insurance keyword scan."""

from pallares_leads.enrich.insurance import insurance_facts_from_pages


def test_finds_keyword_with_quote():
    pages = {"https://acmewash.com/about": "ACME is licensed and insured in Nevada."}
    facts = insurance_facts_from_pages(pages, ("licensed and insured", "insured"))
    assert len(facts) == 1
    fact = facts[0]
    assert fact.fact_kind == "insurance_mention"
    assert fact.value["keyword"] == "licensed and insured"
    assert "licensed and insured" in fact.quote.lower()
    assert fact.verification == "verified"
    assert fact.source_url == "https://acmewash.com/about"


def test_no_keywords_no_facts():
    assert insurance_facts_from_pages({"u": "fully insured"}, ()) == []


def test_caps_at_two_facts():
    pages = {f"https://x.com/{i}": "we are insured" for i in range(5)}
    assert len(insurance_facts_from_pages(pages, ("insured",))) == 2
