"""Settings document synced across devices (GET/PUT /api/settings)."""

from __future__ import annotations

import logging
import threading
import time

from pydantic import ValidationError

from .db import Database
from .models import Settings

log = logging.getLogger("dubdeck.settings")
KEY = "settings"


class SettingsConflict(Exception):
    def __init__(self, current: Settings, updated_at: float) -> None:
        self.current = current
        self.updated_at = updated_at


class SettingsStore:
    def __init__(self, db: Database) -> None:
        self.db = db
        self._lock = threading.Lock()

    def get(self) -> tuple[Settings, float]:
        row = self.db.get_json(KEY)
        if row is None:
            return Settings(), 0.0
        data, updated_at = row
        try:
            return Settings.model_validate(data), updated_at
        except ValidationError as exc:
            log.error("stored settings invalid, falling back to defaults: %s", exc)
            return Settings(), 0.0

    def put(self, settings: Settings, base_updated_at: float | None) -> float:
        with self._lock:
            current, updated_at = self.get()
            if base_updated_at is not None and updated_at and abs(base_updated_at - updated_at) > 1e-6:
                raise SettingsConflict(current, updated_at)
            now = max(time.time(), updated_at + 0.001)
            self.db.set_json(KEY, settings.model_dump(mode="json"), now)
            return now
