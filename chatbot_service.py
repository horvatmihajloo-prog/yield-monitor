import json
import os
from collections.abc import Generator
from datetime import datetime, timedelta
from typing import Any

from openai import OpenAI
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from database import ALLOWED_PART_NUMBERS, ManualTest, get_daily_counts_query

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")


SYSTEM_PROMPT = """You are a helpful assistant for the Yield Monitor manufacturing dashboard.
You answer questions about manual test data stored in the database.

Each test record has:
- serial_number: unit identifier
- part_number: one of 001PN001, 002PN002, 003PN003
- status: true = pass, false = fail
- timestamp: UTC datetime when the test was recorded

Key metrics:
- Yield % = (passed / total_tested) * 100 for a part
- Failed count = total_tested - passed

Always use the provided tools to fetch current data before answering factual questions.
Only cite numbers returned by the tools. If no data exists, say so clearly.
Be concise and use plain language suitable for manufacturing operators."""

TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "get_part_yield_stats",
            "description": (
                "Get yield statistics per part: total tested, passed, failed, and yield percent. "
                "Returns all allowed parts when part_number is omitted."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "part_number": {
                        "type": "string",
                        "description": "Optional filter: 001PN001, 002PN002, or 003PN003.",
                    }
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_overall_summary",
            "description": (
                "Get overall totals across all parts: total tests, passed, failed, "
                "overall yield percent, and count of unique serial numbers."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_daily_test_volume",
            "description": (
                "Get the number of tests recorded per day over a date range (inclusive). "
                "Defaults to the last 7 days ending today (UTC)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "days": {
                        "type": "integer",
                        "description": "Number of days to include, ending today. Default 7.",
                        "minimum": 1,
                        "maximum": 365,
                    }
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_recent_tests",
            "description": (
                "Get recent individual test records, newest first. "
                "Can filter by part number, pass/fail status, or serial number substring."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "description": "Max records to return (default 10, max 50).",
                        "minimum": 1,
                        "maximum": 50,
                    },
                    "part_number": {
                        "type": "string",
                        "description": "Optional filter: 001PN001, 002PN002, or 003PN003.",
                    },
                    "status": {
                        "type": "boolean",
                        "description": "Optional filter: true for passes only, false for failures only.",
                    },
                    "serial_number_contains": {
                        "type": "string",
                        "description": "Optional case-insensitive substring match on serial number.",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_tests_on_date",
            "description": "Get test counts and yield for a specific calendar date (YYYY-MM-DD, UTC).",
            "parameters": {
                "type": "object",
                "properties": {
                    "date": {
                        "type": "string",
                        "description": "Date in YYYY-MM-DD format.",
                    }
                },
                "required": ["date"],
            },
        },
    },
]


def _part_yield_stats(db: Session, part_number: str | None = None) -> list[dict[str, Any]]:
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

    parts = [part_number] if part_number else sorted(ALLOWED_PART_NUMBERS)
    results: list[dict[str, Any]] = []
    for pn in parts:
        if pn not in ALLOWED_PART_NUMBERS:
            continue
        row = by_part.get(pn)
        total = int(row.total_tested) if row else 0
        passed = int(row.passed) if row and row.passed is not None else 0
        failed = total - passed
        yield_percent = round((passed / total) * 100, 2) if total else 0.0
        results.append(
            {
                "part_number": pn,
                "total_tested": total,
                "passed": passed,
                "failed": failed,
                "yield_percent": yield_percent,
            }
        )
    return results


def _overall_summary(db: Session) -> dict[str, Any]:
    total = db.query(func.count(ManualTest.id)).scalar() or 0
    passed = (
        db.query(func.count(ManualTest.id)).filter(ManualTest.status.is_(True)).scalar() or 0
    )
    failed = total - passed
    unique_serials = db.query(func.count(func.distinct(ManualTest.serial_number))).scalar() or 0
    yield_percent = round((passed / total) * 100, 2) if total else 0.0
    return {
        "total_tests": int(total),
        "passed": int(passed),
        "failed": int(failed),
        "overall_yield_percent": yield_percent,
        "unique_serial_numbers": int(unique_serials),
        "allowed_part_numbers": sorted(ALLOWED_PART_NUMBERS),
    }


def _daily_test_volume(db: Session, days: int = 7) -> list[dict[str, Any]]:
    today = datetime.utcnow().date()
    start_day = today - timedelta(days=days - 1)
    start_date = datetime.combine(start_day, datetime.min.time())

    raw_counts = get_daily_counts_query(db, start_date)
    by_day: dict[str, int] = {}
    for row in raw_counts:
        key = row.day.isoformat() if hasattr(row.day, "isoformat") else str(row.day)
        by_day[key] = int(row.count)

    results: list[dict[str, Any]] = []
    for offset in range(days - 1, -1, -1):
        day = today - timedelta(days=offset)
        iso_day = day.isoformat()
        results.append({"date": iso_day, "count": by_day.get(iso_day, 0)})
    return results


def _recent_tests(
    db: Session,
    limit: int = 10,
    part_number: str | None = None,
    status: bool | None = None,
    serial_number_contains: str | None = None,
) -> list[dict[str, Any]]:
    query = db.query(ManualTest)
    if part_number:
        query = query.filter(ManualTest.part_number == part_number)
    if status is not None:
        query = query.filter(ManualTest.status.is_(status))
    if serial_number_contains:
        query = query.filter(ManualTest.serial_number.ilike(f"%{serial_number_contains.strip()}%"))

    records = query.order_by(ManualTest.timestamp.desc()).limit(limit).all()
    return [
        {
            "id": record.id,
            "serial_number": record.serial_number,
            "part_number": record.part_number,
            "status": "pass" if record.status else "fail",
            "timestamp": record.timestamp.isoformat() + "Z",
        }
        for record in records
    ]


