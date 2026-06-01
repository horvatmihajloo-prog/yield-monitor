import threading
import time
import logging
from datetime import datetime, timedelta
from typing import Generator

import json

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field
from sqlalchemy import case, func
from sqlalchemy.orm import Session
from starlette.requests import Request

from chatbot_service import stream_chat_with_data
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

_db_ready = False
_db_lock = threading.Lock()


def _init_db_background() -> None:
    global _db_ready
    delay = 1
    while True:
        try:
            init_db()
            with _db_lock:
                _db_ready = True
            logging.info("Database initialised successfully.")
            return
        except Exception as exc:
            logging.warning("DB not ready (%s); retrying in %ds…", exc, delay)
            time.sleep(delay)
            delay = min(delay * 2, 30)


def _require_db() -> None:
    if not _db_ready:
        raise HTTPException(status_code=503, detail="Database not ready yet, please retry shortly.")


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


class ChatMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@app.on_event("startup")
def on_startup() -> None:
    threading.Thread(target=_init_db_background, daemon=True).start()


@app.get("/", response_class=HTMLResponse)
def dashboard(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(request, "index.html", {"request": request})


@app.post("/tests", response_model=TestOut)
def create_test(test: TestCreate, db: Session = Depends(get_db), _: None = Depends(_require_db)) -> TestOut:
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
def get_tests(db: Session = Depends(get_db), _: None = Depends(_require_db)) -> list[TestOut]:
    return db.query(ManualTest).order_by(ManualTest.timestamp.desc()).all()


@app.get("/stats", response_model=list[PartStatsOut])
def get_stats(db: Session = Depends(get_db), _: None = Depends(_require_db)) -> list[PartStatsOut]:
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
def get_daily(
    week_offset: int = Query(0, ge=-52, le=52),
    db: Session = Depends(get_db),
    _: None = Depends(_require_db),
) -> list[DailyOut]:
    today = datetime.utcnow().date() + timedelta(days=week_offset * 7)
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


@app.post("/chat")
def chat(request: ChatRequest, db: Session = Depends(get_db), _: None = Depends(_require_db)) -> StreamingResponse:
    message_payload = [
        {"role": message.role, "content": message.content} for message in request.messages
    ]

    def event_stream():
        try:
            for event in stream_chat_with_data(db, message_payload):
                yield f"data: {json.dumps(event)}\n\n"
            yield "data: [DONE]\n\n"
        except ValueError as exc:
            yield f"data: {json.dumps({'type': 'error', 'content': str(exc)})}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'content': f'Chat service error: {exc}'})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
