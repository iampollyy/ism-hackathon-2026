# Callback: family practice against voice-clone scams

Plan for Unfair Weekend 2026 (deadline Saturday 14 Nov, 20:00). "Callback" is a working name, after the habit the product teaches. Research notes were gathered on 13 Nov and are linked but not checked by hand.

## Scope for the weekend

**Priority:** a great demo, a clear concept and a working product. Three rules hold throughout: only clone and call people who said yes; every call ends by revealing itself; cloned voices stay inside the family.

**The form to build:** the practice call in a relative's cloned voice is the one path that must work. The person has agreed beforehand to get practice calls but doesn't know when, so the call feels real. The family help line is its last ten seconds: the parent hangs up, calls the family number, and reaches the real relative. If cloned-voice calls turn out not to be possible, the help line becomes the product.

**Cut from the critical path:**
- Every language except English. Lithuanian is dropped for the weekend.
- Real families and strangers. For the demo the "family" is the three teammates, calling each other.
- Scenarios written live from scam warnings. Hard-code the stories. One weekly digest from live sources comes back in only after the calls work.
- HeyGen, condense, and the habit-over-time chart.
- Cloning a judge on stage. Call a teammate with a clone made beforehand, and keep a recording.

**First check:** a stable two-way agent call on our own mobiles, in any voice. Both forms need that.

**How this differs from voice-memory projects:** it protects a family against cloned voices; it doesn't preserve voices.

## Interface mockup

Three screens (home, family page, live practice call), light mode, sample data: https://claude.ai/artifact/JmWtpLXG7g2NVuNsyqPF3n. It is private until shared from its Share menu.

- **Look:** white cards on a cool grey ground, dark navy text, Space Grotesk headings with Inter body. One orange-red accent for the "ringing" and tactic moments, and green for the safe action.
- **Home:** the headline, a tilted phone showing an incoming practice call with tactic labels around it, how it works in four steps, and three sample people with three different plans.
- **Family page:** family readiness before and now, the family word and family number, a card per person with their weak spot and next practice, one person's plan in detail, and this week's activity.
- **Live practice call:** the call panel, the conversation with each tactic labelled as it is used, the stages of the scam, what the person did, seconds to the first challenge, and the call back to the real relative.
- **Worth animating in the real build:** the rings around the phone pulsing while it rings, tactic labels popping in as they are spoken, and the result card turning green when the family word is asked for.

## In short

- **What it is:** a family plan against voice-clone scams. An agent phones each family member, gets their consent and clones their voice from the call. It then runs short practice calls in a relative's voice, so that everyone learns one habit: hang up and call back, or ask for the family's safe word.
- **Who it's for:** an adult child who signs up their parents. The parents never install anything; everything happens by phone.
- **It is not new.** TrustboxAI sells one-off calls like this in the US and Canada, and Kinword is about to launch. Our difference is below.
- **It is buildable this weekend.** The calls, the cloning and the per-call voice switch are all documented features of ElevenLabs with Twilio.
- **Who pays:** banks first, because they are being made liable for scam losses. See "Impact and who pays" below.

## What already exists, and what is ours

