# The member's voice from their own side of the welcome call

Full app, track 2. Written on Saturday 14 Nov for the front-end engineer. The rules live in `backend/app/services/voice_sample.py`; the endpoints in `backend/app/routers/voice_sample.py`; the tests in `backend/tests/test_voice_sample.py`.

Until now a member's voice was cloned only from a recording they made on purpose (`POST /api/members/{id}/voice`). Now it can happen by itself: during the welcome call the phone page records the member's own microphone, the welcome agent asks out loud whether that voice may be used, and the back end clones it once both consents are in. Nobody has to press anything after joining.

## What happens

```
join (track 1)                 welcome call                                   after the call
──────────────                 ────────────                                   ──────────────
tick "my voice may be    ──►   page records ONLY the member's mic             page uploads the recording
cloned from my welcome         agent: "May Callback use your voice …?"   ──►  POST /api/calls/{id}/voice-sample
call" (consent row             tool voice_consent_result {given}              back end: when the recording AND the
clone_from_call)               page sends event voice_consent {given}         spoken yes are both in, it cleans,
                                                                              measures and clones in the background
```

- **Two consents, both needed.** The tick at join (`consents.kind = clone_from_call`, written by track 1) and a clear spoken yes on this welcome call. Without either, nothing is cloned and the recording is not kept.
- **The order does not matter.** The upload usually comes after the yes (the page uploads when the call ends), but the yes may also arrive later (a late events batch). Whichever arrives second starts the clone.
- **At least about 10 seconds of their voice.** The recording is cleaned (mono, long silences trimmed), so what is left is roughly how long they spoke. Under 10 seconds (setting `VOICE_SAMPLE_MIN_SECONDS`), no clone is made and the reason says so. The welcome agent now invites people to talk a little more, so a normal call gives 30 to 60 seconds.
- **A failure never takes away a working voice.** If the member already has a ready clone (from an upload or an earlier call), it stays in use.
- **The result shows where the family page already looks.** A clone made this way sets the member's `voice_status` to `ready` and `voice_ready` to `true` in `GET /api/families/{id}`, exactly like an upload. The new status endpoints add the in-between states and the reason.

## The phone page: what to build

During a **welcome call only**:

1. **Forward the new client tool.** Add it to `clientTools`, next to `consent_result`:

   ```js
   voice_consent_result: (p) => push({ type: 'voice_consent', given: p.given === true || p.given === 'true' }),
   ```

   Send `true` only for a real boolean `true` (or the string `"true"`); anything else is `false`.

2. **Record the member's own microphone**, and nothing else (not the agent's audio). Start it just *before* `startSession`, so that if a phone allows only one live capture, the call's own microphone is the one that wins:

   ```js
   async function startRecording() {
     const stream = await navigator.mediaDevices.getUserMedia(
       { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
     const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm']
       .find((t) => MediaRecorder.isTypeSupported(t)) || '';
     const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
     const chunks = [];
     recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
     recorder.start(1000);
     return { stream, recorder, chunks, type: recorder.mimeType || type || 'audio/webm' };
   }
   ```

   Keep `echoCancellation` on: it stops the agent's voice, coming out of the phone's speaker, from leaking into the recording. A call of a few minutes stays far below the 25 MB limit with the browser's default bitrate.

3. **When the call ends**, after `POST /api/calls/{id}/end`, stop the recorder, stop the tracks and upload:

   ```js
   async function uploadRecording(callId, rec) {
     if (rec.recorder.state !== 'inactive') await new Promise((r) => { rec.recorder.onstop = r; rec.recorder.stop(); });
     rec.stream.getTracks().forEach((t) => t.stop());
     const blob = new Blob(rec.chunks, { type: rec.type });
     if (!blob.size) return;
     const form = new FormData();
     form.append('audio', blob, rec.type.includes('mp4') ? 'welcome.mp4' : 'welcome.webm');
     await fetch(`/api/calls/${callId}/voice-sample`, { method: 'POST', body: form });
   }
   ```

   Do not set `Content-Type` yourself; the browser adds the multipart boundary. Upload whatever happened in the call: the back end decides whether it may be used, and deletes it at once if not. Do not wait for the answer before showing the next screen.

The test phone page served by the back end (`GET /api/dev/phone/{member_id}`, `backend/app/static/dev_phone.html`) already does all three, so the whole path can be tried on a real phone today.

**Check on an iPhone:** that the agent still hears the member while the second recording runs (the ElevenLabs session opens its own microphone capture). The order above protects the call if only one capture can stay live; then the recording would be silent and the status says so.

