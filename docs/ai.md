# Callback AI agents: architecture and prompts

Written on Friday 13 Nov at about 17:15, to go with [backend.md](backend.md) and [idea.md](idea.md). The prompts, the readiness scale and the scenario texts here are version 1: a working start for the data scientist, who owns them.

## Two layers

| Agent | Layer | Runs on | Job | When |
|---|---|---|---|---|
| **Welcome** | Voice | ElevenLabs | Consent, then the five-question survey | Once per member |
| **Practice** | Voice | ElevenLabs | Plays the scam caller, labels its own tactics, reveals | Each practice |
| **Family line** | Voice | ElevenLabs | Answers the family number, confirms it was a practice | After a practice |
| **Profiler** | Model job | Our back end | Welcome transcript to a readiness profile | After the welcome call |
| **Planner** | Model job | Our back end | Profiles and results to each person's plan | After the welcome call and each practice |
| **Director** | Model job | Our back end | Scenario plus person to the brief for one call | When a practice is created |
| **Scorer** | Model job | Our back end | Practice transcript to outcome check, lesson, debrief | After each practice |
| **Digest** | Model job | Our back end | This week's scam warnings to tactics and one note per person | Weekly run |
| **Risk** | Model job | Our back end | The caller's words so far to warning signals; code sets the laptop's traffic light | During each practice, after each caller line |

The voice agents talk in real time and are configured on ElevenLabs. The model jobs are single calls from our back end, each with one task, a typed input and a typed output. None of them is a loop that runs on its own; the order they run in is fixed in `services/pipeline.py`.

```
 welcome call ──► Profiler ──► readiness "before" ──► Planner ──► plan per person
                                                         │
                      ┌──────────────────────────────────┘
                      ▼
 plan step ──► Director ──► brief (variables) ──► Practice agent ──► events
                                                                        │
 readiness "now" ◄── rules in code ◄── outcome ◄── Scorer ◄─────────────┘
        │
        └──► Planner ──► next step
```

## Design rules

- **A fixed frame and a per-call brief.** Each voice agent has one prompt that never changes between calls: its role, its limits, how to use its tools, how to reveal. Everything personal arrives as variables. The same frame runs every scenario.
- **One job per agent.** The practice agent does not score itself, and the scorer does not plan.
- **Typed outputs.** Every model job returns a Pydantic object through the provider's structured outputs. Code checks it before anything uses it.
- **Numbers from code.** Outcome, seconds and readiness scores come from fixed rules. Models choose within limits the code sets, and write the words.
- **A fallback for every job.** If a job fails, is refused or is too slow, the back end uses a fixed template or a fixed sentence. A call is never held up.
- **No agent knows the safe word.** We never collect it, so it is in no prompt and no variable. When someone asks the practice agent for it, the agent truly cannot answer.

## The voice agents

### Settings

| Setting | Welcome | Practice | Family line |
|---|---|---|---|
| Voice | A warm library voice | Any library voice as the default; replaced on each call | A calm library voice |
| First message | "Hi {{member_name}}, this is Callback. {{organiser_name}} set this up for your family. Have you got two minutes?" | `{{opening_line}}` | "Family line. Hi {{caller_name}}, you did the right thing by calling." |
| Longest call (`conversation.max_duration_seconds`) | 360 | 180 | 90 |
| Authentication | On | On | On |
| Overrides switched on | None | Voice ID; also system prompt and first message, as the fallback route | None |
| Client tools | `consent_result` | `mark_tactic`, `practice_result` | None |
| System tools | `end_call` | `end_call` | `end_call` |
| Variable placeholders | Set one for every variable | Set one for every variable | Set one for every variable |

