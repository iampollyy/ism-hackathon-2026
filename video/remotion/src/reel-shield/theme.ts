import { Easing, interpolate, staticFile } from "remotion";

export const C = {
  deep: "#1d1647",
  deep2: "#2a2163",
  navy: "#352a7c",
  accent: "#735ac8",
  pink: "#f2a9fa",
  lavender: "#d8ceff",
  danger: "#e0475e",
  green: "#138653",
  ink: "#0d0926",
};
export const HEAD = "Space Grotesk";
export const BODY = "Inter";
export const P = (f: string) => staticFile(`reel-shield/${f}`);

/** Ease-out with no overshoot (no springy bounce on text). */
export const EASE = Easing.bezier(0.16, 1, 0.3, 1);
export const ease = (frame: number, from: number, dur: number) =>
  interpolate(frame, [from, from + dur], [0, 1], { easing: EASE, extrapolateLeft: "clamp", extrapolateRight: "clamp" });

/** Timeline in frames at 30 fps. Every cut sits in a gap between words (see work/reel-shield/build_data.py). */
export const T = {
  // hero: Denis's phone, AI copy of Polina's voice (IMG_2157)
  a: 0, b: 140, c: 295, flip: 247,
  // three beats with Denis's cloned voice
  beat1: 385, beat2: 502, beat3: 550,
  // team
  team1: 600, team2: 647,
  end: 767,
  total: 872,
};
