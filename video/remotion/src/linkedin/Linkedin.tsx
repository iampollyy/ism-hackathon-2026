// LinkedIn founder story, square 1080x1080 at 30 fps.
// Speech clips, captions and AI-voice tags come from timeline.json
// (video/work/linkedin/build_timeline.py builds it from the word timings).

import { Audio } from "@remotion/media";
import { useMemo } from "react";
import {
  AbsoluteFill, Easing, Img, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame,
} from "remotion";
import { Grain, Vignette } from "../Grain";
import { BODY, C, HEAD } from "../timing";
import data from "./timeline.json";

export const FPS = 30;
const s = (sec: number) => Math.round(sec * FPS);
const P = (name: string) => staticFile(`linkedin/${name}`);
const M = data.marks;
export const TOTAL_FRAMES = s(data.total);
const EASE = Easing.bezier(0.22, 1, 0.36, 1);
const EASE_IO = Easing.bezier(0.65, 0, 0.35, 1);

type Clip = { src: string; from: number; to: number; at: number; kind: string };
type Word = { text: string; startMs: number; endMs: number; kind: string; clip: number };
type Tag = { from: number; to: number; kind: string };
const CLIPS = data.audio as Clip[];
const WORDS = data.captions as Word[];
const TAGS = data.tags as Tag[];

/** 0..1 entrance for an element appearing at frame `at` (local frames), eased, no bounce. */
const useIn = (at: number, dur = 14) => {
  const frame = useCurrentFrame();
  return interpolate(frame, [at, at + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
};

// ---------------------------------------------------------------- backgrounds

const Bg: React.FC = () => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(900px 700px at 85% 10%, ${C.navy} 0%, transparent 60%), radial-gradient(800px 700px at 5% 95%, #3a1f5c 0%, transparent 65%), ${C.deep}`,
    }}
  />
);

// ---------------------------------------------------------------- video framing

type Win = { cx: number; cy: number; size: number };
/** Shows a window (centre + width in source pixels) of a video in the square frame; animates between windows. */
const Framed: React.FC<{
  src: string; w: number; h: number; trim: number; keys: { at: number; win: Win }[]; rate?: number;
  blur?: [number, number, number]; // [fromFrame, toFrame, maxBlur]
}> = ({ src, w, h, trim, keys, rate = 1, blur }) => {
  const frame = useCurrentFrame();
  const ats = keys.map((k) => k.at);
  const pick = (f: (k: Win) => number) =>
    keys.length === 1
      ? f(keys[0].win)
      : interpolate(frame, ats, keys.map((k) => f(k.win)), { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_IO });
  // interpolate the zoom in log space so it feels even
  const size = Math.exp(pick((k) => Math.log(k.size)));
  const cx = pick((k) => k.cx);
  const cy = pick((k) => k.cy);
  const scale = 1080 / size;
  const b = blur ? interpolate(frame, [blur[0], blur[1]], [0, blur[2]], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <div
        style={{
          position: "absolute", left: 0, top: 0, width: w, height: h, transformOrigin: "0 0",
          transform: `translate(${540 - cx * scale}px, ${540 - cy * scale}px) scale(${scale})`,
          filter: b > 0 ? `blur(${b / scale}px)` : undefined,
        }}
      >
        <OffthreadVideo src={P(src)} muted trimBefore={s(trim)} playbackRate={rate} style={{ width: w, height: h }} />
      </div>
    </AbsoluteFill>
  );
};

