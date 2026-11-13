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

| Tool | Use |
|---|---|
| ElevenLabs | The core: agents on the phone, voice cloning, speech both ways. Each teammate's plan has its own call minutes. |
| Claude API credits | The agent's reasoning, scoring what the person did, writing lessons and new practices. |
| Firecrawl | Reads current scam warnings from police, banks and news, so the monthly practice matches what is going around. |
| Lovable | Sign-up flow and family page. |
| HeyGen | Optional: a short explainer for the family in their language, or scenes for the demo video. |
| Screen Studio | The demo video. |
| Codex and Claude Code credits | Building. |
| condense | Optional: route the Claude calls through it for the tokens-saved prize. |

## Technical design

Endpoint and field names below come from an agent's reading of the ElevenLabs and Twilio docs on 13 Nov, plus memory. Check each against the docs as you wire it.

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
| 2:45–3:00 | Who pays, and the close. |

**On stage:** a teammate's phone rings on speaker, with a practice call in another teammate's voice, cloned beforehand. The teammate asks for the safe word, hangs up and taps the family number. Keep a recording ready.

## Proof to collect

- **The three teammates,** as the family in the demo. This is the minimum, and it is enough to ship.
- **Pairs at the venue, if time allows:** friends who both agree. Practice 1 on Friday evening, a short lesson, practice 2 on Saturday with a different story. Report how many asked for the safe word or hung up each time. This needs a paid Twilio account, because their numbers are not verified.
- **Mentors today (carousel, 15:00 to 17:00):** ask the consumer-security and Kilo product mentors whether a family would pay, and what would make them trust it.

## Schedule

| When | Milestone |
|---|---|
| Fri 14:45–16:30 | **First test:** from a paid Twilio account, place one outbound call to your own mobile; fetch both recordings and check the channels separate; clone your voice from 60 seconds of phone audio; place a second call that speaks the real practice script in that voice, using the per-call voice override. Send the question to ElevenLabs' sponsor contact. One person goes to the mentor carousel (15:00 to 17:00). |
| Fri 16:30 | **Go or no-go:** a stable two-way agent call on your own mobiles. |
| Fri 16:30–19:00 | **M1:** the welcome call works end to end: consent, recording, clone. Sign-up page. One practice story and the scoring rules written. |
| Fri 19:00–23:00 | **M2:** a practice call in the cloned voice, with the reveal and the lesson, and the family page. |
| Sat 09:00–12:00 | **M3:** the call back to the family number, the tactic labels on screen, fixes. Feature freeze at 12:00. |
| Sat 12:00–15:00 | Second practice for Friday's pairs; numbers; screen takes for the video. |
| Sat 15:00–18:00 | Video recorded and edited. |
| Sat 18:00–19:30 | Submitted by 19:30. |

**Decision points**
- **Fri 16:30:** if a call with a cloned voice can't be placed, build the help-line form instead.
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
6. **Low prices.** Comparable family plans cost $47 to $84 a year. The larger buyer may be a security subscription that bundles it.
