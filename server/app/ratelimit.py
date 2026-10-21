"""In-memory sliding-window rate limiter (single process, single user)."""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque


class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int, window: float) -> float | None:
        """Record a hit. Returns None if allowed, else seconds until retry."""
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and q[0] <= now - window:
                q.popleft()
            if len(q) >= limit:
                return max(0.0, q[0] + window - now)
            q.append(now)
            if len(self._hits) > 10_000:
                self._prune(now)
            return None

    def _prune(self, now: float) -> None:
        for k in [k for k, q in self._hits.items() if not q or q[-1] < now - 3600]:
            del self._hits[k]


# (limit, window seconds) per route group
LIMITS: dict[str, tuple[int, float]] = {
    "auth": (20, 600),
    "preview": (60, 600),
    "jobs_create": (60, 600),
    "api": (600, 60),
    "file": (300, 60),
    "system": (5, 3600),
    "unauth": (60, 60),
}