/** A 16:9 shot shown whole: sharp band in the middle, a blurred copy behind it. */
const Band: React.FC<{ src: string; trim: number; zoomTo?: { at: number; dur: number; win: Win } }> = ({ src, trim, zoomTo }) => {
  const frame = useCurrentFrame();
  const t = zoomTo ? interpolate(frame, [zoomTo.at, zoomTo.at + zoomTo.dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE_IO }) : 0;
  const band: Win = { cx: 1280, cy: 720, size: 2560 };
  const win = zoomTo?.win ?? band;
  const size = Math.exp(interpolate(t, [0, 1], [Math.log(band.size), Math.log(win.size)]));
  const cx = interpolate(t, [0, 1], [band.cx, win.cx]);
  const cy = interpolate(t, [0, 1], [band.cy, win.cy]);
  const scale = 1080 / size;
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: C.deep }}>
      <AbsoluteFill style={{ opacity: 1 - t, display: t >= 1 ? "none" : undefined }}>
        <OffthreadVideo
          src={P(src.replace(".mp4", "-small.mp4"))} muted trimBefore={s(trim)}
          style={{ width: 1080, height: 1080, objectFit: "cover", filter: "blur(28px) brightness(0.45) saturate(0.8)", transform: "scale(1.15)" }}
        />
      </AbsoluteFill>
      <div
        style={{
          position: "absolute", left: 0, top: 0, width: 2560, height: 1440, transformOrigin: "0 0",
          transform: `translate(${540 - cx * scale}px, ${540 - cy * scale}px) scale(${scale})`,
          boxShadow: t < 1 ? "0 30px 80px rgba(0,0,0,0.5)" : undefined,
        }}
      >
        <OffthreadVideo src={P(src)} muted trimBefore={s(trim)} style={{ width: 2560, height: 1440 }} />
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- overlays

const Kicker: React.FC<{ text: string; at?: number; tone?: string; top?: number; left?: number }> = ({ text, at = 0, tone = C.pink, top = 56, left = 56 }) => {
  const k = useIn(at);
  return (
    <div
      style={{
        position: "absolute", left, top, display: "flex", alignItems: "center", gap: 12, padding: "10px 20px 11px",
        borderRadius: 999, background: "rgba(20,14,52,0.86)", border: `2px solid ${tone}55`, fontFamily: HEAD, fontWeight: 700,
        fontSize: 26, color: C.onDeep, opacity: k, transform: `translateY(${(1 - k) * -12}px)`, letterSpacing: 0.2,
      }}
    >
      <span style={{ width: 11, height: 11, borderRadius: 6, background: tone, boxShadow: `0 0 14px ${tone}` }} />
      {text}
    </div>
  );
};

