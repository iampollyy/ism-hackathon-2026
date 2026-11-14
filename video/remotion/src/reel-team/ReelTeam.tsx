// Reel 2, "We cloned our own voices" (1080x1920, 30 fps).
// Cloned voices over a freeze frame > hard stop and reveal > the real team >
// an AI copy of Polina's voice calling Denis, caught by Callback > the real
// "Callbaaaack!" > vote card. Assets: public/reel-team/ (work/reel-team/transcode.sh);
// word timings: captions.json (work/reel-team/gen_captions.py).

import { Audio } from "@remotion/media";
import { useMemo } from "react";
import {
  AbsoluteFill, Easing, Img, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame,
} from "remotion";
import { Grain, Vignette } from "../Grain";
import CAP from "./captions.json";

const FPS = 30;
const f = (s: number) => Math.round(s * FPS);
const A = (name: string) => staticFile(`reel-team/${name}`);

const K = {
  deep: "#1d1647",
  navy: "#352a7c",
  accent: "#735ac8",
  pink: "#f2a9fa",
  lavender: "#d8ceff",
  danger: "#e0475e",
  green: "#138653",
  greenLight: "#4fe39a",
  ink: "rgba(13, 9, 38, 0.9)",
};
const HEAD = "Space Grotesk";
const BODY = "Inter";
const OUT = Easing.out(Easing.cubic);
const IN_OUT = Easing.inOut(Easing.cubic);

const ramp = (frame: number, a: number, b: number, from = 0, to = 1, easing = OUT) =>
  interpolate(frame, [a, b], [from, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing });

type Word = { text: string; start: number; end: number };
const WORDS = CAP as unknown as Record<string, Word[]>;

// ------------------------------------------------------------------ timeline (seconds)
const T = {
  polina: 0.3,
  gangbi: 2.3,
  denis: 3.7,
  stop: 7.0,
  realA: 10.4,
  realB: 15.2,
  realC: 16.64,
  hero: 17.81,
  shield: 23.06,
  live: 24.81,
  finale: 26.61,
  end: 33.46,
  total: 36.46,
};
const HERO_RED = 21.46; // the phone screen turns red (IMG_2157 at about 27.5 s)
export const TOTAL_FRAMES = f(T.total);

// ------------------------------------------------------------------ small pieces

const Bars: React.FC<{ color: string; active: boolean }> = ({ color, active }) => {
  const frame = useCurrentFrame();
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 26 }}>
      {[0, 1, 2, 3].map((i) => {
        const h = active ? 8 + Math.abs(Math.sin(frame / 3.2 + i * 1.3)) * 18 : 8;
        return <span key={i} style={{ width: 5, height: h, borderRadius: 3, background: color }} />;
      })}
    </span>
  );
};

const Tag: React.FC<{ kind: "ai" | "real"; active?: boolean; label?: string }> = ({ kind, active = true, label }) => {
  const color = kind === "ai" ? K.pink : K.greenLight;
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 12,
        padding: "9px 20px 9px 16px",
        borderRadius: 999,
        background: kind === "ai" ? "rgba(242,169,250,0.16)" : "rgba(79,227,154,0.14)",
        border: `2.5px solid ${color}`,
        color,
        fontFamily: HEAD,
        fontWeight: 700,
        fontSize: 30,
        letterSpacing: 2,
        backdropFilter: "blur(10px)",
        boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
      }}
    >
      <Bars color={color} active={active} />
      {label ?? (kind === "ai" ? "AI VOICE" : "REAL VOICE")}
    </div>
  );
};

/** Name plus voice tag, sliding in from the left (eased, no bounce). */
const SpeakerLabel: React.FC<{ name: string; kind: "ai" | "real"; top: number; tagLabel?: string; nameSize?: number }> = ({
  name, kind, top, tagLabel, nameSize = 64,
}) => {
  const frame = useCurrentFrame();
  const enter = ramp(frame, 0, 9);
  return (
    <div
      style={{
        position: "absolute",
        left: 60,
        right: 60,
        top,
        display: "flex",
        alignItems: "center",
        gap: 22,
        opacity: enter,
        transform: `translateX(${(1 - enter) * -40}px)`,
      }}
    >
      <div
        style={{
          fontFamily: HEAD,
          fontWeight: 700,
          fontSize: nameSize,
          color: "#fff",
          letterSpacing: -1.5,
          textShadow: "0 4px 24px rgba(0,0,0,0.6)",
        }}
      >
        {name}
      </div>
      <Tag kind={kind} label={tagLabel} />
    </div>
  );
};

