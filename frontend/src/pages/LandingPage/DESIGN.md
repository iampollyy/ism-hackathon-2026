# Callback landing page: design notes

The landing page at `/` (and `/pricing`) for Callback, a family plan against voice-clone scams.
It opens as an incoming call. You answer, hear a scam in a cloned voice (an ElevenLabs library voice,
not a real person), the screen glitches into the truth, and the phone calls the real son back in green.
Scrolling then carries the same phone through the product, from night (the scam) into day (the plan).

## Modes

| Mode | Where | What renders |
|---|---|---|
| Lite | everywhere first; permanently on phones, tablets, reduced motion, small or slow machines, Save-Data | CSS phones (`components/Phone.tsx`) with CSS rings and glows |
| 3D | desktops at least 1024 x 640 with a fine pointer, WebGL2, 4+ cores, not reduced motion (`capability.ts`) | one fixed WebGL canvas (`three/Stage.tsx`); the CSS phone boxes stay as anchors |

- The 3D chunk loads after `load` and idle, and swaps in only while the hero rings and nothing in it has focus.
- The 3D phone flies to the box of the CSS phone of the section on screen, so the layout never moves.
- Its screen is the same React screen (`components/screens.tsx`) drawn on the glass with drei `Html`.
- If frames stay slower than 34 ms for 2 s, or WebGL fails, the page falls back to lite for the visit.
- Debug: `/?lite` forces lite; `/?3d` keeps 3D on a slow machine (headless tests).

## The three motion moments

1. **The call** (`callMachine.ts`, `audio.ts`, `components/Hero.tsx`). Ringing is silent. Answer starts
   `scam-call.mp3` inside the tap; captions follow the audio clock word by word (`captions.ts`). At 11.85 s a
   0.9 s glitch (generated noise burst and thunk, RGB split, scramble) resolves into "That voice wasn't real.",
   then `reveal.mp3`, green rings and the call back to "Son". End and Decline each have their own rewarding path.
   On phones the call opens as a full-screen dialog.
2. **The scroll journey** (`motion.ts` with GSAP ScrollTrigger, `components/Night.tsx`, `components/Story.tsx`).
   A field of ringing phones, all dark but one that turns green, then five chapters: consent, the call with tactic
   chips on the transcript timings, the risk light tinting the scene, a full turn into the reveal, the family page.
3. **Shield and the dawn** (`components/Shield.tsx`). The warning drops onto Rasa's screen, Lukas's phone rises with
   the family alert, the canvas fades and the page turns to day.

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
motion.ts         scroll progress (lazy, GSAP ScrollTrigger)
capability.ts     the 3D decision
components/       sections, the CSS phone and every phone screen
three/            the WebGL stage, phone model, ring and glow shaders, the field
styles/           SCSS partials
```
