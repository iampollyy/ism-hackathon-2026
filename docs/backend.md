# Callback back end: architecture, data and API

Written on Friday 13 Nov at about 17:00, for the browser version of the plan in [idea.md](idea.md). It is the working spec for `backend/`: a person or a coding agent should be able to build from it without asking. The AI side (voice agents, model jobs, prompts) is in [ai.md](ai.md).

ElevenLabs names here were checked against their docs on 13 Nov. Items marked "check" were not confirmed.

## Three changes to the first contract in idea.md

idea.md was updated to match on Friday at about 17:45.

1. **Phones poll; they do not use a live stream.** Cloudflare's quick tunnels do not support server-sent events ([Cloudflare docs, Limitations](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)), and every phone reaches us through the tunnel. So `GET /api/members/{id}/phone-events` becomes `GET /api/members/{id}/phone-state`, which the phone page asks for once a second. The laptop keeps its live stream when it is opened on `localhost`; through the tunnel it polls `GET /api/calls/{id}` instead.
2. **Personalise with dynamic variables, and override only the voice.** ElevenLabs' docs recommend dynamic variables over replacing the prompt ([overrides](https://elevenlabs.io/docs/eleven-agents/customization/personalization/overrides.md)). The prompts stay in the agents' own settings and never travel through the browser. The session object keeps its three fields, so the phone page passes them through as before.
3. **The token call also returns the conversation id.** `GET /v1/convai/conversation/token` returns `token` and `conversation_id` ([docs](https://elevenlabs.io/docs/eleven-agents/api-reference/conversations/get-webrtc-token.md)), so the back end stores the id when the phone answers and does not depend on the page sending it at the end.

## The shape of it

```
 Phone page (one per member)  ◄──────── voice (WebRTC) ────────►  ElevenLabs
   polls phone-state each second                                   three voice agents
   answers, talks, runs the agent's tools                          instant voice clones
        │  answer / events / end                                        ▲
        ▼                                                               │ tokens, clones,
 ┌──────────────────────── Back end (FastAPI) ───────────────────────┐  │ transcripts
 │ routers        families · members · calls · streams               │──┘
 │ services       sessions · elevenlabs · audio · pipeline · readiness│
 │ model jobs     profiler · planner · director · scorer · digest     │────► OpenAI and Claude APIs
 │ scheduler      rings due calls, marks missed ones                  │────► Firecrawl (weekly)
 │ event broker   one channel per call                                │
 └───────────┬──────────────────────────────────┬────────────────────┘
             ▼                                  ▼
        SQLite (one file)             Laptop: sign-up, family page,
                                      live call screen (live stream)
```

**Five rules the design follows**

- **The back end holds every secret and writes all state.** The phone page reports what happens; the back end decides what it means.
- **Nothing calls us back.** No webhooks. We ask ElevenLabs for tokens and transcripts, so the back end needs no public address of its own.
- **Numbers come from code; words come from models.** Outcomes, seconds and readiness scores are computed by fixed rules. Models write the lesson, the plan and the story.
- **A call never waits on a model.** Every model job has a fallback in code, so a slow or refused model call cannot stop the phone from ringing.
- **We never collect the safe word.** Sign-up asks only whether the family has agreed one, and the welcome agent tells people not to say it. So no prompt, variable, event or API response can contain it.

## Stack and layout

- Python 3.12, FastAPI, uvicorn.
- SQLite in WAL mode through SQLAlchemy 2. Database calls are plain and synchronous; on a local file they take about a millisecond.
- `httpx` for ElevenLabs and Firecrawl, the `openai` and `anthropic` SDKs for the model jobs. All outside calls are `async`.
- `ffmpeg` on the machine, for cleaning the voice recording.
- Endpoints are `async def`. Work after a call ends runs as a background task (`asyncio.create_task`), so the phone page gets its answer at once.

```
backend/
  .env                 secrets, never committed (already ignored)
  .env.example         names only
  requirements.txt
  app/
    main.py            app, routers, start-up (create tables, start scheduler)
    config.py          settings read from the environment
    db.py              engine, session
    models.py          tables
    schemas.py         request and response shapes
    ids.py             fam_…, mem_…, call_… ids
    events.py          the event broker and the stream helper
    routers/
      families.py  members.py  calls.py  streams.py
    services/
      elevenlabs.py    token, clone, delete voice, transcript, audio
      audio.py         ffmpeg clean-up of the recording
      sessions.py      builds the session object for a call
      pipeline.py      what happens after a call ends
      readiness.py     the scale and its update rules
      scheduler.py     rings due calls, marks missed ones
      firecrawl.py     this week's scam warnings
      push.py          Web Push to the phones (routers/push.py takes the subscriptions)
    agents/            model jobs; see ai.md
      llm.py  profiler.py  planner.py  director.py  scorer.py  digest.py
      prompts/         one file per job and version
    scenarios/         one JSON file per scenario
  voice_agents/        the three ElevenLabs agents as files
    welcome.md  practice.md  family_line.md  tools.json  sync.py
  tests/
  data/                the database file (ignored)
  media/               voice recordings (ignored)
```

Add `backend/data/` and `backend/media/` to `.gitignore` before the first recording is made.

**Environment**

| Name | Use |
|---|---|
| `ELEVENLABS_API_KEY` | All ElevenLabs calls. Already set. |
| `ELEVENLABS_WELCOME_AGENT_ID`, `ELEVENLABS_PRACTICE_AGENT_ID`, `ELEVENLABS_FAMILY_LINE_AGENT_ID` | The three agents. |
| `ELEVENLABS_POLICE_VOICE_ID`, `ELEVENLABS_BANK_VOICE_ID`, `ELEVENLABS_NURSE_VOICE_ID` | Library voices for the scenarios without a clone. |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | The model jobs. Each job has a first choice at one provider and a second choice at the other; the table is in ai.md. |
| `FIRECRAWL_API_KEY` | Optional, for the weekly run. |
| `DATABASE_URL` | Default `sqlite:///data/app.db`. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Web Push to the phones; push is off while either is empty. Make a pair with `.venv/bin/python scripts/make_vapid_keys.py`, which only prints the two lines. |
| `VAPID_SUBJECT` | A contact for the push services, `mailto:` or `https:`. Empty: a `mailto:` placeholder. |

**Run:** `uvicorn app.main:app --reload --port 8000` from `backend/`. Vite proxies `/api` to port 8000, and the tunnel points at Vite, as idea.md describes.

## Data

Ids are short random strings with a prefix (`fam_`, `mem_`, `call_`). A member's id is also their phone page link, so it must be unguessable: use `secrets.token_urlsafe(8)`. Times are ISO 8601 in UTC. JSON columns hold text.

The first five tables are the minimum for Friday night. The rest come with the welcome call and the weekly run.

```sql
CREATE TABLE families (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  safe_word_set INTEGER NOT NULL DEFAULT 0,  -- the family says it has agreed one; the word is never collected
  created_at  TEXT NOT NULL
);

CREATE TABLE members (
  id                  TEXT PRIMARY KEY,
  family_id           TEXT NOT NULL REFERENCES families(id),
  name                TEXT NOT NULL,
  relationship        TEXT NOT NULL,          -- their place in the family: mother, son, friend
  is_organiser        INTEGER NOT NULL DEFAULT 0,
  consent_clone_at    TEXT,
  consent_practice_at TEXT,
  opted_out_at        TEXT,
  voice_id            TEXT,                   -- ElevenLabs voice
  voice_status        TEXT NOT NULL DEFAULT 'none',  -- none | ready | failed | deleted
  profile_json        TEXT,                   -- latest readiness profile
  plan_json           TEXT,                   -- latest plan
  last_seen_at        TEXT,                   -- last phone-state request
  created_at          TEXT NOT NULL
);

CREATE TABLE calls (
  id               TEXT PRIMARY KEY,
  family_id        TEXT NOT NULL REFERENCES families(id),
  kind             TEXT NOT NULL,             -- welcome | practice | family_line
  target_member_id TEXT NOT NULL REFERENCES members(id),
  voice_member_id  TEXT REFERENCES members(id),   -- whose clone speaks; NULL for a library voice
  scenario         TEXT,
  difficulty       INTEGER NOT NULL DEFAULT 1,    -- 1 to 3
  brief_json       TEXT,                      -- the dynamic variables, as sent
  caller_label     TEXT,                      -- what the phone shows
  status           TEXT NOT NULL,             -- see the states below
  scheduled_for    TEXT,
  conversation_id  TEXT,                      -- ElevenLabs
  parent_call_id   TEXT REFERENCES calls(id), -- a family_line call points at its practice
  ring_at          TEXT,
  answered_at      TEXT,
  ended_at         TEXT,
  ended_by         TEXT,                      -- agent | user | timeout | error
  created_at       TEXT NOT NULL
);

CREATE TABLE call_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id    TEXT NOT NULL REFERENCES calls(id),
  seq        INTEGER NOT NULL,                -- 1, 2, 3 within the call; also the stream's event id
  type       TEXT NOT NULL,
  t          REAL,                            -- seconds since answered_at, stamped by the server
  data_json  TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (call_id, seq)
);

CREATE TABLE results (
  call_id              TEXT PRIMARY KEY REFERENCES calls(id),
  outcome              TEXT NOT NULL,
  seconds_to_challenge REAL,                  -- NULL if they never challenged
  tactics_used_json    TEXT NOT NULL,
  tactics_worked_json  TEXT NOT NULL,
  lesson               TEXT NOT NULL,         -- one line
  debrief              TEXT,                  -- three sentences
  callback_seconds     REAL,
  scorer_version       TEXT,
  created_at           TEXT NOT NULL
);

CREATE TABLE consents (                       -- the record behind the two consent columns
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id  TEXT NOT NULL REFERENCES members(id),
  kind       TEXT NOT NULL,                   -- clone | practice | opt_out
  source     TEXT NOT NULL,                   -- voice_recording | welcome_call | manual
  evidence   TEXT,                            -- a file path, or the sentence they said
  call_id    TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE readiness_snapshots (            -- one row per change, so "before" and "now" are both kept
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id      TEXT NOT NULL REFERENCES members(id),
  source_call_id TEXT,
  items_json     TEXT NOT NULL,
  total          INTEGER NOT NULL,
  max            INTEGER NOT NULL,
  created_at     TEXT NOT NULL
);

CREATE TABLE messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id  TEXT NOT NULL REFERENCES members(id),
  kind       TEXT NOT NULL,                   -- weekly | callback_notice | reminder
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at    TEXT
);

CREATE TABLE push_subscriptions (             -- one browser's Web Push subscription; see "Waking the phone"
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id       TEXT NOT NULL REFERENCES members(id),
  endpoint        TEXT NOT NULL UNIQUE,        -- the push service's address for this browser
  p256dh          TEXT NOT NULL,               -- the browser's keys, from PushSubscription.toJSON()
  auth            TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  last_success_at TEXT,
  failure_count   INTEGER NOT NULL DEFAULT 0   -- failures in a row; a success resets it
);

CREATE TABLE digests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week TEXT NOT NULL, sources_json TEXT NOT NULL, tactics_json TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE model_runs (                     -- one row per model call, for debugging and the tests
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job TEXT NOT NULL, model TEXT NOT NULL, prompt_version TEXT NOT NULL,
  input_json TEXT NOT NULL, output_json TEXT, ok INTEGER NOT NULL, error TEXT,
  latency_ms INTEGER, input_tokens INTEGER, output_tokens INTEGER, created_at TEXT NOT NULL
);
```

**Call states**

```
scheduled ──► ringing ──► in_progress ──► ended ──► scored
                 │
                 ├──► declined   (the person tapped Decline)
                 └──► missed     (no answer for 45 seconds)
any state ──► failed            (token or connection error)
```

## The API

- JSON in and out, except the voice upload.
- Errors: `{ "error": { "code": "consent_missing", "message": "…" } }` with a fitting status.
- No log-in this weekend. A member's link is their key.

| Call | Purpose | Returns |
|---|---|---|
| `GET /api/health` | Is it up | `ok` |
| `POST /api/families` | Create a family | `family_id`, and each member's id and phone link |
| `GET /api/families/{id}` | Everything the family page shows | Family object |
| `POST /api/families/{id}/weekly-run` | Run the weekly loop once | The digest and what was done per member |
| `POST /api/members/{id}/voice` | Upload the recording; clone it | `voice_ready` |
| `DELETE /api/members/{id}/voice` | Delete the clone | `ok` |
| `POST /api/members/{id}/opt-out` | Leave for good; deletes the clone | `ok` |
| `POST /api/members/{id}/welcome-call` | Ring their phone page with the welcome agent | `call_id` |
| `GET /api/members/{id}/phone-state` | What the phone page should show now; asked each second | Phone state |
| `POST /api/members/{id}/messages/read` | Mark messages as seen | `ok` |
| `POST /api/members/{id}/family-line` | They tapped the family number | `call_id` and a session |
| `GET /api/push/public-key` | The key the phone subscribes to Web Push with | `enabled`, `public_key` |
| `POST /api/members/{id}/push-subscription` | Store this phone's push subscription | `ok` |
| `DELETE /api/members/{id}/push-subscription` | Remove it | `ok` |
| `GET /api/scenarios` | The scenarios, for the picker | List |
| `POST /api/practice-calls` | Start or schedule a practice | `call_id` |
| `POST /api/calls/{id}/answer` | The phone answers | Session object |
| `POST /api/calls/{id}/decline` | The phone declines | `ok` |
| `POST /api/calls/{id}/events` | The phone reports turns, tactics, the outcome, the reveal | `ok` |
| `POST /api/calls/{id}/end` | The phone reports the end | `ok` |
| `GET /api/calls/{id}` | A call with its turns, tactics and result | Call object |
| `GET /api/calls/{id}/events` | Live stream for the laptop | Call events |

### Families

`POST /api/families`

```json
{ "name": "The Kovacs", "safe_word_set": true,
  "members": [
    { "name": "Sara", "relationship": "mother", "consent_practice": true },
    { "name": "Jon",  "relationship": "son", "is_organiser": true, "consent_practice": true } ] }
```

Returns `201`:

```json
{ "family_id": "fam_k2x9",
  "members": [ { "id": "mem_Qz81hT0a", "name": "Sara", "phone_link": "/phone/mem_Qz81hT0a" },
               { "id": "mem_7Lr2pWcd", "name": "Jon",  "phone_link": "/phone/mem_7Lr2pWcd" } ] }
```

`consent_practice` is each member's own tick on the sign-up page: "I agree to receive practice calls without knowing when." When it is true, the back end sets `consent_practice_at` and writes a `consents` row with `source: manual`. That passes the consent check, so a practice call works before the welcome call is built. The welcome call asks again and records a spoken yes as a second row.

`GET /api/families/{id}` returns the family object from idea.md, with two additions per member: `phone_online` (their page asked for phone-state in the last five seconds) and `voice_status`.

### Voice

`POST /api/members/{id}/voice` takes `multipart/form-data` with one file field, `audio`. Phones send webm (Android) or mp4 (iPhone); accept both. The request stays open while the clone is made, a few seconds.

1. Save the upload unchanged as `media/consent/{member_id}.{ext}`. It opens with the spoken consent sentence, so it is the consent record. Write a `consents` row (`clone`, `voice_recording`).
2. Clean a copy with ffmpeg: mono, trimmed silence, even loudness. A starting point: `ffmpeg -i in -ac 1 -ar 44100 -af "silenceremove=start_periods=1:start_threshold=-45dB,loudnorm" out.mp3`.
3. `POST https://api.elevenlabs.io/v1/voices/add` with header `xi-api-key`, form fields `name` (`callback-{member_id}`) and `files`. Store the returned `voice_id`, set `voice_status` to `ready` and `consent_clone_at` to now.
4. Return `{ "voice_ready": true }`, or `502` with `clone_failed`.

`DELETE /api/members/{id}/voice` calls `DELETE /v1/voices/{voice_id}` (check the path), clears `voice_id` and sets `voice_status` to `deleted`.

### The phone page's requests

`GET /api/members/{id}/phone-state`, once a second. It also records `last_seen_at`.

```json
{ "member": { "id": "mem_Qz81hT0a", "name": "Sara", "family": "The Kovacs" },
  "incoming_call": { "call_id": "call_9f3k", "kind": "practice",
                     "caller": { "label": "Unknown number", "number": "+00 600 555 0142" } },
  "messages": [ { "id": 12, "kind": "weekly", "text": "This week: callers posing as a bank's security team…" } ],
  "family_number": { "enabled": true } }
```

`incoming_call` is `null` unless a call for this member is `ringing`. `caller.number` is made up and must not be a real number or a real institution's.

`POST /api/calls/{id}/answer` moves the call to `in_progress`, asks ElevenLabs for a token, and returns the session object:

```json
{ "kind": "practice",
  "conversation_token": "…",
  "conversation_id": "conv_…",
  "overrides": { "tts": { "voiceId": "…" } },
  "dynamic_variables": {
    "target_name": "Sara",
    "caller_claim": "her son Jon",
    "address_as": "Mum",
    "opening_line": "Mum? It's me. I dropped my phone, so this is a new number.",
    "scenario_brief": "You lost your phone on the way to work and are borrowing a colleague's…",
    "ask": "a transfer of 400 euros today, to a friend's account",
    "tactic_order": "new_number, urgency, secrecy",
    "difficulty": 2,
    "reveal_line": "Sara, this was a Callback practice call. The voice you heard was artificial, made with Jon's permission." },
  "max_seconds": 150,
  "reveal": { "voice_of": "Jon" } }
```

- The page calls `startSession({ conversationToken, connectionType: 'webrtc', overrides, dynamicVariables, clientTools })`.
- Keep every variable a string or a number.
- For a welcome or family-line call, `overrides` is empty and the variables are the ones listed for that agent in ai.md.
- **Fallback, if a long variable is rejected:** send the whole prompt as `overrides.agent.prompt.prompt` and the first line as `overrides.agent.firstMessage`. Switch on those two override toggles on the practice agent now, so either route works.

`POST /api/calls/{id}/events` takes a batch, so the page can send several at once:

```json
{ "events": [
  { "type": "turn",     "speaker": "agent", "text": "Mum? It's me." },
  { "type": "tactic",   "key": "new_number" },
  { "type": "turn",     "speaker": "user",  "text": "Jon? What's our family word?" },
  { "type": "outcome",  "outcome": "asked_safe_word" },
  { "type": "revealed" } ] }
```

- The back end checks `key` and `outcome` against the fixed lists in idea.md, adds the tactic's label, stamps `t` and `seq`, stores each event and publishes it to the call's stream.
- On the first `outcome` it computes `seconds_to_challenge` as the time since `answered_at` and adds it to the published event.
- Only final lines should be sent as `turn`; the library's `onMessage` also delivers tentative ones.
- For a welcome call the page may also send `{ "type": "consent", "given": true }` from the `consent_result` tool.

`POST /api/calls/{id}/end` with `{ "ended_by": "agent" }` (`user` when the person tapped End, `timeout`, `error`). The back end sets `ended`, publishes `call.status`, answers `ok` at once and starts the after-call work in the background.

`POST /api/members/{id}/family-line` finds that member's latest practice that ended in the last ten minutes, creates a `family_line` call pointing at it, and returns `{ "call_id": "…", "session": { … } }`. It also:
- stores `callback_seconds`, the time from the end of the practice to this tap, on the practice's result;
- publishes `callback.connected` on the practice call's stream;
- writes a `callback_notice` message for the relative whose voice was used: "Sara called the family number after a practice."

### Starting a practice

`POST /api/practice-calls`

```json
{ "target_member_id": "mem_Qz81hT0a", "voice_member_id": "mem_7Lr2pWcd",
  "scenario": "relative_new_number", "difficulty": 2, "delay_seconds": 0 }
```

Checks, in order. Each failure is a `409` with the code shown, except the first.

| Check | Code |
|---|---|
| Both members exist and are in the same family | `404` |
| The target has `consent_practice_at` and has not opted out | `consent_missing` |
| If a voice member is given: they have `consent_clone_at`, a ready voice, and have not opted out | `voice_not_ready` |
| The target has no call ringing or in progress | `busy` |
| The target's phone page is open (`last_seen_at` within ten seconds) | `phone_offline` |

Then it builds the brief (ai.md, the director job), stores it on the call, and sets the call to `ringing`, or to `scheduled` with `scheduled_for` when `delay_seconds` is given. A delay is how the person "doesn't know when": start it from the laptop with two minutes' delay and walk away.

Returns `201` with `{ "call_id": "call_9f3k", "status": "ringing" }`.

### Reading a call

`GET /api/calls/{id}` returns the call object from idea.md. `result` is `null` until the call is `scored`. The laptop can poll this every half second when it has no live stream.

`GET /api/calls/{id}/events` is a server-sent event stream.
- On connect it replays the call's stored events, from `Last-Event-ID` if the browser sends one, then continues live. A screen opened late still shows the whole call.
- Each event's `id` is its `seq`, its `event` is the type, and its `data` is JSON.
- Send a comment line every 15 seconds to keep the connection open.
- Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`.

Event types are the ones in idea.md: `call.status`, `turn`, `tactic`, `outcome`, `revealed`, `callback.connected`. One is added when scoring finishes: `result`, carrying the lesson and the debrief.

### Waking the phone: Web Push

Polling only works while the phone page is open. With Web Push (VAPID) the back end also tells a phone whose page is closed. **Push is only a wake-up:** it shows a notification, a tap opens the phone page, and the page then polls `phone-state` exactly as before. Nothing about polling changes, and the page must work the same without push. Push changes no rule either: a call started now still needs the page open (`phone_offline`), but a scheduled call (a delay, or the weekly run) rings whether or not the page is open, and push is how a closed phone learns of it.

Push is off while `VAPID_PUBLIC_KEY` or `VAPID_PRIVATE_KEY` is empty. It does not depend on `FAKE_ELEVENLABS`.

`GET /api/push/public-key` returns `{ "enabled": true, "public_key": "BN…" }`, or `{ "enabled": false, "public_key": null }` while push is off. When it is off, the page does not subscribe.

`POST /api/members/{id}/push-subscription` takes the browser's `PushSubscription.toJSON()` as it is:

```json
{ "endpoint": "https://fcm.googleapis.com/fcm/send/…", "expirationTime": null,
  "keys": { "p256dh": "BOr…", "auth": "k2…" } }
```

- It stores the subscription for this member, or updates the row with the same `endpoint` (new keys, failure count back to 0). The same browser subscribing on another member's page moves the row to that member: one browser, one member.
- `endpoint` must be `https` on a browser push service (Google's for Chrome and Android, Apple's for Safari and iOS, Mozilla's, Microsoft's); `p256dh` must be a 65-byte P-256 key and `auth` 16 bytes, both URL-safe base64. Anything else is `422 invalid_request`. An unknown member is `404`.
- Returns `{ "ok": true }`.

`DELETE /api/members/{id}/push-subscription` with `{ "endpoint": "…" }` (`toJSON()` works too) removes that subscription of this member; with no body it removes all of the member's. Returns `{ "ok": true }`, also when there was nothing to remove.

**When a push is sent.** Once, when a welcome or practice call starts ringing for the member (the welcome call, a practice started now, the scheduler ringing a scheduled one), and once for each message written for them (`callback_notice`, the weekly run's `weekly` and `reminder`). The hook is in `services/push.py` and catches these rows as they are committed, so the push goes out exactly when `phone-state` can first see them, whoever wrote them. Every subscription of the member gets one. Nobody is pushed to after they opt out.

**What it carries.** Small JSON, encrypted for the browser. For a call it shows no more than the ringing screen: the same caller label and number as `incoming_call`, and never that it is a practice or which scenario.

```json
{ "type": "incoming_call", "call_id": "call_9f3k", "title": "Unknown number",
  "body": "Incoming call · +00 600 555 0142", "url": "/phone/mem_Qz81hT0a", "tag": "call_9f3k" }

{ "type": "message", "message_id": 12, "kind": "callback_notice", "title": "Family number",
  "body": "Sara called the family number after a practice.", "url": "/phone/mem_7Lr2pWcd", "tag": "message_12" }
```

`title` is the caller label for a call (`Callback` for the welcome call); for a message it is `Family number`, `This week` or `Reminder`. `body` is the message text, cut at 180 characters. A call push lives 45 seconds (TTL, the ring time) with `Urgency: high`; a message push lives a day.

**Sending.** In the background, on a small thread pool: it never slows down or fails the request that caused it. Just before sending, the back end reads the row again and skips it if the call stopped ringing or the message was read. A `404` or `410` from the push service means the browser unsubscribed: the row is deleted. Any other failure adds one to `failure_count`; a success sets `last_success_at` and resets it. Tests replace `push.send`, so they never reach the network.

**Front-end recipe.** Web Push needs HTTPS (the tunnel) or `localhost`. On iPhone it works only in the installed web app (Add to Home Screen, iOS 16.4 or later), never in a Safari tab, and the web app manifest needs `"display": "standalone"`. Leave `start_url` out of the manifest, or make it the member's own link, so the home-screen icon opens `/phone/{id}`. A subscription belongs to one web address: a quick tunnel gets a new address each time it starts, so install the app from the address the demo will use.

On the phone page:

```js
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const toB64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// On load. Offer an "Alert me when a call comes" button only when push can work here
// (on iPhone that means inside the installed app) and the person has not refused.
const canPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const swReady = canPush ? navigator.serviceWorker.register('/sw.js') : null;
const pushKey = fetch('/api/push/public-key').then((r) => r.json());
const showAlertButton = canPush && Notification.permission === 'default';

async function subscribe(memberId) {
  const { enabled, public_key } = await pushKey;
  if (!enabled) return;                                    // push is off on the back end
  const reg = await swReady;
  let sub = await reg.pushManager.getSubscription();
  if (sub && toB64url(sub.options.applicationServerKey) !== public_key) {
    await sub.unsubscribe();                               // the back end has new keys
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64url(public_key) });
  await fetch(`/api/members/${memberId}/push-subscription`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub.toJSON()),
  });
}

