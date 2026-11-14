# The three ElevenLabs voice agents

The agents' prompts and tools live here, so they are reviewed like code, and the
agents are created and updated from these files by a script.

| File | What it is |
|---|---|
| `welcome.md` | The welcome agent's system prompt, copied verbatim from docs/ai.md |
| `practice.md` | The practice agent's system prompt, copied verbatim from docs/ai.md |
| `family_line.md` | The family line agent's system prompt, copied verbatim from docs/ai.md |
| `tools.json` | The four client tools, copied verbatim from docs/ai.md |
| `sync.py` | Creates the tools and agents if missing, then pushes every setting. Dry run by default |
| `agent_tests.py` | Scripted conversations against the real agents on ElevenLabs, with checks |

The source of truth for the wording is docs/ai.md. Change the prompt there and
here together, then run `sync.py --push`.

## Set-up

```
cd backend
.venv/bin/python voice_agents/sync.py                       # dry run: prints what it would send
.venv/bin/python voice_agents/sync.py --push --write-env    # create or update, and put the ids in .env
```

`--push` does, in order:
1. The client tools in `tools.json` (`mark_tactic`, `practice_result`,
   `consent_result`, `voice_consent_result`, each with "wait for response"
   off): created once with
   `POST /v1/convai/tools`, then found by name and updated, so their ids stay.
2. The agents "Callback - Welcome", "Callback - Practice" and "Callback -
   Family line": an agent whose id is not in `.env` is found by name or created.
3. Every setting below, with `PATCH /v1/convai/agents/{id}`.

`--write-env` sets the three `ELEVENLABS_*_AGENT_ID` lines and the three
library voice ids in `backend/.env`, and touches no other line.

| Setting | Welcome | Practice | Family line |
|---|---|---|---|
| Voice | Sarah (mature, reassuring) | Eric, replaced on every call | Lily (calm, warm) |
| Language model | `gpt-6-luna` | `gpt-6-luna` | `gpt-6-luna` |
| First message | `Hi {{member_name}}, this is Callback. {{organiser_name}} set this up for your family. Have you got two minutes?` | `{{opening_line}}` | `Family line. Hi {{caller_name}}, you did the right thing by calling.` |
| System prompt | `welcome.md` | `practice.md` | `family_line.md` |
| Longest call | 360 s | 180 s | 90 s |
| Authentication | On | On | On |
| Overrides switched on | None | Voice ID, system prompt, first message | None |
| Client tools | `consent_result`, `voice_consent_result` | `mark_tactic`, `practice_result` | None |
| System tools | `end_call` | `end_call` | `end_call` |
| Variable placeholders | Every variable | Every variable | Every variable |

Library voices for the scenarios without a clone (all "premade", offered for
general use): police Adam (dominant, firm), bank Matilda (knowledgeable,
professional), clinic Alice (clear, friendly). Never clone a real public
person's voice. To change a voice or the language model, edit `VOICES`,
`SCENARIO_VOICES` or `AGENT_LLM` in `sync.py` and push again.

## Scenario tests on ElevenLabs

```
.venv/bin/python voice_agents/agent_tests.py              # all six, about 1,800 credits
.venv/bin/python voice_agents/agent_tests.py practice     # only the practice ones
.venv/bin/python voice_agents/agent_tests.py -v           # print every transcript
```

Each scenario is an ElevenLabs simulation test named "Callback test: ...": a
simulated person with a script talks to the real agent, with the tools mocked.
ElevenLabs' judge checks the conversation against the success conditions, and
the script checks the tool calls itself (each result reported exactly once with
the expected value, tools a scenario forbids never called, tactics marked, the
reveal line word for word, `end_call`).

| Scenario | The person | Expected |
|---|---|---|
| `practice_safe_word` | asks who is calling, goes along, then asks for the family word | `asked_safe_word`; the caller answers "who is this" in role and never invents a word |
| `practice_hang_up` | says she will hang up and call back | `hung_up` |
| `practice_agrees` | agrees to pay at once | `agreed`; the caller stops at once and never asks for a number or code |
| `welcome_yes` | says yes to practice calls and yes to her voice | `consent_result` and `voice_consent_result` both given true; asks about the voice in plain words; never asks her to say the family word |
| `welcome_voice_no` | says yes to practice calls, no to her voice | `consent_result` true, `voice_consent_result` false; accepts it and goes on |
| `welcome_no` | says no | `consent_result` given false; accepts it and says nothing will be sent; never asks about the voice |

Run them after every prompt change. Results on 13 Nov 2026 (gpt-6-luna): 5/5.
On 14 Nov, after the voice question was added: the three welcome scenarios pass
(after a prompt fix so each consent is reported exactly once).

## Checks only a real call can do

- [ ] Restart the back end without `FAKE_ELEVENLABS`, answer a practice call on a
      phone page, and check the cloned voice sounds like its owner on the default
      voice model (`eleven_v4_turbo`).
- [ ] Check that `mark_tactic` fires on the phone page (the laptop labels the tactic).
- [ ] Check that a long `scenario_brief` variable is accepted. If not, switch to the
      prompt override route (backend.md, "Fallback").
- [ ] Judge the language model by ear: it should stay in role and sound natural.
      Move up (`gpt-6.1-terra`) only if it drifts or forgets the tools.
- [ ] Before any cloned-voice call to someone other than yourself: that person
      has said yes, and the question about this use has been sent to ElevenLabs
      (their use policy).
