"""Timestamps for the API.

Every time is sent as UTC ISO-8601 ending in "Z", and the screens show it in Indian Standard
Time. Timestamp columns are "without time zone", so a stored value means a time in the
database session's time zone: PostgreSQL uses its TimeZone setting (Asia/Calcutta on an
Indian install), SQLite stores UTC.
"""

from __future__ import annotations

from datetime import datetime, timezone, tzinfo
from functools import lru_cache
from zoneinfo import ZoneInfo

from sqlalchemy import text


def utcnow() -> datetime:
    """Current time for writing to the database (time-zone aware, UTC)."""
    return datetime.now(timezone.utc)


@lru_cache(maxsize=1)
def _db_timezone() -> tzinfo:
    from app.db.session import engine

    if engine.dialect.name != "postgresql":
        return timezone.utc
    try:
        with engine.connect() as conn:
            return ZoneInfo(conn.execute(text("SHOW TIMEZONE")).scalar())
    except Exception:
        return timezone.utc


def iso_utc(value) -> str | None:
    """A database timestamp as e.g. '2026-10-07T16:35:01Z' (None when missing)."""
    if value in (None, ""):
        return None
    if isinstance(value, str):
        return value
    if value.tzinfo is None:
        value = value.replace(tzinfo=_db_timezone())
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
