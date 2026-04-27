# Yield Monitor

FastAPI dashboard for tracking manual product test yields.

## Stack
- **Backend:** Python 3.12 + FastAPI + SQLAlchemy
- **Database:** PostgreSQL (via `DATABASE_URL`); falls back to SQLite for local use
- **Frontend:** Server-rendered Jinja2 template + Chart.js (CDN)
- **Automation:** Selenium script (`test_yield.py`) for the 60% yield validation

## Project Layout
- `main.py` — FastAPI app, routes, and Pydantic schemas
- `database.py` — SQLAlchemy engine, session, and `ManualTest` model
- `templates/index.html` — Dashboard UI
- `static/test_yield.py` — Browser-viewable copy of the Selenium script
- `test_yield.py` — Selenium validation script

## Running on Replit
- Workflow `Start application` runs `uvicorn main:app --host 0.0.0.0 --port 5000`
- Server binds to port 5000 (Replit webview)
- PostgreSQL connection uses the `psycopg` (v3) driver — `database.py` rewrites
  `postgresql://` URLs to `postgresql+psycopg://` automatically.

## Deployment
- Target: `autoscale`
- Run: `uvicorn main:app --host 0.0.0.0 --port 5000`