const AiTag: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const tag = [...TAGS].reverse().find((x) => t >= x.from && t <= x.to);
  if (!tag) return null;
  const k = Math.min(
    interpolate(t, [tag.from, tag.from + 0.25], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    interpolate(t, [tag.to - 0.25, tag.to], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
  );
  const label = tag.kind === "caller" ? "AI voice · a copy of Polina's voice" : "AI voice";
  return (
    <div
      style={{
        position: "absolute", right: 40, top: 40, display: "flex", alignItems: "center", gap: 10, padding: "8px 16px 9px",
        borderRadius: 999, background: "rgba(10,7,30,0.78)", border: "1.5px solid rgba(216,206,255,0.35)", fontFamily: BODY,
        fontWeight: 600, fontSize: 20, color: C.lavender, opacity: k,
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.pink} strokeWidth="2.4" strokeLinecap="round">
        <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />
      </svg>
      {label}
    </div>
  );
};

/** Word-by-word captions: a few words per page, the spoken word in pink. Eased fade, no bounce. */
const Captions: React.FC<{ hideFrom?: number; hideTo?: number }> = ({ hideFrom = 3.2, hideTo = 7.0 }) => {
  const frame = useCurrentFrame();
  const nowMs = (frame / FPS) * 1000;
  const pages = useMemo(() => {
    const out: Word[][] = [];
    let page: Word[] = [];
    for (const w of WORDS) {
      if (w.startMs / 1000 >= hideFrom && w.startMs / 1000 < hideTo) continue; // the hook line is kinetic type instead
      const prev = page[page.length - 1];
      const chars = page.reduce((n, x) => n + x.text.length + 1, 0);
      const breakHere = prev && (prev.clip !== w.clip || /[.?!]$/.test(prev.text) || w.startMs - prev.endMs > 450 || chars + w.text.length > 34 || page.length >= 6);
      if (breakHere) {
        out.push(page);
        page = [];
      }
      page.push(w);
    }
    if (page.length) out.push(page);
    return out;
  }, [hideFrom, hideTo]);
  const index = pages.findIndex((p, i) => {
    const start = p[0].startMs - 80;
    const next = pages[i + 1];
    const end = Math.min(p[p.length - 1].endMs + 450, next ? next[0].startMs - 80 : Infinity);
    return nowMs >= start && nowMs < end;
  });
  if (index < 0) return null;
  const page = pages[index];
  const k = interpolate(nowMs, [page[0].startMs - 80, page[0].startMs + 120], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
  return (
    <div style={{ position: "absolute", left: 60, right: 60, bottom: 64, display: "flex", justifyContent: "center", opacity: k, transform: `translateY(${(1 - k) * 10}px)` }}>
      <div
        style={{
          padding: "14px 30px 18px", borderRadius: 24, background: "rgba(13,9,38,0.9)", border: "2px solid rgba(242,169,250,0.22)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)", fontFamily: HEAD, fontWeight: 700, fontSize: 50, lineHeight: 1.14,
          letterSpacing: -0.8, textAlign: "center", color: "#fff", maxWidth: 920,
        }}
      >
        {page.map((w, i) => {
          const active = w.startMs <= nowMs && w.endMs + 60 > nowMs;
          return (
            <span key={i} style={{ color: active ? C.pink : "#fff" }}>
              {i > 0 ? " " : ""}
              {w.text}
            </span>
          );
        })}
      </div>
    </div>
  );
};

const LowerThird: React.FC<{ name: string; role: string; from: string; at?: number }> = ({ name, role, from, at = 4 }) => {
  const k = useIn(at, 16);
  return (
    <div
      style={{
        position: "absolute", left: 56, bottom: 200, opacity: k, transform: `translateX(${(1 - k) * -30}px)`,
        padding: "16px 26px 18px", borderRadius: 20, background: "rgba(20,14,52,0.9)", borderLeft: `6px solid ${C.pink}`,
        boxShadow: "0 20px 50px rgba(0,0,0,0.45)",
      }}
    >
      <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 44, color: "#fff", letterSpacing: -0.5 }}>{name}</div>
      <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: 24, color: C.lavender, marginTop: 4 }}>{role}</div>
      <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: 22, color: C.pink, marginTop: 4 }}>{from}</div>
    </div>
  );
};

const Logo: React.FC<{ size?: number; text?: boolean }> = ({ size = 44, text = true }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
    <Img src={staticFile("brand/callback-mark-white.svg")} style={{ width: size, height: size }} />
    {text && <span style={{ fontFamily: HEAD, fontWeight: 700, fontSize: size * 0.82, color: "#fff", letterSpacing: -0.5 }}>Callback</span>}
  </div>
);

// ---------------------------------------------------------------- scenes

