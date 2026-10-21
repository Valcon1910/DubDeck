"""In-process pub/sub feeding the SSE stream at /api/events."""

from __future__ import annotations

import asyncio
import json
from typing import Any


class EventBus:
    def __init__(self) -> None:
        self._subs: set[asyncio.Queue[str]] = set()

    def subscribe(self) -> asyncio.Queue[str]:
        q: asyncio.Queue[str] = asyncio.Queue(maxsize=500)
        self._subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[str]) -> None:
        self._subs.discard(q)

    @staticmethod
    def format(event: str, data: Any) -> str:
        return f"event: {event}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n"

    def publish(self, event: str, data: Any) -> None:
        msg = self.format(event, data)
        for q in list(self._subs):
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                # A stalled client: drop it; it reconnects and gets a fresh snapshot.
                self._subs.discard(q)

    def is_subscribed(self, q: asyncio.Queue[str]) -> bool:
        return q in self._subs

    @property
    def subscriber_count(self) -> int:
        return len(self._subs)
