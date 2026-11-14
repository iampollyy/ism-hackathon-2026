# Waitlist (landing page)

| Method | Path | Body | Answer |
|---|---|---|---|
| POST | `/api/waitlist` | `{email, kind: "family" \| "bank" (default family), organisation?, message?, source?}` | `{ok: true}` |
| GET | `/api/waitlist/count` | | `{families, banks}` |

Signing up twice updates the entry and answers the same, so the page never reveals whether an email was already on the list. Errors:
422 `invalid_request` (bad email), 429 `daily_limit` (more than 500 new sign-ups today). `source` is a short tag of where on the page the
form was (e.g. `hero`, `pricing`, `banks`).
