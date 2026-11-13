# Track 3: protection settings, random drills and the Shield

Written on Saturday 14 Nov for the front-end engineer. It adds to [backend.md](../backend.md) and changes nothing there except the additive fields listed under "Changes to existing responses". Back end: `backend/app/routers/protection.py`, `backend/app/services/protection.py` (settings, drills, starting a shield call) and `backend/app/services/shield.py` (the live warning and the family alerts).

## What it gives the app

- **Protection settings** (organiser's family page): random drills on or off, how many a week, the hours they may ring, the Shield on or off; per member, whether drills can reach them and why not, a pause switch, their next drill and how many they had this week.
- **Random drills**: practice calls that ring at a random moment inside the family's hours, announced but not scheduled by anyone. The back end plans them by itself about once a minute.
- **A surprise drill** for the demo: one drill within the next minute or so.
- **A shield call** for the demo's protection moment: a simulated real scam call. The same practice agent and flow, but the person is not in training mode: their phone shows a live warning as soon as the call sounds like a scam, and the family is alerted by itself, with no tap. (In the product, real calls are forwarded to a Callback line; this weekend the call comes through the app.)
- **A manual alert**: a "Something's wrong" button on the phone, outside any call.

## Endpoints

| Call | Purpose | Returns |
|---|---|---|
| `GET /api/families/{id}/protection` | The settings and each member's drill status | Protection object |
| `PUT /api/families/{id}/protection` | Change any setting | Protection object |
| `PUT /api/members/{id}/drills` | Pause or resume one member's drills | Protection member object |
| `POST /api/families/{id}/surprise-drill` | One drill within the next `within_seconds` | `call_id`, member, scenario, `scheduled_for` |
| `POST /api/families/{id}/shield-call` | Ring a shield call now | `call_id`, member, scenario |
| `POST /api/members/{id}/alert` | The "Something's wrong" button | `alerted` |

Errors use the usual shape, `{ "error": { "code": "…", "message": "…" } }`. The `message` is a plain sentence you can show as it is.

### `GET /api/families/{id}/protection`

```json
{ "family_id": "fam_k2x9",
  "enabled": true,
  "drills_per_week": 2,
  "window_start_hour": 10,
  "window_end_hour": 19,
  "timezone": "Europe/Vilnius",
  "shield_enabled": true,
  "updated_at": "2026-11-14T13:02:11.512345+00:00",
  "members": [
    { "member_id": "mem_Qz81hT0a", "name": "Sara", "eligible": true, "reason_if_not": null,
      "paused": false, "next_drill_at": "2026-11-16T09:41:07+00:00", "drills_last_7_days": 1 },
    { "member_id": "mem_7Lr2pWcd", "name": "Jon", "eligible": false, "reason_if_not": "Drills are paused.",
      "paused": true, "next_drill_at": null, "drills_last_7_days": 0 } ] }
```

| Field | Meaning |
|---|---|
| `enabled` | Random drills on. Default `false`. |
| `drills_per_week` | 1 to 7. Default 2. |
| `window_start_hour`, `window_end_hour` | The family's local hours in which a random drill may ring: from the start hour (inclusive) to the end hour (exclusive; 24 is midnight). Default 10 to 19. |
| `timezone` | An IANA zone name. Default `Europe/Vilnius`. |
| `shield_enabled` | The Shield on. Default `true`. Off: no shield calls, no live warning, no automatic alert. |
| `updated_at` | `null` until the settings are first changed (the defaults apply). |
| `members[].eligible` | A random or surprise drill may pick them. |
| `members[].reason_if_not` | Why not, one of: `Has left Callback.`, `Has not agreed to practice calls.`, `Drills are paused.`, `No practice scenario can be used yet.` `null` when eligible. |
| `members[].next_drill_at` | Their next scheduled practice call of any source (random drill, surprise drill, weekly run, a delayed practice from the laptop), or `null`. |
| `members[].drills_last_7_days` | Practice calls that rang for them in the last 7 days (shield calls not counted). |

Members are listed in sign-up order, including those who left (not eligible). Errors: `404 not_found` (no such family).

### `PUT /api/families/{id}/protection`

Every field is optional; a missing or `null` field keeps its value.

```json
{ "enabled": true, "drills_per_week": 3, "window_start_hour": 9, "window_end_hour": 20,
  "timezone": "Europe/Vilnius", "shield_enabled": true }
```

Returns the protection object, as `GET`.

- Any change to `enabled`, `drills_per_week`, the window or `timezone` cancels the family's pending random drills (they show as `failed` in the family page's `week`). If drills are on, the next pass (within about a minute) plans new ones with the new settings. Changing only `shield_enabled` cancels nothing.
- Errors: `404 not_found`; `422 invalid_request` when `drills_per_week` is outside 1 to 7, `window_start_hour` outside 0 to 23, `window_end_hour` outside 1 to 24, the start is not before the end (also against the stored value of the hour not sent), or the time zone is unknown. Nothing is changed on an error.

