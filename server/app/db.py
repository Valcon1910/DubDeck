"""Tiny SQLite layer. One connection, one lock; the workload is a single user."""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any, Iterable

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    email      TEXT NOT NULL,
    name       TEXT,
    picture    TEXT,
    created_at REAL NOT NULL,
    last_seen  REAL NOT NULL,
    expires_at REAL NOT NULL,
    user_agent TEXT
);
CREATE TABLE IF NOT EXISTS jobs (
    id          TEXT PRIMARY KEY,
    url         TEXT NOT NULL,
    options     TEXT NOT NULL,
    status      TEXT NOT NULL,
    title       TEXT,
    channel     TEXT,
    thumbnail   TEXT,
    duration    REAL,
    error_code  TEXT,
    error_msg   TEXT,
    file_id     TEXT,
    created_at  REAL NOT NULL,
    started_at  REAL,
    finished_at REAL,
    attempts    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS jobs_created ON jobs(created_at);
CREATE TABLE IF NOT EXISTS files (
    id          TEXT PRIMARY KEY,
    job_id      TEXT,
    name        TEXT NOT NULL,
    disk_name   TEXT NOT NULL,
    kind        TEXT NOT NULL,
    ext         TEXT NOT NULL,
    size        INTEGER NOT NULL,
    quality     TEXT,
    duration    REAL,
    width       INTEGER,
    height      INTEGER,
    vcodec      TEXT,
    acodec      TEXT,
    title       TEXT,
    channel     TEXT,
    source_url  TEXT,
    has_thumb   INTEGER NOT NULL DEFAULT 0,
    created_at  REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS files_created ON files(created_at);
CREATE TABLE IF NOT EXISTS kv (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at REAL NOT NULL
);
"""


class Database:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA foreign_keys=ON")
            self._conn.executescript(SCHEMA)

    def execute(self, sql: str, params: Iterable[Any] = ()) -> int:
        with self._lock:
            cur = self._conn.execute(sql, tuple(params))
            return cur.rowcount

    def one(self, sql: str, params: Iterable[Any] = ()) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(sql, tuple(params)).fetchone()
        return dict(row) if row else None

    def all(self, sql: str, params: Iterable[Any] = ()) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(sql, tuple(params)).fetchall()
        return [dict(r) for r in rows]

    def get_json(self, key: str) -> tuple[Any, float] | None:
        row = self.one("SELECT value, updated_at FROM kv WHERE key = ?", (key,))
        if not row:
            return None
        return json.loads(row["value"]), row["updated_at"]

    def set_json(self, key: str, value: Any, updated_at: float) -> None:
        self.execute(
            "INSERT INTO kv(key, value, updated_at) VALUES(?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            (key, json.dumps(value, separators=(",", ":")), updated_at),
        )

    def close(self) -> None:
        with self._lock:
            self._conn.close()
