import { Audio } from "@remotion/media";
import type { Caption } from "@remotion/captions";
import {
  AbsoluteFill, Freeze, Img, interpolate, random, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig,
} from "remotion";
import { Captions } from "./Captions";
import { Grain, Vignette } from "./Grain";
import { Phone } from "./Phone";
import {
  BODY, C, FREEZE_AT, HEAD, LINE2_FROM, OUTRO_FROM, RING_END, TEXT_FROM, TOTAL, VOICE_FRAMES, VOICE_FROM,
} from "./timing";
import voiceCaptions from "./voice-captions.json";

/** The dark room around the phone: soft light, drifting bokeh. */
const Room: React.FC = () => {
  const frame = useCurrentFrame();
  const dots = [
    { x: 140, y: 300, r: 90, c: C.accent },
    { x: 930, y: 520, r: 70, c: C.pink },
    { x: 860, y: 1500, r: 110, c: C.navy },
    { x: 210, y: 1650, r: 80, c: C.accentFill },
    { x: 990, y: 1050, r: 50, c: C.lavender },
  ];
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse 80% 60% at 50% 42%, #2a2163 0%, #0d0a24 55%, #04030c 100%)` }}>
      {dots.map((d, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: d.x + Math.sin((frame + i * 40) / 70) * 20,
            top: d.y + Math.cos((frame + i * 30) / 90) * 16,
            width: d.r * 2,
            height: d.r * 2,
            borderRadius: "50%",
            background: d.c,
            opacity: 0.22,
            filter: "blur(36px)",
          }}
        />
      ))}
    </AbsoluteFill>
  );
};

/** Phone in the room, with a slow push-in and the vibration while it rings. */
const CallScene: React.FC = () => {
  const frame = useCurrentFrame();
  const push = interpolate(frame, [0, FREEZE_AT], [1.0, 1.1], { extrapolateRight: "clamp" });
  // Vibrate in bursts: 0.8 s on, 0.4 s off, while ringing.
  const ringing = frame < RING_END && frame % 36 < 24;
  const shakeX = ringing ? Math.sin(frame * 2.7) * 5 : 0;
  const shakeR = ringing ? Math.sin(frame * 3.1) * 0.35 : 0;
  const tilt = interpolate(frame, [0, FREEZE_AT], [-2.2, 0.6]);
  return (
    <AbsoluteFill>
      <Room />
      <AbsoluteFill
        style={{
          transform: `scale(${push}) translateX(${shakeX}px) rotate(${tilt + shakeR}deg)`,
          transformOrigin: "50% 48%",
        }}
      >
        <Phone />
      </AbsoluteFill>
      <Sequence from={VOICE_FROM} durationInFrames={VOICE_FRAMES + 6} name="Caller captions">
        <Captions captions={voiceCaptions as Caption[]} />
      </Sequence>
      <Vignette />
    </AbsoluteFill>
  );
};

/** The picture freezes, splits and tears for a moment. */
const Glitch: React.FC = () => {
  const frame = useCurrentFrame();
  const bands = Array.from({ length: 9 }, (_, i) => i);
  const flash = interpolate(frame, [0, 2, 6], [0.5, 0.15, 0], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Freeze frame={FREEZE_AT - 1}>
        <AbsoluteFill style={{ filter: "saturate(0.6) contrast(1.2)" }}>
          <CallScene />
        </AbsoluteFill>
        <AbsoluteFill style={{ mixBlendMode: "screen", opacity: 0.55, transform: `translateX(${12 + frame}px)`, filter: "hue-rotate(-60deg)" }}>
          <CallScene />
        </AbsoluteFill>
        {bands.map((i) => {
          const y0 = Math.floor(random(`y-${i}-${frame}`) * 1800);
          const h = 20 + Math.floor(random(`h-${i}-${frame}`) * 90);
          const dx = (random(`x-${i}-${frame}`) - 0.5) * 160;
          return (
            <AbsoluteFill key={i} style={{ clipPath: `inset(${y0}px 0 ${1920 - y0 - h}px 0)`, transform: `translateX(${dx}px)` }}>
              <CallScene />
            </AbsoluteFill>
          );
        })}
      </Freeze>
      <AbsoluteFill style={{ background: "#fff", opacity: flash }} />
    </AbsoluteFill>
  );
};

const Word: React.FC<{ children: string; delay: number; color?: string }> = ({ children, delay, color = C.onDeep }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 15, stiffness: 140 } });
  return (
    <span
      style={{
        display: "inline-block",
        marginRight: 26,
        color,
        opacity: s,
        transform: `translateY(${(1 - s) * 60}px)`,
        filter: `blur(${(1 - s) * 10}px)`,
      }}
    >
      {children}
    </span>
  );
};

