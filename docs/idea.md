# Callback: family practice against voice-clone scams

Plan for Unfair Weekend 2026 (deadline Saturday 14 Nov, 20:00). "Callback" is a working name, after the habit the product teaches. Research notes were gathered on 13 Nov and are linked but not checked by hand.

**Changed on Friday 13 Nov, about 16:30:** this weekend the calls run in a web page on each person's phone, not over the phone network. The product still rings real phones; that part moves to "Later: real phone calls". The sections below are updated to match.

## Scope for the weekend

**Priority:** a great demo, a clear concept and a working product. Three rules hold throughout: only clone and call people who said yes; every call ends by revealing itself; cloned voices stay inside the family.

**The form to build:** the practice call in a relative's cloned voice is the one path that must work. The person has agreed beforehand to get practice calls but doesn't know when, so the call feels real. The family number is its last ten seconds: the person hangs up, taps the family number, and the real relative hears that they called.

**The channel this weekend: a web page that acts as the phone.** Each person keeps a page open on their phone that looks like the phone's own call screen. When a practice starts, it rings full screen from an unknown number; they tap Answer and talk to the agent through the page.
- It is free: it uses only ElevenLabs credits, with no phone numbers or call charges.
- It works with anyone at the venue who opens a link, not only verified numbers.
- The page receives each line as it is spoken, so the laptop screen can show the conversation and label tactics live. A phone call might not give us that.
- Say it plainly in the pitch and the video: the product rings the real phone; this weekend it runs in a web page.

**Cut from the critical path:**
- Twilio and real phone numbers. Optional: one real ring on Twilio's free trial for the video's first seconds, if someone has a spare half hour. What we found about Twilio is under "Later: real phone calls".
- Every language except English. Lithuanian is dropped for the weekend.
- Real families. For the demo the "family" is the three teammates; friends at the venue can join with a link.
- Cloning from call audio. Clone from a one-minute microphone recording made on the sign-up page.
- Scenarios written live from scam warnings. Hard-code the stories. One weekly digest from live sources comes back in only after the calls work.
- HeyGen, condense, and the habit-over-time chart.
- Cloning a judge on stage. Call a teammate with a clone made beforehand, and keep a recording.

**First check:** on your own phone, over HTTPS, a two-way conversation with the practice agent in your own cloned voice, set per call, with one client tool firing on the page.

**How this differs from voice-memory projects:** it protects a family against cloned voices; it doesn't preserve voices.

## Interface mockup

Three screens (home, family page, live practice call), light mode, sample data: https://claude.ai/artifact/JmWtpLXG7g2NVuNsyqPF3n. It is private until shared from its Share menu.

- **Look:** white cards on a cool grey ground, dark navy text, Space Grotesk headings with Inter body. One orange-red accent for the "ringing" and tactic moments, and green for the safe action.
- **Home:** the headline, a tilted phone showing an incoming practice call with tactic labels around it, how it works in four steps, and three sample people with three different plans.
- **Family page:** family readiness before and now, the family word and family number, a card per person with their weak spot and next practice, one person's plan in detail, and this week's activity.
- **Live practice call:** the call panel, the conversation with each tactic labelled as it is used, the stages of the scam, what the person did, seconds to the first challenge, and the call back to the real relative. In the demo this is the laptop screen the audience watches, next to the ringing phone.
- **Worth animating in the real build:** the rings around the phone pulsing while it rings, tactic labels popping in as they are spoken, and the result card turning green when the family word is asked for.
- **Not in the mockup yet: the phone page.** What the person holds, one link per member: a waiting screen ("Callback is on", with one tap to switch on sound), the incoming call from an unknown number with Answer and Decline, the in-call screen with a timer and an End button, the reveal with the one-line lesson, and a "Call the family number" button. Same look as the mockup, but it should pass for a phone's own call screen.

## In short

