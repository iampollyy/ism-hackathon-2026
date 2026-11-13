# Callback back end

FastAPI + SQLite. The specs are `docs/backend.md` (authoritative), `docs/ai.md`
(voice agents, model jobs, prompts, readiness) and the "Technical design"
section of `docs/idea.md`.

## Set-up

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env    # only if you have no .env yet; fill in the values
```

Needs Python 3.12 and `ffmpeg` on the machine.

## Run

```bash
cd backend
.venv/bin/uvicorn app.main:app --reload --port 8000
```

Vite proxies `/api` to port 8000. Run one process only (no `--workers`), or
the live streams split. Tables and the `data/` and `media/` folders are made
on start-up.

### FAKE_ELEVENLABS

`FAKE_ELEVENLABS=true` makes every ElevenLabs call return fakes (token,
conversation id, voice id), so the whole flow runs without voice and without
spending credit:

```bash
FAKE_ELEVENLABS=true .venv/bin/uvicorn app.main:app --reload --port 8000
```

### The fake phone

`scripts/fake_phone.py` drives the whole practice path over HTTP (family,
voice upload, practice call, answer, events, end, scoring, family number):

```bash
FAKE_ELEVENLABS=true .venv/bin/uvicorn app.main:app --port 8765 &
.venv/bin/python scripts/fake_phone.py http://localhost:8765
```

It prints PASS or FAIL per step. It fails against the stubs until tracks A,
B and C are done.

## Tests

```bash
cd backend
.venv/bin/pytest -q
```

Each test gets a fresh SQLite file, `FAKE_ELEVENLABS=true`, the scheduler
off and all outside API keys blanked (`tests/conftest.py`). Fixtures:
`client` (TestClient), `db` (a session on the same database), `make_family`.
Spec tests from the independent test writers live in `tests/spec/`.

## Stubs

Every endpoint in backend.md's API table answers already, with a fixed
sample of the right shape. Stubs are marked `# STUB (track X): replace`;
stub functions are marked `# OWNER: track X` in their docstring and raise
`NotImplementedError` (except `agents.director.improve_brief`, which returns
`None`). Find what is left with `grep -rn "STUB (track" app`.

## File ownership

Paths under `backend/`. Edit only files you own; ask for changes elsewhere.

| Owner | Files |
|---|---|
| Shared (foundation, frozen) | `app/main.py`, `app/config.py`, `app/db.py`, `app/models.py`, `app/schemas.py`, `app/ids.py`, `app/events.py`, `app/routers/families.py`, `app/routers/__init__.py`, `app/services/__init__.py`, `app/agents/__init__.py`, `tests/conftest.py`, `tests/test_families.py`, `tests/test_health.py`, `tests/test_events.py`, `tests/test_config.py`, `tests/spec/__init__.py`, `scripts/fake_phone.py`, `requirements.txt`, `pytest.ini`, `.env.example`, `README.md` |
| Track A (ElevenLabs, voice, sessions) | `app/services/elevenlabs.py`, `app/services/audio.py`, `app/services/sessions.py`, `app/services/briefs.py`, `app/services/scenarios.py`, `app/scenarios/*.json`, `app/routers/voice.py`, `app/routers/scenarios.py`, `voice_agents/*`, `tests/test_elevenlabs.py`, `tests/test_voice.py`, `tests/test_sessions.py`, `tests/test_briefs.py` |
| Track B (calls and phones) | `app/routers/calls.py`, `app/routers/streams.py`, `app/routers/phone.py`, `app/services/scheduler.py`, `tests/test_calls.py`, `tests/test_phone.py`, `tests/test_stream.py`, `tests/test_scheduler.py` |
| Track C (AI and rules) | `app/agents/*` (except `__init__.py`), `app/services/outcome.py`, `app/services/readiness.py`, `app/services/pipeline.py`, `app/services/firecrawl.py`, `app/routers/weekly.py`, `tests/test_outcome.py`, `tests/test_readiness.py`, `tests/test_pipeline.py`, `tests/test_agents.py`, `tests/fixtures/*`, `scripts/eval_scorer.py` |
| Spec tests (independent writers) | `tests/spec/test_track_a.py`, `tests/spec/test_track_b.py`, `tests/spec/test_track_c.py` |

## Where endpoints live

| Endpoint | Router | Track |
|---|---|---|
| `GET /api/health`, `POST /api/families`, `GET /api/families/{id}` | `families.py` | shared |
| `POST /api/families/{id}/weekly-run` | `weekly.py` | C |
| `POST`/`DELETE /api/members/{id}/voice`, `POST /api/members/{id}/opt-out` | `voice.py` | A |
| `GET /api/scenarios` | `scenarios.py` | A |
| `POST /api/members/{id}/welcome-call`, `POST /api/practice-calls`, `POST /api/calls/{id}/answer`, `/decline`, `/events`, `/end`, `GET /api/calls/{id}` | `calls.py` | B |
| `GET /api/calls/{id}/events` (stream) | `streams.py` | B |
| `GET /api/members/{id}/phone-state`, `POST /api/members/{id}/messages/read`, `POST /api/members/{id}/family-line` | `phone.py` | B |

## Conventions

- Raise `schemas.ApiError(status, code, message)` for errors; `main.py` turns
  it into `{"error": {"code", "message"}}`. Validation errors become `422
  invalid_request`.
- Times are ISO 8601 UTC text: `db.now_iso()`, `db.parse_time()`,
  `db.seconds_between()`.
- Background work: `services.run_in_background(coro, name)`; it opens its own
  session with `db.new_session()`.
- Events: `events.publish(call_id, type, data, db=None)`; commit your own
  writes first, or pass `db` (publish then commits it). If that commit fails,
  publish raises and stores nothing; roll back your session yourself.
- **Hard rule: commit (or roll back) before every await of network or model
  I/O; never hold uncommitted writes across an await.** Everything runs on
  one event loop and SQLite has one writer, so a flushed, uncommitted write
  held across an await blocks every other writer and ends in "database is
  locked" (busy_timeout is 1 s). Examples: answer commits status and
  answered_at, then awaits `sessions.build_session`; the pipeline commits
  before awaiting the scorer or planner.
- A practice call is only ever made by `calls.create_practice(...)` (track
  B), which runs the consent gate `calls.check_practice_gate(...)`. The
  weekly run calls it with `check_phone_online=False`; the scheduler re-runs
  the gate before ringing a scheduled practice.
- `callback_seconds`: family-line stores it on the practice call (and on the
  result, plus a new readiness snapshot via `readiness.apply_callback`, if
  scoring has finished); the pipeline re-reads it from the call, with no
  await in between, when it inserts the result.
- The safe word is never collected: only `families.safe_word_set` exists.