def _tests_on_date(db: Session, date_str: str) -> dict[str, Any]:
    try:
        target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        return {"error": "Invalid date format. Use YYYY-MM-DD."}

    start = datetime.combine(target_date, datetime.min.time())
    end = start + timedelta(days=1)

    rows = (
        db.query(
            ManualTest.part_number.label("part_number"),
            func.count(ManualTest.id).label("total_tested"),
            func.sum(case((ManualTest.status.is_(True), 1), else_=0)).label("passed"),
        )
        .filter(ManualTest.timestamp >= start, ManualTest.timestamp < end)
        .group_by(ManualTest.part_number)
        .all()
    )

    by_part = {row.part_number: row for row in rows}
    per_part: list[dict[str, Any]] = []
    total = 0
    passed = 0
    for pn in sorted(ALLOWED_PART_NUMBERS):
        row = by_part.get(pn)
        part_total = int(row.total_tested) if row else 0
        part_passed = int(row.passed) if row and row.passed is not None else 0
        part_failed = part_total - part_passed
        total += part_total
        passed += part_passed
        per_part.append(
            {
                "part_number": pn,
                "total_tested": part_total,
                "passed": part_passed,
                "failed": part_failed,
                "yield_percent": round((part_passed / part_total) * 100, 2) if part_total else 0.0,
            }
        )

    return {
        "date": target_date.isoformat(),
        "total_tests": total,
        "passed": passed,
        "failed": total - passed,
        "overall_yield_percent": round((passed / total) * 100, 2) if total else 0.0,
        "by_part": per_part,
    }


def execute_tool(db: Session, name: str, arguments: dict[str, Any]) -> Any:
    if name == "get_part_yield_stats":
        part_number = arguments.get("part_number")
        if part_number and part_number not in ALLOWED_PART_NUMBERS:
            return {"error": f"Invalid part number. Allowed: {sorted(ALLOWED_PART_NUMBERS)}"}
        return _part_yield_stats(db, part_number)

    if name == "get_overall_summary":
        return _overall_summary(db)

    if name == "get_daily_test_volume":
        days = int(arguments.get("days", 7))
        days = max(1, min(days, 365))
        return _daily_test_volume(db, days)

    if name == "get_recent_tests":
        part_number = arguments.get("part_number")
        if part_number and part_number not in ALLOWED_PART_NUMBERS:
            return {"error": f"Invalid part number. Allowed: {sorted(ALLOWED_PART_NUMBERS)}"}
        limit = int(arguments.get("limit", 10))
        limit = max(1, min(limit, 50))
        status = arguments.get("status")
        if status is not None and not isinstance(status, bool):
            status = bool(status)
        return _recent_tests(
            db,
            limit=limit,
            part_number=part_number,
            status=status,
            serial_number_contains=arguments.get("serial_number_contains"),
        )

    if name == "get_tests_on_date":
        date_str = arguments.get("date", "")
        return _tests_on_date(db, date_str)

    return {"error": f"Unknown tool: {name}"}


def _accumulate_tool_calls(
    tool_calls_accum: dict[int, dict[str, str]], tool_call_deltas: list[Any]
) -> None:
    for tc_delta in tool_call_deltas:
        idx = tc_delta.index
        if idx not in tool_calls_accum:
            tool_calls_accum[idx] = {"id": "", "name": "", "arguments": ""}
        if tc_delta.id:
            tool_calls_accum[idx]["id"] = tc_delta.id
        if tc_delta.function:
            if tc_delta.function.name:
                tool_calls_accum[idx]["name"] = tc_delta.function.name
            if tc_delta.function.arguments:
                tool_calls_accum[idx]["arguments"] += tc_delta.function.arguments


def stream_chat_with_data(
    db: Session, messages: list[dict[str, str]]
) -> Generator[dict[str, str], None, None]:
    if not OPENAI_API_KEY:
        raise ValueError(
            "OPENAI_API_KEY is not configured. Set it in your environment to use the chatbot."
        )

    client = OpenAI(api_key=OPENAI_API_KEY)
    llm_messages: list[dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT}]
    llm_messages.extend(messages)

    for _ in range(6):
        stream = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=llm_messages,
            tools=TOOLS,
            tool_choice="auto",
            stream=True,
        )

        content_parts: list[str] = []
        tool_calls_accum: dict[int, dict[str, str]] = {}

        for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if delta.content:
                content_parts.append(delta.content)
                yield {"type": "token", "content": delta.content}
            if delta.tool_calls:
                _accumulate_tool_calls(tool_calls_accum, delta.tool_calls)

        if tool_calls_accum:
            ordered_calls = [tool_calls_accum[i] for i in sorted(tool_calls_accum)]
            llm_messages.append(
                {
                    "role": "assistant",
                    "content": "".join(content_parts) or None,
                    "tool_calls": [
                        {
                            "id": call["id"],
                            "type": "function",
                            "function": {
                                "name": call["name"],
                                "arguments": call["arguments"],
                            },
                        }
                        for call in ordered_calls
                    ],
                }
            )
            for call in ordered_calls:
                args = json.loads(call["arguments"] or "{}")
                result = execute_tool(db, call["name"], args)
                llm_messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call["id"],
                        "content": json.dumps(result),
                    }
                )
            continue

        final_text = "".join(content_parts).strip()
        if final_text:
            yield {"type": "done", "content": final_text}
            return

        yield {"type": "done", "content": "I couldn't generate a response. Please try rephrasing your question."}
        return

    yield {
        "type": "done",
        "content": "I need more steps to answer that. Please ask a more specific question.",
    }