## Endpoints

All paths are under `/api`. Errors have the usual shape: `{ "error": { "code": "…", "message": "…" } }`.

### `POST /api/calls/{call_id}/events`: new event type `voice_consent`

```json
{ "events": [ { "type": "voice_consent", "given": true } ] }
```

Answer: `{ "ok": true }`, as for every batch.

- `given` is required and must be a JSON boolean, `true` or `false`; anything else (`"true"`, `"yes"`, `1`) is `422 invalid_request` and the whole batch is refused, so normalise it on the page as shown above.
- **Welcome calls:** stored and published on the call's stream like every event. A `true` from a member who ticked "my voice may be cloned from my welcome call" at join also writes a consent row (`kind: clone`, `source: welcome_call`, `call_id`, evidence "Said yes on the welcome call (voice_consent_result)"); the same yes twice writes one row. Without the tick, or after an opt-out, only the event is stored. A `false` is kept as the event; a recording waiting for this answer is deleted.
- **The latest answer in the call counts.** A no after a yes, before the clone is made, stops it. A yes after a no gives consent again, but a recording the no already let go of is not brought back.
- **Other kinds of call:** stored, changes nothing (like `consent`).
- It never touches practice consent; that is still `consent`.
- It does not appear in `GET /api/calls/{id}` (turns, tactics and risk only).

### `POST /api/calls/{call_id}/voice-sample`

`multipart/form-data` with one file field, `audio`: webm, mp4, m4a, ogg, wav, mp3, aac or caf (by file name, else by content type; anything else is still tried, as `bin`). At most 25 MB. The same rules as `POST /api/members/{id}/voice`.

Answers `200` at once:

```json
{ "accepted": true, "cloning": true, "reason": null }
```

```json
{ "accepted": true, "cloning": false, "reason": "Waiting for Sara's spoken yes on the welcome call." }
```

| Field | Meaning |
|---|---|
| `accepted` | Always `true` on a `200`: the upload was received. |
| `cloning` | `true`: the recording and both consents are in, and the clone is being made now, in the background (a few seconds). |
| `reason` | Why it is not cloning (yet), in plain words for the screen. `null` when `cloning` is `true`. |

The reasons a `200` can carry when `cloning` is `false`:

| Situation | What the back end does | `reason` (example) |
|---|---|---|
| No spoken answer yet | Keeps the recording; clones when a yes arrives | "Waiting for Sara's spoken yes on the welcome call." |
| The member did not tick at join | Does not keep it | "Sara did not agree, when joining, that their voice may be cloned from the welcome call, so the recording is not kept." |
| The latest spoken answer is not a clear yes | Does not keep it | "Sara did not say a clear yes to using their voice from this call, so the recording is not kept." |
| A voice was already made from this call | Ignores the new upload | "A voice was already made from this call." |

A second upload for the same call, while the first still waits, replaces it. While a clone is running, another upload answers `cloning: true` and is ignored. After a failure, a new upload is a new attempt: it is checked against the daily cap again and counts toward it (it writes a `clone` consent row of its own, evidence "A new attempt with a new recording from the welcome call (the spoken yes stands)").

| Status | Code | When |
|---|---|---|
| 404 | `not_found` | No call with this id. |
| 409 | `not_a_welcome_call` | The call is a practice or a family-line call. |
| 409 | `not_answered` | The call is `scheduled`, `ringing`, `declined` or `missed`. |
| 409 | `call_over` | The call `failed` (the conversation never started). |
| 409 | `opted_out` | The member has left Callback. |
| 413 | `too_large` | Over 25 MB. |
| 422 | `invalid_request` | No `audio` field, or an empty file. |
| 429 | `daily_limit` | A new attempt after a failure, when today's clone cap is reached. |

The upload is taken while the call is `in_progress`, `ended` or `scored`.

### `GET /api/calls/{call_id}/voice-sample/status`

What became of that welcome call's recording. Poll it every second or two after the upload until `state` is `ready`, `failed` or `none`.

```json
{ "call_id": "call_9f3k", "state": "ready", "reason": null, "speech_seconds": 41.5 }
```

```json
{ "call_id": "call_9f3k", "state": "failed",
  "reason": "Only about 6 seconds of Sara's voice were heard on the call; a voice needs at least 10. Sara's earlier voice is still used.",
  "speech_seconds": 6.2 }
```

