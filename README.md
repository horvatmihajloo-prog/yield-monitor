# Yield Monitor Web Application

This project implements the practical exam requirements for a Yield Monitor dashboard:
- FastAPI backend with configurable database (SQLite or PostgreSQL)
- Dashboard with bar chart, pie chart, and dynamic yield gauge
- Manual test entry form in a modal
- Selenium script to validate 60% yield for part `001PN001`

## Tech Stack

- **Backend:** Python, FastAPI, SQLAlchemy
- **Database:** SQLite (default) or PostgreSQL via `DATABASE_URL`
- **Frontend:** HTML, CSS, JavaScript, Chart.js
- **Automation:** Selenium (Python)

## Project Structure

- `main.py` - FastAPI entry point and API routes
- `database.py` - database setup and model
- `templates/index.html` - dashboard HTML/CSS layout
- `static/dashboard.js` - dashboard JavaScript logic (charts, modal events, API calls)
- `test_yield.py` - Selenium validation script
- `static/test_yield.py` - browser-viewable script endpoint via `/static/test_yield.py`
- `requirements.txt` - dependencies

## Run Locally

1. Install dependencies:

```bash
pip install -r requirements.txt
```

2. Start server:

```bash
uvicorn main:app --reload
```

3. Open app:
- Dashboard: [http://localhost:8000](http://localhost:8000)
- API docs: [http://localhost:8000/docs](http://localhost:8000/docs)

## Published App

- Dashboard: [https://yield-monitor--horvatmihajloo.replit.app/](https://yield-monitor--horvatmihajloo.replit.app/)

## Database Configuration

The app reads `DATABASE_URL` from environment variables:

- If `DATABASE_URL` is not set, it uses local SQLite:
  - `sqlite:///./yield_monitor.db`
- If `DATABASE_URL` is set to PostgreSQL (for Replit/production), it uses that DB.

Examples:

```bash
# SQLite (default behavior)
python -m uvicorn main:app --reload

# PostgreSQL
set DATABASE_URL=postgresql://user:password@host:5432/dbname
python -m uvicorn main:app --reload
```

## API Endpoints

- `POST /tests` - insert manual test record
- `GET /tests` - list all records
- `GET /stats` - per-part yield statistics
- `GET /daily` - daily test count for last 7 days

## Run Selenium Test

1. Ensure app is running at `http://localhost:8000`.
2. Run:

```bash
python test_yield.py
```

Expected output should show:
- For a clean database: `PASS: Expected 60.0%, got 60.0%`
- If existing records are already present, expected value is calculated from current baseline data plus the 5 inserted test records.

## Deployment

Can be deployed to Replit, Render, Railway, or PythonAnywhere with:
- startup command: `uvicorn main:app --host 0.0.0.0 --port 8000`
- on Replit, set `DATABASE_URL` in Secrets if using PostgreSQL
