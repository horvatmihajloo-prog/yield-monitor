# Yield Monitor Web Application

This project implements the practical exam requirements for a Yield Monitor dashboard:

- FastAPI backend with configurable database (SQLite or PostgreSQL)
- Dashboard with bar chart (7-day window with week navigation), pie chart, and dynamic yield gauge
- Part selection via legend; yield panel shows tested/passed counts for the selected part
- Manual test entry form in a modal (serial, part number, pass/fail)
- Selenium script to validate yield for part `001PN001` after inserting five controlled records

## Tech Stack

- **Backend:** Python, FastAPI, Pydantic, SQLAlchemy, Starlette
- **Database:** SQLite (default) or PostgreSQL via `DATABASE_URL`
- **Frontend:** HTML, CSS, JavaScript, Chart.js
- **Automation:** Selenium (Python), Chrome

## Project Structure

- `main.py` — FastAPI app, routes, and request/response models
- `database.py` — engine/session setup, `ManualTest` model, `ALLOWED_PART_NUMBERS`, daily-count query helper
- `templates/index.html` — dashboard layout and styles
- `static/dashboard.js` — charts, modal, API calls, week controls for the daily chart
- `static/chatbot.js` — floating AI chat widget
- `chatbot_service.py` — OpenAI integration with database query tools
- `test_yield.py` — Selenium validation script (project root)
- `static/test_yield.py` — copy served under `/static/` if you want to open the script in the browser
- `requirements.txt` — Python dependencies

## Run Locally

1. Install dependencies:

```bash
pip install -r requirements.txt
```

2. Start the server:

```bash
uvicorn main:app --reload
```

3. Open the app:

- Dashboard: [http://localhost:8000](http://localhost:8000)
- API docs: [http://localhost:8000/docs](http://localhost:8000/docs)

## Published App

- Dashboard: [https://yield-monitor--horvatmihajloo.replit.app/](https://yield-monitor--horvatmihajloo.replit.app/)

## Database Configuration

The app reads `DATABASE_URL` from the environment:

- If `DATABASE_URL` is not set, it uses local SQLite:
  - `sqlite:///./yield_monitor.db`
- If `DATABASE_URL` is set to PostgreSQL (for Replit/production), it uses that DB.

## AI Chatbot

The dashboard includes a floating **Ask AI** assistant that uses OpenAI to answer questions about stored test data (quantities, yield, daily volume, recent records).

Set these environment variables (or add them to a local `.env` file):

```bash
# Required for the chatbot
set OPENAI_API_KEY=sk-...

# Optional (defaults to gpt-4o-mini)
set OPENAI_MODEL=gpt-4o-mini
```

The app loads variables from `.env` automatically on startup. That file is gitignored and should not be committed.

Example questions:

- "What is the yield for part 001PN001?"
- "How many tests were recorded in the last 7 days?"
- "Show me the most recent failed tests."
- "What was the overall pass rate today?"

The chatbot uses function calling to query the database before answering, so responses are grounded in live data.

Examples:

```bash
# SQLite (default)
python -m uvicorn main:app --reload

# PostgreSQL (Windows cmd example)
set DATABASE_URL=postgresql://user:password@host:5432/dbname
python -m uvicorn main:app --reload
```

## Part Numbers

`POST /tests` only accepts these part numbers (defined in `database.py`):

- `001PN001`
- `002PN002`
- `003PN003`

`GET /stats` returns one row per allowed part (including parts with no tests yet).

## API Endpoints

- `POST /tests` — insert a manual test (`serial_number`, `part_number`, `status`)
- `GET /tests` — list all tests, newest first
- `GET /stats` — per-part totals, passes, and yield percentage for every allowed part
- `GET /daily` — seven consecutive days of test counts  
  - Optional query: `week_offset` (integer, `-52` … `52`, default `0`). Each step shifts the window by one week backward (`negative`) or forward; `0` is the current week ending today (UTC).
- `POST /chat` — stream AI assistant replies as Server-Sent Events (requires `OPENAI_API_KEY`)

## Run Selenium Test

1. Ensure the app is running at `http://localhost:8000` (or change `BASE_URL` in `test_yield.py`).
2. Use a Chrome installation compatible with your Selenium/WebDriver setup.
3. Run:

```bash
python test_yield.py
```

The script selects `001PN001` in the legend, records baseline tested/passed counts, opens the modal, adds five tests (three pass, two fail), re-selects the part, and compares the gauge percentage to the expected value.

Expected output:

- On a consistent baseline: `PASS: Expected …%, got …%`
- If the database already had data for that part, the expected percentage is derived from the baseline plus those five rows.

## Deployment

Can be deployed to Replit, Render, Railway, or PythonAnywhere with:
- startup command: `uvicorn main:app --host 0.0.0.0 --port 8000`
- on Replit, set `DATABASE_URL` in Secrets if using PostgreSQL