| `state` | Meaning | `reason` |
|---|---|---|
| `none` | Nothing from this call is kept: no recording yet, or it may not be used. | Why, such as "No recording from this call yet." or one of the refusals above. Never `null`. |
| `waiting_for_consent` | The recording is kept and waits for a spoken yes. | "Waiting for Sara's spoken yes on the welcome call." |
| `cloning` | The clone is being made. | `null` |
| `ready` | A voice was made from this call; it is now the member's voice. | `null` |
| `failed` | It could not be made. | Why: too little voice, unreadable audio, ElevenLabs' answer, or the daily limit. |

`speech_seconds` is how many seconds of their voice were left after cleaning, once measured; otherwise `null`.

For a practice or family-line call: `200` with `state: none` and "Only a welcome call records the member's voice." Unknown call: `404 not_found`.

`ready` describes this call: if the member later deletes their voice (`DELETE /api/members/{id}/voice`) or records a new one, the family view's `voice_status` is what is current.

### `GET /api/members/{member_id}/voice-sample`

The same object for the member's latest answered welcome call (`in_progress`, `ended` or `scored`; not one that `failed` as it started) that has a recording, or else for their latest answered welcome call, so the family page can show it without knowing the call id. So a voice made on an earlier welcome call still shows as `ready` while a re-run has not uploaded yet. Before any welcome call:

```json
{ "call_id": null, "state": "none", "reason": "No welcome call yet.", "speech_seconds": null }
```

Unknown member: `404 not_found`.

## The family page

`GET /api/families/{id}` is unchanged. A voice made from the call shows as `voice_status: "ready"`, `voice_ready: true` and `consent.clone: true`. A failed attempt with no earlier voice (too little voice, unreadable audio, ElevenLabs, or the daily limit) shows `voice_status: "failed"`.

For the moments in between, and for the reason, use `GET /api/members/{id}/voice-sample`. A suggestion for each state:

| `state` | Show |
|---|---|
| `none` | Nothing, or the `reason` in small print. |
| `waiting_for_consent` | "Voice: waiting for their yes" |
| `cloning` | "Voice: being made…" |
| `ready` | "Voice: ready" (the family view's `voice_ready` says the same) |
| `failed` | "Voice: not made" and the `reason`, with the existing "Record a voice" route as the way out. |

## Rules the back end keeps

- **Never without both consents.** They are checked when the clone starts and again before it is stored; if a no or an opt-out came in meanwhile, the new clone is deleted at ElevenLabs.
- **The daily clone cap** (`DAILY_CLONE_LIMIT`, `services/limits.py`) counts consent rows of kind `clone`. The spoken yes's row is checked against the cap just before it is written, as an upload's is. Over the cap, the row is still written (it is what they said), the call's sample is `failed` with the cap's message, and `voice_status` becomes `failed` unless an earlier voice is ready. Each new attempt after a failure is checked again and writes a row of its own, so it counts like an upload.
- **Files.** The upload is kept under `media/samples/` only while it may still be used, and deleted once the clone is made or has failed, or as soon as it may not be used. `POST /api/members/{id}/opt-out` deletes a recording that is still waiting at once. The cleaned copy of a clone that was made replaces `media/voices/{member_id}.mp3`, the same file an upload keeps, so deleting the voice deletes it.
- **Replacing a voice.** A new clone replaces the member's older one, which is deleted at ElevenLabs, as with an upload.
- **Restarts.** A clone cut short by a server restart starts again on the next upload or status request for that call.

## Settings

| Name | Default | Use |
|---|---|---|
| `VOICE_SAMPLE_MIN_SECONDS` | `10` | Fewer seconds of their voice than this, after cleaning, and no clone is made. |
| `DAILY_CLONE_LIMIT` | `0` (no cap) | Existing; also covers these clones. |
| `FAKE_ELEVENLABS` | `false` | Existing; with it on, the clone is a fake voice id, so the whole path runs without ElevenLabs. ffmpeg still cleans and measures the real recording. |

## For the lead, after merging

- Push the agent: `.venv/bin/python voice_agents/sync.py --push` (creates the `voice_consent_result` tool and puts it on the welcome agent with the new prompt).
- Run `.venv/bin/python voice_agents/agent_tests.py welcome`: `welcome_yes` now expects both tools with `true`, the new `welcome_voice_no` expects `consent_result` true and `voice_consent_result` false, and `welcome_no` must never ask about the voice.
- Members made by the old sign-up (`POST /api/families`) have no join tick, so their welcome call never clones; they still record a voice the old way.
