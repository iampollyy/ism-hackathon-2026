// Demo Day backup video: "A Shield call, recorded on the live site." 40 s, 1920x1080.
// Spec: work/demo-day/outline.md, "DEMO VIDEO SPEC". Every time is in seconds of this video (V).
//
// Sources (one Shield demo call, recorded on the live site):
//   P = raw/demo-phone-shield.mp4 (Anna's phone), L = raw/laptop-live.mp4 (the family's live view),
//   F = raw/demo-phone-alert.mp4 (a family member's phone with the alert card).
// Sync: P = V - 0.5 and L = V - 3.7. Read off the two call timers: phone 0:01 at P 6.73, laptop 0:01
// at L 3.53; phone 0:15 at P 20.77, laptop 0:15 at L 17.53 (both offsets 3.2 s, so they agree).
// Event times below are measured frame by frame on the sources (work/demo-day/demo/chk).

import { Easing, interpolate, staticFile } from "remotion";

export const FPS = 30;
export const TOTAL_S = 40;
export const f = (sec: number) => Math.round(sec * FPS);
export const A = (file: string) => staticFile(`demo-day/${file}`);

export const P_OFF = 0.5; // P = V - P_OFF
export const L_OFF = 3.7; // L = V - L_OFF

export const T = {
  split: 2.5, // the call scene starts (P 2.0, ringing)
  lStart: 3.7, // the laptop recording starts (L 0.0); before this it holds its first frame
  answer: 6.2, // answered: both timers start at 0:00 (P 5.7, L 2.47)
  line1: 9.9, // "The fraud team from your bank." lands on the laptop (L 6.2)
  chipYellow: 11.0, // laptop "Light turned yellow" (L 7.3)
  line2: 14.8, // "Your account is at risk..." lands (L 11.1)
  phoneYellow: 15.77, // phone "Be careful" banner (P 15.27)
  line3: 21.5, // "You need to move your savings..." lands (L 17.8)
  red: 21.77, // phone turns full-screen red (P 21.27)
  alert: 22.7, // laptop "Shield alerted the family at 0:16" card (L 19.0); family inset slides in
  redCap: 24.0,
  hangup: 26.5, // phone "You hung up. That was the right thing to do." (P 26.03)
  still: 30.0, // full-frame still of the red warning
  end: 36.0, // end card
};

export const C = {
  deep: "#1d1647",
  deep2: "#2a2163",
  ink: "#0d0a24",
  accent: "#735ac8",
  accentFill: "#917ae5",
  lavender: "#d8ceff",
  pink: "#f2a9fa",
  onDeep: "#f1eeff",
  onDeepMuted: "#b9b2e0",
};
export const HEAD = "Space Grotesk";
export const BODY = "Inter";

const EASE = Easing.bezier(0.16, 1, 0.3, 1);
/** 0 -> 1 between two frames, eased, clamped. */
export const ramp = (frame: number, from: number, to: number, easing = EASE) =>
  interpolate(frame, [from, to], [0, 1], { easing, extrapolateLeft: "clamp", extrapolateRight: "clamp" });

/** Layout in canvas pixels. */
export const LAP = { x: 60, y: 90, w: 1140, h: 810, cropX: 380, scale: 0.75 }; // L cropped to x 380-1900
export const PH = { x: 1310, y: 64, w: 540, h: 960, scale: 0.5 };
export const INSET = { x: 566, y: 172, w: 594, h: 374, cropY: 180, scale: 0.55 }; // F cropped to y 180-860

/** Map a source rectangle to the canvas. */
export const onLap = (x0: number, y0: number, x1: number, y1: number, pad = 8) => ({
  x: LAP.x + (x0 - LAP.cropX) * LAP.scale - pad,
  y: LAP.y + y0 * LAP.scale - pad,
  w: (x1 - x0) * LAP.scale + 2 * pad,
  h: (y1 - y0) * LAP.scale + 2 * pad,
});
export const onPhone = (x0: number, y0: number, x1: number, y1: number, pad = 6) => ({
  x: PH.x + x0 * PH.scale - pad,
  y: PH.y + y0 * PH.scale - pad,
  w: (x1 - x0) * PH.scale + 2 * pad,
  h: (y1 - y0) * PH.scale + 2 * pad,
});

/** Accent rings: where (canvas px) and when (V seconds). */
export const RINGS = [
  { x: 529, y: 648, w: 148, h: 33, from: T.chipYellow + 0.15, to: 14.3 }, // "Light turned yellow" (measured on a render; the chip sits lower early in the call)
  { ...onPhone(48, 144, 1032, 438), from: T.phoneYellow + 0.15, to: 18.8 }, // phone "Be careful"
  { ...onLap(405, 587, 960, 943), from: T.alert + 0.3, to: 26.4 }, // "Shield alerted the family at 0:16"
  { ...onPhone(51, 219, 1029, 438), from: T.hangup + 0.25, to: 29.8 }, // "You hung up..."
];

export type Cap = { from: number; to: number; heard?: string; text: string };
/** One caption at a time (exact wording from the spec). `heard` = the caller's words after "Callback heard:". */
export const CAPS: Cap[] = [
  { from: T.split, to: T.answer, text: "An unknown number calls Anna. Shield is on." },
  { from: T.answer, to: T.line1, text: "She answers. Callback Shield is listening." },
  { from: T.line1, to: T.line2, heard: "“The fraud team from your bank.”", text: " The light turns yellow." },
  { from: T.line2, to: T.line3, heard: "“Your account is at risk, and someone is trying to take your money.”", text: "" },
  {
    from: T.line3,
    to: T.redCap,
    heard: "“You need to move your savings to a safe account today. Don’t tell anyone, and don’t hang up.”",
    text: "",
  },
  { from: T.redCap, to: T.hangup, text: "Red: a full-screen warning, and the family is alerted. Nobody tapped anything." },
  { from: T.hangup, to: T.still, text: "She hangs up. Next: call the family on a number she knows." },
];

export const LABEL = "Recorded Shield demo call on callback.denishoti.dev · AI voice · simulated scam";