/** 0 - 7 s: the red phone and the AI copy of Polina's voice, then the line. */
const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const split = s(3.07);
  const head = useIn(3, 12);
  const headOut = interpolate(frame, [split - 8, split + 4], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const line = WORDS.filter((w) => w.startMs >= 3200 && w.startMs < 7000);
  const nowMs = (frame / FPS) * 1000;
  const dim = interpolate(frame, [split, split + 14], [0, 0.6], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill>
      <Sequence durationInFrames={split}>
        <Framed src="call.mp4" w={1440} h={1440} trim={14.05} keys={[{ at: 0, win: { cx: 720, cy: 700, size: 1440 } }, { at: split, win: { cx: 720, cy: 700, size: 1320 } }]} />
      </Sequence>
      <Sequence from={split}>
        <Framed src="call.mp4" w={1440} h={1440} trim={17.12} rate={0.45} blur={[0, 16, 12]} keys={[{ at: 0, win: { cx: 720, cy: 700, size: 1320 } }, { at: s(3.9), win: { cx: 720, cy: 700, size: 1200 } }]} />
      </Sequence>
      <AbsoluteFill style={{ background: `rgba(16,10,40,${dim})` }} />
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(10,6,30,0.78) 0%, rgba(10,6,30,0) 34%)", opacity: headOut }} />
      <div style={{ position: "absolute", left: 56, top: 104, right: 56, opacity: head * headOut, transform: `translateY(${(1 - head) * 14}px)` }}>
        <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 68, color: "#fff", letterSpacing: -1.5, lineHeight: 1.02 }}>This isn't Polina.</div>
        <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: 30, color: C.lavender, marginTop: 12 }}>It's an AI copy of her voice, and Callback just caught it.</div>
      </div>
      {/* the line, word by word */}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: "0 90px" }}>
        <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 92, lineHeight: 1.04, letterSpacing: -2.5, color: "#fff", textAlign: "center" }}>
          {line.map((w, i) => {
            const k = interpolate(nowMs, [w.startMs - 60, w.startMs + 220], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });
            const pink = /your|voice/i.test(w.text);
            return (
              <span key={i} style={{ display: "inline-block", opacity: k, transform: `translateY(${(1 - k) * 22}px)`, color: pink ? C.pink : "#fff", marginRight: 22 }}>
                {w.text}
              </span>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Stat: React.FC<{ at: number; value: string; text: string; source: string; top: number }> = ({ at, value, text, source, top }) => {
  const k = useIn(at, 18);
  return (
    <div
      style={{
        position: "absolute", left: 56, right: 56, top, padding: "30px 40px 30px", borderRadius: 30,
        background: "linear-gradient(160deg, rgba(53,42,124,0.9), rgba(29,22,71,0.92))", border: "2px solid rgba(216,206,255,0.16)",
        boxShadow: "0 30px 80px rgba(0,0,0,0.4)", opacity: k, transform: `translateY(${(1 - k) * 40}px)`,
      }}
    >
      <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 104, color: C.pink, letterSpacing: -3, lineHeight: 1 }}>{value}</div>
      <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: 32, color: "#fff", marginTop: 14, lineHeight: 1.25 }}>{text}</div>
      <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: 21, color: C.onDeepMuted, marginTop: 14 }}>Source: {source}</div>
    </div>
  );
};

const Problem: React.FC = () => (
  <AbsoluteFill>
    <Bg />
    <Kicker text="The problem" />
    <Stat at={s(0.3)} top={130} value="€20 million" text="lost to phone scammers in Lithuania in one year" source="LRT.lt, 27 February 2026" />
    <Stat at={s(5.4)} top={450} value="$4.88 billion" text="reported lost to scams by people over 60 in the US in 2024" source="FBI Internet Crime Complaint Center (IC3)" />
  </AbsoluteFill>
);

// team-intro.mp4 face positions (2560x1440): Polina 486,691 · Gangbi 1229,717 · Denis 1843,768
const Team: React.FC = () => {
  const frame = useCurrentFrame();
  const gangbi = s(M.gangbi - M.team);
  const polina = s(M.polina - M.team);
  const title = useIn(4, 16);
  const titleOut = interpolate(frame, [s(3.6), s(4.1)], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill>
      <Sequence durationInFrames={gangbi}>
        <Band src="team-intro.mp4" trim={0.4} zoomTo={{ at: s(3.75), dur: s(0.7), win: { cx: 1830, cy: 860, size: 1040 } }} />
        <div style={{ position: "absolute", left: 56, right: 56, top: 70, opacity: title * titleOut, transform: `translateY(${(1 - title) * 14}px)` }}>
          <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: 26, color: C.pink }}>Built in 48 hours at Unfair Weekend, Vilnius</div>
          <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 64, color: "#fff", letterSpacing: -1.5, marginTop: 8 }}>3 countries. 1 app.</div>
        </div>
        <Sequence from={s(4.0)} layout="none">
          <LowerThird name="Denis Hoti" role="Data Science MSc, KU Ingolstadt" from="From Kosovo · back end & voice agents" at={0} />
        </Sequence>
      </Sequence>
      <Sequence from={gangbi} durationInFrames={polina - gangbi}>
        <Framed src="team-intro.mp4" w={2560} h={1440} trim={10.58} keys={[{ at: 0, win: { cx: 1229, cy: 840, size: 1000 } }, { at: s(3.03), win: { cx: 1229, cy: 830, size: 960 } }]} />
        <LowerThird name="Gangbi Park" role="Data Science MSc, KU Ingolstadt" from="From South Korea" at={3} />
      </Sequence>
      <Sequence from={polina}>
        <Framed src="team-intro.mp4" w={2560} h={1440} trim={16.06} keys={[{ at: 0, win: { cx: 540, cy: 820, size: 1000 } }, { at: s(3.1), win: { cx: 540, cy: 810, size: 960 } }]} />
        <LowerThird name="Polina" role="Front-end engineer" from="From Belarus" at={3} />
      </Sequence>
    </AbsoluteFill>
  );
};

