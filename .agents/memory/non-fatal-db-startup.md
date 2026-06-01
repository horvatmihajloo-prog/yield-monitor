---
name: Non-fatal DB startup pattern
description: How and why DB init must be non-fatal in this project; pattern to restore after user GitHub pushes
---

The Replit-managed Neon endpoint (`ep-lingering-brook-ajzqejdm`) is disabled for direct external connections. Production connects directly to Neon (not through dev's helium proxy), so `init_db()` always crashes in production until/unless Replit fixes the endpoint.

**The rule:** `on_startup` must NEVER call `init_db()` directly. Always use the background-thread retry pattern.

**How to apply:** Every time the user pushes from GitHub, check `main.py` — if `on_startup` was reverted to `init_db()`, restore this pattern:

```python
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

@app.on_event("startup")
def on_startup() -> None:
    threading.Thread(target=_init_db_background, daemon=True).start()
```

Add `_: None = Depends(_require_db)` to every route that uses the DB (`/tests GET+POST`, `/stats`, `/daily`, `/chat`).

**Why:** Replit's publish pipeline also runs a DB diff check using the disabled endpoint — this is a separate infrastructure issue only Replit support can resolve. The non-fatal startup prevents production crash loops while that issue persists.
