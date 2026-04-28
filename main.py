from datetime import datetime, timedelta
from typing import Generator

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field
from sqlalchemy import case, func
from sqlalchemy.orm import Session
from starlette.requests import Request

from database import (
    ALLOWED_PART_NUMBERS,
    ManualTest,
    SessionLocal,
    get_daily_counts_query,
    init_db,
)


app = FastAPI(title="Yield Monitor")
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")


class TestCreate(BaseModel):
    serial_number: str = Field(min_length=1)
    part_number: str
    status: bool


class TestOut(BaseModel):
    id: int
    serial_number: str
    part_number: str
    timestamp: datetime
    status: bool

    class Config:
        from_attributes = True


class PartStatsOut(BaseModel):
    part_number: str
    total_tested: int
    passed: int
    yield_percent: float


class DailyOut(BaseModel):
    date: str
    count: int


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/", response_class=HTMLResponse)
def dashboard(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(request, "index.html", {"request": request})


@app.post("/tests", response_model=TestOut)
def create_test(test: TestCreate, db: Session = Depends(get_db)) -> TestOut:
    serial_number = test.serial_number.strip()
    if not serial_number:
        raise HTTPException(status_code=400, detail="Serial number cannot be empty")

    if test.part_number not in ALLOWED_PART_NUMBERS:
        raise HTTPException(status_code=400, detail="Invalid part number")

    record = ManualTest(
        serial_number=serial_number,
        part_number=test.part_number,
        status=test.status,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


@app.get("/tests", response_model=list[TestOut])
def get_tests(db: Session = Depends(get_db)) -> list[TestOut]:
    return db.query(ManualTest).order_by(ManualTest.timestamp.desc()).all()


@app.get("/stats", response_model=list[PartStatsOut])
def get_stats(db: Session = Depends(get_db)) -> list[PartStatsOut]:
    rows = (
        db.query(
            ManualTest.part_number.label("part_number"),
            func.count(ManualTest.id).label("total_tested"),
            func.sum(case((ManualTest.status.is_(True), 1), else_=0)).label("passed"),
        )
        .group_by(ManualTest.part_number)
        .all()
    )
    by_part = {row.part_number: row for row in rows}

    stats: list[PartStatsOut] = []
    for part_number in sorted(ALLOWED_PART_NUMBERS):
        row = by_part.get(part_number)
        total = int(row.total_tested) if row else 0
        passed = int(row.passed) if row and row.passed is not None else 0
        yield_percent = round((passed / total) * 100, 2) if total else 0.0
        stats.append(
            PartStatsOut(
                part_number=part_number,
                total_tested=total,
                passed=passed,
                yield_percent=yield_percent,
            )
        )
    return stats


@app.get("/daily", response_model=list[DailyOut])
def get_daily(db: Session = Depends(get_db)) -> list[DailyOut]:
    today = datetime.utcnow().date()
    days = [today - timedelta(days=offset) for offset in range(6, -1, -1)]
    start_date = datetime.combine(days[0], datetime.min.time())

    raw_counts = get_daily_counts_query(db, start_date)
    by_day: dict[str, int] = {}
    for row in raw_counts:
        key = row.day.isoformat() if hasattr(row.day, "isoformat") else str(row.day)
        by_day[key] = int(row.count)

    results: list[DailyOut] = []
    for day in days:
        iso_day = day.isoformat()
        results.append(DailyOut(date=iso_day, count=by_day.get(iso_day, 0)))
    return results