/** Polina on camera, then the real call: the phone turns red. */
const HowLine: React.FC = () => {
  const broll = s(M.broll - M.polinaLine + 0.14);
  return (
    <AbsoluteFill>
      <Sequence durationInFrames={broll}>
        <Framed src="team-close.mp4" w={2560} h={1440} trim={0.28} keys={[{ at: 0, win: { cx: 520, cy: 860, size: 1000 } }, { at: broll, win: { cx: 520, cy: 850, size: 960 } }]} />
      </Sequence>
      <Sequence from={broll}>
        <Framed src="call.mp4" w={1440} h={1440} trim={5.84} keys={[{ at: 0, win: { cx: 720, cy: 720, size: 1440 } }, { at: s(3.6), win: { cx: 720, cy: 690, size: 1240 } }]} />
        <Kicker text="A real Callback Shield call" />
      </Sequence>
    </AbsoluteFill>
  );
};

const Chip: React.FC<{ at: number; text: string; tone: string; top: number }> = ({ at, text, tone, top }) => {
  const k = useIn(at, 12);
  return (
    <div
      style={{
        position: "absolute", left: 620, top, display: "flex", alignItems: "center", gap: 14, padding: "16px 24px 18px",
        borderRadius: 18, background: "rgba(13,9,38,0.9)", border: `2px solid ${tone}`, fontFamily: HEAD, fontWeight: 700,
        fontSize: 34, color: "#fff", opacity: k, transform: `translateX(${(1 - k) * 30}px)`, whiteSpace: "nowrap",
      }}
    >
      <span style={{ width: 14, height: 14, borderRadius: 7, background: tone, boxShadow: `0 0 14px ${tone}` }} />
      {text}
    </div>
  );
};

/** The phone recording in a frame, with what Shield heard. */
const PhoneDemo: React.FC = () => {
  const k = useIn(0, 18);
  const at = (t: number) => s(t - M.phone);
  const H = 960;
  const sw = Math.round(((H - 24) * 9) / 16);
  return (
    <AbsoluteFill>
      <Bg />
      <div
        style={{
          position: "absolute", left: 60, top: 60, width: sw + 24, height: H, borderRadius: 66, padding: 12, boxSizing: "border-box",
          background: "linear-gradient(150deg, #4a4a55 0%, #15151b 25%, #0b0b10 60%, #34343d 100%)",
          boxShadow: "0 50px 120px rgba(0,0,0,0.6), inset 0 0 0 2px rgba(255,255,255,0.1)", opacity: k, transform: `translateY(${(1 - k) * 60}px)`,
        }}
      >
        <div style={{ width: sw, height: H - 24, borderRadius: 54, overflow: "hidden", background: "#000" }}>
          <OffthreadVideo src={P("demo-phone-shield.mp4")} muted trimBefore={s(15.6)} style={{ width: sw, height: H - 24, objectFit: "cover" }} />
        </div>
      </div>
      <div style={{ position: "absolute", left: 620, top: 120, fontFamily: BODY, fontWeight: 600, fontSize: 26, color: C.lavender, opacity: useIn(at(36.4), 12) }}>
        What Shield listens for
      </div>
      <Chip at={at(36.55)} top={175} text="Money today" tone={C.danger} />
      <Chip at={at(37.85)} top={265} text="Secrecy" tone={C.danger} />
      <Chip at={at(39.05)} top={355} text="A new number" tone={C.danger} />
      <Chip at={at(41.5)} top={485} text="Red within seconds" tone={C.pink} />
    </AbsoluteFill>
  );
};

