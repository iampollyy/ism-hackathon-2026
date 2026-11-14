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
.venv/bin/uvicorn app.main:app --reload --timeout-graceful-shutdown 3 --port 8000
```

Vite proxies `/api` to port 8000. Run one process only (no `--workers`), or
the live streams split. Tables and the `data/` and `media/` folders are made
on start-up.

Keep `--timeout-graceful-shutdown 3`: an open live stream otherwise stops
uvicorn from exiting or reloading (it waits for every connection), and every
`/api` request fails until the laptop tab is closed. Streams of finished
calls end on their own.

### FAKE_ELEVENLABS

`FAKE_ELEVENLABS=true` makes every ElevenLabs call return fakes (token,
conversation id, voice id), so the whole flow runs without voice and without
spending credit:

```bash
FAKE_ELEVENLABS=true .venv/bin/uvicorn app.main:app --reload --timeout-graceful-shutdown 3 --port 8000
```

### The fake phone

`scripts/fake_phone.py` drives the whole practice path over HTTP (family,
voice upload, practice call, answer, events, end, scoring, family number):

```bash
FAKE_ELEVENLABS=true .venv/bin/uvicorn app.main:app --timeout-graceful-shutdown 3 --port 8765 &
.venv/bin/python scripts/fake_phone.py http://localhost:8765
```

It prints PASS or FAIL per step.

### A real call with the test phone page

Until the front end has its phone page, `GET /api/dev/phone/{member_id}`
serves a bare one (`app/static/dev_phone.html`): it rings, answers with the
real ElevenLabs session, sends the events, shows the reveal and the family
number. It uses only the public phone endpoints.

```bash
.venv/bin/uvicorn app.main:app --timeout-graceful-shutdown 3 --port 8000   # without FAKE_ELEVENLABS
cloudflared tunnel --url http://localhost:8000                               # prints https://….trycloudflare.com
.venv/bin/python scripts/dev_call.py setup --voice ~/Desktop/me.m4a --public https://….trycloudflare.com
# open the printed link on your phone, tap "Tap to switch on sound", then:
.venv/bin/python scripts/dev_call.py ring                      # cloned voice (your own recording)
.venv/bin/python scripts/dev_call.py ring --scenario bank_security   # library voice
.venv/bin/python scripts/dev_call.py status                    # turns, tactics, result
```

Record 30 to 60 seconds of your own voice for `--voice`.

On the deployed server no tunnel is needed: use `--base https://callback.denishoti.dev`
for every `dev_call.py` command (and no `--public`), and open the printed link
on the phone. See `deploy/README.md`.

### Web Push

Off until both VAPID keys are set. To turn it on, print a pair and paste the
two lines into `.env` yourself (the script writes no file):

```bash
.venv/bin/python scripts/make_vapid_keys.py
```

A new pair makes every stored subscription useless; the phones subscribe
again. The endpoints, the payload and the front-end recipe are in
`docs/backend.md`, "Waking the phone: Web Push".

## Tests

```bash
cd backend
.venv/bin/pytest -q
```

Each test gets a fresh SQLite file, `FAKE_ELEVENLABS=true`, the scheduler
and the live risk check off (`tests/test_risk.py` turns the check back on)
and all outside API keys blanked (`tests/conftest.py`). Fixtures:
`client` (TestClient), `db` (a session on the same database), `make_family`.
Spec tests from the independent test writers live in `tests/spec/`.

## Live tests

`tests/live/` calls the real ElevenLabs, OpenAI, Anthropic and Firecrawl
APIs with the keys and ids in `backend/.env`. They are marked `live` and left
out of the default run (`pytest.ini`: `-m "not live"`):

```bash
cd backend
.venv/bin/pytest -m live -v              # about 80 s and a few cents
LIVE_CLONE=1 .venv/bin/pytest -m live -v # also clones a voice and deletes it (uses a voice slot for a moment)
```

They still get a temporary database and media folder, with the scheduler
off. A test skips, naming the setting, when a key or id it needs is not set.
What they check:

- ElevenLabs: the key works and characters are left; each agent exists, has
  authentication on, its client tools from `voice_agents/tools.json` (and no
  others), `end_call` on, a placeholder for every variable the back end sends
  (and the prompt uses no variable it does not send); the practice agent
  allows the voice, prompt and first-message overrides; the three library
  voices exist; `elevenlabs.conversation_token` works for each agent.
- Each model job once on a fixture input: a model answered (not the
  fallback), the first choice did not fail, and no attempt took longer than
  the job's limit in `app/agents/llm.py`.
- Firecrawl: the weekly run's pages come back with usable text.
- The practice path in process (like `scripts/fake_phone.py`) with real
  models and a fake voice: `model_runs` has director, scorer and planner rows
  without errors.

The end of the run prints a "live report": credit left, the voices, which
model answered each job and how fast against its limit, and the pages
fetched. Keys and tokens are never printed.

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
| Track C (AI and rules) | `app/agents/*` (except `__init__.py`), `app/services/outcome.py`, `app/services/readiness.py`, `app/services/pipeline.py`, `app/services/firecrawl.py`, `app/services/live_risk.py`, `app/routers/weekly.py`, `tests/test_outcome.py`, `tests/test_readiness.py`, `tests/test_pipeline.py`, `tests/test_agents.py`, `tests/test_risk.py`, `tests/fixtures/*`, `scripts/eval_scorer.py`, `scripts/eval_risk.py` |
| Web Push | `app/routers/push.py`, `app/services/push.py`, `scripts/make_vapid_keys.py`, `tests/test_push.py` |
| Spec tests (independent writers) | `tests/spec/test_track_a.py`, `tests/spec/test_track_b.py`, `tests/spec/test_track_c.py` |

## Where endpoints live

| Endpoint | Router | Track |
|---|---|---|
| `GET /api/health`, `POST /api/families`, `GET /api/families/{id}`, `POST /api/members/{id}/consent` | `families.py` | shared |
| `POST /api/families/{id}/weekly-run` | `weekly.py` | C |
| `POST`/`DELETE /api/members/{id}/voice`, `POST /api/members/{id}/opt-out` | `voice.py` | A |
| `GET /api/scenarios` | `scenarios.py` | A |
| `POST /api/members/{id}/welcome-call`, `POST /api/practice-calls`, `POST /api/calls/{id}/answer`, `/decline`, `/events`, `/end`, `GET /api/calls/{id}` | `calls.py` | B |
| `GET /api/calls/{id}/events` (stream) | `streams.py` | B |
| `GET /api/members/{id}/phone-state`, `POST /api/members/{id}/messages/read`, `POST /api/members/{id}/family-line` | `phone.py` | B |
| `GET /api/push/public-key`, `POST`/`DELETE /api/members/{id}/push-subscription` | `push.py` (sending: `services/push.py`) | shared |

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
