# Track 1: organiser accounts, invites and joining, the welcome call on joining

Written on Saturday 14 Nov for the front-end engineer. It adds to [backend.md](../backend.md); nothing there changes except what is listed under "Changes to existing endpoints".

All requests and answers are JSON. Errors have the usual shape, `{ "error": { "code": "…", "message": "…" } }`; show `message` to the person, branch on `code`. A body that does not validate is `422 invalid_request`.

## The flows

**Organiser.**
1. `/register` page: `POST /api/auth/register`. The answer sets the log-in cookie; the browser keeps it.
2. Sign-up page: `POST /api/families` as before. Because the browser is logged in, the family now belongs to the account.
3. Family page (`GET /api/families/{id}`): each member has `invite_link` (`/join/{member_id}`), `joined`, `joined_at` and `phone_number`. Show the invite link as a QR code or a share button, and a "joined" badge.
4. Later visits: `GET /api/auth/me` on load. `401 not_logged_in` means show `/login`; otherwise `families[0].id` opens their family page. `GET /api/families` gives a list with counts, for a picker.

**Member.**
1. Opens `/join/{member_id}` (a front-end route). The page loads `GET /api/join/{member_id}` and shows who invited them, two ticks and an optional phone number.
2. Taps Join: `POST /api/join/{member_id}`. The answer has `phone_link`; go there with the router (a client-side navigation, not a full page load), so the tap on Join can also unlock sound for the ring.
3. The phone page polls `GET /api/members/{id}/phone-state` as before. **On the first poll the welcome call starts by itself**, so that same answer already has `incoming_call` (`kind: "welcome"`). The page rings; Answer works as for any welcome call.

The cookie is HttpOnly: the page cannot read it and does not need to. Calls from the page to `/api/...` are same-origin (the Vite proxy in development, the same server in production), so `fetch` sends the cookie without extra options.

## Endpoints

### `POST /api/auth/register`

Creates an organiser account and logs it in.

```json
{ "name": "Jon Kovacs", "email": "jon@example.com", "password": "at least 8 characters" }
```

`201`, and a `Set-Cookie: cb_session=…`:

```json
{ "account": { "id": "acc_x7Kp2mQa1Bc", "name": "Jon Kovacs", "email": "jon@example.com" },
  "families": [] }
```

- The email is stored trimmed and lower-cased. `name` is 1 to 60 characters, the password 8 to 200.
- `409 email_taken`: an account with this email exists ("Please log in").
- `422 password_too_short`: under 8 characters.
- `422 invalid_request`: the email is not an email address, the name is empty, and so on.

### `POST /api/auth/login`

```json
{ "email": "jon@example.com", "password": "…" }
```

`200` with the same body as `/me`, and a new `Set-Cookie: cb_session=…`.

- `401 wrong_login`, "Wrong email or password.": the same answer for a wrong password and an unknown email.
- `429 too_many_attempts`: 5 wrong log-ins for this email in the last 15 minutes. It is checked before the password, so even the right password is refused until the window passes. A right password before the limit clears the count.

### `POST /api/auth/logout`

No body. Forgets the session and clears the cookie. `200 { "ok": true }`, also when nobody was logged in.

### `GET /api/auth/me`

`200`:

```json
{ "account": { "id": "acc_x7Kp2mQa1Bc", "name": "Jon Kovacs", "email": "jon@example.com" },
  "families": [ { "id": "fam_k2x9…", "name": "The Kovacs" } ] }
```

`families` are the account's own, oldest first. `401 not_logged_in` when there is no valid session (no cookie, an unknown one, or an expired one).

### `GET /api/families`

The logged-in account's families, oldest first, with counts for a picker or a dashboard.

```json
{ "families": [
  { "id": "fam_k2x9…", "name": "The Kovacs", "safe_word_set": true,
    "created_at": "2026-11-14T10:02:11.120000+00:00",
    "member_count": 4, "joined_count": 1 } ] }
```

`401 not_logged_in` without a session.

### `GET /api/join/{member_id}`

What the invite page shows. No log-in: the member id in the link is the key, as for the phone page.

```json
{ "family": { "id": "fam_k2x9…", "name": "The Kovacs", "safe_word_set": true },
  "organiser": { "name": "Jon Kovacs" },
  "member": { "id": "mem_Qz81hT0a", "name": "Sara", "relationship": "mother" },
  "joined": false,
  "joined_at": null,
  "phone_number": null,
  "opted_out": false,
  "consents": { "practice": false, "clone_from_call": false },
  "phone_link": "/phone/mem_Qz81hT0a" }
```

