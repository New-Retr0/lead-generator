"""Cross-process lock so only one pipeline run executes at a time."""

from __future__ import annotations

import json
import logging
import os
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

logger = logging.getLogger(__name__)

STALE_AFTER_S = 6 * 3600


class PipelineLockedError(RuntimeError):
    pass


def _pid_alive(pid: int) -> bool:
    if os.name == "nt":
        import ctypes

        process_query_limited_information = 0x1000
        handle = ctypes.windll.kernel32.OpenProcess(
            process_query_limited_information, False, pid
        )
        if handle:
            ctypes.windll.kernel32.CloseHandle(handle)
            return True
        return False
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _lock_is_stale(lock_path: Path) -> bool:
    if not lock_path.exists():
        return True
    try:
        info = json.loads(lock_path.read_text(encoding="utf-8"))
        holder_pid = int(info.get("pid", 0))
        started = float(info.get("started", 0))
    except (ValueError, OSError, json.JSONDecodeError):
        return True
    return (time.time() - started) > STALE_AFTER_S or not _pid_alive(holder_pid)


def _acquire_lock_file(lock_path: Path) -> None:
    """Atomically create the lock file (O_EXCL) or fail if another run holds it."""
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps({"pid": os.getpid(), "started": time.time()}).encode("utf-8")
    flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY
    if hasattr(os, "O_BINARY"):
        flags |= os.O_BINARY
    for attempt in (1, 2):
        try:
            fd = os.open(str(lock_path), flags)
            try:
                os.write(fd, payload)
            finally:
                os.close(fd)
            return
        except FileExistsError:
            if _lock_is_stale(lock_path):
                logger.warning("Removing stale pipeline lock at %s", lock_path)
                lock_path.unlink(missing_ok=True)
                if attempt == 1:
                    continue
            raise PipelineLockedError(
                "Another pipeline run is active. "
                "Wait for it to finish, or delete data/.pipeline.lock if it crashed."
            ) from None


@contextmanager
def pipeline_lock(data_dir: Path) -> Iterator[None]:
    lock_path = data_dir / ".pipeline.lock"
    _acquire_lock_file(lock_path)
    try:
        yield
    finally:
        lock_path.unlink(missing_ok=True)