### `PUT /api/members/{id}/drills`

```json
{ "paused": true }
```

Returns that member's entry, as in `members[]` above:

```json
{ "member_id": "mem_Qz81hT0a", "name": "Sara", "eligible": false, "reason_if_not": "Drills are paused.",
  "paused": true, "next_drill_at": null, "drills_last_7_days": 1 }
```

Pausing cancels the member's pending random and surprise drills (other scheduled practices, such as the weekly run's, stay). Errors: `404 not_found`, `422 invalid_request` (no `paused`).

### `POST /api/families/{id}/surprise-drill`

The body is optional.

```json
{ "member_id": "mem_Qz81hT0a", "within_seconds": 60 }
```

- `member_id`: who gets it. Left out: a random eligible member who is not on a call.
- `within_seconds`: 20 to 300, default 60. The drill rings at a random moment between 10 seconds and this many seconds from now.

Returns `201`:

```json
{ "call_id": "call_9f3k", "member": { "id": "mem_Qz81hT0a", "name": "Sara" },
  "scenario": "relative_new_number", "scheduled_for": "2026-11-14T13:05:42+00:00" }
```

The call is a normal practice call with status `scheduled`; the scheduler rings it at `scheduled_for`, with the phone page open or not (Web Push wakes a closed one). The laptop can follow it with `GET /api/calls/{call_id}` or the live stream as usual. It works whether or not random drills are enabled. The scenario, difficulty and voice are chosen as for a random drill (below).

Errors: `404 not_found` (family, or a member not in this family); `409 not_eligible` (that member cannot get a drill, or nobody can; the message says why, such as "Sara cannot get a drill now. Drills are paused."); `409 busy` (that member is on a call); `422 invalid_request` (`within_seconds` out of range); `429 daily_limit`.

### `POST /api/families/{id}/shield-call`

```json
{ "member_id": "mem_Qz81hT0a", "voice_member_id": null, "scenario": null }
```

- `voice_member_id` and `scenario` are optional. With neither: `relative_new_number` in a random other member's ready voice; if nobody else has a ready voice, `bank_security` in its library voice. With only `voice_member_id`: `relative_new_number` in that voice. With only a clone `scenario` (`relative_new_number`): a random other member's ready voice, if any. A library scenario (`police`, `bank_security`, `hospital`) speaks in its library voice.
- It rings now, created like `POST /api/practice-calls` with all its checks (the phone page must be open), at difficulty 2.

Returns `201`:

```json
{ "call_id": "call_9f3k", "member": { "id": "mem_Qz81hT0a", "name": "Sara" }, "scenario": "relative_new_number" }
```

On the phone it rings like any practice ("Unknown number"), and the answer returns the usual session. Errors: `404 not_found` (family, or member not in it); `409 shield_off` (the family switched the Shield off); `409 consent_missing`, `voice_not_ready`, `busy`, `phone_offline` (as for practice calls); `422 invalid_request` (unknown scenario); `429 daily_limit`.