- `organiser`: the name on the account that created the family; for a family made without a log-in, the first member marked `is_organiser`; `null` if neither exists.
- `joined`, `joined_at`, `phone_number`: from their last join, so the form can be filled in again. `joined_at` is the first join's time.
- `consents.practice`: they currently agree to practice calls (the sign-up tick, this page's tick, or a yes on the welcome call). Pre-tick the box with it.
- `consents.clone_from_call`: their latest answer to "my voice may be cloned from my welcome call".
- `opted_out: true`: they left Callback. Show that instead of the form; joining answers `409 opted_out`.
- `404 not_found` for an unknown member.

### `POST /api/join/{member_id}`

```json
{ "consent_practice": true, "consent_clone_from_call": true, "phone_number": "+49 151 2345678" }
```

`200`:

```json
{ "phone_link": "/phone/mem_Qz81hT0a" }
```

Suggested wording for the two ticks (the back end stores these words as the evidence):
- `consent_practice`: "I agree to receive practice calls without knowing when."
- `consent_clone_from_call`: "My voice may be cloned from my welcome call, for practice calls to my family." The welcome agent still asks for a spoken yes before anything is cloned (track 2).

Rules:
- `phone_number` is optional: `null`, missing or blank all mean none. Otherwise an optional leading `+`, then digits and spaces, 6 to 20 characters in all (`+49 151 2345678`, `0151234567`). Anything else is `422 invalid_request` and nothing is stored. It is stored as typed, trimmed. It is not used to call anyone; it is shown on the family page.
- Joining again updates: the ticks, and the phone number (a join without one clears it). `joined_at` keeps the first join's time.
- `409 opted_out`: the member left Callback. `404 not_found`: unknown member.
- Joining does not ring anything by itself. The welcome call starts when their phone page polls (below).

### Changes to existing endpoints

**`POST /api/families`**: unchanged without a session. With a valid session cookie, the new family also belongs to that account (it shows in `/me` and `GET /api/families`).

**`GET /api/families/{id}`**: still readable by id without a log-in. Each member has four new fields, after the existing ones:

```json
{ "id": "mem_Qz81hT0a", "name": "Sara", "…": "existing fields as before",
  "invite_link": "/join/mem_Qz81hT0a",
  "joined": true,
  "joined_at": "2026-11-14T10:05:40.551000+00:00",
  "phone_number": "+49 151 2345678" }
```

`joined` is false (and the other two `null`) for members who have not used their invite link, including every member made before this change.

**`GET /api/members/{id}/phone-state`**: same answer as before. New: for a member who joined and has never had a welcome call, this request first starts one, so `incoming_call` is already set in its answer (`kind: "welcome"`, caller `Callback`).

**`POST /api/members/{id}/welcome-call`**: unchanged (still `409 phone_offline` when the page is not open). It is how a welcome call is started again by hand.

## The welcome call that starts by itself

When a joined member's phone page polls `phone-state` and they have never had a welcome call, in any status, the back end starts one right then, with the same rules as `POST /api/members/{id}/welcome-call`:
- not opted out;
- not busy (no call ringing or in progress): if they are, a later poll starts it, once the other call is over;
- the daily call cap (`DAILY_CALL_LIMIT`): if it is reached, the poll still answers normally, and a later poll tries again;
- the phone is online: the poll itself proves it.

**Only once.** A declined, missed or failed welcome call is not started again by itself; the family page can offer "Start the welcome call" with the existing endpoint. Members who never joined (the old sign-up flow, and the dev phone page) are never called by themselves. A failure here never breaks `phone-state`.

Because it rings on the first poll, the ring screen can appear the moment the phone page opens. Unlock sound on the Join tap (see "The flows") or show the existing "Tap to switch on sound" first; the call rings for 45 seconds before it counts as missed.

## Consents written here

`consents` rows with `source: "invite"`:

| What happened on the invite page | Row (`kind`) | Effect |
|---|---|---|
| Practice ticked, first join | `practice` | Sets `consent_practice_at` if empty (`services/consent.py`, as the sign-up tick). Written even if the organiser ticked it at sign-up: it records the member's own agreement. |
| Practice ticked on a later join, consent already given | none | |
| Practice not ticked while consent is given | `practice_withdrawn` | Clears `consent_practice_at`: the member's own answer wins over the organiser's tick. Practice calls get `409 consent_missing`. |
| Voice ticked, first join, or after a withdrawal | `clone_from_call` | |
| Voice not ticked after a yes | `clone_from_call_withdrawn` | |

The latest of `clone_from_call` and `clone_from_call_withdrawn` is the member's answer: `services/joining.clone_from_call_given(db, member)` reads it (false after an opt-out). Track 2 should check it, together with the spoken `voice_consent`, before cloning from the welcome call.

## Log-in details

- Passwords: `hashlib.scrypt` (n=2¹⁴, r=8, p=1, a 16-byte random salt, a 64-byte key), stored with its parameters as `scrypt$n$r$p$salt$key`, compared with `hmac.compare_digest`.
- The cookie `cb_session` holds a random 32-byte token: HttpOnly, SameSite=Lax, Path=/, Secure when the request came over https (the server's uvicorn trusts nginx's forwarded scheme), 30 days. Only the token's sha256 is stored (`sessions`). Logging out deletes that row.
- Wrong log-ins are counted per email in `login_failures`, also for emails without an account, so the answers never reveal which emails exist.

## Tables (new only)

| Table | Columns |
|---|---|
| `accounts` | `id` (`acc_…`), `email` (unique, lower-cased), `name`, `password_hash`, `created_at` |
| `sessions` | `token_hash` (sha256, primary key), `account_id`, `created_at`, `expires_at` |
| `family_owners` | `family_id` (primary key), `account_id` |
| `login_failures` | `id`, `email`, `created_at` |
| `member_joins` | `member_id` (primary key), `joined_at`, `phone_number` |

## Settings

| Name | Default | Use |
|---|---|---|
| `SESSION_DAYS` | 30 | How long a log-in lasts. |
| `LOGIN_MAX_FAILURES` | 5 | Wrong log-ins for one email within the window before `429`. |
| `LOGIN_WINDOW_MINUTES` | 15 | The window. |
| `AUTO_WELCOME_CALL` | true | `false` stops `phone-state` from starting welcome calls by itself. |

## Where the code is

- `app/routers/accounts.py`: every endpoint above.
- `app/services/accounts.py`: passwords, sessions, the cookie, the wrong-log-in count, family owners.
- `app/services/joining.py`: the invite page, the join, the consent rows, `auto_welcome_call`.
- `app/routers/calls.py`: `start_welcome_call()`, the one place a welcome call is made (the endpoint and `auto_welcome_call` both use it).
- Tests: `tests/test_accounts.py`, `tests/test_joining.py`.
