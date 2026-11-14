# Callback landing page: design notes

The landing page at `/` (and `/pricing`) for Callback, a family plan against voice-clone scams.
It opens as an incoming call. You answer, hear a scam in a cloned voice (an ElevenLabs library voice,
not a real person), the screen glitches into the truth, and the phone calls the real son back in green.
Scrolling then carries the same phone through the product, from night (the scam) into day (the plan).

## Before it goes live

This branch carries the landing only. Show it to nobody until it is merged into `feat/full-app`:

- Here `/signup` is a "coming soon" placeholder and there is no `/login`; on `feat/full-app` both are real.
- In `App.tsx` on `feat/full-app`, keep `/` and `/pricing` outside `DashboardLayout` (as on this branch) and
  remove `/` from inside it (it renders `SignUpPage` there today).
- `SIGNUP` and `SIGNIN` in `copy.ts` are the only places the page names those routes.
- After the merge, click every button once: the nav, the hero, the done state, chapter 5, the three plan cards,
  the close (and Mum's phone), the mobile bar, Sign in in the nav, menu and footer.
- The back end's `GET /api/pricing` (`feat/full-app-backend`, `routers/billing.py`) still says "Free for customers
  of partner banks" and lists "Your brand on the welcome call"; the page overrides the bank card's note
  (`pricing.bankNote`) and never shows the partner features, but the API text should change to match.

## Modes

| Mode | Where | What renders |
|---|---|---|
| Lite | everywhere first; permanently on phones, tablets, reduced motion, small or slow machines, Save-Data | CSS phones (`components/Phone.tsx`) with CSS rings and glows |
| 3D | desktops at least 1024 x 640 with a fine pointer, WebGL2, 4+ cores, not reduced motion (`capability.ts`) | one fixed WebGL canvas (`three/Stage.tsx`); the CSS phone boxes stay as anchors |

- The 3D chunk loads after `load` and idle, and swaps in only while the hero rings and nothing in it has focus.
  Its first frame puts the phone exactly on the CSS phone, and it reports ready only once it has sat there for two
  frames, so the swap is a cross-fade in place.
- In 3D the notes under the hero phone fade as the hero scrolls away (`heroLeave`), before the phone crosses them.
- The 3D phone flies to the box of the CSS phone of the section on screen, so the layout never moves.
- Its screen is the same React screen (`components/screens.tsx`) drawn on the glass with drei `Html`.
- If frames stay slower than 34 ms for 2 s, or WebGL fails, the page falls back to lite for the visit.
- Debug: `/?lite` forces lite; `/?3d` keeps 3D on a slow machine (headless tests).

## The three motion moments

1. **The call** (`callMachine.ts`, `audio.ts`, `components/Hero.tsx`). Ringing is silent. Answer (on the phone,
   or "or answer the call" beside the trial button) starts `scam-call.mp3` inside the tap; captions follow the audio
   clock word by word (`captions.ts`), and under them the tactic chips pop in at the times they are spoken while
   Callback's risk light steps green, yellow, red (the back end's labels and reasons). While the call plays the
   headline and nav dim and the ground darkens (`.lp[data-call-focus]`). At 11.85 s a 0.9 s glitch (generated noise
   burst and thunk, RGB split, scramble, one scanline sweep, a short buzz on phones) resolves into "That voice wasn't
   real." at headline size, then `reveal.mp3`, green rings and the call back to "Son". The done state offers the
   trial, a replay and "Would your mum have known? Send her the call" (share sheet, or the link copied).
   End and Decline each have their own rewarding path. On phones the call opens as a full-screen dialog with a
   close button from the first second.
2. **The scroll journey** (`motion.ts`, `components/Night.tsx`, `components/Story.tsx`).
   A field of ringing phones, all dark but one that turns green, then five chapters: consent, the call with tactic
   chips level with the transcript lines they name, the risk light tinting the scene, a full turn into the reveal,
   the family page. Each chapter's text is sticky beside the phone until the next pushes it up.
3. **Shield and the dawn** (`components/Shield.tsx`). The warning drops onto Rasa's screen, Lukas's phone rises with
   the family alert, the canvas fades and the page turns to day: a band that starts on Shield's own navy and grain
   and warms to paper, with a low peach light drawn inside it (no clipped edges). The night ends at the close,
   where Mum calls: Answer connects the call, the rings bloom green and the call leads to the trial.

## Tokens (scoped under `.lp`, `styles/_base.scss`)

- Night: `--lp-night-0 #07111a`, `--lp-night-1 #0c1a26`, `--lp-navy #112231`, `--lp-navy-soft #213d52`.
- Day: `--lp-paper #eef3f0`, `--lp-surface #f9fbfa`, `--lp-ink #12212f`, `--lp-muted #4f6472`.
- Signals, and only for meaning: orange-red `--lp-scam #e76d52` (the scam, ringing, tactics), amber
  `--lp-doubt #f5b94d`, green `--lp-safe #3cc58f` / `--lp-safe-brand #1d8d64` (the safe action, calling back).
- Type: Space Grotesk 500/600 for what is said, Inter 400/600 for what is read; tabular numerals on timers and prices.
- Buttons: paper on night, navy on paper; green only for call-back buttons on phone screens.

## Rules the page keeps

- Nothing plays before a tap; captions are always on screen while sound plays; a sound toggle sits in the nav and
  under the phone.
- Reduced motion: lite only, no glitch or scramble, the story as five still rows with every tactic shown.
- Copy lives in `copy.ts` (British spelling, curly quotes, no em dashes). Only two statistics, both sourced in the
  footer. No user counts, logos, testimonials or real bank names. The voices are declared artificial next to the
  phone and in the footer.
- Pricing renders the static fallback at once and takes the server's text from `GET /api/pricing`; both forms post
  to `POST /api/waitlist` (`api.ts`).

## Files

```
LandingPage.tsx   route: head tags, sections, lite or 3D
PricingPage.tsx   /pricing: the pricing section, questions and close
copy.ts           every string
store.ts          tiny shared store (the 3D screen is a separate React root)
callMachine.ts    the hero call's state machine and clock
audio.ts          one AudioContext, decoded clips, analyser, generated sounds
captions.ts       word timings grouped into display lines
motion.ts         scroll progress: cached section offsets, one animation frame per scroll (no library)
capability.ts     the 3D decision
components/       sections, the CSS phone and every phone screen
three/            the WebGL stage, phone model, ring and glow shaders, the field
styles/           SCSS partials
```