/** The family's live view (laptop), then the result's traffic light, then the drills list. */
const Laptop: React.FC = () => {
  const result = s(M.result - M.live);
  const drills = s(M.drills - M.live);
  const pan = s(46.6 - M.live);
  return (
    <AbsoluteFill style={{ background: "#eef0fb" }}>
      <Sequence durationInFrames={result}>
        <Framed src="laptop-live.mp4" w={1920} h={1080} trim={21.0} keys={[{ at: 0, win: { cx: 790, cy: 650, size: 860 } }, { at: pan - 10, win: { cx: 770, cy: 650, size: 840 } }, { at: pan + 20, win: { cx: 1410, cy: 640, size: 880 } }]} />
        <Kicker text="The family's live view" top={40} left={40} tone={C.accent} />
      </Sequence>
      <Sequence from={result} durationInFrames={drills - result}>
        <Framed src="laptop-result.mp4" w={1920} h={1080} trim={4.0} keys={[{ at: 0, win: { cx: 760, cy: 650, size: 860 } }, { at: drills - result, win: { cx: 740, cy: 660, size: 820 } }]} />
        <Kicker text="After the call: the traffic light" top={40} left={40} tone={C.danger} />
      </Sequence>
      <Sequence from={drills}>
        <Framed src="laptop-drills.mp4" w={1920} h={1080} trim={1.0} keys={[{ at: 0, win: { cx: 950, cy: 545, size: 1070 } }, { at: s(5.2), win: { cx: 950, cy: 560, size: 1000 } }]} />
        <Kicker text="Practice calls · with consent" top={40} left={40} tone={C.good} />
      </Sequence>
    </AbsoluteFill>
  );
};

const Row: React.FC<{ at: number; title: string; text: string; top: number; big?: boolean }> = ({ at, title, text, top, big }) => {
  const k = useIn(at, 16);
  return (
    <div
      style={{
        position: "absolute", left: 56, right: 56, top, display: "flex", gap: 28, alignItems: "center", padding: "26px 34px",
        borderRadius: 26, background: "rgba(53,42,124,0.55)", border: "2px solid rgba(216,206,255,0.14)", opacity: k,
        transform: `translateY(${(1 - k) * 30}px)`,
      }}
    >
      <div style={{ width: 180, flexShrink: 0, fontFamily: HEAD, fontWeight: 700, fontSize: 40, color: C.pink }}>{title}</div>
      <div style={{ fontFamily: big ? HEAD : BODY, fontWeight: big ? 700 : 600, fontSize: big ? 64 : 38, color: "#fff", lineHeight: 1.2, letterSpacing: big ? -1.5 : 0 }}>{text}</div>
    </div>
  );
};

const Next: React.FC = () => {
  const at = (t: number) => s(t - M.next);
  return (
    <AbsoluteFill>
      <Bg />
      <Kicker text="Where it goes" />
      <Row at={at(57.7)} top={160} title="Next" text="Callback answers unknown numbers for your parents" />
      <Row at={at(61.15)} top={365} title="Banks" text="pay to protect their customers" />
      <Row at={at(63.75)} top={540} title="Families" text="€4.99 a month" big />
    </AbsoluteFill>
  );
};

const Cta: React.FC<{ at?: number; top?: number }> = ({ at = 0, top = 70 }) => {
  const k = useIn(at, 16);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top, display: "flex", justifyContent: "center", opacity: k, transform: `translateY(${(1 - k) * -14}px)` }}>
      <div style={{ padding: "16px 34px 18px", borderRadius: 999, background: C.pink, fontFamily: HEAD, fontWeight: 700, fontSize: 40, color: C.deep, letterSpacing: -0.5, boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }}>
        Vote for us · link in the comments
      </div>
    </div>
  );
};

const Close: React.FC = () => {
  const base = M.close - 0.25;
  const wide = s(M.closeWide - base);
  const end = s(M.end - base);
  return (
    <AbsoluteFill>
      <Sequence durationInFrames={wide}>
        <Framed src="team-close.mp4" w={2560} h={1440} trim={16.95} keys={[{ at: 0, win: { cx: 1930, cy: 850, size: 1120 } }, { at: wide, win: { cx: 1930, cy: 860, size: 1060 } }]} />
      </Sequence>
      <Sequence from={wide} durationInFrames={end - wide}>
        <Band src="team-close.mp4" trim={22.4} />
        <Cta at={2} />
      </Sequence>
      <Sequence from={end}>
        <EndCard />
      </Sequence>
    </AbsoluteFill>
  );
};

