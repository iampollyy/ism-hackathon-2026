// "Is this Denis?": the hero reel for the vote campaign. A video message from
// Denis asks for money; it is an AI copy of his face (HeyGen) and voice
// (ElevenLabs). Then the real Denis, and Callback catching the same kind of
// call on a real phone. 1080x1920, 30 fps.

import { type Caption } from "@remotion/captions";
import { Audio } from "@remotion/media";
import { useMemo } from "react";
import {
  AbsoluteFill, Easing, Img, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig,
} from "remotion";
import { Grain, Vignette } from "../Grain";
import "../fonts";
import caps from "./caps.json";

export const FPS = 30;
const S = (seconds: number) => Math.round(seconds * FPS);
export const TOTAL = S(38.3);

const C = {
  deep: "#1d1647", navy: "#352a7c", pink: "#f2a9fa", lavender: "#d8ceff", danger: "#e0475e", white: "#ffffff",
  muted: "#b9b2e0",
};
const HEAD = "Space Grotesk, sans-serif";
const BODY = "Inter, sans-serif";
const f = (name: string) => staticFile(`hero/${name}`);

const ease = (frame: number, from: number, dur = 12) =>
  interpolate(frame, [from, from + dur], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic),
  });

// ---------------------------------------------------------------- pieces

const Pill: React.FC<{ children: React.ReactNode; top: number; right?: number; left?: number; tone?: "quiet" | "voice" }> = ({
  children, top, right, left, tone = "voice",
}) => (
  <div
    style={{
      position: "absolute", top, right, left, padding: tone === "quiet" ? "6px 14px" : "10px 22px", borderRadius: 999,
      background: tone === "quiet" ? "rgba(0,0,0,0.28)" : "rgba(29,22,71,0.78)",
      border: `1.5px solid ${tone === "quiet" ? "rgba(255,255,255,0.25)" : "rgba(242,169,250,0.55)"}`,
      color: tone === "quiet" ? "rgba(255,255,255,0.75)" : C.pink, fontFamily: BODY, fontWeight: 600,
      fontSize: tone === "quiet" ? 24 : 30, letterSpacing: 1,
    }}
  >
    {children}
  </div>
);

const Line: React.FC<{ text: string; at: number; size?: number; color?: string; top: number }> = ({
  text, at, size = 96, color = C.white, top,
}) => {
  const frame = useCurrentFrame();
  const a = ease(frame, at, 14);
  return (
    <div
      style={{
        position: "absolute", left: 80, right: 80, top, textAlign: "center", fontFamily: HEAD, fontWeight: 700,
        fontSize: size, lineHeight: 1.06, letterSpacing: -2, color, opacity: a,
        transform: `translateY(${(1 - a) * 28}px)`, textShadow: "0 10px 40px rgba(0,0,0,0.55)",
      }}
    >
      {text}
    </div>
  );
};

