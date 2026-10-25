"""Small TTL cache with a disk copy, used by the route-news feed.

Fresh entries (younger than ttl) are served directly. Older entries are kept, not deleted, so that when the live feed
fails the caller can still return the last good result and mark it stale. The clock is injectable so tests can move time.
Nothing here is shared with the NewsAPI classification pipeline (separate files, separate keys, no shared quota).
"""

import json
import re
import time
from pathlib import Path
from typing import Any, Callable


class TTLCache:
    def __init__(self, directory: Path | None, ttl_seconds: float, clock: Callable[[], float] = time.time):
        self.directory = directory
        self.ttl = ttl_seconds
        self.clock = clock
        self._mem: dict[str, dict[str, Any]] = {}
        if directory is not None:
            directory.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path | None:
        if self.directory is None:
            return None
        return self.directory / (re.sub(r"[^a-z0-9_.-]", "_", key.lower()) + ".json")

    def get(self, key: str) -> dict[str, Any] | None:
        """Returns {'fetched_at': epoch seconds, 'payload': ...} or None. May be older than ttl: check is_fresh()."""
        if key in self._mem:
            return self._mem[key]
        path = self._path(key)
        if path is not None and path.exists():
            try:
                entry = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(entry, dict) and "fetched_at" in entry and "payload" in entry:
                    self._mem[key] = entry
                    return entry
            except (OSError, ValueError):
                return None  # unreadable cache file: behave as a miss
        return None

    def is_fresh(self, entry: dict[str, Any]) -> bool:
        if entry.get("expired"):
            return False
        return (self.clock() - entry["fetched_at"]) < self.ttl

    def put(self, key: str, payload: Any) -> dict[str, Any]:
        entry = {"fetched_at": self.clock(), "payload": payload}
        self._mem[key] = entry
        path = self._path(key)
        if path is not None:
            try:
                path.write_text(json.dumps(entry), encoding="utf-8")
            except OSError:
                pass  # disk is a convenience; memory still works
        return entry

    def expire_all(self) -> int:
        """Mark every entry expired WITHOUT changing its fetched_at (used to prove the stale path). A stale answer must
        still report when its data was really fetched, so the timestamp is never rewritten; the next put() clears the flag."""
        n = 0
        keys = set(self._mem)
        if self.directory is not None:
            keys |= {p.stem for p in self.directory.glob("*.json")}
        for key in keys:
            entry = self.get(key)
            if entry is None:
                continue
            entry = {**entry, "expired": True}
            self._mem[key] = entry
            path = self._path(key)
            if path is not None:
                try:
                    path.write_text(json.dumps(entry), encoding="utf-8")
                except OSError:
                    pass
            n += 1
        return n