/** A chip in the safe area at the top (below the platform's top 12%). */
const TopChip: React.FC<{ children: React.ReactNode; dot?: string; top?: number }> = ({ children, dot = K.greenLight, top = 250 }) => {
  const frame = useCurrentFrame();
  const enter = ramp(frame, 0, 10);
  return (
    <div style={{ position: "absolute", top, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "14px 30px",
          borderRadius: 999,
          background: "rgba(29,22,71,0.86)",
          border: "2px solid rgba(216,206,255,0.28)",
          fontFamily: HEAD,
          fontWeight: 700,
          fontSize: 40,
          color: "#fff",
          letterSpacing: -0.5,
          boxShadow: "0 16px 40px rgba(0,0,0,0.4)",
          opacity: enter,
          transform: `translateY(${(1 - enter) * -16}px)`,
          textAlign: "center",
        }}
      >
        <span style={{ width: 16, height: 16, borderRadius: 8, background: dot, boxShadow: `0 0 16px ${dot}`, flexShrink: 0 }} />
        <span>{children}</span>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ captions (word by word, eased)

const CaptionTrack: React.FC<{ words: Word[]; at: number; until: number; top?: number; size?: number; breakAfter?: number[] }> = ({
  words, at, until, top = 1300, size = 74, breakAfter = [],
}) => {
  // Pages break after a comma or sentence end (once a page has 2 words), after the words in breakAfter, or at 40 characters.
  const pages = useMemo(() => {
    type Tok = { text: string; fromMs: number; toMs: number };
    const out: { startMs: number; endMs: number; tokens: Tok[] }[] = [];
    let cur: Tok[] = [];
    const flush = () => {
      if (cur.length) out.push({ startMs: cur[0].fromMs, endMs: cur[cur.length - 1].toMs, tokens: cur });
      cur = [];
    };
    words.forEach((w, i) => {
      const chars = cur.map((t) => t.text).join("").length + w.text.length;
      if (cur.length > 0 && chars > 40) flush();
      cur.push({ text: (cur.length ? " " : "") + w.text, fromMs: (at + w.start) * 1000, toMs: (at + w.end) * 1000 });
      if (/[.?!]$/.test(w.text) || (/,$/.test(w.text) && cur.length >= 2) || breakAfter.includes(i)) flush();
    });
    flush();
    return out;
  }, [words, at, breakAfter]);
  return (
    <>
      {pages.map((page, index) => {
        const next = pages[index + 1];
        const from = f(page.startMs / 1000);
        const endMs = Math.min(next ? next.startMs : page.endMs + 700, until * 1000);
        const to = Math.max(from + 1, f(endMs / 1000));
        return (
          <Sequence key={index} from={from} durationInFrames={to - from} layout="none">
            <CaptionPage tokens={page.tokens} startMs={page.startMs} top={top} size={size} />
          </Sequence>
        );
      })}
    </>
  );
};

const CaptionPage: React.FC<{ tokens: { text: string; fromMs: number; toMs: number }[]; startMs: number; top: number; size: number }> = ({
  tokens, startMs, top, size,
}) => {
  const frame = useCurrentFrame();
  const nowMs = startMs + (frame / FPS) * 1000;
  const enter = ramp(frame, 0, 5);
  return (
    <div
      style={{
        position: "absolute",
        top,
        left: 60,
        right: 60,
        display: "flex",
        justifyContent: "center",
        opacity: enter,
        transform: `translateY(${(1 - enter) * 14}px)`,
      }}
    >
      <div
        style={{
          padding: "18px 36px 22px",
          borderRadius: 30,
          background: K.ink,
          border: "2px solid rgba(242,169,250,0.28)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
          fontFamily: HEAD,
          fontWeight: 700,
          fontSize: size,
          lineHeight: 1.12,
          letterSpacing: -1.2,
          textAlign: "center",
          color: "#fff",
          whiteSpace: "pre-wrap",
        }}
      >
        {tokens.map((token) => {
          const spoken = token.fromMs <= nowMs;
          const active = spoken && token.toMs + 120 > nowMs;
          return (
            <span key={token.fromMs} style={{ color: active ? K.pink : spoken ? "#fff" : "rgba(255,255,255,0.55)" }}>
              {token.text}
            </span>
          );
        })}
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ 1. the cloned voices over a freeze frame

// team-still.jpg is 3840x2160, shown at 0.75 (2880x1620). Camera positions put each face in the upper middle.
const CAM = {
  polina: { x: 0, y: -65 },
  gangbi: { x: -855, y: -110 },
  denis: { x: -1350, y: -300 },
};

const CloneScene: React.FC = () => {
  const frame = useCurrentFrame();
  const keys = [0, f(1.85), f(2.3), f(3.25), f(3.7), f(T.stop)];
  const xs = [CAM.polina.x, CAM.polina.x, CAM.gangbi.x, CAM.gangbi.x, CAM.denis.x, CAM.denis.x];
  const ys = [CAM.polina.y, CAM.polina.y, CAM.gangbi.y, CAM.gangbi.y, CAM.denis.y, CAM.denis.y];
  const opts = { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: IN_OUT } as const;
  const x = interpolate(frame, keys, xs, opts);
  const y = interpolate(frame, keys, ys, opts);
  const push = interpolate(frame, [0, f(T.stop)], [1.0, 1.05], { extrapolateRight: "clamp" });
  // the hard stop: desaturate, darken, a few frames of jitter
  const stopF = f(T.stop);
  const stopped = ramp(frame, stopF, stopF + 5);
  const jitter = frame >= stopF && frame < stopF + 5 ? (frame % 2 === 0 ? 14 : -10) : 0;
  return (
    <AbsoluteFill style={{ background: K.deep }}>
      <AbsoluteFill
        style={{
          transform: `translateX(${jitter}px) scale(${push})`,
          transformOrigin: "540px 650px",
          filter: `grayscale(${stopped}) brightness(${1 - stopped * 0.62}) blur(${stopped * 5}px)`,
        }}
      >
        <Img
          src={A("team-still.jpg")}
          style={{ position: "absolute", left: 0, top: 0, width: 2880, height: 1620, transform: `translate(${x}px, ${y}px)` }}
        />
      </AbsoluteFill>
      {/* the picture fades into deep indigo behind the captions */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 880,
          bottom: 0,
          background: `linear-gradient(180deg, rgba(29,22,71,0) 0%, rgba(29,22,71,0.85) 32%, ${K.deep} 48%)`,
        }}
      />
      {jitter !== 0 && <AbsoluteFill style={{ background: "rgba(242,169,250,0.18)", mixBlendMode: "screen" }} />}
    </AbsoluteFill>
  );
};

const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const a = ramp(frame, -8, 6);
  const b = ramp(frame, -4, 8);
  const out = 1 - ramp(frame, f(1.7), f(1.95));
  return (
    <div style={{ position: "absolute", top: 248, left: 0, right: 0, textAlign: "center", opacity: out }}>
      <div
        style={{
          fontFamily: HEAD,
          fontWeight: 700,
          fontSize: 92,
          letterSpacing: -2.5,
          color: "#fff",
          lineHeight: 1,
          textShadow: "0 6px 30px rgba(0,0,0,0.65)",
          opacity: a,
          transform: `translateY(${(1 - a) * 30}px)`,
        }}
      >
        Meet the team
      </div>
      <div
        style={{
          marginTop: 14,
          fontFamily: HEAD,
          fontWeight: 700,
          fontSize: 50,
          color: K.lavender,
          textShadow: "0 4px 24px rgba(0,0,0,0.7)",
          opacity: b,
          transform: `translateY(${(1 - b) * 24}px)`,
        }}
      >
        behind Callback
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ 2. the reveal

const RevealWords: React.FC<{ text: string; start: number; size: number; color?: string; accentFrom?: number }> = ({
  text, start, size, color = "#fff", accentFrom = 99,
}) => {
  const frame = useCurrentFrame();
  // "|" forces a line break; words still count on across lines for the stagger and the accent
  const words = text.split(" ");
  return (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", columnGap: size * 0.26 }}>
      {words.map((raw, i) => {
        const p = ramp(frame, start + i * 2, start + i * 2 + 7);
        const word = raw.replace("|", "");
        if (raw === "|") return <div key={i} style={{ flexBasis: "100%", height: 0 }} />;
        return (
          <span
            key={i}
            style={{
              fontFamily: HEAD,
              fontWeight: 700,
              fontSize: size,
              lineHeight: 1.05,
              letterSpacing: -2.5,
              color: i >= accentFrom ? K.pink : color,
              opacity: p,
              transform: `translateY(${(1 - p) * 28}px)`,
              display: "inline-block",
            }}
          >
            {word}
          </span>
        );
      })}
    </div>
  );
};

const Reveal: React.FC = () => {
  const frame = useCurrentFrame();
  const out = 1 - ramp(frame, f(3.2), f(3.4));
  const chip = ramp(frame, 2, 9);
  return (
    <AbsoluteFill style={{ opacity: out }}>
      <div style={{ position: "absolute", top: 560, left: 70, right: 70, textAlign: "center" }}>
        <div
          style={{
            display: "inline-block",
            padding: "10px 26px",
            borderRadius: 999,
            border: `2px solid ${K.pink}`,
            color: K.pink,
            fontFamily: HEAD,
            fontWeight: 700,
            fontSize: 34,
            letterSpacing: 3,
            opacity: chip,
            marginBottom: 40,
          }}
        >
          PLOT TWIST
        </div>
        <RevealWords text="None of that | was us talking." start={f(0.25)} size={116} />
        <div style={{ height: 70 }} />
        <RevealWords text="Our voices were | copied in minutes." start={f(1.45)} size={84} accentFrom={4} />
      </div>
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------ 3. real footage in a wide card over a blurred fill

const CARD = { x: 28, y: 380, w: 1024, h: 608 };

const WideCard: React.FC<{
  src: string;
  trimIn: number; // seconds into the file
  focus: { x: number; y: number }; // in card pixels at zoom 1
  zoom: [number, number];
  frames: number;
}> = ({ src, trimIn, focus, zoom, frames }) => {
  const frame = useCurrentFrame();
  const z = interpolate(frame, [0, frames], zoom, { extrapolateRight: "clamp" });
  const tx = Math.min(0, Math.max(CARD.w - CARD.w * z, CARD.w / 2 - focus.x * z));
  const ty = Math.min(0, Math.max(CARD.h - CARD.h * z, CARD.h / 2 - focus.y * z));
  return (
    <AbsoluteFill style={{ background: K.deep }}>
      <AbsoluteFill style={{ filter: "blur(38px) brightness(0.42) saturate(1.2)", transform: "scale(1.25)" }}>
        <OffthreadVideo
          src={A(src)}
          muted
          trimBefore={f(trimIn)}
          style={{ position: "absolute", height: 1920, width: 3236, left: -1078, top: 0 }}
        />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(29,22,71,0.35), rgba(29,22,71,0.75))" }} />
      <div
        style={{
          position: "absolute",
          left: CARD.x,
          top: CARD.y,
          width: CARD.w,
          height: CARD.h,
          borderRadius: 34,
          overflow: "hidden",
          boxShadow: "0 40px 100px rgba(0,0,0,0.6)",
          border: "2px solid rgba(216,206,255,0.22)",
        }}
      >
        <OffthreadVideo
          src={A(src)}
          muted
          trimBefore={f(trimIn)}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: CARD.w,
            height: CARD.h,
            transform: `translate(${tx}px, ${ty}px) scale(${z})`,
            transformOrigin: "0 0",
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

// card-pixel focus points (3640-wide crop of 4K, shown 1024 wide)
const FACE = {
  denis: { x: 690, y: 370 },
  gangbi: { x: 495, y: 300 },
  polina: { x: 172, y: 282 },
  team: { x: 512, y: 300 },
};

// ------------------------------------------------------------------ 4. the test call and the app

const Hero: React.FC = () => {
  const frame = useCurrentFrame();
  const zoom = interpolate(frame, [0, f(5.25)], [1.0, 1.07]);
  const redAt = f(HERO_RED - T.hero);
  const caught = ramp(frame, redAt + 3, redAt + 11);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <AbsoluteFill style={{ transform: `scale(${zoom})`, transformOrigin: "540px 760px" }}>
        <OffthreadVideo src={A("hero.mp4")} muted trimBefore={f(0.1)} style={{ width: 1080, height: 1920 }} />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(13,9,38,0.55) 0%, rgba(13,9,38,0) 22%, rgba(13,9,38,0) 55%, rgba(13,9,38,0.8) 72%, rgba(13,9,38,0.92) 100%)",
        }}
      />
      <TopChip dot={K.pink}>Test call: an AI copy of Polina</TopChip>
      <SpeakerLabel name="Polina" kind="ai" top={1150} />
      {frame >= redAt + 3 && (
        <div style={{ position: "absolute", top: 1020, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
          <div
            style={{
              padding: "14px 34px",
              borderRadius: 22,
              background: K.danger,
              color: "#fff",
              fontFamily: HEAD,
              fontWeight: 700,
              fontSize: 52,
              letterSpacing: -1,
              boxShadow: "0 20px 60px rgba(224,71,94,0.55)",
              opacity: caught,
              transform: `scale(${0.92 + 0.08 * caught})`,
            }}
          >
            Callback caught it
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};

const PhoneShot: React.FC = () => {
  const frame = useCurrentFrame();
  const enter = ramp(frame, 0, 10);
  const W = 600;
  const H = Math.round((W * 1920) / 1080);
  const zoom = interpolate(frame, [0, f(1.75)], [1.0, 1.04]);
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(900px 900px at 50% 35%, #5a1f3d 0%, transparent 70%), ${K.deep}`,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: (1080 - W - 28) / 2,
          top: 175,
          width: W + 28,
          height: H + 28,
          padding: 14,
          borderRadius: 78,
          background: "linear-gradient(145deg, #3b3550, #15121f)",
          boxShadow: "0 60px 140px rgba(0,0,0,0.7), 0 0 120px rgba(224,71,94,0.35), inset 0 0 0 2px rgba(255,255,255,0.08)",
          transform: `translateY(${(1 - enter) * 60}px) scale(${zoom})`,
          opacity: enter,
        }}
      >
        <div style={{ width: W, height: H, borderRadius: 64, overflow: "hidden", background: "#000" }}>
          <OffthreadVideo src={A("shield.mp4")} muted trimBefore={f(0.5)} style={{ width: W, height: H }} />
        </div>
      </div>
    </AbsoluteFill>
  );
};

// laptop-live.mp4 crop around the purple "Shield alerted the family" card
const LIVE_CROP = { x: 398, y: 585, w: 590, h: 372 };
const LiveShot: React.FC = () => {
  const frame = useCurrentFrame();
  const enter = ramp(frame, 0, 10);
  const W = 1000;
  const s = W / LIVE_CROP.w;
  const H = Math.round(LIVE_CROP.h * s);
  const zoom = interpolate(frame, [0, f(1.8)], [1.0, 1.04]);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(900px 900px at 50% 40%, ${K.navy} 0%, transparent 70%), ${K.deep}` }}>
      <div style={{ position: "absolute", top: 262, left: 60, right: 60, textAlign: "center", opacity: enter }}>
        <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 58, color: "#fff", letterSpacing: -1.5, lineHeight: 1.08 }}>
          The family is told
          <br />
          <span style={{ color: K.pink }}>automatically</span>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: (1080 - W) / 2,
          top: 470,
          width: W,
          height: H,
          borderRadius: 34,
          overflow: "hidden",
          boxShadow: "0 50px 120px rgba(0,0,0,0.6)",
          border: "2px solid rgba(216,206,255,0.25)",
          transform: `translateY(${(1 - enter) * 50}px) scale(${zoom})`,
          opacity: enter,
        }}
      >
        <OffthreadVideo
          src={A("live.mp4")}
          muted
          trimBefore={f(24.0)}
          style={{
            position: "absolute",
            width: 1920 * s,
            height: 1080 * s,
            left: -LIVE_CROP.x * s,
            top: -LIVE_CROP.y * s,
            maxWidth: "none",
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------ 5. end card

const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const a = ramp(frame, 0, 10);
  const b = ramp(frame, 5, 15);
  const c = ramp(frame, 10, 20);
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(1000px 900px at 80% 10%, ${K.navy} 0%, transparent 60%), radial-gradient(900px 800px at 10% 95%, #3a1f5c 0%, transparent 65%), ${K.deep}`,
        alignItems: "center",
      }}
    >
      <Img
        src={A("callback-app-icon-512.png")}
        style={{
          position: "absolute",
          top: 470,
          left: 540 - 110,
          width: 220,
          height: 220,
          borderRadius: 52,
          boxShadow: "0 30px 80px rgba(115,90,200,0.55)",
          opacity: a,
          transform: `translateY(${(1 - a) * 30}px)`,
        }}
      />
      <div style={{ position: "absolute", top: 760, left: 40, right: 40, textAlign: "center", opacity: b, transform: `translateY(${(1 - b) * 30}px)` }}>
        <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 116, letterSpacing: -3.5, color: "#fff", lineHeight: 1 }}>Vote for</div>
        <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 116, letterSpacing: -3.5, color: K.pink, lineHeight: 1.05 }}>Callback</div>
      </div>
      <div style={{ position: "absolute", top: 1035, left: 0, right: 0, display: "flex", justifyContent: "center", opacity: c }}>
        <div
          style={{
            padding: "16px 38px",
            borderRadius: 999,
            background: "#fff",
            color: K.deep,
            fontFamily: HEAD,
            fontWeight: 700,
            fontSize: 46,
            letterSpacing: -0.5,
          }}
        >
          link in bio
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          top: 1180,
          left: 40,
          right: 40,
          textAlign: "center",
          fontFamily: BODY,
          fontWeight: 600,
          fontSize: 34,
          color: K.lavender,
          lineHeight: 1.5,
          opacity: c,
        }}
      >
        callback.denishoti.dev
        <br />
        <span style={{ color: "rgba(216,206,255,0.7)", fontSize: 30 }}>Built in 48 hours at Unfair Weekend, Vilnius</span>
      </div>
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------ the reel