const EndCard: React.FC = () => {
  const k = useIn(0, 18);
  const k2 = useIn(8, 18);
  return (
    <AbsoluteFill>
      <Bg />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", gap: 34, opacity: k, transform: `scale(${0.97 + 0.03 * k})` }}>
        <Logo size={96} />
        <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: 34, color: C.lavender, textAlign: "center", maxWidth: 800, lineHeight: 1.3 }}>
          It guards your family's phone calls.
        </div>
        <div style={{ opacity: k2, padding: "20px 40px 22px", borderRadius: 999, background: C.pink, fontFamily: HEAD, fontWeight: 700, fontSize: 46, color: C.deep, letterSpacing: -0.5 }}>
          Vote for us · link in the comments
        </div>
        <div style={{ opacity: k2, fontFamily: HEAD, fontWeight: 700, fontSize: 38, color: "#fff" }}>callback.denishoti.dev</div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- audio

const SpeechAudio: React.FC = () => (
  <>
    {CLIPS.map((c, i) => {
      const len = s(c.to - c.from);
      return (
        <Sequence key={i} from={s(c.at)} durationInFrames={len} layout="none">
          <Audio
            src={P(c.src)}
            trimBefore={s(c.from)}
            trimAfter={s(c.to)}
            volume={(f) => interpolate(f, [0, 2, len - 3, len], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}
          />
        </Sequence>
      );
    })}
  </>
);

const Sfx: React.FC<{ at: number; src: string; volume: number }> = ({ at, src, volume }) => (
  <Sequence from={s(at)} durationInFrames={s(3)} layout="none">
    <Audio src={P(src)} volume={volume} />
  </Sequence>
);

const Music: React.FC = () => {
  const total = TOTAL_FRAMES;
  return (
    <Audio
      src={P("pitch-bed.mp3")}
      loop
      volume={(f) =>
        interpolate(f, [0, s(1), s(M.end) - 10, s(M.end) + 10, total - s(1.2), total], [0, 0.07, 0.07, 0.16, 0.16, 0], {
          extrapolateLeft: "clamp", extrapolateRight: "clamp",
        })
      }
    />
  );
};

// ---------------------------------------------------------------- the video

export const Linkedin: React.FC = () => {
  const seq = (from: number, to: number) => ({ from: s(from), durationInFrames: s(to) - s(from) });
  return (
    <AbsoluteFill style={{ background: C.deep }}>
      <Sequence {...seq(0, M.problem)}>
        <Hook />
      </Sequence>
      <Sequence {...seq(M.problem, M.team)}>
        <Problem />
      </Sequence>
      <Sequence {...seq(M.team, M.polinaLine - 0.14)}>
        <Team />
      </Sequence>
      <Sequence {...seq(M.polinaLine - 0.14, M.phone)}>
        <HowLine />
      </Sequence>
      <Sequence {...seq(M.phone, M.live)}>
        <PhoneDemo />
      </Sequence>
      <Sequence {...seq(M.live, M.next)}>
        <Laptop />
      </Sequence>
      <Sequence {...seq(M.next, M.close - 0.25)}>
        <Next />
      </Sequence>
      <Sequence {...seq(M.close - 0.25, M.total)}>
        <Close />
      </Sequence>
      <Vignette strength={0.35} />
      <Grain opacity={0.05} />
      <Captions />
      <AiTag />
      <SpeechAudio />
      <Music />
      <Sfx at={M.problem - 0.15} src="whoosh.mp3" volume={0.3} />
      <Sfx at={M.team - 0.15} src="whoosh.mp3" volume={0.25} />
      <Sfx at={34.68} src="alert.mp3" volume={0.22} />
      <Sfx at={M.phone - 0.15} src="whoosh.mp3" volume={0.25} />
      <Sfx at={M.next - 0.15} src="whoosh.mp3" volume={0.25} />
    </AbsoluteFill>
  );
};
