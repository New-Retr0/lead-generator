from __future__ import annotations

import json
from pathlib import Path

import pytest

from pallares_leads.utils.run_lock import PipelineLockedError, pipeline_lock


def test_pipeline_lock_blocks_second_acquire(tmp_path: Path) -> None:
    with pipeline_lock(tmp_path):
        with pytest.raises(PipelineLockedError):
            with pipeline_lock(tmp_path):
                pass


def test_stale_lock_with_dead_pid_is_replaced(tmp_path: Path) -> None:
    lock_path = tmp_path / ".pipeline.lock"
    lock_path.write_text(
        json.dumps({"pid": 999_999_999, "started": 0}),
        encoding="utf-8",
    )
    with pipeline_lock(tmp_path):
        assert lock_path.exists()
    assert not lock_path.exists()


def test_lock_removed_on_exit(tmp_path: Path) -> None:
    lock_path = tmp_path / ".pipeline.lock"
    with pipeline_lock(tmp_path):
        assert lock_path.is_file()
    assert not lock_path.exists()
