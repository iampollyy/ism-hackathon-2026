// Reel 3 "Watch Callback catch a scam, live": the edit plan, in seconds of the reel.
// Narration timings come from timeline.json (work/reel-live/build_vo.py).
import timeline from "./timeline.json";

export const FPS = 30;

export const C = {
  deep: "#1d1647",
  deeper: "#120d33",
  navy: "#352a7c",
  accent: "#735ac8",
  pink: "#f2a9fa",
  lavender: "#d8ceff",
  danger: "#e0475e",
  green: "#138653",
  greenBright: "#2fd67f",
  yellow: "#f4b740",
  white: "#ffffff",
};
export const HEAD = "Space Grotesk";
export const BODY = "Inter";

/** A camera on a 1920x1080 screen recording: centre (cx, cy) in source pixels, scale s. */
export type Cam = { cx: number; cy: number; s: number };
/** A glowing box drawn on the recording (source pixels), from `at` seconds into the scene. */
export type Mark = { x: number; y: number; w: number; h: number; at: number; color: string };

export type Scene =
  | { kind: "screen"; from: number; to: number; src: string; srcFrom: number; rate?: number; cam: [Cam, Cam]; label: string; marks?: Mark[]; ease?: "out" }
  | { kind: "phone"; from: number; to: number; src: string; srcFrom: number; label: string; redAt?: number }
  | { kind: "team"; from: number; to: number; src: string; srcFrom: number; label: string; zoom: [number, number]; names?: boolean; fadeOut: number; gain: number }
  | { kind: "end"; from: number; to: number };

export const S = {
  hook: 3.18,
  phone1: 8.75,
  overview: 12.03,
  convo: 18.42,
  red: 21.93,
  phoneRed: 27.2,
  alerted: 31.33,
  after: 33.15,
  traffic: 35.45,
  hungup: 37.6,
  team: 39.26,
  shout: 41.4,
  end: 44.8,
};
export const TOTAL_S = S.end;

export const SCENES: Scene[] = [
  // Hook: the family's live view while Anna's phone rings.
  {
    kind: "screen", from: 0, to: S.hook, src: "laptop-live.mp4", srcFrom: 0,
    cam: [{ cx: 690, cy: 400, s: 1.75 }, { cx: 1010, cy: 560, s: 0.9 }], label: "Live demo · a scam call", ease: "out",
  },
  // Anna's phone: incoming, answered (src 5.65 lands on "picks up"), Shield listening.
  { kind: "phone", from: S.hook, to: S.phone1, src: "demo-phone-shield.mp4", srcFrom: 2.38, label: "Anna's phone" },
  // The family's view: the call card and the Shield listening.
  {
    kind: "screen", from: S.phone1, to: S.overview, src: "laptop-live.mp4", srcFrom: 1.9,
    cam: [{ cx: 960, cy: 540, s: 0.87 }, { cx: 700, cy: 440, s: 1.32 }], label: "The family's live view",
  },
  // Lines appear as they are said; first line lands on "The fraud team...", yellow on "yellow".
  {
    kind: "screen", from: S.overview, to: S.convo, src: "laptop-live.mp4", srcFrom: 4.25, rate: 0.6,
    cam: [{ cx: 1425, cy: 640, s: 1.08 }, { cx: 1310, cy: 740, s: 1.5 }], label: "The family's live view",
    marks: [{ x: 1006, y: 738, w: 196, h: 30, at: (7.35 - 4.25) / 0.6, color: C.yellow }],
  },
  // The pressure line, then red + "Shield alerted the family".
  {
    kind: "screen", from: S.convo, to: S.red, src: "laptop-live.mp4", srcFrom: 17.22, rate: 0.65,
    cam: [{ cx: 1420, cy: 700, s: 1.14 }, { cx: 1405, cy: 760, s: 1.3 }], label: "The family's live view",
    marks: [{ x: 1004, y: 1008, w: 474, h: 36, at: (19.0 - 17.22) / 0.65, color: C.danger }],
  },
  // Anna's phone turns red (src 21.2 lands on "red.").
  { kind: "phone", from: S.red, to: S.phoneRed, src: "demo-phone-shield.mp4", srcFrom: 18.88, label: "Anna's phone", redAt: 24.25 - S.red },
  // The family is alerted.
  {
    kind: "screen", from: S.phoneRed, to: S.alerted, src: "laptop-live.mp4", srcFrom: 18.5,
    cam: [{ cx: 684, cy: 740, s: 1.42 }, { cx: 684, cy: 766, s: 1.62 }], label: "The family's live view",
  },
  // Afterwards: the result page.
  {
    kind: "screen", from: S.alerted, to: S.after, src: "laptop-result.mp4", srcFrom: 0.1,
    cam: [{ cx: 1140, cy: 540, s: 0.9 }, { cx: 1140, cy: 470, s: 1.06 }], label: "Afterwards: how you did",
  },
  {
    kind: "screen", from: S.after, to: S.traffic, src: "laptop-result.mp4", srcFrom: 5.0, rate: 0.6,
    cam: [{ cx: 680, cy: 640, s: 1.55 }, { cx: 690, cy: 630, s: 1.78 }], label: "Afterwards: how you did",
  },
  {
    kind: "screen", from: S.traffic, to: S.hungup, src: "laptop-result.mp4", srcFrom: 0.3,
    cam: [{ cx: 1180, cy: 470, s: 1.45 }, { cx: 1200, cy: 476, s: 1.85 }], label: "Afterwards: how you did",
    marks: [{ x: 1000, y: 430, w: 250, h: 74, at: 0.35, color: C.greenBright }],
  },
  // Who we are: the real team, real voices.
  { kind: "team", from: S.hungup, to: S.team, src: "team-a.mp4", srcFrom: 0.7, label: "Who we are", zoom: [1.0, 1.04], names: true, fadeOut: 0.06, gain: 1.05 },
  { kind: "team", from: S.team, to: S.shout, src: "team-b.mp4", srcFrom: 4.95, label: "Who we are", zoom: [1.04, 1.1], fadeOut: 0.3, gain: 0.68 },
  { kind: "end", from: S.shout, to: S.end },
];

export type Word = { text: string; start: number; end: number; brk?: boolean };
const vo: Word[] = timeline.lines.flatMap((l) => l.words.map((w, i) => ({ ...w, brk: i === l.words.length - 1 })));
// The team's own words (IMG_3589 0.7 s -> reel 37.6 s; IMG_3594 shout).
const teamA: Word[] = [
  { text: "Hi", start: 0.88, end: 1.04 },
  { text: "everyone,", start: 1.14, end: 1.48 },
  { text: "we", start: 1.6, end: 1.68 },
  { text: "are", start: 1.7, end: 1.8 },
  { text: "Plan", start: 1.86, end: 2.08 },
  { text: "C!", start: 2.18, end: 2.3 },
].map((w) => ({ ...w, start: w.start - 0.7 + S.hungup, end: w.end - 0.7 + S.hungup }));
const shout: Word[] = [{ text: "Callbaaaack!", start: 5.36 - 4.95 + S.team, end: 6.34 - 4.95 + S.team }];

export const WORDS: Word[] = [...vo, ...teamA, ...shout];

/** When Gangbi's AI voice is speaking: [from, to] in seconds. */
export const AI_VOICE: [number, number][] = [
  [0, timeline.voEnd + 0.1],
  [S.shout + 0.2, S.shout + 2.6],
];
export const V11_AT = S.shout + 0.2;
export const VO_END = timeline.voEnd;