const At: React.FC<{ from: number; to: number; children: React.ReactNode }> = ({ from, to, children }) => (
  <Sequence from={f(from)} durationInFrames={f(to) - f(from)}>
    {children}
  </Sequence>
);

export const ReelTeam: React.FC = () => {
  const musicTail = (frame: number) => {
    // frame is relative to the second music sequence (starts at T.realA)
    const endStart = f(T.end - T.realA);
    const last = f(T.total - T.realA);
    const fadeIn = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: "clamp" });
    const lift = interpolate(frame, [endStart - 6, endStart + 6], [0.1, 0.38], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    const fadeOut = interpolate(frame, [last - 24, last], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return fadeIn * lift * fadeOut;
  };
  return (
    <AbsoluteFill style={{ background: K.deep }}>
      {/* 1-2. cloned voices, the hard stop and the reveal */}
      <At from={0} to={T.realA}>
        <CloneScene />
      </At>
      <At from={0} to={1.95}>
        <Hook />
      </At>
      <At from={0.25} to={1.95}>
        <SpeakerLabel name="Polina" kind="ai" top={1150} />
      </At>
      <At from={2.25} to={3.3}>
        <SpeakerLabel name="Gangbi" kind="ai" top={1150} />
      </At>
      <At from={3.65} to={T.stop}>
        <SpeakerLabel name="Denis" kind="ai" top={1150} />
      </At>
      <CaptionTrack words={WORDS.polina} at={T.polina} until={1.95} />
      <CaptionTrack words={WORDS.gangbi} at={T.gangbi} until={3.3} />
      <CaptionTrack words={WORDS.denis} at={T.denis} until={T.stop} />
      <At from={T.stop} to={T.realA}>
        <Reveal />
      </At>

      {/* 3. the real team */}
      <At from={T.realA} to={T.realB}>
        <WideCard src="real.mp4" trimIn={0.1} focus={FACE.denis} zoom={[1.0, 1.12]} frames={f(T.realB - T.realA)} />
        <SpeakerLabel name="Denis" kind="real" top={1048} />
      </At>
      <At from={T.realB} to={T.realC}>
        <WideCard src="real.mp4" trimIn={10.38} focus={FACE.gangbi} zoom={[1.7, 1.78]} frames={f(T.realC - T.realB)} />
        <SpeakerLabel name="Gangbi" kind="real" top={1048} />
      </At>
      <At from={T.realC} to={T.hero}>
        <WideCard src="real.mp4" trimIn={15.85} focus={FACE.polina} zoom={[1.7, 1.78]} frames={f(T.hero - T.realC)} />
        <SpeakerLabel name="Polina" kind="real" top={1048} />
      </At>
      <At from={T.realA} to={T.hero}>
        <TopChip>The real us</TopChip>
      </At>
      <CaptionTrack words={WORDS.realA} at={T.realA} until={T.realB} />
      <CaptionTrack words={WORDS.realB} at={T.realB} until={T.realC} />
      <CaptionTrack words={WORDS.realC} at={T.realC} until={T.hero} />

      {/* 4. an AI copy of Polina calls Denis; Callback catches it */}
      <At from={T.hero} to={T.shield}>
        <Hero />
      </At>
      <CaptionTrack words={WORDS.hero} at={T.hero} until={T.shield} />
      <At from={T.shield} to={T.live}>
        <PhoneShot />
      </At>
      <At from={T.live} to={T.finale}>
        <LiveShot />
      </At>
      <CaptionTrack words={WORDS.vo1} at={23.1 - 0.0} until={24.76} />
      <CaptionTrack words={WORDS.vo2} at={24.76} until={T.finale} />

      {/* 5. the real "Callbaaaack!" */}
      <At from={T.finale} to={T.end}>
        <WideCard src="finale.mp4" trimIn={0.15} focus={FACE.team} zoom={[1.0, 1.1]} frames={f(T.end - T.finale)} />
        <TopChip>The real us</TopChip>
        <SpeakerLabel name="Plan C" kind="real" tagLabel="REAL VOICES" top={1048} />
      </At>
      <CaptionTrack words={WORDS.finale} at={T.finale} until={T.end} breakAfter={[4]} />

      {/* 6. vote */}
      <At from={T.end} to={T.total}>
        <EndCard />
      </At>

      <Vignette strength={0.35} />
      <Grain opacity={0.05} />

      {/* ---------------- sound */}
      <At from={0} to={T.stop}>
        <Audio src={A("music.mp3")} volume={0.12} />
      </At>
      <At from={T.realA} to={T.total}>
        <Audio src={A("music.mp3")} trimBefore={f(T.stop)} volume={musicTail} />
      </At>
      {/* every speech part is levelled to -18 LUFS (work/reel-team/level_audio.py) */}
      {(
        [
          ["a-polina.wav", T.polina, T.polina + 1.7],
          ["a-gangbi.wav", T.gangbi, T.gangbi + 1.0],
          ["a-denis.wav", T.denis, T.denis + 3.25],
          ["a-realA.wav", T.realA, T.realB],
          ["a-realB.wav", T.realB, T.realC],
          ["a-realC.wav", T.realC, T.hero],
          ["a-hero.wav", T.hero, T.shield],
          ["a-vo1.wav", 23.1, 24.7],
          ["a-vo2.wav", 24.76, 26.45],
          ["a-finale1.wav", T.finale, T.finale + 4.65],
          ["a-finale2.wav", T.finale + 4.65, T.end],
        ] as const
      ).map(([file, from, to]) => (
        <At key={file} from={from} to={to}>
          <Audio src={A(file)} />
        </At>
      ))}
      <At from={0} to={1.5}>
        <Audio src={A("whoosh.mp3")} volume={0.3} />
      </At>
      <At from={1.8} to={3.0}>
        <Audio src={A("whoosh.mp3")} volume={0.1} />
      </At>
      <At from={3.2} to={4.4}>
        <Audio src={A("whoosh.mp3")} volume={0.1} />
      </At>
      <At from={T.stop} to={T.stop + 2}>
        <Audio src={A("call-ended.mp3")} volume={0.16} />
      </At>
      <At from={T.realA - 0.15} to={T.realA + 1.2}>
        <Audio src={A("whoosh.mp3")} volume={0.22} />
      </At>
      <At from={HERO_RED} to={HERO_RED + 2}>
        <Audio src={A("alert.mp3")} volume={0.2} />
      </At>
      <At from={T.end - 0.1} to={T.end + 1.2}>
        <Audio src={A("whoosh.mp3")} volume={0.22} />
      </At>
    </AbsoluteFill>
  );
};