| Product | What it does | Gap |
|---|---|---|
| [TrustboxAI](https://trustboxai.com/) | Clones your voice from 15 seconds, places one call to a relative, reveals, suggests a safe word. $4.90 a call or $46.80 a year. | US and Canada only. One-off. No consent step described for the person called. |
| [Kinword](https://kinword.towers.app/) (pre-launch) | Recorded consent, calls up to four enrolled relatives in the cloned voice, never asks for money, debrief, safe word. | Not launched; no price; languages unknown. |
| [ScamDrill](https://scamdrill.com/) | Opt-in email drills for families, $84 a year. | No calls. |
| [Doppel](https://www.doppel.com/lp/vishing-simulation) and other enterprise vendors | Voice-deepfake drills for companies. | No family version found. |

**Our claim, in four parts**
1. **Europe and its languages,** as the direction after the weekend. The voice platform already speaks many European languages. The demo is in English.
2. **A recurring agent, not a one-off call.** It owns a job: keep one habit alive in this family, with short practices over months and a record of whether the habit holds.
3. **Consented by design.** Everyone agrees beforehand to be cloned and to receive practice calls, and every call ends by revealing itself.
4. **Everything by phone.** Parents are enrolled, consent and practise without an app.

## Impact and who pays

**The problem is large and growing**
- Lithuanian residents lose about €20 million a year to phone scams ([LRT, Feb 2026](https://lrt.lt/en/news-in-english/19/2852348/twenty-million-euros-15-million-calls-lithuanian-authorities-tackle-phone-swindlers); [national cyber report, May 2026](https://www.lrt.lt/en/news-in-english/19/2941159/lithuania-cyber-attacks-fall-overall-but-breaches-in-organisations-nearly-double)). AI-generated voices are already used in them ([OECD incident record, Mar 2026](https://oecd.ai/en/incidents/2026-03-27-e138)).
- In the US, people over 60 reported $7.7 billion in losses in 2025, up 59% in a year ([AARP](https://www.aarp.org/money/scams-fraud/fbi-ftc-report-2025-losses), [HousingWire](https://www.housingwire.com/articles/fbi-seniors-cybercrime-2025/)).

**Who pays, in order**
1. **Banks.** They are being made to carry these losses, so prevention has a budget. A bank pays per enrolled family and gives the product to its customers for free.
   - In February 2026 the Bank of Lithuania proposed that banks compensate customers when they fail to stop a suspicious payment ([LRT](https://lrt.lt/en/news-in-english/19/2852348/twenty-million-euros-15-million-calls-lithuanian-authorities-tackle-phone-swindlers)).
   - The EU's new payment rules add a refund right for bank-impersonation scams. The final text is not confirmed here ([PwC](https://www.pwc.com/cz/cs/blog/rizeni-rizik/psd-3-the-psr-payments-reform.html), [The Register](https://www.theregister.com/2026/03/11/eu_psd2_compensation/)).
   - The UK has required refunds since October 2024.
2. **Security and telecom subscriptions** that bundle it as a family feature.
3. **Families directly.** Comparable plans cost $47 to $84 a year. That market is small; it mostly proves that people want this.

**What the bank gets:** a prevention step it can show to customers and to the regulator, and a count of how many enrolled families practised and kept the habit.

**The category already sells to companies.** Doppel runs deepfake attack simulations for employers and raised $70 million at a valuation above $600 million in November 2025 ([Fortune](https://fortune.com/2025/11/19/exclusive-doppel-raises-70-million-series-c-at-more-than-600-million-valuation-to-fight-ai-powered-social-engineering-attacks)). The family version is still only small players such as TrustboxAI and Kinword.

**What we don't claim:** that practice calls reduce real losses. Nobody has shown that for families. We claim one habit that can be measured, call by call.

**The line for the pitch:** "Banks are being made liable for these losses. This is the practice they give their customers' families."

## The rules we build to

These decide the design. Not legal advice.

- **ElevenLabs' use policy** (updated 9 Oct 2026) forbids using its services "to deceive, manipulate, or impersonate others", and forbids "social engineering". It has no exception for training. Cloning a living person needs their "explicit and informed consent" ([policy](https://elevenlabs.io/use-policy)). A drill on someone who hasn't agreed is therefore out. Our practice calls go only to people who opted in, and each one reveals itself at the end. We are confirming this design with ElevenLabs, and scripts never use real bank names or payment details. If needed, the call can announce itself in its first sentence.
- **EU rules:** deepfake labelling has applied since August 2026, and a cloned voice is likely to count as biometric data needing explicit consent.
- **What the evidence favours:** practice that is forewarned, interactive, about one behaviour, and repeated in short boosters. Large studies of surprise simulated attacks found effects of about two percentage points or none.

**So every call follows these rules:**
1. Consent from both people, spoken and recorded on the first call: the one whose voice is cloned, and the one who will be called.
2. The person has agreed beforehand to get practice calls, without knowing when. Every call ends by saying it was a practice and that the voice was artificial.
3. No emergencies, no kidnappings, and it never takes real payment details.
4. It scores what the person did (asked for the safe word, hung up), never whether their ear was fooled. No public list of who failed.
5. Clones are used only inside that family and deleted on request. Anyone can opt out for good.
6. The demo uses our own voices and consenting attendees only.

## How it works

### The path

1. **Sign up.** An adult child enters the family's names and phone numbers and picks the language.
2. **The welcome call, with a short readiness survey.** The agent phones each person, explains the service, asks for consent, and then asks five questions about scams. The answers do three jobs at once: they are the speech the clone is made from, they give a starting readiness score, and they shape that person's plan. The family agrees a safe word.
3. **The clone.** The person's side of that call becomes a voice clone.
4. **The practice call.** A few days later (minutes later, in the demo) the phone rings from an unknown number: "Mum, it's me. I lost my phone, this is my new number." The agent plays a scammer in that voice and answers whatever the person says: a new number, an urgent request.
5. **The lesson.** If the person asks for the safe word or hangs up, the agent says so and stops. If they go along with it, the agent stops and explains the habit, kindly.
6. **The call back.** The person hangs up and taps the family number. A voice agent answers, and connects them to the real relative on that relative's real number. This is the habit, done once for real.
7. **The family plan.** From the survey and each practice, every member gets a personal plan: their weakest spot, which story comes next, and one thing to do this week. The family gets shared tasks, such as agreeing the safe word and saving the family number.
8. **The family page.** Who has practised, each person's readiness before and after, their plan, and when the next practice is.

### The parts

| Part | Built with | Notes from the docs check |
|---|---|---|
| Outbound calls | ElevenLabs agents with the native Twilio integration | One API call places a call ([docs](https://elevenlabs.io/docs/eleven-agents/api-reference/twilio/outbound-call.md)). Creator includes 275 call minutes. |
| Voice per call | The same call accepts a voice override | So one agent can speak in any family member's cloned voice. The override probably has to be switched on in the agent's security settings first. |
| Cloning | ElevenLabs instant voice cloning | Needs 10 seconds at least; 1 to 2 minutes recommended ([docs](https://elevenlabs.io/docs/product-guides/voices/voice-cloning/instant-voice-cloning)). Quality from phone audio is untested. |
| The person's own audio | Twilio dual-channel recording | Each side of the call is on its own channel. |
| Languages | English only this weekend | Other languages are a later step. |
| The agent's reasoning, scoring and lessons | Claude API | Also writes each practice from current scam warnings. |
| Sign-up and family page | A small web app | Lovable credits can produce the first version quickly. |

**Twilio.** A trial account calls only verified numbers (up to five) in the sign-up country, for 75 minutes. With calls only between the three teammates, that may be enough. Check two things on the first call: that all three numbers can be verified and reached, and whether the trial plays its own message before the agent speaks (from memory it does, which would spoil the demo). If either fails, upgrade to a paid account. Calls to Lithuanian mobiles cost about $0.35 to $0.60 a minute.

### How each hackathon tool is used

Ordered by how much each one lifts the product, the video or the pitch.

| Tool | What to do with it | Lifts | Effort |
|---|---|---|---|
| **ElevenLabs** | The whole product runs on it: three phone agents, voice cloning, tools the agent calls mid-conversation. Say this in the Devpost text, because their hacker guide leads with the agents platform. | Product, and their prize | Core work |
| **ElevenLabs, for the pitch** | Open with two clips of the same sentence, one in a teammate's real voice and one in the clone: "Which one is real?" Let the room vote by hand, then reveal. | The first 20 seconds | 15 minutes |
| **ElevenLabs, for realism** | Give the practice voice urgency and stress if the agent's voice model supports expression controls (check), and generate a ringtone and call sounds for the video. | Demo feel | 30 minutes |
| **Screen Studio** | Record the live call screen with automatic zoom on each tactic label as it appears, next to a screen recording of the phone ringing. Their best-demo prize is judged on the video. | Video, and their prize | Saturday afternoon |
| **Firecrawl** | One real "scam of the week": fetch a current warning from a public consumer-protection source, and show the note and the practice story built from it. It makes the agent visibly do something on its own. | The recurring-agent claim, and the Kilo track | 1 to 2 hours |
| **Lovable** | A public landing page at a real address with a waiting list, built from the home screen of the mockup. Put its QR code on the last slide. Keep the app itself in `frontend/`, since Lovable works in its own repo. | Product feel, public vote | 1 hour |
| **Claude or OpenAI API credits** | Scoring, readiness profiles, plans and lessons. | Product | Core work |
| **Codex and Claude Code credits** | Building. | Speed | Ongoing |
| **HeyGen** | Optional, one clip only: a ten-second "next: video calls" teaser for the end of the video, using a teammate's own consented avatar. Rendering takes about ten minutes per minute of video. | The "where it goes" beat | 30 minutes plus rendering |
| **condense** | Optional: run the team's coding agents through it all weekend. The tokens-saved prize is a leaderboard, so it can be won without touching the product. Drop it at the first sign it slows anyone down. | Their prize | 10 minutes to set up |
| NordVPN | Nothing to build. Mention consumer-security bundles as a route to customers. | Pitch only | None |

## Technical design

Endpoint and field names below come from an agent's reading of the ElevenLabs and Twilio docs on 13 Nov, plus memory. Check each against the docs as you wire it.

### Start here: stack, layout and the contract

**Confirmed on Friday 13 Nov:** the stack below, the contract below, and the owners. Denis owns the back end and both provider accounts (ElevenLabs and Twilio), including their set-up. The front-end colleague owns `frontend/`. The data scientist owns the agents' scripts, the survey, the scoring scale and the plan format.

**Stack**
- Front end: React with Vite, already set up in `frontend/`.
- Back end: Python with FastAPI in `backend/`. The repo's ignore file already covers Python, audio clean-up is easy with ffmpeg, and the prompts and scoring can be written by anyone on the team.
- Database: SQLite to start.
- Live updates to the browser: server-sent events, one stream per call.
- Secrets in `backend/.env`, never committed. Commit a `backend/.env.example` listing the names only: `ELEVENLABS_API_KEY`, the three agent ids, `ELEVENLABS_PHONE_NUMBER_ID`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_NUMBER`, the model provider's key, `PUBLIC_BASE_URL`.

**The contract between front end and back end.** Agree this first; then both sides work in parallel, and the front end builds against fixed sample responses until the back end is ready.

| Call | Purpose | Returns |
|---|---|---|
| `POST /api/families` | Create a family: name, safe word, members (name, phone, relationship) | `family_id` |
| `GET /api/families/{id}` | Everything the family page shows | The family object below |
| `POST /api/members/{id}/welcome-call` | Start the welcome call to that member | `call_id` |
| `POST /api/members/{id}/voice` | Upload a microphone recording to clone from (demo path) | `voice_ready` |
| `POST /api/practice-calls` | Start a practice: `target_member_id`, `voice_member_id` or none, `scenario` | `call_id` |
| `GET /api/calls/{id}` | A finished call: turns, tactics, result, lesson | The call object below |
| `GET /api/calls/{id}/events` | Live stream for the call screen | Events below |

*Member, inside the family object:* `id`, `name`, `relationship`, `consent` (clone, practice), `voice_ready`, `readiness` (`before`, `now`, and `items` each with `label`, `before`, `now`, `max`), `weak_spot`, `said` (their quote from the welcome call), `plan` (`this_week`, and `steps` each with `when`, `scenario`, `why`, `status`).

*Family object:* `id`, `name`, `safe_word_set`, `family_number`, `members`, `readiness` (`before`, `now`), `week` (recent and planned activity).

*Call object:* `id`, `kind`, `target`, `voice_of`, `scenario`, `status`, `turns` (`speaker`, `text`, `t`, optional `tactic`), `tactics` (`key`, `label`, `t`), `result` (`outcome`, `seconds_to_challenge`, `lesson`), `callback_seconds`.

*Live events:*
- `call.status`: `ringing`, `in_progress` or `ended`
- `tactic`: `key`, `label`, `t`
- `turn`: `speaker`, `text`, `t` (only if a live transcript turns out to be available)
- `outcome`: `outcome`, `seconds_to_challenge`
- `revealed`
- `callback.connected`: `seconds`

*Fixed lists:* tactic keys are `new_number`, `urgency`, `secrecy`, `authority`, `emotional_appeal`, `small_ask_first`, `isolation`, `unusual_payment`. Outcomes are `asked_safe_word`, `hung_up`, `asked_personal_question`, `hesitated`, `agreed`. Scenarios are `relative_new_number`, `police`, `bank_security`, `hospital`.

The provider webhooks (after-call report, the agent's tool calls, the caller look-up for the family line) are back-end only; the front end never sees them.

**The first three hours, in parallel**
- Back end: the first test in the schedule below (a call in a cloned voice), then `POST /api/practice-calls` and the event stream.
- Front end: the three screens from the mockup against sample data shaped like the objects above, starting with the live call screen.
- Data: the welcome agent's script with the five questions, the practice agent's script for the relative story, and the scoring scale.

### Set-up checklist: Twilio and ElevenLabs

Written so that a person or a coding agent can follow it. Steps marked "check" were not confirmed in the docs. Whoever runs this creates the keys themselves and puts them only in `backend/.env`.

**Twilio**
1. Open the account. Note the Account SID and the Auth Token.
2. Get one phone number that can make and receive voice calls.
3. On a trial account, verify each teammate's mobile number as a caller ID. A trial calls only verified numbers in the sign-up country.
4. Check that calling the teammates' country is switched on in the voice geographic permissions.
5. Place one test call and listen: if the trial plays its own message before the agent speaks, upgrade to a paid account. (Check.)

**ElevenLabs**
1. Redeem the Creator plan through the event's Discord coupon, on the one account that will hold everything.
2. Create an API key.
3. In the Phone Numbers tab, import the Twilio number with the Account SID and Auth Token ([native integration](https://elevenlabs.io/docs/eleven-agents/phone-numbers/twilio-integration/native-integration)). Note the phone number id.
4. Create three agents and note their ids: welcome, practice, family line. Their scripts come from the data scientist.
5. On the practice agent, allow per-call overrides for the voice, the prompt and the first message. This is probably in the agent's security settings ([overrides](https://elevenlabs.io/docs/eleven-agents/customization/personalization/twilio-personalization)). (Check.)
6. Give the practice agent two server tools that call our back end: `mark_tactic` and `practice_result`.
7. Point the after-call webhook at our back end, so transcripts arrive when a call ends.
8. Assign the family-line agent to the number for incoming calls, with the start-of-call look-up pointing at our back end, and find the built-in way to transfer a call to another number. (Check.)
9. Pick the language model for the agents: the fastest one that stays in role.

**A public address for the back end**
- Run a tunnel to the local server and put its HTTPS address in `PUBLIC_BASE_URL`. The webhooks and tools above all point there, so they must be updated if the address changes.

**Then the first test, in this order**
1. From the ElevenLabs dashboard, send a test call from the welcome agent to your own mobile.
2. Place the same call through the API ([outbound call](https://elevenlabs.io/docs/eleven-agents/api-reference/twilio/outbound-call.md)). With the Twilio call id it returns, start a two-channel recording and check that your voice is alone on one channel.
3. Clone your voice from a one-minute microphone recording ([instant cloning](https://elevenlabs.io/docs/product-guides/voices/voice-cloning/instant-voice-cloning)).
4. Place a call from the practice agent to a teammate with that voice id as the override.

**Before any cloned-voice call to someone other than yourself:** that person has said yes, and the question about this use has been sent to ElevenLabs ([use policy](https://elevenlabs.io/use-policy)).

### The pieces

```
  Web app (sign-up, family page, live call screen)
        │  REST + live updates
        ▼
  Our backend ──────────────► Database
   │      ▲                    (families, members, calls, events, results)
   │      │ webhooks: tool calls during a call, and the after-call report
   ▼      │
  ElevenLabs agents ◄──────► Twilio number ◄──────► phones
   (welcome, practice,        (outbound, inbound,
    family line)               two-channel recording)
   │
   ▼
  ElevenLabs voice cloning          Claude API (scoring, lesson)
```

- **Web app:** sign-up (family name, each member's name, phone and relationship, the safe word), the family page, and a live call screen for the demo.
- **Backend:** one small server with a public HTTPS address, because ElevenLabs and Twilio call it back. It starts calls, receives webhooks, makes clones, scores calls and pushes live updates to the web app. Use a tunnel while developing.
- **Database:** five tables.
  - *families:* name, safe word
  - *members:* name, phone, relationship, consent times, voice id, readiness profile, plan
  - *calls:* kind (welcome, practice, family line), who, ElevenLabs conversation id, Twilio call id, status
  - *events:* call, time, kind (tactic, outcome), detail
  - *results:* call, outcome, seconds until the first challenge, tactics used, lesson text
- **Three ElevenLabs agents:**
  - *Welcome:* a friendly stock voice. Explains, asks for consent, then runs the five-question readiness survey so the person talks for a minute or more.
  - *Practice:* the scammer role. Its voice is overridden per call with a member's clone. It can call our tools.
  - *Family line:* answers the family number, looks up who is calling, and transfers them to the real relative.
- **One Twilio number** for outbound and inbound, with recording on.

### The three flows

**1. Welcome call and clone**
1. The backend asks ElevenLabs to place an outbound call from the welcome agent to the member, passing their name as a variable.
2. Using the Twilio call id that comes back, the backend starts a two-channel recording, so the member's voice is on its own channel.
3. When the call ends, ElevenLabs sends the after-call webhook with the transcript. The backend checks the transcript for a clear "yes" to both consents.
4. The backend downloads the recording, keeps only the member's channel, cuts the silence, evens out the loudness, and keeps the longest clean stretches until it has at least 60 seconds.
5. It sends that audio to instant voice cloning and stores the returned voice id on the member.

For the demo, also allow a clone from a good microphone recording uploaded on the sign-up page; it sounds better.

**2. Practice call**
1. The backend picks the target and the voice (another member's clone), and fills the scenario: who the caller claims to be, the story, the ask.
2. It places an outbound call from the practice agent with three per-call overrides: the voice id, the prompt and the first sentence.
3. During the call the agent calls our tool `mark_tactic` each time it uses a pressure tactic, and `practice_result` when the person challenges it, agrees, or the time runs out. The backend pushes each one to the live call screen.
4. The agent reveals the practice and gives the one-line lesson, then ends the call.
5. The after-call webhook delivers the transcript. Claude scores it and writes the short debrief.

**3. Calling back the family line**
1. The member taps the family number. Twilio hands the inbound call to the family-line agent.
2. At the start of the call ElevenLabs asks our backend who this caller is. We answer with their name, their family and the relative whose voice was just used.
3. The agent says it was a practice and transfers the call to that relative's real number.

**4. Readiness survey and family plan**
1. In the welcome call, after consent, the agent asks five open questions. Open questions make people talk, which the clone needs.
   - "Has anyone ever phoned or messaged you pretending to be family, your bank or the police? What happened?"
   - "If your son rang from a new number, said he'd lost his phone and needed money today, what would you do first?"
   - "Does your family have a word or a question only you would know?"
   - "Who would you ring if something felt wrong?"
   - "How do you usually send money, and has anyone ever asked you to do it in an unusual way?"
2. After the call, a model reads the transcript and fills a readiness profile for that member: whether they verify before acting, whether a safe word exists, past exposure, how they pay, and how confident they sound. Each item is scored on a short fixed scale, and the total is the starting readiness.
3. A second model call writes the plan as structured data: for each member, the weakest item, the first practice story and its difficulty, and one action for this week; for the family, two or three shared tasks.
4. After every practice call, the profile and the plan are updated from the result.

**5. The scenario library: not only relatives**

Many phone scams don't imitate family at all. The caller claims to be the police, the bank or a hospital. These need no cloning: the practice agent takes a ready-made voice from the voice library and a role.

| Scenario | Voice | The story | Main tactics |
|---|---|---|---|
| Relative with a new number | A family member's clone | "I lost my phone, I need a transfer today" | New number, urgency, emotional appeal |
| Police officer | Ready-made voice | "Your account is being used by criminals; move your money to a safe account" | Authority, secrecy, urgency |
| Bank security team | Ready-made voice | "We blocked a payment; read me the code we just sent" | Authority, a small ask first |
| Nurse or hospital | Ready-made voice | "Your relative has had an accident; a payment is needed before treatment" | Emotional appeal, urgency, isolation |

- A scenario is data: a role, a voice (a clone or a library voice), the stages and the tactics. Adding one is writing a prompt, not code.
- The plan picks the scenario from the survey. Someone who says they would trust a call from their bank gets the bank story first.
- "Ready-made" means voices offered in the voice library for general use. Never clone a real public person's voice.
- Keep institutions generic ("the police", "your bank's security team"). Don't name a real force, bank or hospital, and don't display a real institution's number.
- For the weekend: the relative scenario must work; add the police one next, since it shows the range in the video.

**6. The weekly loop: what the agent does on its own**

This is what makes it an agent with a job and not a one-off test. Each week, for each family:

1. **Read what is going around.** Collect recent scam warnings from police, banks and news with Firecrawl, and reduce them to a few current tactics.
2. **Decide what each person needs.** Compare those tactics with each member's profile: what worked on them last time, what they haven't practised, what they said in the survey.
3. **Act.** For each member, one of:
   - a short message with this week's scam and the one thing to do about it, written for them
   - a practice call in a scenario picked for them
   - a reminder of the family's shared task (agree the safe word, save the family number)
4. **Record and adjust.** Update the profile and the plan from what happened.

Messages go by SMS through the same Twilio account. A trial account can text only verified numbers, and texting some countries needs extra set-up, so test one text early. If it fails, show the message in the family page and send it by email.

For the weekend: generate one real weekly digest from live sources, send one real message to a teammate, and show the schedule on the family page. Nobody can demo weeks passing, so say plainly that the loop is shown once.

**Which models.** Keep model calls behind one function so the provider can be swapped. The scoring, the profile and the plan can run on OpenAI's API or on Claude; use whichever account has credits. One thing to check: the hackathon's Codex perk is credit for the Codex coding agent, and its card says it is not API credit, so API calls need a separate OpenAI API balance. The language model inside the phone agents is chosen in ElevenLabs' own settings.

### The logic that is ours

- **The welcome call does three jobs at once:** consent, a voice sample, and a readiness survey. One two-minute call replaces a sign-up form, a recording step and a questionnaire.
- **A readiness profile per person,** scored the same way before and after practice, so the family page can show a change.
- **The practice agent never knows the safe word.** It is not in its prompt, so when the person asks for it, the voice truly cannot answer. That is the mechanism, not an act.
- **A scam is a sequence of stages:** hook, story, urgency, the ask, pressure, fallback. The practice prompt walks through them using the family's own names and relationships.
- **A fixed list of tactics:** new number, urgency, secrecy, authority, emotional appeal, a small ask first, isolation ("don't call anyone"), and payment by an unusual route. The on-screen labels and the debrief both use this list.
- **Scoring what the person did:**
  - *Outcome:* asked for the safe word, hung up, asked a personal question, hesitated, or agreed.
  - *Seconds until the first challenge:* the one number that should fall with practice.
  - *Tactics that worked on them,* which choose the next practice.
- **Choosing the next practice:** start with a simple rule (repeat the tactic that worked, in a new story). A proper schedule of spaced boosters is later work.
- **Hard stops:** two minutes at most; no card or account numbers ever requested; if the person sounds distressed or says stop, reveal at once.

### What each person builds

| Person | Builds |
|---|---|
| Engineer | The backend: call starting, webhooks, recording and audio clean-up, cloning, the three agents' wiring, the live updates |
| Front end and design | Sign-up, the family page, the live call screen with tactic labels, the debrief view |
| Data scientist | The scenario stages and the tactic list, the three agents' prompts, the survey and its scoring scale, the plan format, the scoring prompt and its checks, and the small tests below |

### Small tests that make the demo credible

- **Does the clone sound like the person?** Five listeners rate a phone-audio clone and a microphone clone from 1 to 5.
- **Does the scoring get it right?** Ten role-played calls with known outcomes; count how many the scoring labels correctly.
- **Does practice change anything?** Seconds until the first challenge on a first call and on a second call, for the three teammates and anyone else who joins.

### Things to settle on the first day

- Whether per-call voice overrides must be switched on in the practice agent's security settings.
- Which language model the agents use. Pick the fastest one that stays in role; slow answers break the illusion of a phone call.
- How to get live events during a phone call. Tool calls from the agent are the simple route; a live transcript feed may not exist for phone calls.
- How the agent transfers a call to another number. Look for a built-in transfer tool before building one with Twilio.
- Deleting a clone: store the voice id so it can be removed on request.

## Demo

**Video, 3 minutes**

| Time | On screen |
|---|---|
| 0:00–0:20 | A phone rings. "Mum, it's me, I lost my phone." Caption: this voice is artificial. Then the fact: in a 2025 study, listeners took a cloned voice for the real person about 80% of the time ([Scientific Reports](https://www.nature.com/articles/s41598-025-94170-3)). |
| 0:20–0:50 | Sign-up: two phone numbers. The agent phones a teammate, asks for consent and chats. |
| 0:50–1:40 | The practice call. The cloned voice asks for an urgent transfer, while the screen labels each pressure tactic as it is used (new number, urgency, secrecy). The parent asks for the safe word, and the call ends with the reveal and the one-line lesson. Then ten seconds of a second call, a "police officer" in a ready-made voice, to show it covers more than family. |
| 1:40–2:00 | The family page: each person's readiness before and after, and their personal plan with the next practice. |
| 2:00–2:25 | The rules on screen: consent from both sides, a reveal in every call, no money, clones locked and deletable. |
| 2:25–2:45 | What happened this weekend: how many pairs practised, how many did the safe thing the first and the second time. |
| 2:45–3:00 | Who pays: "Banks are being made liable for these losses. This is the practice they give their customers' families." Then the close. |

**On stage:** a teammate's phone rings on speaker, with a practice call in another teammate's voice, cloned beforehand. The teammate asks for the safe word, hangs up and taps the family number. Keep a recording ready.

## Proof to collect

- **The three teammates,** as the family in the demo. This is the minimum, and it is enough to ship.
- **Pairs at the venue, if time allows:** friends who both agree. Practice 1 on Friday evening, a short lesson, practice 2 on Saturday with a different story. Report how many asked for the safe word or hung up each time. This needs a paid Twilio account, because their numbers are not verified.
- **Mentors today (carousel, 15:00 to 17:00):** ask the consumer-security and Kilo product mentors whether a family would pay, and what would make them trust it. Also ask whether a bank's fraud team would buy this for its customers, and what it would need to see first.

## Schedule

| When | Milestone |
|---|---|
| Fri 13:15–15:00 | **First test:** from a paid Twilio account, place one outbound call to your own mobile; fetch both recordings and check the channels separate; clone your voice from 60 seconds of phone audio; place a second call that speaks the real practice script in that voice, using the per-call voice override. Send the question to ElevenLabs' sponsor contact. One person goes to the mentor carousel (15:00 to 17:00). |
| Fri 15:00 | **Go or no-go:** a stable two-way agent call on your own mobiles. |
| Fri 15:00–19:00 | **M1:** the welcome call works end to end: consent, recording, clone. Sign-up page. One practice story and the scoring rules written. |
| Fri 19:00–23:00 | **M2:** a practice call in the cloned voice, with the reveal and the lesson, and the family page. |
| Sat 09:00–12:00 | **M3:** the call back to the family number, the tactic labels on screen, fixes. Feature freeze at 12:00. |
| Sat 12:00–15:00 | Second practice for Friday's pairs; numbers; screen takes for the video. |
| Sat 15:00–18:00 | Video recorded and edited. |
| Sat 18:00–19:30 | Submitted by 19:30. |

**Decision points**
- **Fri 15:00:** if a call with a cloned voice can't be placed, build the help-line form instead.
- **Fri 18:00:** if clones made from phone audio sound wrong, take the voice sample through a web link with the phone's microphone instead.
- **If ElevenLabs says the practice call is not allowed:** keep the welcome call and the cloning, and play the practice inside the web page as a labelled demonstration the family listens to together, with no outbound call in the cloned voice.

## Later: a safety net for real calls

Not built this weekend. It belongs in the pitch as where the product goes.

- **What it is:** protection during a real suspicious call, not only practice beforehand. The family number becomes a line anyone in the family can ring or forward to at any time: an agent answers, says whether it sounds like a scam, and connects them to a real relative.
- **Next steps after that:** screening calls from unknown numbers before they reach an older relative, checking a forwarded message or number, and one-tap "I'm not sure" that alerts the family.
- **Why later:** phones don't let an app listen to calls or read messages, so real screening needs call forwarding or carrier partnerships, and that side already has large players.
- **What exists of it this weekend:** the call back at the end of a practice, where the person rings the family number and reaches the real relative. That is the first piece of the safety net, and the demo shows it.

## Risks

1. **It isn't new.** Similar one-off services exist. Our difference is the four-part claim above.
2. **Voice-platform policy.** Practice calls must stay within ElevenLabs' rules: consent from both people and a reveal in every call. We are confirming the design with them.
3. **Training evidence is weak.** Promise rehearsal of one habit, not fewer losses.
4. **Phone set-up** can eat hours: account upgrade, number, permissions.
5. **We hold family voice clones.** That is the most sensitive data a product like this can hold; the deletion and lock rules have to be real.
6. **Low prices.** Comparable family plans cost $47 to $84 a year, so families alone are a small market. The larger buyer is a bank, or a security subscription that bundles it. See "Impact and who pays".
