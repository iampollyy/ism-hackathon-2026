# Track 4: drill review, family activity, member progress, learning, news

For the front end. Seven endpoints, all JSON, all under `/api`. Six only read; the news refresh writes the shared digest and nothing else (never a call, never a message). Built from the tables that already exist, plus one new table (`news_refreshes`, the refresh rate limit).

Code: `backend/app/routers/review.py` (endpoints), `backend/app/services/review.py` (drills, activity, progress), `backend/app/services/learn.py` and `backend/app/content/*.json` (learning), `backend/app/services/news.py` (news). Tests: `backend/tests/test_review.py`, `test_learn.py`, `test_news.py`. The TypeScript types come from the OpenAPI schema as usual (`DrillList`, `ActivityView`, `ProgressView`, `LearnTactics`, `Habits`, `NewsView`, `NewsRefreshed`).

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/families/{id}/drills?member_id=&limit=` | `{ "drills": [Drill] }`, newest first |
| `GET` | `/api/families/{id}/activity?limit=` | `{ "items": [ActivityItem] }`, newest first |
| `GET` | `/api/members/{id}/progress` | Progress |
| `GET` | `/api/learn/tactics` | `{ "tactics": [Tactic] }` |
| `GET` | `/api/learn/habits` | `{ "habits": [Habit] }` |
| `GET` | `/api/families/{id}/news` | News |
| `POST` | `/api/families/{id}/news/refresh` | News, plus `refreshed` and `reason` |

Errors use the usual shape, `{ "error": { "code", "message" } }`:

| Status | Code | When |
|---|---|---|
| 404 | `not_found` | Unknown family or member; on `drills`, a `member_id` that is not in this family |
| 422 | `invalid_request` | `limit` out of range, or not a number |
| 503 | `content_unavailable` | `learn/*` only: a content file is missing or broken (a deploy mistake, not a user one) |

**Two rules for every screen here**

- **Never shame.** Say what people did. The back end's sentences already follow this (no "failed", "fooled" or "fell for"; an outcome that was not safe reads "picked up a tip for next time"). Please keep the same tone in any words the front end adds: `safe: false` is "a tip for next time", never a red cross or "failed" (idea.md, "The rules we build to", rule 4).
- **Drill timing is a surprise for the person being called.** `scheduled_for` on a drill and `next_drill_at` on progress are for the organiser's screens only. On a member's own screens, show at most "a practice call will come some time" and never the time. The activity timeline already leaves out drills that are scheduled, ringing or in progress.

## Drills

`GET /api/families/{id}/drills?member_id=mem_…&limit=20`

- Practice calls only (no welcome or family-line calls), newest first by when they were created. Includes drills that have not happened yet (`status: "scheduled"`), so filter by `status` for a "past drills" list.
- `member_id` (optional): only drills to that member. `limit`: 1 to 100, default 20.
- The full replay (turns, tactics with times, the risk light point by point, debrief) stays `GET /api/calls/{call_id}`.

```json
{ "drills": [
  { "call_id": "call_9f3kQ1aB",
    "member": { "id": "mem_Qz81hT0a", "name": "Sara" },
    "voice_of": { "id": "mem_7Lr2pWcd", "name": "Jon" },
    "scenario": "relative_new_number",
    "scenario_title": "Relative with a new number",
    "difficulty": 2,
    "status": "scored",
    "created_at": "2026-11-14T15:02:11.204512+00:00",
    "scheduled_for": null,
    "answered_at": "2026-11-14T15:02:18.009113+00:00",
    "ended_at": "2026-11-14T15:03:40.551870+00:00",
    "outcome": "asked_safe_word",
    "outcome_label": "Asked for the family word",
    "safe": true,
    "seconds_to_challenge": 23.4,
    "peak_risk_level": "red",
    "tactics": [ { "key": "new_number", "label": "New number" }, { "key": "urgency", "label": "Urgency" } ],
    "lesson": "You asked for the family word: that is the habit. Keep doing it on every urgent call.",
    "callback_seconds": 40.0 } ] }
```

| Field | Meaning |
|---|---|
| `member` | Who was called. |
| `voice_of` | Whose cloned voice spoke; `null` for a library voice (bank, police, clinic). |
| `scenario`, `scenario_title` | The scenario key and its title from the scenario file. |
| `status` | A call status: `scheduled`, `ringing`, `in_progress`, `ended` (being scored), `scored`, `declined`, `missed`, `failed`. |
| `outcome`, `outcome_label` | From the result: `asked_safe_word`, `hung_up`, `asked_personal_question`, `hesitated`, `agreed`. `null` until the drill is scored with a result (and for a drill that never connected). |
| `safe` | `true` when the outcome is `asked_safe_word`, `hung_up` or `asked_personal_question`; `false` otherwise, including when there is no outcome yet. Computed in code. |
| `seconds_to_challenge` | Seconds from answering to the challenge; `null` for `hesitated`, `agreed` and no result. |
| `peak_risk_level` | The highest level the live risk light reached on this call: `green`, `yellow` or `red`. `null` when the risk check never ran on it (before the caller spoke, or the check is switched off). |
| `tactics` | The pressure tactics used, first use first. Once scored, the result's list; before that, the tactics marked so far. |
| `lesson` | One kind sentence, from the result; `null` without a result. |
| `callback_seconds` | Seconds from the end of the drill to tapping the family number; `null` if they did not tap it. |

## Family activity

`GET /api/families/{id}/activity?limit=30`

A newest-first timeline of who did what. `limit`: 1 to 200, default 30.

```json
{ "items": [
  { "when": "2026-11-14T15:04:20.118220+00:00", "member": { "id": "mem_Qz81hT0a", "name": "Sara" },
    "kind": "family_line", "text": "Sara called the family number 40 seconds after a practice call",
    "call_id": "call_9f3kQ1aB" },
  { "when": "2026-11-14T15:03:40.551870+00:00", "member": { "id": "mem_Qz81hT0a", "name": "Sara" },
    "kind": "drill", "text": "Sara asked for the family word after 23 seconds, on a practice call in Jon's voice",
    "call_id": "call_9f3kQ1aB" },
  { "when": "2026-11-14T14:50:02.771900+00:00", "member": null,
    "kind": "alert", "text": "Sara may be on a scam call. Ring her on her usual number.", "call_id": null },
  { "when": "2026-11-14T14:10:09.330011+00:00", "member": { "id": "mem_7Lr2pWcd", "name": "Jon" },
    "kind": "voice_ready", "text": "Jon's voice was set up for family drills", "call_id": null } ] }
```

- `when`: ISO time. `member`: who did it (for a message: who got it); `null` for an alert that went to several people. `text`: a ready sentence, without a full stop, to show as it is. `call_id`: the call to open with `GET /api/calls/{id}`, or `null`.
- `kind` is one of the values below; use it for the icon.

| `kind` | From | Example `text` | `call_id` |
|---|---|---|---|
| `joined` | the member row | "Sara joined the family plan" / "Jon started the family plan" (organiser) | null |
| `consent_given` | consents `practice` | "Sara agreed to practice calls at sign-up" / "… when joining" / "Sara said yes to practice calls on the welcome call" | null |
| `consent_withdrawn` | consents `practice_withdrawn` | "Sara paused practice calls" / "Sara chose not to get practice calls for now" | null |
| `voice_consent` | consents `clone`, `clone_from_call` | "Jon recorded a voice sample for family drills" / "Jon agreed on the welcome call to lend their voice for family drills" / "Jon agreed that their welcome call may be used to copy their voice for family drills" | null |
| `voice_ready` | the member's clone | "Jon's voice was set up for family drills" | null |
| `welcome_done` | an answered welcome call | "Sara took the welcome call" | the welcome call |
| `drill` | a practice call that ended | safe: "Sara asked for the family word after 23 seconds, on …", "Sara hung up to check after 12 seconds, on …", "Sara asked a question only family would know after 15 seconds, on …"; otherwise "Sara took a practice call (police officer) and picked up a tip for next time"; before scoring: "Sara took a practice call in Jon's voice; the review is on its way" | the drill |
| `drill_unanswered` | a declined or missed practice call | "Sara declined a practice call" / "A practice call for Sara went unanswered" | the drill |
| `family_line` | a tap on the family number | "Sara called the family number 40 seconds after a practice call" (the first tap); "Sara called the family number" (a later one) | the practice it followed |
| `alert` | messages of kind `alert` (the Shield) | the alert's own text | null |
| `weekly_note` | messages of kind `weekly` | "This week's note for Sara: …" | null |
| `reminder` | messages of kind `reminder` | "Reminder for Ana: Agree a family word in person." | null |
| `message` | any other message kind | the message's own text | null |
| `opted_out` | consents `opt_out` | "Ana left Callback" | null |

- Not listed: drills that are scheduled, ringing or in progress (a surprise), drills that failed or never connected, and `callback_notice` messages (the `family_line` item already says it).
- The same alert sent to several members within five minutes is one item.
- "on …" names the voice when a clone spoke ("on a practice call in Jon's voice"), otherwise the scenario ("on a practice call (bank security team)").

## Member progress

`GET /api/members/{id}/progress`

```json
{ "member": { "id": "mem_Qz81hT0a", "name": "Sara" },
  "readiness": { "before": 3, "now": 9, "max": 10,
                 "items": [ { "key": "verify_first", "label": "Checks before acting", "before": 0, "now": 2, "max": 2 },
                            { "key": "safe_word", "label": "Family word", "before": 1, "now": 2, "max": 2 },
                            { "key": "trusted_contact", "label": "Someone to ring", "before": 1, "now": 2, "max": 2 },
                            { "key": "payment_caution", "label": "Careful with payments", "before": 1, "now": 1, "max": 2 },
                            { "key": "under_pressure", "label": "Calm under pressure", "before": 0, "now": 2, "max": 2 } ] },
  "drills": { "total": 4, "safe": 3, "last_outcome": "asked_personal_question",
              "last_outcome_label": "Asked a personal question", "safe_streak": 2 },
  "lessons": [ { "call_id": "call_9f3kQ1aB", "when": "2026-11-14T15:03:40.551870+00:00",
                 "outcome": "asked_personal_question", "outcome_label": "Asked a personal question",
                 "lesson": "Testing the caller was smart. Even better: hang up and call the family number, or ask for the family word." } ],
  "weak_spot": "Calls that sound official.",
  "next_drill_at": "2026-11-15T10:00:00+00:00" }
```

| Field | Meaning |
|---|---|
| `readiness` | Exactly the family page's numbers for this member (`GET /api/families/{id}`, `members[].readiness`): "before" is the welcome call, "now" the latest. All zeros before the welcome call. |
| `drills.total` | Drills with a result. `safe`: how many of them were safe. |
| `drills.last_outcome` | The latest result's outcome, or `null`. |
| `drills.safe_streak` | Safe results in a row, counting back from the latest; 0 after a "tip for next time". |
| `lessons` | Each scored drill's lesson, newest first, at most 20. |
| `weak_spot` | The plan's weak spot, or the welcome call's; `null` before either. |
| `next_drill_at` | The earliest scheduled drill for this member, or `null`. **Organiser's screen only** (see the rules at the top). |

`404 not_found` for an unknown member. A member who left still has their progress.

## Learning

`GET /api/learn/tactics`: the eight pressure tactics, then the three extra warning signs the live risk light knows. Static text from `backend/app/content/tactics.json`, written warmly and plainly; it names no real bank, police force or company.

```json
{ "tactics": [
  { "key": "new_number", "label": "New number", "kind": "tactic", "level": "yellow",
    "what_it_sounds_like": [ "Hi Mum, it's me. My phone broke, so this is my new number.",
                             "Can you save this one? My old number doesn't work any more." ],
    "why_it_works": "It explains the strange number before you have time to wonder about it, …",
    "what_to_do": "Say you'll ring them straight back, hang up, and call the number you already have for them. …" },
  { "key": "asks_for_code", "label": "Asks for a code", "kind": "signal", "level": "red", "…": "…" } ] }
```

- Order: `new_number`, `urgency`, `secrecy`, `authority`, `emotional_appeal`, `small_ask_first`, `isolation`, `unusual_payment`, then `money_request`, `asks_for_code`, `refuses_callback`.
- `label` is the same text as the chips on the live call screen (`risk` events, `tactics` on a call), so a chip can link to its card by `key`.
- `kind`: `tactic` or `signal`. `level`: the light this sign alone gives on a live call (`yellow` for softer pressure, `red` for money, codes, secrecy, isolation or dodging a call-back).
- `what_it_sounds_like`: always two short example lines.

`GET /api/learn/habits`: the four core habits, in this order.

```json
{ "habits": [
  { "key": "hang_up_and_call_back", "title": "Hang up and call back",
    "line": "If a call asks for money or a code, hang up and ring the person on the number you already have." },
  { "key": "ask_for_the_family_word", "title": "Ask for the family word",
    "line": "Your real relative knows the family word; a copy of their voice does not." },
  { "key": "never_share_codes", "title": "Never share codes",
    "line": "Nobody who calls you needs a code, a PIN or a password: not your bank, and not family." },
  { "key": "take_your_time", "title": "Take your time",
    "line": "Anything real can wait a few minutes while you check, so a rush is a sign to slow down." } ] }
```

Both can be cached for the session; they change only with a deploy. `503 content_unavailable` if a file is broken.

## News

`GET /api/families/{id}/news`: this week's scam patterns (the weekly digest, shared by all families) and each member's latest weekly note.

```json
{ "patterns": [
    { "title": "Parcel fee calls",
      "summary": "A caller asks for a small fee to release a parcel.",
      "tactics": [ { "key": "small_ask_first", "label": "Small ask first" }, { "key": "urgency", "label": "Urgency" } ],
      "closest_scenario": "bank_security",
      "sources": [ { "url": "https://consumer.ftc.gov/consumer-alerts", "date": "2026-11-14" } ] } ],
  "updated_at": "2026-11-14T09:30:00.120931+00:00",
  "week": "2026-W46",
  "fallback": false,
  "notes": [ { "member": { "id": "mem_Qz81hT0a", "name": "Sara" },
               "text": "This week: callers posing as a bank's security team. If a call asks for a code, hang up and call the family number.",
               "when": "2026-11-14T09:31:02.551870+00:00" } ],
  "next_refresh_at": null }
```

| Field | Meaning |
|---|---|
| `patterns` | Up to three patterns. `[]` when there is no digest yet. |
| `patterns[].sources` | The page each pattern came from, with the day Callback read it. `[]` for the built-in examples, which have no web page. |
| `patterns[].closest_scenario` | The scenario a "practise this" button could start, or `null`. |
| `updated_at`, `week` | When the digest was built, and its ISO week; both `null` when there is none. |
| `fallback` | `true` when these are the built-in examples (or an older digest carried forward because no model answered). Label them "Examples" rather than "This week". |
| `notes` | Each member's latest weekly note (members who left are not listed). |
| `next_refresh_at` | When this family may refresh again; `null` means now. Disable the refresh button until then. |

`POST /api/families/{id}/news/refresh` (no body): fetches the warning pages and builds a new digest with the same code as the weekly run, then answers with the news as above plus two fields:

```json
{ "patterns": [ … ], "updated_at": "…", "week": "2026-W46", "fallback": false, "notes": [ … ],
  "next_refresh_at": "2026-11-14T15:20:00.000000+00:00",
  "refreshed": true, "reason": null }
```

| `refreshed` | `reason` | Meaning |
|---|---|---|
| `true` | `null` | A new digest was built just now. |
| `false` | `too_soon` | This family refreshed less than 10 minutes ago; the current news is returned. |
| `false` | `fresh` | A digest was built less than 10 minutes ago (by another family or the weekly run); it is returned as it is. |
| `false` | `no_new_digest` | No model could build one (no key, or every model failed). The stored news stays; with none at all, the built-in examples are stored (`fallback: true`). |
| `false` | `failed` | Something went wrong (a network error); the current news is returned. |

- At most one refresh per family per 10 minutes (`NEWS_REFRESH_SECONDS`, default 600). The request can take up to about a minute when it does build (Firecrawl, then the digest model); show a spinner.
- It never creates a call or a message: the weekly run (`POST /api/families/{id}/weekly-run`) is still what sends notes and schedules drills, and it reuses this week's refreshed digest without building it again.
- `404 not_found` for an unknown family is the only error status; everything else answers `200` with a `reason`.
