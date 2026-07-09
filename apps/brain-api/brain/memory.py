"""
Persistent memory. Real database (SQLite for local dev, Postgres in
production via DATABASE_URL) — not an in-process list that vanishes
on restart.
"""
from datetime import datetime
from sqlalchemy import create_engine, Column, Integer, String, DateTime, Text
from sqlalchemy.orm import declarative_base, sessionmaker

from config import settings

Base = declarative_base()

engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False} if settings.DATABASE_URL.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class MemoryRow(Base):
    __tablename__ = "memory"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
    session_id = Column(String, index=True)
    kind = Column(String)  # observation | decision | summary
    content = Column(Text)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)


def write(session_id: str, kind: str, content: str) -> int:
    with SessionLocal() as db:
        row = MemoryRow(session_id=session_id, kind=kind, content=content)
        db.add(row)
        db.commit()
        db.refresh(row)
        return row.id


def recent(session_id: str, limit: int = 50) -> list[MemoryRow]:
    with SessionLocal() as db:
        return (
            db.query(MemoryRow)
            .filter(MemoryRow.session_id == session_id)
            .order_by(MemoryRow.id.desc())
            .limit(limit)
            .all()
        )


def recent_as_text(session_id: str, limit: int = 10) -> str:
    """Compact context block for feeding into the Claude prompt."""
    rows = recent(session_id, limit)
    if not rows:
        return "No prior memory for this session."
    lines = [f"[{r.timestamp.isoformat(timespec='seconds')}] ({r.kind}) {r.content}" for r in reversed(rows)]
    return "\n".join(lines)
