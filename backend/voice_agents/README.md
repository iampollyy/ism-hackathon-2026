# The three ElevenLabs voice agents

The agents' prompts and tools live here, so they are reviewed like code.

| File | What it is |
|---|---|
| `welcome.md` | The welcome agent's system prompt, copied verbatim from docs/ai.md |
| `practice.md` | The practice agent's system prompt, copied verbatim from docs/ai.md |
| `family_line.md` | The family line agent's system prompt, copied verbatim from docs/ai.md |
| `tools.json` | The three client tools, copied verbatim from docs/ai.md |
| `sync.py` | Pushes prompts, first messages, placeholders, call length and override toggles to ElevenLabs. Dry run by default |

The source of truth for the wording is docs/ai.md. Change the prompt there and here together.

## Set-up checklist (Denis, in the ElevenLabs dashboard)

Do this once. Every box is a click in the dashboard; nothing here needs code.

### 1. Create the three agents

Create them **in the dashboard**, not through the API: agents created in the dashboard get the `end_call` system tool by default, and agents created through the API do not.

- [ ] Create the **Welcome** agent. Put its id in `backend/.env` as `ELEVENLABS_WELCOME_AGENT_ID`.
- [ ] Create the **Practice** agent. Put its id in `backend/.env` as `ELEVENLABS_PRACTICE_AGENT_ID`.
- [ ] Create the **Family line** agent. Put its id in `backend/.env` as `ELEVENLABS_FAMILY_LINE_AGENT_ID`.

### 2. Settings per agent (docs/ai.md, "Settings")

| Setting | Welcome | Practice | Family line |
|---|---|---|---|
| Voice | A warm library voice | Any library voice as the default; replaced on each call | A calm library voice |
| First message | `Hi {{member_name}}, this is Callback. {{organiser_name}} set this up for your family. Have you got two minutes?` | `{{opening_line}}` | `Family line. Hi {{caller_name}}, you did the right thing by calling.` |
| System prompt | `welcome.md` | `practice.md` | `family_line.md` |
| Longest call (`conversation.max_duration_seconds`) | 360 | 180 | 90 |
| Authentication | On | On | On |
| Overrides switched on | None | Voice ID; also system prompt and first message, as the fallback route | None |
| Client tools | `consent_result` | `mark_tactic`, `practice_result` | None |
| System tools | `end_call` | `end_call` | `end_call` |
| Variable placeholders | Set one for every variable | Set one for every variable | Set one for every variable |

**Welcome agent**
- [ ] Voice: a warm library voice.
- [ ] First message: `Hi {{member_name}}, this is Callback. {{organiser_name}} set this up for your family. Have you got two minutes?`
- [ ] System prompt: paste the whole of `welcome.md`.
- [ ] Advanced: maximum conversation duration 360 seconds.
- [ ] Security: authentication on. Do not also set a host allowlist.
- [ ] Overrides: none switched on.
- [ ] Tools: add the client tool `consent_result` from `tools.json`, with "Wait for response" off.
- [ ] Tools: the system tool `end_call` is on.
- [ ] Placeholders: `member_name` = Sara, `organiser_name` = Jon, `family_name` = The Kovacs.

**Practice agent**
- [ ] Voice: any library voice (the back end replaces it on every call).
- [ ] First message: `{{opening_line}}`
- [ ] System prompt: paste the whole of `practice.md`.
- [ ] Advanced: maximum conversation duration 180 seconds.
- [ ] Security: authentication on. Do not also set a host allowlist.
- [ ] Security, overrides: switch on **Voice ID** (`tts.voiceId`), and also **System prompt** and **First message** for the fallback route. An override the page sends that is not switched on makes the conversation fail to start.
- [ ] Tools: add the client tools `mark_tactic` and `practice_result` from `tools.json`, each with "Wait for response" off. Names are case-sensitive.
- [ ] Tools: the system tool `end_call` is on.
- [ ] Placeholders: `target_name` = Sara, `caller_claim` = Sara's son, Jon, `address_as` = Mum, `opening_line` = Mum? It's me. I dropped my phone, so this is a new number., `scenario_brief` = You broke your phone this morning and are using a borrowed one., `ask` = a transfer of a few hundred euros today, to a friend's account, `tactic_order` = new_number, urgency, secrecy, `difficulty` = 1, `reveal_line` = Sara, this was a Callback practice call. The voice you heard was artificial.

**Family line agent**
- [ ] Voice: a calm library voice.
- [ ] First message: `Family line. Hi {{caller_name}}, you did the right thing by calling.`
- [ ] System prompt: paste the whole of `family_line.md`.
- [ ] Advanced: maximum conversation duration 90 seconds.
- [ ] Security: authentication on. Do not also set a host allowlist.
- [ ] Overrides: none switched on.
- [ ] Tools: no client tools. The system tool `end_call` is on.
- [ ] Placeholders: `family_name` = The Kovacs, `caller_name` = Sara, `relative_name` = Jon, `what_happened` = It was a practice call in Jon's voice about a new phone number. They asked for the family word.

### 3. Library voices for the scenarios without a clone

- [ ] Pick a library voice for the police scenario; put its id in `backend/.env` as `ELEVENLABS_POLICE_VOICE_ID`.
- [ ] Pick one for the bank scenario: `ELEVENLABS_BANK_VOICE_ID`.
- [ ] Pick one for the clinic (hospital) scenario: `ELEVENLABS_NURSE_VOICE_ID`.
- [ ] Use only voices offered for general use in the library. Never clone a real public person's voice.

### 4. The agents' language model

- [ ] Pick the fastest model that stays in role and still calls the tools. Start small (`gpt-6-luna`, `gpt-6.1-terra`); move up only if it drifts or forgets `mark_tactic` / `practice_result`. Judge by ear.
- [ ] If you use "Custom LLM" with our own OpenAI key, store the key as an ElevenLabs secret named `OPENAI_API_KEY`, and check that `mark_tactic` still fires.

### 5. Checks after set-up

- [ ] Talk to the practice agent in the dashboard in a stock voice: it plays the caller, calls `practice_result`, says the reveal line and hangs up with `end_call`.
- [ ] Restart the back end without `FAKE_ELEVENLABS`, answer a practice call on a phone page, and check the cloned voice sounds like its owner on the default voice model (`eleven_v4_turbo`).
- [ ] Check that `mark_tactic` fires on the phone page (the laptop labels the tactic).
- [ ] Check that a long `scenario_brief` variable is accepted. If not, switch to the prompt override route (backend.md, "Fallback").
- [ ] Before any cloned-voice call to someone other than yourself: that person has said yes, and the question about this use has been sent to ElevenLabs (their use policy).

## Pushing changes with sync.py

```
cd backend
.venv/bin/python voice_agents/sync.py            # dry run: prints what it would send, sends nothing
.venv/bin/python voice_agents/sync.py --push     # sends it to the three agents in backend/.env
```

`--push` updates each agent's prompt, first message, placeholders, longest call, authentication and override toggles with `PATCH /v1/convai/agents/{agent_id}`. It does not add or remove tools: add the client tools by hand (step 2). The request shape follows ElevenLabs' API reference but was not tried against the live account (check). After the first push, check in the dashboard that `end_call` is still on.