// The button's click handler. Ask for permission first, straight from the tap:
// iOS refuses a request that does not come from one.
async function onAlertButtonTap(memberId) {
  if (await Notification.requestPermission() === 'granted') await subscribe(memberId);
}

// On every later load, keep the back end's copy fresh without asking again.
if (canPush && Notification.permission === 'granted') subscribe(memberId);
```

The service worker, served at the site root as `/sw.js` (in Vite, `frontend/public/sw.js`). It must show a notification for every push: iOS and Chrome expect one, and Safari stops delivering to a site that pushes silently.

```js
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(data.title || 'Callback', {
    body: data.body || '',
    tag: data.tag,                                      // one notification per call or message
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data.url, self.location.origin);
  event.waitUntil((async () => {
    const pages = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = pages.find((page) => new URL(page.url).pathname === url.pathname);
    return open ? open.focus() : clients.openWindow(url.href);
  })());
});
```

Show only `title` and `body`; do not add words such as "practice". When the page opens it polls as usual, and rings only if `incoming_call` is still set: a call missed while the phone slept is gone. An open page gets the notification too; when it shows the ringing screen it can close it with `(await navigator.serviceWorker.ready).getNotifications({ tag: callId })`, then `close()` on each.

## Live updates inside the back end

`events.py` holds one in-memory broker: a dictionary from `call:{id}` to a set of `asyncio.Queue`s. `publish(call_id, event)` writes the row first, then puts the event on each queue. One process, one worker; do not run uvicorn with several workers, or the streams split.

`scheduler.py` is one background loop, every two seconds:
- calls that are `scheduled` and due become `ringing`;
- calls `ringing` for more than 45 seconds become `missed`;
- calls `in_progress` for more than `max_seconds` plus 30 become `ended` with `ended_by: timeout`.

## The flows, step by step

**1. Sign-up and voice**
1. Laptop: `POST /api/families`, with each member's consent tick. The page shows each member's phone link as a QR code.
2. Each member opens their link on their phone; the page starts polling `phone-state`.
3. Each member records the one-minute text on the sign-up page: `POST /api/members/{id}/voice`.

**2. Welcome call**
1. Laptop: `POST /api/members/{id}/welcome-call`. The call is `ringing`.
2. Phone: sees `incoming_call`, rings. Answer: `POST /api/calls/{id}/answer`, then `startSession`.
3. The agent asks for consent and calls `consent_result`; the page forwards it as an event. On `given: true` the back end sets `consent_practice_at` and writes a `consents` row.
4. The agent runs the five questions and ends the call. Phone: `POST /api/calls/{id}/end`.
5. After-call work: transcript, then the profiler, then the planner (below).

**3. Practice call**
1. Laptop or scheduler: `POST /api/practice-calls`. The checks pass; the brief is built; the call rings.
2. Phone: Answer, session, `startSession` with the voice override and the variables.
3. Phone: forwards each line and each `mark_tactic` and `practice_result` as events. Laptop: shows them from the stream.
4. The agent reveals and calls `end_call`, or the person taps End. Phone: `POST /api/calls/{id}/end`.
5. Phone: shows the reveal screen whatever happened, with fixed wording and `reveal.voice_of`. The reveal never depends on the agent having said it.
6. After-call work: scoring.

**4. The family number**
1. Phone: `POST /api/members/{id}/family-line`, then `startSession` with the returned session.
2. The relative's phone shows the `callback_notice` message on its next poll. The laptop shows `callback.connected` with the seconds.

**5. After a call ends** (`pipeline.py`, in the background)

| Step | Welcome call | Practice call |
|---|---|---|
| 1 | Build the transcript from our own stored `turn` events, so nothing waits | Same |
| 2 | Profiler job: consent, the five readiness items, the quote | Decide the outcome by rule (below), then the scorer job for the lesson and debrief |
| 3 | Write a `readiness_snapshots` row; this is "before" | Update readiness by rule; write a snapshot; this is "now" |
| 4 | Planner job for the whole family; store each member's plan | Planner job for this member's next step |
| 5 | Set the call to `scored` | Publish `result`; set the call to `scored` |
| 6 | Later, when ElevenLabs reports the conversation as `done`, fetch `GET /v1/convai/conversations/{conversation_id}` and keep its transcript as the record | Same |

The conversation's `status` is one of `initiated`, `in-progress`, `processing`, `done`, `failed` ([docs](https://elevenlabs.io/docs/eleven-agents/api-reference/conversations/get.md)). Ask every two seconds, for up to a minute, and never block scoring on it.

**Deciding the outcome, by rule**
1. If the person ended the call before any `outcome` event: `hung_up`.
2. Otherwise the agent's `practice_result` outcome.
3. If neither exists (the agent forgot the tool, or the call timed out): the scorer's outcome.
4. `seconds_to_challenge` is the server time of the first `outcome` event, or of the end of the call for `hung_up`, minus `answered_at`. It is empty for `hesitated` and `agreed`.

**6. The weekly run** (`POST /api/families/{id}/weekly-run`)
1. Firecrawl fetches two or three public scam-warning pages; the digest job reduces them to this week's tactics. One digest per week, shared by all families.
2. For each member the planner picks one action: a message, a practice, or a reminder.
3. Messages are written to `messages` and appear on the phone at its next poll. Practices are created as `scheduled` calls.
4. The response lists what was done, for the family page.

## The ElevenLabs layer

One file, `services/elevenlabs.py`, with one `httpx.AsyncClient` and the header `xi-api-key`. Base address `https://api.elevenlabs.io`.