### `POST /api/members/{id}/alert`

The "Something's wrong" button, outside any call. The body is optional.

```json
{ "claimed_member_id": "mem_7Lr2pWcd" }
```

`claimed_member_id`: the relative the caller pretended to be, if the person knows. Writes an `alert` message to every other family member who has not left; the claimed relative gets the specific text (below). The same tap again within 60 seconds writes nothing more but answers the same.

Returns `{ "alerted": 2 }` (how many family members were alerted). Errors: `404 not_found` (member, or a claimed member outside the family); `409 consent_missing` (the member has left Callback).

## Changes to existing responses (all additive)

**`GET /api/members/{id}/phone-state`** has a new field, `shield`. It is `null` unless the member is on a shield call that is in progress (never while it rings, never on a training drill, never once it ended, never when the family's Shield is off):

```json
"shield": {
  "call_id": "call_9f3k",
  "level": "red",
  "reason": "Asks for money today",
  "signals": ["new_number", "urgency", "money_request"],
  "labels": ["New number", "Urgency", "Asks for money"],
  "warn": true,
  "message": "This sounds like a scam. Hang up and call Jon on their usual number.",
  "call_back": { "member_id": "mem_7Lr2pWcd", "name": "Jon", "phone_number": "+370 600 00000" } }
```

| Field | Meaning |
|---|---|
| `level`, `reason`, `signals`, `labels` | From the call's latest live risk check (backend.md, "The `risk` event"). Before the first check: `green`, "Nothing worrying yet", no signals. |
| `warn` | `true` when `level` is `red`, or `yellow` with `money_request`, `asks_for_code` or `refuses_callback` among the signals. Once true it stays true for the call (the level never goes down). |
| `message` | The warning to show, fixed wording from code; `null` while `warn` is false. |
| `call_back` | Whom to call back: the relative whose voice is being imitated; for a library-voice scenario, the family's organiser (another member if the person is the organiser). `phone_number` is the number stored when they joined, or `null`. The whole object is `null` if the family has nobody else. |

The phone polls every second, so the warning shows within about a second of the risk check.

**`POST /api/calls/{id}/answer`**: `reveal` has a new field, `kind`: `"practice"` or `"shield"`. For a shield call, `dynamic_variables.reveal_line` is "Sara, this was a simulated scam call to show how Callback Shield protects you. The voice you heard was artificial." Show the reveal screen with wording to match: a simulated scam call that showed the Shield, not a practice.

**`GET /api/calls/{id}`** has a new field, `shield`: `null` for every call but a shield call; for one:

```json
"shield": { "alerted": 2, "alerted_at": "2026-11-14T13:06:03.120000+00:00", "alert_level": "red" }
```

`alerted` is 0 and the times `null` until the family is alerted. A shield call is otherwise an ordinary practice call (`kind: "practice"`), scored like one.

**Live stream** (`GET /api/calls/{id}/events`): a new event, `shield.alert`, at most once per shield call, right after the `risk` event that set it off:

```
id: 15
event: shield.alert
data: {"alerted": 2, "level": "red", "t": 22.4}
```

**Messages**: a new kind, `alert`, in `phone-state.messages` and in the family page's `week` (`kind: "alert"`). Texts:

- to the relative being imitated: "Sara is on a call from someone pretending to be you. Call them now."
- to everyone else: "Sara is on a call that sounds like a scam. Call them now on their usual number."

Web Push sends each one with the title "Family alert" and `Urgency: high`.

## Rules

**Eligible for a drill**: has agreed to practice calls, has not left Callback, has not paused drills, and at least one scenario can be used (a clone scenario needs another family member with a ready voice; library scenarios always work).

**Random drills.** About once a minute, for each family with drills enabled, each eligible member who has no scheduled practice and fewer drills in the last 7 days than `drills_per_week` gets the next one: at a random time inside the family's window (its time zone), on a random day within the next 7 / `drills_per_week` days, never sooner than 10 minutes from now. So with 2 a week the next drill is within three and a half days.

**Choosing a drill** (random and surprise): the scenario and difficulty of the member's next planned step (`plan.steps`, marked `scheduled` once used), else the readiness rule the planner uses (the story they would most likely believe first; after that, a new story or the same pressure in a different story). For a clone scenario, a random other family member with a ready voice; if there is none, a random library scenario instead.

**Every drill and shield call is a practice call** made by the same code as `POST /api/practice-calls`: the consent gate, the voice checks and the daily caps all apply, and a scheduled drill re-runs the gate when it comes due.

**The Shield acts only on shield calls.** Training drills never warn and never alert: `phone-state.shield` stays `null` for them and no `alert` message is written. The warning and the alert come only from the stored live risk checks, so they need the live risk check on (`RISK_CHECK_ENABLED`, on by default; without model keys its keyword fallback still runs).

**The automatic alert** is sent once per shield call, the first time a stored risk check warns (as `warn` above), with no tap from anyone.

## Recipes

**Phone page.**

```js
const s = state.shield;                 // from phone-state, every second
if (s && s.warn) {
  showWarning(s.message);               // big, red, over the call screen
  if (s.call_back) showCallBack(s.call_back.name, s.call_back.phone_number);  // tel: link when there is a number
} else if (s) {
  showShieldChip(s.level, s.reason);    // optional: "Callback Shield is listening"
}
// After the call: if (session.reveal.kind === 'shield') use the shield wording on the reveal screen.
```

Outside a call, a "Something's wrong" button posts `POST /api/members/{id}/alert` (optionally with the relative the caller claimed to be) and shows "Your family has been told" with `alerted`.

**Laptop live screen.** On the stream, show "Shield alerted the family" on `shield.alert` (with `alerted`). Without the stream, poll `GET /api/calls/{id}` and show it once `shield.alerted > 0`.

**Settings screen.** `GET` on open; `PUT` on each change and render the returned object. Show `reason_if_not` under a member who is not eligible, and their pause switch (`PUT /api/members/{id}/drills`).

## Demo

1. Open Sara's, Jon's and Ana's phone pages. Jon has a ready voice.
2. Laptop: `POST /api/families/{id}/shield-call` with Sara. Her phone rings.
3. Sara answers. The caller, in Jon's voice, soon asks for money. Within a second or two of that line her phone shows the red warning with "Call Jon", Jon and Ana get the family alert (and a push, when Web Push is on), and the laptop shows "Shield alerted the family".
4. The agent reveals with the shield line; the reveal screen shows the shield wording.

For a drill instead: `POST /api/families/{id}/surprise-drill` with Sara, and it rings within a minute, with no warning and no alert.

## Settings (`backend/.env`)

| Name | Default | Use |
|---|---|---|
| `RANDOM_DRILLS_ENABLED` | `true` | `false` stops the random-drill pass for every family (surprise drills still work). |
| `DRILL_PASS_SECONDS` | `60` | How often the scheduler loop plans random drills. |

## Tables (new)

| Table | Columns |
|---|---|
| `protection_settings` | `family_id` (key), `enabled`, `drills_per_week`, `window_start_hour`, `window_end_hour`, `timezone`, `shield_enabled`, `updated_at` |
| `member_drill_settings` | `member_id` (key), `paused`, `updated_at` |
| `call_shield` | `call_id` (key), `created_at`, `alerted_at`, `alert_level`. A practice call with a row here is a shield call. |
| `drill_calls` | `call_id` (key), `family_id`, `member_id`, `source` (`random` or `surprise`), `created_at`. Says which scheduled calls a pause or a settings change may cancel. |

`member_joins` (track 1) is read for `call_back.phone_number`, defensively: with raw SQL, and `null` when the table or the row is missing.