- **Placeholders matter.** ElevenLabs' docs say to set a default for every custom variable, or the dashboard preview and tests have nothing to fill in ([dynamic variables](https://elevenlabs.io/docs/eleven-agents/customization/personalization/dynamic-variables.md)).
- **The agents' language model** is picked in ElevenLabs' settings. Start with a small, fast one and move up only if it drifts out of role or forgets to call the tools ([model list](https://elevenlabs.io/docs/eleven-agents/customization/llm.md)). Slow answers break the feeling of a phone call, so judge by ear. Which models to try, and how to run them on our own OpenAI key, is under "Models and providers" below.
- **The voice model.** New agents default to `eleven_v4_turbo`, which turns on expressive mode: the agent can add tags such as `[sighs]` to its lines ([expressive mode](https://elevenlabs.io/docs/eleven-agents/customization/voice/expressive-mode.md)). Check that a cloned voice still sounds like the person on it.

### Tools

Client tools run in the phone page, which forwards each call to the back end. All three have "wait for response" off. Names are case-sensitive.

```json
[
  { "type": "client", "name": "mark_tactic", "expects_response": false,
    "description": "Call this in the same turn in which you start using a pressure tactic, once per tactic, so the practice screen can label it.",
    "parameters": { "type": "object", "required": ["key"], "properties": {
      "key": { "type": "string", "description": "Exactly one of: new_number, urgency, secrecy, authority, emotional_appeal, small_ask_first, isolation, unusual_payment" } } } },

  { "type": "client", "name": "practice_result", "expects_response": false,
    "description": "Call this once, at the moment the practice is decided and before you speak the reveal.",
    "parameters": { "type": "object", "required": ["outcome"], "properties": {
      "outcome": { "type": "string", "description": "Exactly one of: asked_safe_word, hung_up, asked_personal_question, hesitated, agreed" } } } },

  { "type": "client", "name": "consent_result", "expects_response": false,
    "description": "Call this once, right after the person answers the question about receiving practice calls.",
    "parameters": { "type": "object", "required": ["given"], "properties": {
      "given": { "type": "boolean", "description": "true only for a clear yes" } } } }
]
```

### Variables

| Agent | Variable | Filled from |
|---|---|---|
| Welcome | `member_name`, `organiser_name`, `family_name` | The family record |
| Practice | `target_name` | The person being called |
| | `caller_claim`, `address_as`, `opening_line`, `scenario_brief`, `ask`, `tactic_order` | The director job, or the scenario's template |
| | `difficulty` | The plan step, 1 to 3 |
| | `reveal_line` | Fixed wording, built in code |
| Family line | `caller_name`, `relative_name`, `what_happened` | The practice call and its result |

`reveal_line` is never written by a model. With a clone: "Sara, this was a Callback practice call. The voice you heard was artificial, made with Jon's permission." With a library voice: "Sara, this was a Callback practice call. The voice you heard was artificial."

### The practice agent's prompt

The section headings follow ElevenLabs' prompting guide ([guide](https://elevenlabs.io/docs/eleven-agents/best-practices/prompting-guide.md)).

```text
# Personality
You are a rehearsal partner in Callback, a service that helps families practise
spotting phone scams. {{target_name}} signed up for practice calls and agreed to
receive them without knowing when. In this call you play a scam caller, so that
{{target_name}} can rehearse one habit: stop, and check through a channel they
trust. You are on their side throughout. The call always ends with you saying it
was a practice.

# The role for this call
- You claim to be: {{caller_claim}}
- You address them as: {{address_as}}
- The story: {{scenario_brief}}
- What you ask for: {{ask}}
- Pressure to use, in this order: {{tactic_order}}
- Difficulty: {{difficulty}} (1 gentle, 2 persistent, 3 very persistent)

# Tone
Sound like a real phone call. One or two short sentences per turn, plain words,
small hesitations. Never read a list aloud. Stay inside the story you were
given; do not add new emergencies or details that make it more frightening.

# Goal
Walk through these stages, one per turn where you can:
1. Hook: after your first line, check they can hear you.
2. Story: say what happened, in one or two sentences.
3. Urgency: say why it has to be today.
4. The ask: ask for what is listed above.
5. Pressure: each time they hesitate, use the next tactic on your list.
6. Reveal: as described below.

The practice is decided as soon as one of these happens:
- They ask for the family word, a password or a secret question. You do not
  know it, and you must not guess or make one up. At difficulty 1, stop at once.
  At difficulty 2 or 3, brush it off once ("there's no time for that"); if they
  ask again, stop. Outcome: asked_safe_word.
- They say they will hang up and call back on the usual number, or check with
  someone else first. Same rule as above. Outcome: hung_up.
- They ask something only the real person would know (a shared memory, a pet's
  name, a family detail that is not in your role), or ask whether this is a
  practice or a recording. You do not know the answer; stop. Outcome:
  asked_personal_question. Asking who is calling, or about the story you were
  given, is not a check: answer it in role from your claim and story, and go on.
- They agree: they say they will pay, ask where to send it, or start to read
  out a number or a code. Interrupt straight away ("Stop, please don't read that
  out") and stop. Outcome: agreed.
- You have used all your tactics and they are still unsure, or about two
  minutes have passed. Outcome: hesitated.

# The reveal
When the practice is decided, call practice_result, then drop the role
completely and speak calmly and warmly:
1. Say exactly: "{{reveal_line}}"
2. In one sentence, say what they did.
3. In one sentence, give the habit: hang up, then call the family number or ask
   for the family word.
4. Say goodbye and call end_call.
Never blame them, and never comment on whether the voice fooled them.

# Tools
- mark_tactic: call it in the same turn in which you start using a tactic.
- practice_result: call it exactly once, when the practice is decided, before the
  reveal. Never call it again in the same call.
- end_call: call it after the reveal and the goodbye.

# Guardrails
- If they sound distressed or confused, or say stop, reveal at once.
- If they sincerely ask whether this is real, reveal at once.
- Never ask for, accept or repeat a real card number, account number, password
  or code. If they begin to give one, interrupt and reveal.
- Never name a real bank, police force, hospital or company. Say "your bank" or
  "the police".
- Never mention an injury, an accident, an arrest, a kidnapping or a death.
- No threats and no insults.
- If a child answers, or the person says they are driving, reveal and end.
```

First message: `{{opening_line}}`

### The welcome agent's prompt

```text
# Personality
You are the welcome voice of Callback, a service that helps families practise
spotting phone scams. You are friendly, unhurried and clear. You are talking to
{{member_name}}; {{organiser_name}} added them to the {{family_name}} family.

# Goal
1. Explain, in three short sentences: scammers can now copy a relative's voice;
   Callback gives the family short practice calls so everyone learns to stop
   and check; every practice call ends by saying it was a practice.
2. Ask for consent: "Are you happy to get a practice call now and then, without
   knowing when?" Then call consent_result with their answer. If the answer is
   not a clear yes, thank them, say nothing will be sent to them, and end the
   call.
3. Ask the five questions below, one at a time. Let them talk. Ask one short
   follow-up if an answer is a single word. Do not give advice and do not
   correct them; this is to learn how they think.
   a. "Has anyone ever phoned or messaged you pretending to be family, your
      bank or the police? What happened?"
   b. "If {{organiser_name}} rang from a new number, said they'd lost their
      phone and needed money today, what would you do first?"
   c. "Does your family have a secret word or question for checking it's really
      them? Don't tell me what it is; just say whether you have one."
   d. "Who would you ring if something felt wrong?"
   e. "How do you usually send money, and has anyone ever asked you to do it in
      an unusual way?"
4. Close: thank them, and say the one habit: if a call asks for money or a
   code, hang up and call the family number, or ask for the family word. Then
   call end_call.

# Tone
Short sentences, warm, never in a hurry. One question per turn.

# Tools
- consent_result: once, right after the consent answer.
- end_call: at the end, or straight after a refusal.

# Guardrails
- Never ask what the family word is. If they start to say it, stop them kindly.
- Never ask for bank details, card numbers, passwords or codes.
- If they want to stop at any point, thank them and end the call.
```

Question c differs from idea.md on purpose: it tells the person not to say the word, so that the word stays out of the transcript.

### The family line agent's prompt

```text
# Personality
You answer the family number for the {{family_name}} family in Callback. You are
calm and brief.

# Goal
{{caller_name}} has just had a practice call and has now called the family
number, which is exactly the right thing to do.
1. Confirm: the call they just had was a Callback practice, not a real request.
2. Tell them what they did: {{what_happened}}
3. Tell them {{relative_name}} has been told that they called.
4. Ask if they have a question, answer it in one or two sentences, say goodbye
   and call end_call.

# Guardrails
- Never ask for or mention the family word.
- Do not give financial or legal advice. If they describe a real suspicious
  call, tell them to hang up on it and ring their relative or their bank on a
  number they already know.
```

Later, in the product, this is the agent that connects the caller to the real relative.

## The model jobs

### One function

All jobs go through `agents/llm.py`, so the providers and the models are set in one place. Two providers are available: Claude and OpenAI. Each job has a first-choice model and a second choice at the other provider, so one provider failing, refusing or running slow does not stop the job.

```python
import asyncio
import anthropic
from openai import AsyncOpenAI
from pydantic import BaseModel

claude = anthropic.AsyncAnthropic()        # reads ANTHROPIC_API_KEY
oai = AsyncOpenAI()                        # reads OPENAI_API_KEY

async def _call(model: str, system: str, user: str,
                schema: type[BaseModel], max_tokens: int):
    if model.startswith("gpt-"):
        response = await oai.responses.parse(
            model=model,
            input=[{"role": "system", "content": system},
                   {"role": "user", "content": user}],
            text_format=schema,
        )
        return response.output_parsed      # check for None: the model may refuse
    response = await claude.messages.parse(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
        output_format=schema,
    )
    if response.stop_reason == "refusal":
        return None
    return response.parsed_output          # a validated instance of `schema`

async def run_job(job: str, *, system: str, user: str,
                  schema: type[BaseModel], max_tokens: int = 8000):
    for model in JOB_MODELS[job]:          # first choice, then the other provider
        try:
            result = await asyncio.wait_for(
                _call(model, system, user, schema, max_tokens), JOB_SECONDS[job])
            if result is not None:
                return result
        except Exception:
            continue
    return None                            # the caller uses its fallback in code
```

Both calls follow the providers' own examples: `messages.parse` with `output_format` for Claude, and `responses.parse` with `text_format` for OpenAI ([structured outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs.md)). `run_job` also writes a `model_runs` row for each attempt, with the model and the prompt version.

| Job | First choice | Second choice | Time limit each | Fallback in code |
|---|---|---|---|---|
| Profiler | `gpt-6-astra` | `claude-opus-5-5` | 30 s | All items 0, consent from the `consent` event only |
| Planner | `gpt-6-astra` | `claude-opus-5-5` | 30 s | The rule's choice with a fixed sentence as the reason |
| Digest | `gpt-6-astra` | `claude-opus-5-5` | 60 s | Last week's digest |
| Director | `claude-haiku-5-5` | `gpt-6-luna` | 4 s | The scenario's template with names filled in |
| Scorer | `claude-haiku-5-5` | `gpt-6-luna` | 8 s | The rule's outcome with a fixed lesson per outcome |
| Risk | `claude-haiku-5-5` | `gpt-6-luna` | 3 s (5 s for both) | Keywords and phrases in code |

- The three careful jobs are not timed by anyone waiting, and they read the most text, so they go to the flagship model on the account with the most credit.
- The two fast jobs sit where someone is waiting: the director before the phone rings, the scorer before the debrief appears. Time both providers on the first evening and put the faster one first.
- The risk check is faster still: it runs while the call goes on, so a slow answer is a stale light. It has the shortest limit and low effort on Claude, like the other fast jobs.
- The model names are in `config.py`, one line per job, so swapping is a one-line change.

### Prompt conventions

- One file per job and version: `agents/prompts/scorer.v1.md`. The file is the system prompt. A change is a new version, and the version is recorded with each run.
- The system prompt says what the product is, what this job is for, defines every label it uses, and says what to do when something is missing.
- Inputs go in the user message, inside named tags such as `<transcript>`. No dates or ids in the system prompt.
- The output is the schema. The prompt does not describe JSON.

### Output shapes

```python
Tactic = Literal["new_number", "urgency", "secrecy", "authority",
                 "emotional_appeal", "small_ask_first", "isolation", "unusual_payment"]
Outcome = Literal["asked_safe_word", "hung_up", "asked_personal_question", "hesitated", "agreed"]
Scenario = Literal["relative_new_number", "police", "bank_security", "hospital"]

class ReadinessItem(BaseModel):
    key: Literal["verify_first", "safe_word", "trusted_contact", "payment_caution", "under_pressure"]
    score: int                  # 0, 1 or 2; clamped in code
    evidence: str               # a short quote

class Profile(BaseModel):       # Profiler
    consent_practice: bool
    consent_quote: str
    items: list[ReadinessItem]
    trusts_most: Literal["family", "bank", "police", "hospital", "unknown"]
    said: str                   # one quote for the family page
    weak_spot: str              # one sentence

class PlanStep(BaseModel):
    when: str                   # "today", "in three days"
    scenario: Scenario
    difficulty: int
    voice_of: str | None        # a member's name, or None for a library voice
    why: str

class MemberPlan(BaseModel):    # Planner returns list[MemberPlan] and family_tasks
    member_id: str
    weak_spot: str
    this_week: str
    steps: list[PlanStep]

class FamilyPlan(BaseModel):
    members: list[MemberPlan]
    family_tasks: list[str]

class Brief(BaseModel):         # Director
    caller_claim: str
    address_as: str
    opening_line: str
    scenario_brief: str
    ask: str
    tactic_order: list[Tactic]

class Score(BaseModel):         # Scorer
    outcome: Outcome
    tactics_used: list[Tactic]
    tactics_worked: list[Tactic]
    lesson: str
    debrief: str

class Pattern(BaseModel):
    title: str
    summary: str
    tactics: list[Tactic]
    closest_scenario: Scenario
    source_url: str

class Digest(BaseModel):        # Digest
    patterns: list[Pattern]

RiskSignal = Literal[Tactic, "money_request", "asks_for_code", "refuses_callback"]

class RiskCheck(BaseModel):     # Risk; code turns the signals into the level
    signals: list[RiskSignal]
    reason: str                 # a few plain words for the laptop screen
```

### The job prompts

**Profiler**

```text
You read the transcript of a welcome call from Callback, a service that helps
families practise spotting phone scams. The person was asked whether they agree
to receive practice calls, and then five questions about scam calls. Fill in
their readiness profile from what they said.

Use only what the person said. If something was not answered, score it 0 and
write "not answered" as the evidence.

consent_practice is true only for a clear yes to receiving practice calls.
"Maybe", silence or a change of subject is false.

Score each item 0, 1 or 2:
- verify_first: 0 would act on the call; 1 would hesitate or question the
  caller; 2 would hang up and call back, or ask for a family word.
- safe_word: 0 the family has none; 1 has one but is unsure of it; 2 has one
  and would use it.
- trusted_contact: 0 names nobody; 1 names someone vaguely; 2 names a person
  they would ring.
- payment_caution: 0 would pay by whatever route is asked; 1 unsure; 2 refuses
  unusual routes or never pays on a call.
- under_pressure: 0 says they act fast when rushed, or was caught before;
  1 mixed; 2 says they slow down when rushed.

evidence is a quote of at most 15 words, in their words.
trusts_most is the kind of caller they would be most inclined to believe.
said is one quote of at most 20 words that shows how they think about such calls.
weak_spot is one plain, kind sentence for their family, with no blame.

If they say a family word or password aloud, never copy it. Write
"[family word]" in its place.
```

**Planner**

```text
You write the practice plan for one family in Callback, a service that helps
families practise spotting phone scams through short rehearsal calls that
always end by saying they were a practice.

You receive each member's readiness profile, their past practice results, and
for each member the choices the system allows: which scenarios, whose voice may
be used, and the highest difficulty. Choose only from those.

For each member:
- weak_spot: the one thing most worth practising, in a plain sentence.
- steps: one to three practices. Start with the story they would most likely
  believe, judging by their answers. If a tactic worked on them before, bring
  it back in a different story. After two safe results in a row, raise the
  difficulty by one.
- why: one sentence that ties the step to something they said or did.
- this_week: one small action they can do without a phone call, such as saving
  the family number.

family_tasks: two or three things the whole family does together, such as
agreeing the family word in person.

Write for the family, kindly and plainly. Never rank people, and never say
anyone failed.
```

**Director**

```text
You prepare one rehearsal call for Callback, a service that helps families
practise spotting phone scams. The person being called has agreed to receive
practice calls, the owner of any cloned voice has agreed to that use, and every
call ends by telling the person it was a practice. You write the brief that the
voice agent will follow.

You receive the scenario template, the person being called (name, place in the
family, weak spot, what they said, tactics that worked on them before), who the
caller claims to be, the difficulty, and the tactics this scenario allows.

Write:
- caller_claim: who the caller says they are, as the agent should think of it.
- address_as: what this caller would naturally call this person.
- opening_line: the first thing said, at most 20 words, as spoken on a phone.
- scenario_brief: at most 60 words, addressed to the agent as "you". An
  everyday, believable story that fits this family.
- ask: one sentence. A modest amount, under 1,000 euros, or a small favour.
- tactic_order: up to three of the allowed tactics. Lead with one that worked
  on this person before, or the one closest to their weak spot.

Never include: the name of a real bank, police force, hospital or company; any
account number, card number, code or link; an injury, accident, arrest,
kidnapping or death; any family word or password.
```

**Scorer**

```text
You review one practice call from Callback, a service that helps families
practise spotting phone scams. The caller was a rehearsal agent playing a scam
caller; the person had agreed to practice calls. Say what the person did, and
write a short, kind lesson.

outcome is exactly one of:
- asked_safe_word: they asked for the family word, a password or a secret question.
- hung_up: they ended the call, or said they would hang up and call back.
- asked_personal_question: they tested the caller another way, or asked if it
  was a practice.
- hesitated: they neither went along with it nor challenged it.
- agreed: they said they would pay or help, asked where to send it, or began
  to give a number or a code.
If more than one applies, choose the safest thing they did before any reveal.

tactics_used: the tactics the caller actually used.
tactics_worked: the ones after which the person moved towards going along with
it, for example by apologising, asking how to pay, or agreeing.

lesson: one sentence of at most 20 words, addressed to them as "you", naming
the habit: hang up, then call the family number or ask for the family word.
debrief: three sentences. What the caller did; what you did; what to do next time.

Never say whether the voice fooled them, and never blame them.
```

**Digest**

```text
You read public warnings about scams and pick out what matters for phone calls
this week, for Callback, a service that helps families practise spotting phone
scams.

Return up to three current patterns that reach people by phone call or voice
message. Ignore anything else. For each: a short title, a one-sentence summary
in your own words, the tactics it uses from the fixed list, the closest of our
scenarios, and the address of the page it came from.

Do not copy sentences from the pages. Do not name real banks or companies in
the summary; say "a bank" or "a delivery firm".
```

The weekly note for each person is a sixth small job with the same pattern: one digest pattern plus the person's weak spot in, a message of at most 40 words out.

**Risk** (`agents/prompts/risk.v1.md`)

```text
You watch a practice call from Callback, a service that helps families practise
spotting phone scams. A rehearsal agent plays a scam caller; the person agreed
to receive practice calls, and every call ends by saying it was a practice.
While the call goes on, a screen shows how risky the call has become. You read
what has been said so far and name the warning signs in the caller's words.

Judge only what the caller says: never how they sound, and never who they claim
to be. Read the person's lines only to understand the caller's. List every sign
the caller has shown at any point so far, not only in the last line.

signals, from this list only:
- new_number: says they have a new or borrowed phone, or that their usual
  number does not work.
- urgency: says it has to happen today, now, or before something happens.
- secrecy: asks them to keep it quiet, or not to tell a particular person.
- authority: claims to be the police, a bank's security or fraud team, or
  another official.
- emotional_appeal: plays on feelings: distress, fear, guilt or love.
- small_ask_first: asks for something small or harmless first, such as a quick
  check that it is them.
- isolation: tells them not to call, check with or talk to anyone else, such
  as their bank or their family.
- unusual_payment: asks for an unusual way to pay: gift cards, vouchers,
  crypto, cash collected by a courier, or someone else's account.
- money_request: asks for money or a payment, or says they need money they
  cannot get themselves.
- asks_for_code: asks for a code, a PIN, a password, or card or account details.
- refuses_callback: discourages hanging up or calling back, or brushes off the
  family word or a question that would check who they are.

If the caller has said nothing worrying yet, return no signals. A line in which
the caller says the call was a practice adds no signal.

reason: at most eight plain words for the screen, naming the strongest sign so
far, such as "Asks for money and to keep it quiet". With no signals, write
"Nothing worrying yet".
```

### The live risk check

"Judge what the caller says, not how they sound." During a practice call the laptop shows a traffic light (green, yellow, red) that turns red as the scam builds. It is a real, independent classifier: the model reads only the turn texts, never the practice agent's `mark_tactic` events, so how often it agrees with those marks is a fair measure.

| | |
|---|---|
| Code | `agents/risk.py` (the job and its fallback), `services/live_risk.py` (when it runs; the `risk` event), prompt `agents/prompts/risk.v1.md` |
| When | After each events batch for a practice call that holds a caller line (`speaker: "agent"`), in the background, so `POST /events` never waits. One check per call at a time; lines that arrive meanwhile get one more check, on the latest transcript, when it finishes. Checks stop at the call's first `outcome` event, after which the agent reveals. Welcome and family-line calls are never checked. |
| Input | The turns so far, up to the first `outcome`, as `Caller:` and `Person:` lines inside `<transcript>`. No tactic events, names or scenario. |
| Output | `RiskCheck`: `signals` from the fixed list below, and `reason`, at most eight plain words for the screen. |
| Time limit | 3 s per model, 5 s for both together; then the fallback. |
| Fallback | Keywords and phrases in code, over the caller's lines only: a new or borrowed phone; today, right now, no time; don't tell, keep it quiet; police, a bank's security or fraud team; distress, "I need your help"; "I just need to confirm it's you"; don't call or contact anyone; gift cards, crypto, a courier, a friend's account; "could you send", "I need to pay"; a code, PIN, password or card details; don't hang up, don't call me back, "no time for that". The reason is then built from fixed phrases, such as "Caller asks for money and wants it kept secret", and `source` is `fallback`. It is used when no model key is set (so FAKE mode and the tests have a working light), on a timeout and on a refusal. |
| Result | A stored and streamed `risk` event: `level`, `signals`, `labels`, `reason`, `turn_index`, `source` (backend.md, "Reading a call", has the exact payload). `GET /api/calls/{id}` replays them as `risk`. |

| Signal | The caller… | Level |
|---|---|---|
| `new_number` | says they have a new or borrowed phone | yellow |
| `urgency` | says it has to happen today or now | yellow |
| `authority` | claims to be the police, a bank's security team or an official | yellow |
| `emotional_appeal` | plays on distress, fear, guilt or love | yellow |
| `small_ask_first` | asks for something small first, such as a quick check that it is them | yellow |
| `secrecy` | asks them to keep it quiet | red |
| `isolation` | tells them not to call or check with anyone | red |
| `unusual_payment` | asks for gift cards, crypto, a courier or someone else's account | red |
| `money_request` | asks for money or a payment | red |
| `asks_for_code` | asks for a code, PIN, password or card details | red |
| `refuses_callback` | discourages hanging up or calling back, or brushes off the family word | red |

- **Numbers from code.** The level is a rule over the signals: none is green, only yellow ones is yellow, any red one is red. The model never picks a colour.
- **Nothing is taken back within a call.** Each check's signals are added to the last stored check's (first seen first), and the level never goes below the last one. The model's reason is kept only when its own signals reach the level shown; otherwise the earlier reason stays, so the words always explain the colour.
- **Settings.** `RISK_MODELS` (first choice, then the other provider) and `RISK_CHECK_ENABLED` (on by default; the test suite turns it off, because background `risk` events would interleave with the events other tests compare).

## How one person's answers shape their calls

This chain is what the family page and the pitch should make visible.

| Step | Example |
|---|---|
| What Sara said in the welcome call | "If the bank rings, I do what they say." |
| Profiler | `trusts_most: bank`, `verify_first: 0`, quote kept as `said` |
| Rule | First scenario allowed for her: `bank_security`, difficulty 1 |
| Planner | Step 1: bank security call today, "because you said you would do what the bank says" |
| Director | Leads with `authority`, then `small_ask_first` |
| Practice agent | Uses those tactics; the laptop labels each one as it is spoken |
| Rule | Outcome `agreed`; `under_pressure` falls to 0 |
| Scorer | Lesson: "When a caller asks for a code, hang up and ring the family number." |
| Planner | Next step: the same tactic in a different story, in two days |

## The readiness scale, and how practice moves it

Five items, each 0 to 2, so a person scores out of 10. The welcome call sets "before". After that, only practice results move the scores, because what people do counts for more than what they say they would do.

| Result | `verify_first` | `under_pressure` | Also |
|---|---|---|---|
| `asked_safe_word` | 2 | 2 if within 30 seconds, otherwise 1 | `safe_word` becomes 2 |
| `hung_up` | 2 | 2 if within 30 seconds, otherwise 1 | |
| `asked_personal_question` | 1, or 2 if it already was | 1 | |
| `hesitated` | 1 | 1 | |
| `agreed` | 0 | 0 | `payment_caution` becomes 0 |
| Tapped the family number within a minute | | | `trusted_contact` becomes 2 |

**Choosing what the planner may pick**
- First practice: the scenario matching `trusts_most` (bank, police, hospital), or the relative story for `family` and `unknown`.
- After `agreed` or `hesitated`: the same leading tactic, a different scenario, the same difficulty.
- After a safe result: a scenario they have not had. After two safe results in a row, difficulty plus one, up to 3.
- A relative's voice only if that relative has a ready clone and has consented.

## Scenario files

One JSON file per scenario in `app/scenarios/`. Adding a scenario is adding a file.

```json
{
  "key": "relative_new_number",
  "title": "Relative with a new number",
  "voice": "clone",
  "caller_label": "Unknown number",
  "allowed_tactics": ["new_number", "urgency", "secrecy", "emotional_appeal", "small_ask_first"],
  "template": {
    "caller_claim": "{target_relation_to_caller}'s {caller_relationship}, {caller_name}",
    "opening_line": "{address_as}? It's me. I dropped my phone, so this is a new number.",
    "scenario_brief": "You broke your phone this morning and are using a borrowed one. You need to pay for something today and cannot get into your banking app.",
    "ask": "a transfer of a few hundred euros today, to a friend's account",
    "tactic_order": ["new_number", "urgency", "secrecy"]
  }
}
```

- `voice` is `clone` or the name of an environment variable holding a library voice id, such as `ELEVENLABS_POLICE_VOICE_ID`.
- The template alone must make a complete call. The director only improves on it.
- **The hospital scenario needs rewording.** As written in idea.md it says a relative has had an accident, which breaks the rule against emergencies. Either make it an unpaid fee for an appointment, or leave it out. The weekend needs only the relative and the police stories.

## Models and providers

- **OpenAI API** (Denis has a large API balance there). Current models, from OpenAI's own list ([models](https://developers.openai.com/api/docs/models.md)): `gpt-6-astra` is the flagship, `gpt-6.1-sol` balances quality and cost, `gpt-6.1-terra` is fast and aimed at natural writing, and `gpt-6-luna` is the cheapest and built for volume. It is first choice for the three careful jobs and second choice for the two fast ones.
- **Claude API** is first choice for the two fast jobs and second choice for the careful ones.
- **The voice agents' own language model** is chosen in ElevenLabs' settings, in one of two ways:
  - *From their list,* which includes the GPT-6 and Claude models. ElevenLabs then bills the model use itself, at the provider's rate.
  - *With our own OpenAI key,* so the in-call model use comes out of the OpenAI balance and not the ElevenLabs one. In the agent's model menu pick "Custom LLM", enter OpenAI's server address and a model id, and store the key as a secret named `OPENAI_API_KEY` ([docs](https://elevenlabs.io/docs/eleven-agents/customization/llm/custom-llm.md)). Check that `mark_tactic` still fires on this route before relying on it.
  - Either way, choose the in-call model by how quickly it answers. A flagship model that pauses for two seconds sounds less like a phone call than a small one that answers at once. Try `gpt-6-luna` and `gpt-6.1-terra` first, then `gpt-6.1-sol`; use `gpt-6-astra` in a call only if it still sounds natural.
- **Two worthwhile uses for spare credit,** both for Saturday and both optional:
  - *Simulated callers.* A model plays thirty different people (trusting, rushed, suspicious) in text against the practice prompt. That tests the prompt and the scorer before any person is called, and gives the pitch a number.
  - *A second opinion on scoring.* Run the scorer on both providers over the test transcripts and report how often they agree.
- **Condense** is a proxy that shortens long conversations before they reach the model, and charges on what it removes. Its own notes say chains under about 4,000 tokens are not worth compressing ([condense.chat](https://condense.chat/llms.txt)), and every job here is shorter than that. So:
  - Run the team's coding agents through it (`dense claude`, `dense codex`). That is where the leaderboard tokens are.
  - In the product, the only long input is the weekly digest, which reads scraped pages. To route that one job through Condense, point its client at Condense's address for the provider (`https://api.condense.chat/openai/v1` or `https://api.condense.chat/anthropic`) and send the Condense key in the `X-Condense-Auth-Token` header, alongside the provider's own key. Optional, and only after everything else works.

## Checking quality

- **Scorer:** ten written transcripts with known outcomes; report how many it labels correctly. Keep them in `tests/fixtures/`.
- **Director:** twenty generated briefs through the code checks; none may contain a digit run or a listed institution.
- **Practice agent:** role-play each of the five endings by voice and confirm that it calls `practice_result` with the right value, reveals, and hangs up. `backend/voice_agents/agent_tests.py` runs this as ElevenLabs simulation tests for the safe-word, hang-up and agree endings and for the welcome yes and no (5/5 on 13 Nov 2026); the other endings still need a voice check.
- **Profiler:** three recorded welcome calls scored by hand by two of us, compared with the job.
- **Risk check:** `scripts/eval_risk.py` replays the ten written practice calls line by line, as in a live call, up to the reveal. It reports precision and recall per tactic (the signals found by the end against the tactics the agent marked), how often the three non-tactic signals fired, the light at the reveal, the fallback count and the latency per check. `--fallback` runs the keywords alone, with no API calls. The marks are what the agent chose to label, not a full answer key. The fallback's keywords were written with these ten calls in view, so its score on them (precision 0.92, recall 1.00) flatters it; the model's run is the honest number.