const Kinetic: React.FC = () => {
  const frame = useCurrentFrame();
  const l2 = LINE2_FROM - TEXT_FROM;
  const dimFirst = interpolate(frame, [l2 - 4, l2 + 10], [1, 0.45], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const style: React.CSSProperties = { fontFamily: HEAD, fontWeight: 700, fontSize: 128, lineHeight: 1.05, letterSpacing: -4 };
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse 90% 70% at 50% 40%, ${C.deep2} 0%, ${C.deep} 60%, #0b0820 100%)` }}>
      <div style={{ position: "absolute", top: 560, left: 90, right: 70, ...style, opacity: dimFirst }}>
        <Word delay={0}>That</Word>
        <Word delay={4} color={C.danger}>wasn’t</Word>
        <Word delay={8}>her</Word>
        <Word delay={12}>son.</Word>
      </div>
      <Sequence from={l2} layout="none">
        <div style={{ position: "absolute", top: 930, left: 90, right: 70, ...style }}>
          <Word delay={0}>It</Word>
          <Word delay={3}>was</Word>
          <Word delay={6}>a</Word>
          <Word delay={9} color={C.pink}>copy</Word>
          <Word delay={13}>of</Word>
          <Word delay={16}>his</Word>
          <Word delay={19} color={C.pink}>voice.</Word>
        </div>
      </Sequence>
      <Grain opacity={0.07} />
    </AbsoluteFill>
  );
};

const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const logo = spring({ frame, fps, config: { damping: 13, stiffness: 120 } });
  const l1 = spring({ frame: frame - 8, fps, config: { damping: 16 } });
  const l2 = spring({ frame: frame - 16, fps, config: { damping: 16 } });
  const url = spring({ frame: frame - 26, fps, config: { damping: 20 } });
  const glow = 0.5 + Math.sin(frame / 10) * 0.15;
  return (
    <AbsoluteFill style={{ background: C.deep, alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          position: "absolute",
          top: 520,
          width: 520,
          height: 520,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${C.pink}55 0%, transparent 65%)`,
          opacity: glow,
          filter: "blur(10px)",
        }}
      />
      <div style={{ position: "absolute", top: 600, transform: `scale(${logo})` }}>
        <Img src={staticFile("brand/callback-mark-white.svg")} style={{ width: 300, height: 300 }} />
      </div>
      <div style={{ position: "absolute", top: 1010, width: "100%", textAlign: "center", fontFamily: HEAD, fontWeight: 700, fontSize: 132, letterSpacing: -4, lineHeight: 1.05, color: C.onDeep }}>
        <div style={{ opacity: l1, transform: `translateY(${(1 - l1) * 40}px)` }}>Hang up.</div>
        <div style={{ opacity: l2, transform: `translateY(${(1 - l2) * 40}px)`, color: C.pink }}>Call back.</div>
      </div>
      <div style={{ position: "absolute", top: 1360, width: "100%", textAlign: "center", fontFamily: BODY, fontSize: 46, color: C.lavender, opacity: url }}>
        callback.denishoti.dev
      </div>
      <Grain opacity={0.06} />
    </AbsoluteFill>
  );
};

export const ColdOpen: React.FC = () => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Sequence durationInFrames={FREEZE_AT} name="Call">
        <CallScene />
        <Grain />
      </Sequence>
      <Sequence from={FREEZE_AT} durationInFrames={TEXT_FROM - FREEZE_AT} name="Glitch">
        <Glitch />
      </Sequence>
      <Sequence from={TEXT_FROM} durationInFrames={OUTRO_FROM - TEXT_FROM} name="Kinetic text">
        <Kinetic />
      </Sequence>
      <Sequence from={OUTRO_FROM} durationInFrames={TOTAL - OUTRO_FROM} name="Outro">
        <Outro />
      </Sequence>

      {/* sound */}
      <Audio
        name="Ringtone"
        src={staticFile("audio/ringtone.mp3")}
        durationInFrames={RING_END}
        volume={(f) => interpolate(f, [0, 6, RING_END - 8, RING_END], [0, 0.45, 0.45, 0], { extrapolateRight: "clamp" })}
      />
      <Audio
        name="Music bed"
        src={staticFile("audio/music.mp3")}
        durationInFrames={FREEZE_AT}
        volume={(f) =>
          interpolate(f, [0, 20, VOICE_FROM - 10, VOICE_FROM + 4, VOICE_FROM + VOICE_FRAMES, FREEZE_AT - 4, FREEZE_AT], [0, 0.28, 0.28, 0.09, 0.09, 0.22, 0], {
            extrapolateRight: "clamp",
          })
        }
      />
      <Sequence from={VOICE_FROM} name="Caller voice">
        <Audio src={staticFile("audio/voice.wav")} volume={1} />
      </Sequence>
      <Sequence from={FREEZE_AT - 6} name="Call drops">
        <Audio src={staticFile("audio/call-ended.mp3")} volume={0.4} />
      </Sequence>
      <Sequence from={FREEZE_AT} name="Sting">
        <Audio src={staticFile("audio/alert.mp3")} volume={0.45} />
      </Sequence>
      <Sequence from={TEXT_FROM} name="Whoosh in">
        <Audio src={staticFile("audio/whoosh.mp3")} volume={0.4} />
      </Sequence>
      <Sequence from={OUTRO_FROM} name="Whoosh outro">
        <Audio src={staticFile("audio/whoosh.mp3")} volume={0.45} />
      </Sequence>
      <Sequence from={OUTRO_FROM} name="Music outro">
        <Audio
          src={staticFile("audio/music.mp3")}
          trimBefore={Math.round(2 * fps)}
          volume={(f) => interpolate(f, [0, 15, TOTAL - OUTRO_FROM - 20, TOTAL - OUTRO_FROM], [0, 0.16, 0.16, 0], { extrapolateRight: "clamp" })}
        />
      </Sequence>
    </AbsoluteFill>
  );
};
