"""Database engine and sessions: SQLAlchemy 2 on SQLite in WAL mode.

- In a request: `db: Session = Depends(get_db)`.
- In a background task (pipeline, scheduler): `with new_session() as db: ...`
  and commit yourself.
- Times are stored as ISO 8601 text in UTC: use now_iso() to write and
  parse_time() to read.

Hard rule: commit (or roll back) before every await of network or model I/O;
never hold uncommitted writes across an await. Every request and background
job shares one event loop, and SQLite has one writer: a session that has
flushed a write holds the write lock until it commits. Another coroutine that
writes meanwhile blocks the whole loop (busy_timeout), so the holder cannot
resume either, and the writer then fails with "database is locked".
"""

from collections.abc import Iterator
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import BACKEND_DIR, get_settings


class Base(DeclarativeBase):
    pass


_engine: Engine | None = None
_session_factory: sessionmaker[Session] | None = None


def resolve_database_url(url: str) -> str:
    """Make a relative SQLite path relative to backend/, and create its folder."""
    prefix = "sqlite:///"
    if not url.startswith(prefix) or url == prefix + ":memory:":
        return url
    path = Path(url[len(prefix):])
    if not path.is_absolute():
        path = BACKEND_DIR / path
    path.parent.mkdir(parents=True, exist_ok=True)
    return prefix + str(path)


def _set_sqlite_pragmas(dbapi_connection, _record) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    # Short on purpose: inside one event loop a wait never helps (see the rule
    # above), so a mistake should fail fast instead of freezing the app.
    cursor.execute("PRAGMA busy_timeout=1000")
    cursor.close()


def get_engine() -> Engine:
    global _engine, _session_factory
    if _engine is None:
        url = resolve_database_url(get_settings().database_url)
        connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
        _engine = create_engine(url, connect_args=connect_args)
        if url.startswith("sqlite"):
            event.listen(_engine, "connect", _set_sqlite_pragmas)
        _session_factory = sessionmaker(bind=_engine, expire_on_commit=False)
    return _engine


def reset_engine() -> None:
    """Forget the engine, so the next use reads the settings again (tests)."""
    global _engine, _session_factory
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _session_factory = None


def new_session() -> Session:
    """A new session. Use it as a context manager; it does not commit for you."""
    get_engine()
    assert _session_factory is not None
    return _session_factory()


def get_db() -> Iterator[Session]:
    """FastAPI dependency: one session per request."""
    with new_session() as db:
        yield db


def init_db() -> None:
    """Create the tables and the media folder. Safe to call more than once."""
    from app import models  # noqa: F401  (registers the tables)

    Base.metadata.create_all(get_engine())
    get_settings().media_path.mkdir(parents=True, exist_ok=True)
    (get_settings().media_path / "consent").mkdir(parents=True, exist_ok=True)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def now_iso() -> str:
    """Now, as stored in the database: ISO 8601 in UTC."""
    return utcnow().isoformat()


def to_iso(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def parse_time(value: str | None) -> datetime | None:
    """Read a stored time back as an aware UTC datetime (None stays None)."""
    if not value:
        return None
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def seconds_between(start: str | None, end: str | None) -> float | None:
    """Seconds from one stored time to another, or None if either is missing."""
    start_dt, end_dt = parse_time(start), parse_time(end)
    if start_dt is None or end_dt is None:
        return None
    return (end_dt - start_dt).total_seconds()