- **What it is:** a family plan against voice-clone scams. An agent phones each family member, gets their consent and clones their voice from the call. It then runs short practice calls in a relative's voice, so that everyone learns one habit: hang up and call back, or ask for the family's safe word.
- **Who it's for:** an adult child who signs up their parents. The parents never install anything; everything happens by phone.
- **It is not new.** TrustboxAI sells one-off calls like this in the US and Canada, and Kinword is about to launch. Our difference is below.
- **It is buildable this weekend.** Agents that talk in the browser, instant voice cloning and the per-call voice switch are all documented features of ElevenLabs agents. Real phone calls are later work.
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
4. **Everything by phone.** Parents are enrolled, consent and practise without an app. That is the product; this weekend's demo uses a web page on the phone instead.

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

**This weekend, in the browser:** step 2 is a conversation on the member's phone page instead of a call; step 3 uses a one-minute microphone recording from the sign-up page, which opens with the person's spoken consent; step 4 rings the phone page; and in step 6 the person taps the family number on the page, the family-line agent confirms it was a practice, and the relative's own page shows that they called.

### The parts

| Part | Built with | Notes from the docs check |
|---|---|---|
| Calls | ElevenLabs agents in the browser, with the `@elevenlabs/react` library | The phone page starts the conversation with a short-lived token from our back end ([React library](https://elevenlabs.io/docs/eleven-agents/libraries/react.md)). Browser conversations use the plan's agent minutes. |
| Voice per call | A voice override, plus dynamic variables for the person and the story | The voice override must first be switched on in the agent's Security tab, or the conversation fails to start; variables need no switch ([overrides](https://elevenlabs.io/docs/eleven-agents/customization/personalization/overrides.md)). |
| Cloning | ElevenLabs instant voice cloning | `POST /v1/voices/add` with `name` and `files`; returns `voice_id` ([docs](https://elevenlabs.io/docs/api-reference/voices/ivc/create.md)). The docs say under two minutes can give a usable clone; use one to two minutes of clean microphone audio. |
| Live events | Client tools and the library's callbacks | The agent calls `mark_tactic` and `practice_result`, which run in the page ([client tools](https://elevenlabs.io/docs/eleven-agents/customization/tools/client-tools.md)). `onMessage` gives each line as it is spoken. |
| The transcript after a call | `GET /v1/convai/conversations/{conversation_id}` | Each entry has `role` (`user` or `agent`), `message` and `time_in_call_secs` ([docs](https://elevenlabs.io/docs/eleven-agents/api-reference/conversations/get.md)). No webhook needed. |
| Languages | English only this weekend | Other languages are a later step. |
| The agent's reasoning, scoring and lessons | Claude API | Also writes each practice from current scam warnings. |
| Sign-up and family page | A small web app | Lovable credits can produce the first version quickly. |

### How each hackathon tool is used

Ordered by how much each one lifts the product, the video or the pitch.

| Tool | What to do with it | Lifts | Effort |
|---|---|---|---|
| **ElevenLabs** | The whole product runs on it: three voice agents, voice cloning, tools the agent calls mid-conversation. Say this in the Devpost text, because their hacker guide leads with the agents platform. | Product, and their prize | Core work |
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

The ElevenLabs names below were checked against their docs on 13 Nov at about 16:20. The rest is our design; check each piece as you wire it.

**The full specs are in two files:** [backend.md](backend.md) (layout, tables, every request and response, the flows, the rules enforced in code) and [ai.md](ai.md) (the three voice agents, the model jobs, all prompts, the readiness scale). This section was brought in line with them on Friday at about 17:45; if they ever differ, those two files are newer.

### Start here: stack, layout and the contract

**Confirmed on Friday 13 Nov, updated at about 16:30 for the browser version:** the stack below, the contract below, and the owners. Denis owns the back end and the ElevenLabs account, including its set-up. The front-end colleague owns `frontend/`. The data scientist owns the agents' scripts, the survey, the scoring scale and the plan format.

**Stack**
- Front end: React with Vite, already set up in `frontend/`, plus `@elevenlabs/react` for the agent conversation on the phone page.
- Back end: Python with FastAPI in `backend/`. The repo's ignore file already covers Python, audio clean-up is easy with ffmpeg, and the prompts and scoring can be written by anyone on the team.
- Database: SQLite to start.
- Live updates to the browser: server-sent events for the laptop's call screen, opened on `localhost`. The phone pages poll once a second instead, because Cloudflare's quick tunnels do not carry server-sent events ([Cloudflare docs](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)).
- **HTTPS for the phones.** A phone browser gives a page the microphone only over HTTPS (localhost is the one exception). Run one free tunnel, for example cloudflared, to the Vite dev server, and proxy `/api` from Vite to FastAPI, so phones and laptop share one HTTPS address. Vite 6 refuses unknown host names, so add the tunnel's host to `server.allowedHosts`. Nothing on the ElevenLabs side points at the tunnel, so a new address only changes the links.
- Secrets in `backend/.env`, never committed. `ELEVENLABS_API_KEY` is already there. Commit a `backend/.env.example` listing the names only: `ELEVENLABS_API_KEY`, `ELEVENLABS_WELCOME_AGENT_ID`, `ELEVENLABS_PRACTICE_AGENT_ID`, `ELEVENLABS_FAMILY_LINE_AGENT_ID`, and the model provider's key. The API key never reaches the browser: the back end hands out short-lived conversation tokens instead.

**The contract between front end and back end.** Agree this first; then both sides work in parallel, and the front end builds against fixed sample responses until the back end is ready. Each member opens their own phone page at `/phone/{member_id}`.

| Call | Purpose | Returns |
|---|---|---|
| `POST /api/families` | Create a family: name, a tick that a safe word is agreed (never the word itself), members (name, relationship, and their own tick agreeing to practice calls) | `family_id`, and each member's id and phone link |
| `GET /api/families/{id}` | Everything the family page shows | The family object below |
| `POST /api/members/{id}/voice` | Upload the one-minute microphone recording; the back end clones it | `voice_ready` |
| `POST /api/members/{id}/welcome-call` | Ring that member's phone page with the welcome agent | `call_id` |
| `POST /api/practice-calls` | Start a practice: `target_member_id`, `voice_member_id` or none, `scenario`. Rings the target's phone page | `call_id` |
| `POST /api/calls/{id}/answer` | The phone page answers | The session object below |
| `POST /api/calls/{id}/events` | The phone page reports what happens: turns, tactics, the outcome, the reveal | `ok` |
| `POST /api/calls/{id}/end` | The phone page reports the end and who ended it. The back end scores the call and writes the lesson | `ok` |
| `POST /api/members/{id}/family-line` | The person taps the family number after a practice | `call_id` and the session object |
| `GET /api/calls/{id}` | A finished call: turns, tactics, result, lesson | The call object below |
| `GET /api/calls/{id}/events` | Live stream for the laptop's call screen | Call events below |
| `GET /api/members/{id}/phone-state` | What that member's phone page should show now; the page asks once a second | An incoming call or none, and unread messages. Shape in backend.md |

*Session object,* what the phone page needs to start the conversation: `conversation_token`, `overrides`, `dynamic_variables`. The back end gets the token from `GET /v1/convai/conversation/token?agent_id=...` ([docs](https://elevenlabs.io/docs/eleven-agents/api-reference/conversations/get-webrtc-token.md)). That call also returns the `conversation_id`, which the back end stores on Answer. `overrides` carries only the voice, `{ tts: { voiceId } }`. Everything personal (names, the story, the ask, the first sentence) travels as `dynamic_variables`, and the prompts stay in the agents' own settings, so no prompt passes through the browser. The page then calls `startSession({ conversationToken, connectionType: 'webrtc', overrides, dynamicVariables, clientTools })`. A full example is in backend.md.

*Member, inside the family object:* `id`, `name`, `relationship`, `consent` (clone, practice), `voice_ready`, `readiness` (`before`, `now`, and `items` each with `label`, `before`, `now`, `max`), `weak_spot`, `said` (their quote from the welcome call), `plan` (`this_week`, and `steps` each with `when`, `scenario`, `why`, `status`).

*Family object:* `id`, `name`, `safe_word_set`, `family_number`, `members`, `readiness` (`before`, `now`), `week` (recent and planned activity).

*Call object:* `id`, `kind`, `target`, `voice_of`, `scenario`, `status`, `turns` (`speaker`, `text`, `t`, optional `tactic`), `tactics` (`key`, `label`, `t`), `result` (`outcome`, `seconds_to_challenge`, `lesson`), `callback_seconds`.

*Call events, for the laptop's call screen:*
- `call.status`: `ringing`, `in_progress` or `ended`
- `turn`: `speaker`, `text`, `t`, from the library's `onMessage`
- `tactic`: `key`, `label`, `t`
- `outcome`: `outcome`, `seconds_to_challenge`
- `revealed`
- `callback.connected`: `seconds`, from the end of the practice to tapping the family number

*Phone state, for one member's phone page (returned by `phone-state`, not streamed):*
- `incoming_call`: `call_id`, `kind` (`welcome` or `practice`), `caller` (what the screen shows: "Unknown number" and a made-up number)
- `message`: `text` (for example the weekly message, or "Mum called the family number after a practice")

*Fixed lists:* tactic keys are `new_number`, `urgency`, `secrecy`, `authority`, `emotional_appeal`, `small_ask_first`, `isolation`, `unusual_payment`. Outcomes are `asked_safe_word`, `hung_up`, `asked_personal_question`, `hesitated`, `agreed`. Scenarios are `relative_new_number`, `police`, `bank_security`, `hospital`.

No provider webhooks this weekend. The agent's tools run in the phone page, which forwards them to the back end, and the back end fetches each transcript itself. So the back end needs no address that ElevenLabs can reach.

**The first three hours, in parallel**
- Back end: the first test below, then `POST /api/practice-calls`, `answer` with a real token, and both event streams.
- Front end: the phone page first (waiting, ringing, in call, reveal), against sample data; then the laptop's live call screen, the family page and sign-up.
- Data: the welcome agent's script with the five questions, the practice agent's script for the relative story, and the scoring scale.

### Set-up checklist: ElevenLabs

Written so that a person or a coding agent can follow it. Steps marked "check" were not confirmed in the docs. Whoever runs this creates the keys themselves and puts them only in `backend/.env`.

1. **Done:** the Creator plan is active on the one account that holds everything, and `ELEVENLABS_API_KEY` is in `backend/.env`.
2. Create three agents and put their ids in `backend/.env`: welcome, practice, family line. Their scripts come from the data scientist.
3. On each agent's Security tab, turn on authentication, so a conversation starts only with a token from our back end. Don't also set the host allowlist; the docs say to use one or the other ([authentication](https://elevenlabs.io/docs/eleven-agents/customization/authentication.md)).
4. On the same tab, switch on each override we pass: on the practice agent, the voice, the system prompt and the first message. An override that isn't switched on makes the conversation fail to start.
5. On the practice agent, add two client tools, with "Wait for response" off. Names are case-sensitive and must match the page's code.
   - `mark_tactic`, with a string parameter `key`: one of the tactic keys above
   - `practice_result`, with a string parameter `outcome`: one of the outcomes above
6. Keep the `end_call` system tool on each agent, so the agent can hang up after the reveal. Dashboard agents have it by default ([end call](https://elevenlabs.io/docs/eleven-agents/customization/tools/system-tools/end-call.md)).
7. Pick the language model for the agents: the fastest one that stays in role.

**Then the first test, in this order**
1. In the ElevenLabs dashboard, talk to the practice agent in a stock voice.
2. Clone your voice from a one-minute microphone recording (`POST /v1/voices/add`).
3. Make a bare page in `frontend/` that fetches a token from the back end and starts the conversation with your clone as the voice override. Open it on your own phone through the tunnel and talk to it.
4. Add `mark_tactic` and check that it fires on the page.

**Before any cloned-voice call to someone other than yourself:** that person has said yes, and the question about this use has been sent to ElevenLabs ([use policy](https://elevenlabs.io/use-policy)).

### The pieces

```
  Phone page (one per member) ◄──── voice ────► ElevenLabs agents
    rings, answers, talks,                        (welcome, practice,
    runs the agent's tools                         family line)
        │                                              ▲
        │ tokens, events, end      tokens, clones,     │
        ▼                          transcripts         │
  Our backend ─────────────────────────────────────────┘
    ├──► Database (families, members, calls, events, results)
    ├──► Claude API (scoring, lesson, plan)
    └──► Laptop: sign-up, family page, live call screen (live updates)
```

- **Phone page:** one link per member: waiting, ringing, in call, reveal, family number. It starts the agent conversation itself, runs the agent's tools and forwards everything to the back end.
- **Laptop:** sign-up (family name, each member's name and relationship, a tick that the family has agreed a safe word, each member's own tick agreeing to practice calls, the one-minute voice recording), the family page, and the live call screen for the demo.
- **Backend:** one small server. It hands out conversation tokens with the right overrides, makes clones, rings phone pages, fetches transcripts, scores calls and pushes live updates. No provider calls it back.
- **Database:** five tables.
  - *families:* name, whether a safe word is agreed (the word itself is never collected)
  - *members:* name, phone, relationship, consent times, voice id, readiness profile, plan
  - *calls:* kind (welcome, practice, family line), who, ElevenLabs conversation id, status
  - *events:* call, time, kind (tactic, outcome), detail
  - *results:* call, outcome, seconds until the first challenge, tactics used, lesson text
- **Three ElevenLabs agents:**
  - *Welcome:* a friendly stock voice. Explains, asks for consent, then runs the five-question readiness survey.
  - *Practice:* the scammer role. Its voice is overridden per call with a member's clone. It calls the page's tools.
  - *Family line:* answers when the person taps the family number, says it was a practice, and tells them the relative has been told.

### The flows

**1. Voice sample and welcome call**
1. On the sign-up page, each member reads a short text aloud for about a minute. It opens with their consent: "I'm [name], and I agree to Callback cloning my voice for practice calls inside my family." The page records it with the microphone and uploads it.
2. The back end cuts the silence, evens out the loudness, sends the audio to instant cloning, and stores the returned `voice_id` on the member.
3. On the same page each member ticks "I agree to receive practice calls without knowing when". That tick is enough for a practice call, so practice calls work on Friday, before the welcome call exists.
4. The welcome call rings the member's phone page. The agent explains the service, asks again for consent to receive practice calls, and runs the five-question survey (flow 4).
5. The back end records a clear "yes". A "no" withdraws the tick at once, so no practice call is sent to them until they tick again or say yes on a later welcome call. When the call ends, the back end reads the conversation and fills the readiness profile.

Later, in the product, the voice sample comes from the welcome call itself, as in "The path".

**2. Practice call**
1. The back end picks the target and the voice (another member's clone), fills the scenario (who the caller claims to be, the story, the ask), creates the call as `ringing` and sends `incoming_call` to the target's phone page.
2. The page rings. On Answer it calls `POST /api/calls/{id}/answer` and gets a token, the voice override and the call's variables (names, the story, the ask, the first sentence).
3. The page starts the conversation. Each line from `onMessage`, and each call of `mark_tactic` or `practice_result`, goes to `POST /api/calls/{id}/events`; the back end pushes it to the laptop's call screen.
4. The agent reveals the practice, gives the one-line lesson, and ends the call with `end_call`. If the person taps End first, that counts as hanging up.
5. The page sends `POST /api/calls/{id}/end`. The back end decides the outcome from the lines and tool calls it already has, a model writes the short debrief, and the ElevenLabs transcript is fetched afterwards as the record.

**3. The family number**
1. After the reveal, the phone page shows the family number with a call button.
2. Tapping it starts a conversation with the family-line agent, which knows the caller's name and whose voice was just used.
3. The agent says it was a practice and that the relative has been told. The relative's phone page shows a `message`: "Mum called the family number after a practice." The back end records the seconds from the end of the practice to the tap.

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

This weekend, messages appear on the person's phone page as a `message` event. A Telegram bot is a free way to send one for real, if time allows.

For the weekend: generate one real weekly digest from live sources, send one real message to a teammate, and show the schedule on the family page. Nobody can demo weeks passing, so say plainly that the loop is shown once.

**Which models.** Keep model calls behind one function so the provider can be swapped. The scoring, the profile and the plan can run on OpenAI's API or on Claude; use whichever account has credits. Both are available: Denis has a separate OpenAI API balance, apart from the hackathon's Codex perk, which is credit for the Codex coding agent only. Which job runs on which model is in ai.md. The language model inside the voice agents is chosen in ElevenLabs' own settings.

### The logic that is ours

- **The welcome call does three jobs at once:** consent, a voice sample, and a readiness survey. One two-minute call replaces a sign-up form, a recording step and a questionnaire.
- **A readiness profile per person,** scored the same way before and after practice, so the family page can show a change.
- **The practice agent never knows the safe word.** We never collect it: sign-up asks only whether the family has agreed one. So when the person asks for it, the voice truly cannot answer. That is the mechanism, not an act.
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
| Engineer | The backend: conversation tokens and overrides, cloning, the three agents' set-up, transcripts and scoring, the live updates, the tunnel |
| Front end and design | The phone page (waiting, ringing, in call, reveal, family number), sign-up with the voice recording, the family page, the live call screen with tactic labels, the debrief view |
| Data scientist | The scenario stages and the tactic list, the three agents' prompts, the survey and its scoring scale, the plan format, the scoring prompt and its checks, and the small tests below |

### Small tests that make the demo credible

- **Does the clone sound like the person?** Five listeners rate the clone against the person's real voice from 1 to 5, both played through a phone speaker.
- **Does the scoring get it right?** Ten role-played calls with known outcomes; count how many the scoring labels correctly.
- **Does practice change anything?** Seconds until the first challenge on a first call and on a second call, for the three teammates and anyone else who joins.

### Things to settle on the first day

- Which language model the agents use. Pick the fastest one that stays in role; slow answers break the illusion of a phone call.
- **Sound and screen on the phones.** A page can't play sound until someone has tapped it, so the waiting screen needs one tap to switch on sound. iPhones don't let a web page vibrate, so the ring there is sound and screen only. Keep the screen awake while waiting: turn off auto-lock on the demo phones, or use the browser's Wake Lock.
- **The network.** If the venue Wi-Fi is slow or blocks the voice connection, put the demo phones and the laptop on a phone's hotspot.
- Deleting a clone: store the voice id so it can be removed on request.
- Settled since the morning: overrides must be switched on per field; live lines come from the library; no call transfer is needed this weekend.

## Demo

**Video, 3 minutes**

| Time | On screen |
|---|---|
| 0:00–0:20 | A phone rings. "Mum, it's me, I lost my phone." Caption: this voice is artificial. Then the fact: in a 2025 study, listeners took a cloned voice for the real person about 80% of the time ([Scientific Reports](https://www.nature.com/articles/s41598-025-94170-3)). |
| 0:20–0:50 | Sign-up: the family, a tick that they have agreed a safe word (we never ask for the word), and a one-minute voice recording that opens with spoken consent. The welcome agent talks to a teammate and asks the five questions. |
| 0:50–1:40 | The practice call. The cloned voice asks for an urgent transfer, while the screen labels each pressure tactic as it is used (new number, urgency, secrecy). The parent asks for the safe word, and the call ends with the reveal and the one-line lesson. Then ten seconds of a second call, a "police officer" in a ready-made voice, to show it covers more than family. |
| 1:40–2:00 | The family page: each person's readiness before and after, and their personal plan with the next practice. |
| 2:00–2:25 | The rules on screen: consent from both sides, a reveal in every call, no money, clones locked and deletable. One line: this weekend the call runs in a web page; the product rings the real phone. |
| 2:25–2:45 | What happened this weekend: how many pairs practised, how many did the safe thing the first and the second time. |
| 2:45–3:00 | Who pays: "Banks are being made liable for these losses. This is the practice they give their customers' families." Then the close. |

**On stage:** a teammate's phone rings on speaker, with a practice call in another teammate's voice, cloned beforehand; the laptop shows the tactics as they are used. The teammate asks for the safe word, hangs up and taps the family number. Run the phones and the laptop on a hotspot, and keep a recording ready.

## Proof to collect

- **The three teammates,** as the family in the demo. This is the minimum, and it is enough to ship.
- **Pairs at the venue, if time allows:** friends who both agree, each with the link on their own phone; no account or number needed. Practice 1 on Saturday morning, a short lesson, practice 2 a few hours later with a different story. Report how many asked for the safe word or hung up each time.
- **Mentors today (carousel, 15:00 to 17:00):** ask the consumer-security and Kilo product mentors whether a family would pay, and what would make them trust it. Also ask whether a bank's fraud team would buy this for its customers, and what it would need to see first.

## Schedule

Replanned on Friday at about 16:30 for the browser version.

| When | Milestone |
|---|---|
| Fri 16:30–18:30 | **First test:** the four steps in the set-up checklist: a conversation on your own phone through the tunnel, in your cloned voice, with a client tool firing. Send the question to ElevenLabs' sponsor contact. |
| Fri 18:30 | **Go or no-go:** that conversation works on a phone. |
| Fri 18:30–23:00 | **M1:** the practice call end to end: the phone page rings, the cloned voice, tactic labels on the laptop, the reveal, the scoring. Sign-up with the voice recording. |
| Sat 09:00–12:00 | **M2:** the welcome call (consent, survey, readiness), the family page, the family number. First practice for pairs at the venue. Feature freeze at 12:00. |
| Sat 12:00–15:00 | Second practice for the pairs; numbers; screen takes for the video. |
| Sat 15:00–18:00 | Video recorded and edited. |
| Sat 18:00–19:30 | Submitted by 19:30. |

**Decision points**
- **Fri 18:30:** if the per-call voice override doesn't work, make one practice agent per cloned voice, with the voice set in the agent itself.
- **If the voice connection fails on the venue network:** switch the page to `connectionType: 'websocket'` with a signed URL from `GET /v1/convai/conversation/get-signed-url`. It expires after 15 minutes, so fetch it on Answer.
- **If ElevenLabs says the practice call is not allowed:** the practice announces itself in its first sentence, and the family listens to it together on the laptop as a labelled demonstration.

## Later: real phone calls

The product rings real phones, through ElevenLabs' Twilio integration. What we found on 13 Nov, for when we build it:

- Twilio's free trial plays its own notice at the start of each call (outbound calls usually need a key press first) and calls only verified numbers. A paid account starts with a top-up of about $20.
- A Lithuanian or other EU number needs proof of address and identity, approved in working days. A US number is instant but shows +1.
- Twilio charges by destination, so calls to Lithuanian mobiles cost more than calls within the US. Calling a US family number from a Lithuanian SIM is an international call on the caller's own plan.
- Telegram bots can't make voice calls. They can send voice messages, which suits the "Hi Mum" voice-message scams as a second channel.

## Later: a safety net for real calls

Not built this weekend. It belongs in the pitch as where the product goes.

- **What it is:** protection during a real suspicious call, not only practice beforehand. The family number becomes a line anyone in the family can ring or forward to at any time: an agent answers, says whether it sounds like a scam, and connects them to a real relative.
- **Next steps after that:** screening calls from unknown numbers before they reach an older relative, checking a forwarded message or number, and one-tap "I'm not sure" that alerts the family.
- **Why later:** phones don't let an app listen to calls or read messages, so real screening needs call forwarding or carrier partnerships, and that side already has large players.
- **What exists of it this weekend:** the family number at the end of a practice, which the person taps and which tells the real relative. That is the first piece of the safety net, and the demo shows it.

## Risks

1. **It isn't new.** Similar one-off services exist. Our difference is the four-part claim above.
2. **Voice-platform policy.** Practice calls must stay within ElevenLabs' rules: consent from both people and a reveal in every call. We are confirming the design with them.
3. **Training evidence is weak.** Promise rehearsal of one habit, not fewer losses.
4. **Phones in a browser:** the microphone needs HTTPS, sound needs a first tap, iPhones won't vibrate, and venue Wi-Fi may be slow.
5. **We hold family voice clones.** That is the most sensitive data a product like this can hold; the deletion and lock rules have to be real.
6. **Low prices.** Comparable family plans cost $47 to $84 a year, so families alone are a small market. The larger buyer is a bank, or a security subscription that bundles it. See "Impact and who pays".
7. **The demo is a web page, not a phone call.** Say so plainly, and show where the phone line comes in.