| Function | Request | Notes |
|---|---|---|
| `conversation_token(agent_id)` | `GET /v1/convai/conversation/token?agent_id=…` | Returns `token` and `conversation_id`. Ask on Answer, not earlier. |
| `signed_url(agent_id)` | `GET /v1/convai/conversation/get-signed-url?agent_id=…` | Fallback if WebRTC fails on the venue network. Valid 15 minutes. |
| `clone_voice(name, path)` | `POST /v1/voices/add`, multipart `name`, `files` | Returns `voice_id`. |
| `delete_voice(voice_id)` | `DELETE /v1/voices/{voice_id}` | Check the path. |
| `conversation(conversation_id)` | `GET /v1/convai/conversations/{id}` | `status`, `transcript` (`role`, `message`, `time_in_call_secs`), `analysis`. |
| `conversation_audio(conversation_id)` | `GET /v1/convai/conversations/{id}/audio` | Check. Useful for the video. |

**The agents as files.** `voice_agents/` holds each agent's prompt as a Markdown file and its tools as JSON. `sync.py` pushes them with the official Python SDK, using the two calls shown in ElevenLabs' docs: `conversational_ai.tools.create(...)` for a client tool, and `conversational_ai.agents.update(agent_id=…, conversation_config=…, platform_settings=…)` for the prompt, first message, variable placeholders, call length and override toggles. Prompts then live in git and are reviewed like code. Create the three agents once in the dashboard, because agents created there get the `end_call` tool by default and agents created through the API do not ([docs](https://elevenlabs.io/docs/eleven-agents/customization/tools/system-tools/end-call.md)). After the first sync, check in the dashboard that `end_call` is still on.

The agents' settings, variables and prompts are in ai.md.

## Rules enforced in code

These are checks in the back end, not instructions to a model.

1. **Consent gate.** No practice call is created unless the target has consented to practice and the voice's owner has consented to cloning. See the checks under "Starting a practice".
2. **Same family only.** A clone can be used only on a call inside its owner's family.
3. **The safe word is never collected.** Sign-up takes only `safe_word_set`, and no table has a column for the word.
4. **The brief is checked before it is sent:** no run of six or more digits, no name from a short list of real banks and institutions, tactic keys only from the fixed list, length limits on every field. A brief that fails is replaced by the scenario's fixed template.
5. **Length.** The practice agent's `max_duration_seconds` is 180, the prompt aims for two minutes, and the scheduler ends anything longer.
6. **The reveal is certain.** The phone page shows it after every practice call, however the call ended.
7. **Deletion is real.** Opt-out and voice deletion call ElevenLabs and clear the stored id.

## Build order

**Friday evening, for the practice call end to end**
1. App skeleton, settings, tables, ids. `GET /api/health`.
2. `POST /api/families` with the consent ticks, `GET /api/families/{id}`, with fixed sample values for readiness and plan.
3. `services/elevenlabs.py`: token and clone. `POST /api/members/{id}/voice`.
4. `GET /api/members/{id}/phone-state`, `POST /api/practice-calls` with the template brief only, `answer`, `decline`.
5. `events`, `end`, the broker, `GET /api/calls/{id}`, the stream.
6. Outcome by rule, and the scorer job. `result` event.

The front end can build against steps 2, 4 and 5 as soon as their shapes are fixed, before the logic behind them exists.

**Saturday morning, for the welcome call, the family page and the family number**
7. Welcome call, `consent` event, the profiler, readiness snapshots.
8. The planner; real `readiness` and `plan` in the family object.
9. `family-line`, `callback.connected`, messages.
10. The director job, replacing the template brief when it passes the checks.
11. The scheduler's delay, the weekly run, voice deletion and opt-out.

## Tests worth writing

- The consent gate: each missing consent gives its `409`.
- The sign-up tick: a member with `consent_practice: true` can receive a practice call before any welcome call.
- The brief checks: a brief with a card-like number or a listed bank name is replaced by the template.
- The outcome rules: the four cases above, from stored events.
- Readiness: each outcome moves the scores as the table in ai.md says.
- The scorer: ten written transcripts with known outcomes; count how many it labels correctly. This is also the number for the pitch.

## Still to check

- That a cloned voice sounds right on the agents' default voice model, `eleven_v4_turbo`.
- How many conversations the plan runs at once, and how many cloned voices it can hold, before inviting other pairs.
- That a long text in a dynamic variable is accepted. If not, use the prompt override.
- The two paths marked "check" in the ElevenLabs table.
