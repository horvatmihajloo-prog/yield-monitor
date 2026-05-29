from typing import Any
from datetime import datetime
import os

from dotenv import load_dotenv
from sqlalchemy import Boolean, Column, DateTime, Integer, String, create_engine, func
from sqlalchemy.orm import Session, declarative_base, sessionmaker

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./yield_monitor.db")

# Replit PostgreSQL URLs are sometimes provided with the legacy scheme.
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# Use the psycopg (v3) driver explicitly since psycopg2 is not installed.
if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg://", 1)

engine_kwargs = {"pool_pre_ping": True}
if DATABASE_URL.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, **engine_kwargs)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


ALLOWED_PART_NUMBERS = {"001PN001", "002PN002", "003PN003"}


class ManualTest(Base):
    __tablename__ = "manual_tests"

    id = Column(Integer, primary_key=True, index=True)
    serial_number = Column(String, nullable=False, index=True)
    part_number = Column(String, nullable=False, index=True)
    timestamp = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    status = Column(Boolean, nullable=False, default=False)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)


def get_daily_counts_query(session: Session, start_date: datetime) -> list[Any]:
    return (
        session.query(
            func.date(ManualTest.timestamp).label("day"),
            func.count(ManualTest.id).label("count"),
        )
        .filter(ManualTest.timestamp >= start_date)
        .group_by(func.date(ManualTest.timestamp))
        .all()
    )
