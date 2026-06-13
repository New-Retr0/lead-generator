from __future__ import annotations

import asyncio
from unittest.mock import patch

from pydantic import BaseModel

from pallares_leads.enrich.browser_use_client import BrowserUseClient
from pallares_leads.settings import Settings


class _Dummy(BaseModel):
    pass


def test_browser_use_timeout_returns_none() -> None:
    settings = Settings(
        browser_use_enabled=True,
        browser_use_api_key="bu_test",
        browser_use_task_timeout_s=1.0,
    )
    client = BrowserUseClient(settings)

    with patch.object(
        client,
        "_run_cloud_task_async",
        side_effect=asyncio.TimeoutError(),
    ):
        result = client._run_cloud_task("task", _Dummy, stage="sos_entity_lookup")

    assert result is None
    assert "timed out" in client.last_skip_reason
