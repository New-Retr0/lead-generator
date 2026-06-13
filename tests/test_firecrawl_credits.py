from pallares_leads.enrich.firecrawl_client import FirecrawlClient


def test_credits_from_nested_data_metadata():
    payload = {
        "success": True,
        "data": {"metadata": {"creditsUsed": 5}},
    }
    assert FirecrawlClient._credits_from_payload(payload, operation="scrape") == 5


def test_search_fallback_estimate():
    payload = {"success": True, "data": {}}
    assert FirecrawlClient._credits_from_payload(payload, operation="search") == 2


def test_search_list_data_shape():
    payload = {"success": True, "data": [{"url": "https://bbb.org/example"}]}
    assert FirecrawlClient._credits_from_payload(payload, operation="search") == 2


def test_map_fallback_estimate():
    payload = {"success": True}
    assert FirecrawlClient._credits_from_payload(payload, operation="map") == 1


def test_normalize_team_credit_usage_v2_payload():
    payload = {
        "success": True,
        "data": {
            "remainingCredits": 1496,
            "planCredits": 8000,
            "billingPeriodEnd": "2026-06-23T04:03:59.000Z",
        },
    }
    normalized = FirecrawlClient.normalize_team_credit_usage(payload)
    assert normalized["remainingCredits"] == 1496
    assert normalized["usedCredits"] == 6504
    assert normalized["planCredits"] == 8000


def test_normalize_team_credit_usage_v1_payload():
    payload = {"remainingCredits": 120, "usedCredits": 880, "planCredits": 1000}
    normalized = FirecrawlClient.normalize_team_credit_usage(payload)
    assert normalized["remainingCredits"] == 120
    assert normalized["usedCredits"] == 880