/** Word-by-word captions: eased in, the spoken word in pink, clear of the top 12% and bottom 22%. */
const Captions: React.FC<{ top?: number }> = ({ top = 1330 }) => {
  const { fps } = useVideoConfig();
  const pages = useMemo(() => paginate(caps as Caption[]), []);
  return (
    <AbsoluteFill>
      {pages.map((page, index) => {
        const next = pages[index + 1];
        const from = Math.round((page.startMs / 1000) * fps);
        const lastEnd = page.tokens[page.tokens.length - 1].toMs;
        const untilMs = Math.min(next ? next.startMs : 1e9, lastEnd + 500, nextCut(page.startMs));
        const until = Math.round((untilMs / 1000) * fps);
        return (
          <Sequence key={index} from={from} durationInFrames={Math.max(1, until - from)} layout="none">
            <CaptionPage page={page} top={top} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

type Page = { startMs: number; tokens: { text: string; fromMs: number; toMs: number }[] };

const CUTS_MS = [3000, 13200, 17600, 20000, 27000, 33800, 38300];
const nextCut = (ms: number) => CUTS_MS.find((c) => c > ms + 1) ?? 1e9;

/** Pages of up to 3 words / 18 characters, broken at any pause over 0.45 s. */
function paginate(words: Caption[]): Page[] {
  const pages: Page[] = [];
  let cur: Page | null = null;
  let curSpeaker: string | undefined;
  for (const w of words) {
    const token = { text: w.text, fromMs: w.startMs, toMs: w.endMs };
    const last = cur?.tokens[cur.tokens.length - 1];
    const chars = cur ? cur.tokens.reduce((n, x) => n + x.text.length, 0) + w.text.length : 0;
    const prevEnds = last ? /[.?!,]$/.test(last.text.trim()) : false;
    const speaker = (w as Caption & { speaker?: string }).speaker;
    const newSpeaker = cur !== null && speaker !== curSpeaker;
    curSpeaker = speaker;
    if (!cur || !last || newSpeaker || w.startMs - last.toMs > 450 || cur.tokens.length >= 3 || chars > 20 || (prevEnds && cur.tokens.length >= 2)) {
      cur = { startMs: w.startMs, tokens: [token] };
      pages.push(cur);
    } else {
      cur.tokens.push(token);
    }
  }
  return pages;
}

/** The same captions inside a Sequence that starts later: shift by its offset. */
const CaptionsAt: React.FC<{ offset: number; top: number }> = ({ offset, top }) => {
  const { fps } = useVideoConfig();
  const pages = useMemo(() => paginate(caps as Caption[]).filter((p) => p.startMs >= (offset / fps) * 1000 - 50), [offset, fps]);
  return (
    <AbsoluteFill>
      {pages.map((page, index) => {
        const next = pages[index + 1];
        const from = Math.round((page.startMs / 1000) * fps) - offset;
        const lastEnd = page.tokens[page.tokens.length - 1].toMs;
        const untilMs = Math.min(next ? next.startMs : 1e9, lastEnd + 500, nextCut(page.startMs));
        const until = Math.round((untilMs / 1000) * fps) - offset;
        return (
          <Sequence key={index} from={from} durationInFrames={Math.max(1, until - from)} layout="none">
            <CaptionPage page={page} top={top} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const CaptionPage: React.FC<{ page: Page; top: number }> = ({
  page, top,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const nowMs = page.startMs + (frame / fps) * 1000;
  const a = ease(frame, 0, 5);
  return (
    <div style={{ position: "absolute", top, left: 70, right: 70, display: "flex", justifyContent: "center", opacity: a }}>
      <div
        style={{
          padding: "14px 26px", borderRadius: 22, background: "rgba(29,22,71,0.82)", fontFamily: HEAD, fontWeight: 700,
          fontSize: 62, lineHeight: 1.12, textAlign: "center", color: C.white, maxWidth: 940,
        }}
      >
        {page.tokens.map((token) => {
          const active = nowMs >= token.fromMs && nowMs < token.toMs;
          return (
            <span key={token.fromMs} style={{ color: active ? C.pink : C.white, whiteSpace: "pre" }}>
              {token.text}
            </span>
          );
        })}
      </div>
    </div>
  );
};

const Dark: React.FC = () => (
  <AbsoluteFill
    style={{ background: `radial-gradient(120% 80% at 50% 30%, ${C.navy} 0%, ${C.deep} 60%, #0d0a24 100%)` }}
  />
);

// ---------------------------------------------------------------- scenes

/** 0-3 s: a video message notification over a dark, blurred still. */
const Notification: React.FC = () => {
  const frame = useCurrentFrame();
  const slide = ease(frame, 2, 16);
  const pulse = 0.5 + Math.sin(frame / 5) * 0.5;
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Img
        src={f("avatar-still.jpg")}
        style={{ width: "100%", height: "100%", objectFit: "cover", filter: "blur(36px) brightness(0.42) saturate(0.8)", transform: "scale(1.15)" }}
      />
      <div
        style={{
          position: "absolute", top: 300, left: 60, right: 60, borderRadius: 40, padding: "30px 34px",
          background: "rgba(245,243,255,0.92)", boxShadow: "0 30px 80px rgba(0,0,0,0.45)", display: "flex", gap: 26,
          alignItems: "center", opacity: slide, transform: `translateY(${(1 - slide) * -140}px)`,
        }}
      >
        <div
          style={{
            width: 110, height: 110, borderRadius: 999, background: C.navy, color: C.white, display: "grid",
            placeItems: "center", fontFamily: HEAD, fontWeight: 700, fontSize: 52, flexShrink: 0,
          }}
        >
          D
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 48, color: C.deep }}>Denis</div>
          <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: 34, color: "#4a4470", marginTop: 4, display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 14, height: 14, borderRadius: 99, background: C.danger, opacity: 0.4 + pulse * 0.6 }} />
            Video message · now
          </div>
        </div>
      </div>
      <Line text="Is this Denis?" at={18} size={88} top={900} color={C.white} />
    </AbsoluteFill>
  );
};

/** 3-13.2 s: the avatar, full screen, slow push-in. Audio plays separately from 0 s. */
const Avatar: React.FC = () => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, S(10.2)], [1.0, 1.09], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <AbsoluteFill style={{ transform: `scale(${scale})` }}>
        <OffthreadVideo src={f("avatar.mp4")} startFrom={S(3.0)} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </AbsoluteFill>
      <Vignette strength={0.35} />
      <Pill top={250} right={60} tone="quiet">AI</Pill>
    </AbsoluteFill>
  );
};

/** 13.2-17.6 s: the reveal. */
const Reveal: React.FC = () => {
  const frame = useCurrentFrame();
  const grey = ease(frame, 0, 18);
  const realFrom = S(2.5);
  const realIn = ease(frame, realFrom, 6);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Img
        src={f("avatar-freeze.jpg")}
        style={{
          width: "100%", height: "100%", objectFit: "cover",
          filter: `grayscale(${grey}) brightness(${1 - grey * 0.55}) contrast(${1 + grey * 0.1})`,
          transform: `scale(${1.09 + grey * 0.03})`,
        }}
      />
      <Line text="That wasn't Denis." at={S(0.2)} size={104} top={560} />
      <Line text="An AI copy of his face." at={S(0.9)} size={64} top={790} color={C.lavender} />
      <Line text="Made in minutes." at={S(1.5)} size={64} top={975} color={C.pink} />
      <Sequence from={realFrom} layout="none">
        <AbsoluteFill style={{ opacity: realIn }}>
          <OffthreadVideo src={f("denis-real.mp4")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          <Pill top={300} left={60}>The real Denis</Pill>
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};

/** 17.6-20 s: the turn to the product. */
const Turn: React.FC = () => (
  <AbsoluteFill>
    <Dark />
    <Line text="Scammers do this on phone calls too." at={2} size={84} top={640} />
    <Line text="Callback catches them during the call." at={S(1.0)} size={84} top={900} color={C.pink} />
    <Grain opacity={0.06} />
  </AbsoluteFill>
);

/** 20-27 s: the real Shield call on Denis's phone; red from 24 s. */
const RealCall: React.FC = () => {
  const frame = useCurrentFrame();
  const push = interpolate(frame, [0, S(7)], [1.0, 1.06], { extrapolateRight: "clamp" });
  const flash = interpolate(frame, [S(4.0), S(4.15), S(4.6)], [0, 0.35, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <AbsoluteFill style={{ transform: `scale(${push})` }}>
        <OffthreadVideo src={f("call.mp4")} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: C.danger, opacity: flash }} />
      <Sequence from={S(0.2)} durationInFrames={S(4.1)} layout="none">
        <Pill top={250} right={60}>AI voice · Gangbi</Pill>
      </Sequence>
      <Sequence from={S(4.3)} layout="none">
        <Pill top={250} right={60}>Caller: AI copy of Polina's voice</Pill>
      </Sequence>
    </AbsoluteFill>
  );
};

/** 27-33.8 s: the warning up close, then the family alert. */
const Warning: React.FC = () => {
  const frame = useCurrentFrame();
  const a = ease(frame, 0, 10);
  const card: React.CSSProperties = {
    position: "absolute", top: 320, left: (1080 - 594) / 2, width: 594, height: 1056, borderRadius: 50, overflow: "hidden",
    boxShadow: "0 40px 100px rgba(0,0,0,0.55), 0 0 0 10px rgba(255,255,255,0.08)",
  };
  return (
    <AbsoluteFill>
      <Dark />
      <div style={{ ...card, opacity: a, transform: `translateY(${(1 - a) * 30}px)` }}>
        <OffthreadVideo src={f("shield.mp4")} startFrom={S(1.0)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        <Sequence from={S(5.4)} layout="none">
          <AbsoluteFill>
            <OffthreadVideo src={f("alert.mp4")} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </AbsoluteFill>
        </Sequence>
      </div>
      <Pill top={236} right={60}>AI voice · Polina</Pill>
      <Grain opacity={0.05} />
    </AbsoluteFill>
  );
};

const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const a = ease(frame, 0, 14);
  const b = ease(frame, 10, 14);
  const c = ease(frame, 22, 14);
  const glow = 0.55 + Math.sin(frame / 9) * 0.15;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", textAlign: "center" }}>
      <Dark />
      <div style={{ position: "absolute", top: 420, width: 520, height: 520, borderRadius: 999, background: `radial-gradient(circle, ${C.pink}55 0%, transparent 65%)`, opacity: glow }} />
      <Img src={f("logo.svg")} style={{ position: "absolute", top: 520, width: 300, height: 300, opacity: a, transform: `translateY(${(1 - a) * 20}px)` }} />
      <div style={{ position: "absolute", top: 900, left: 70, right: 70, fontFamily: HEAD, fontWeight: 700, fontSize: 78, lineHeight: 1.08, letterSpacing: -2, color: C.white, opacity: b }}>
        Callback guards your family's phone calls.
      </div>
      <div style={{ position: "absolute", top: 1130, left: 70, right: 70, fontFamily: BODY, fontWeight: 600, fontSize: 38, color: C.muted, opacity: c }}>
        Built in 48 hours by Plan C
      </div>
      <div style={{ position: "absolute", top: 1220, left: 0, right: 0, display: "flex", justifyContent: "center", opacity: c }}>
        <div style={{ padding: "22px 40px", borderRadius: 999, background: C.pink, color: C.deep, fontFamily: HEAD, fontWeight: 700, fontSize: 46 }}>
          Vote for Callback · link in bio
        </div>
      </div>
      <Grain opacity={0.06} />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- the reel

export const Hero: React.FC = () => {
  const frame = useCurrentFrame();
  // Tense pulse under the message, swelling at the money ask, gone by the reveal.
  const tense = (t: number) =>
    interpolate(t, [0, S(1), S(7.6), S(8.4), S(10.5), S(12.6), S(13.2)], [0, 0.09, 0.09, 0.17, 0.12, 0.1, 0], {
      extrapolateLeft: "clamp", extrapolateRight: "clamp",
    });
  // Calm bed from the turn on, ducked under the voices.
  const bed = (t: number) => {
    const local = t + S(17.6);
    const speaking = (local >= S(20.1) && local <= S(24.4)) || (local >= S(27.0) && local <= S(33.8));
    const base = speaking ? 0.05 : 0.1;
    const fadeOut = interpolate(local, [S(37.2), S(38.3)], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return base * fadeOut;
  };
  // The real call: low under Gangbi, up for the caller after the red warning.
  const callVol = (t: number) => interpolate(t, [0, S(4.2), S(4.5)], [0.25, 0.25, 1.15], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  void frame;
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Sequence from={0} durationInFrames={S(3.0)}><Notification /></Sequence>
      <Sequence from={S(3.0)} durationInFrames={S(10.2)}><Avatar /></Sequence>
      <Sequence from={S(13.2)} durationInFrames={S(4.4)}><Reveal /></Sequence>
      <Sequence from={S(17.6)} durationInFrames={S(2.4)}><Turn /></Sequence>
      <Sequence from={S(20.0)} durationInFrames={S(7.0)}><RealCall /></Sequence>
      <Sequence from={S(27.0)} durationInFrames={S(6.8)}><Warning /></Sequence>
      <Sequence from={S(33.8)} durationInFrames={S(4.5)}><EndCard /></Sequence>

      <Sequence from={0} durationInFrames={S(27.0)} layout="none"><Captions /></Sequence>
      <Sequence from={S(27.0)} layout="none"><CaptionsAt offset={S(27.0)} top={1388} /></Sequence>

      {/* sound */}
      <Sequence from={0} durationInFrames={S(13.2)}><Audio src={f("avatar.mp4")} /></Sequence>
      <Sequence from={0} durationInFrames={S(13.2)}><Audio src={f("tense.mp3")} volume={tense} /></Sequence>
      <Sequence from={S(0.1)}><Audio src={f("alert.mp3")} volume={0.28} /></Sequence>
      <Sequence from={S(13.12)}><Audio src={f("whoosh.mp3")} volume={0.7} /></Sequence>
      <Sequence from={S(15.7)} durationInFrames={S(1.9)}><Audio src={f("denis-real.mp4")} /></Sequence>
      <Sequence from={S(17.55)}><Audio src={f("whoosh.mp3")} volume={0.45} /></Sequence>
      <Sequence from={S(17.6)} durationInFrames={S(20.7)}><Audio src={f("pitch-bed.mp3")} volume={bed} /></Sequence>
      <Sequence from={S(20.0)} durationInFrames={S(7.0)}><Audio src={f("call.mp4")} volume={callVol} /></Sequence>
      <Sequence from={S(20.2)}><Audio src={f("hero-gangbi.wav")} /></Sequence>
      <Sequence from={S(24.0)}><Audio src={f("alert.mp3")} volume={0.6} /></Sequence>
      <Sequence from={S(27.1)}><Audio src={f("hero-polina.wav")} /></Sequence>
      <Sequence from={S(33.75)}><Audio src={f("whoosh.mp3")} volume={0.5} /></Sequence>
    </AbsoluteFill>
  );
};
