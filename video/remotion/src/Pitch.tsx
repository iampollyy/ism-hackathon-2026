// The Devpost pitch video (1920x1080, 30 fps): Callback Shield first.
// Footage, phone recordings, voice-over and cards live in public/pitch/
// (video/work/transcode_pitch.sh makes them); captions and cue times come
// from pitchData.json (built from the transcripts).

import { createTikTokStyleCaptions, type Caption } from "@remotion/captions";
import { Audio } from "@remotion/media";
import { useMemo } from "react";
import {
  AbsoluteFill, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig,
} from "remotion";
import data from "./pitchData.json";
import { Grain } from "./Grain";
import { BODY, C, HEAD } from "./timing";

const FPS = 30;
const s = (seconds: number) => Math.round(seconds * FPS);
const P = (name: string) => staticFile(`pitch/${name}`);

// Section lengths in seconds.
export const SECTIONS = {
  hook: 12.8, title: 3.5, problem: 11.5, shield: 25.4, setup: 9.0, consent: 18.0, sharp: 7.0, roadmap: 14.0, end: 5.0,
};
const order = ["hook", "title", "problem", "shield", "setup", "consent", "sharp", "roadmap", "end"] as const;
const starts: Record<string, number> = {};
let acc = 0;
for (const key of order) {
  starts[key] = acc;
  acc += SECTIONS[key];
}
export const PITCH_FRAMES = s(acc);

// ---------------------------------------------------------------- building blocks

const Background: React.FC = () => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(1200px 800px at 85% 15%, ${C.navy} 0%, transparent 60%), radial-gradient(900px 700px at 10% 90%, #3a1f5c 0%, transparent 65%), ${C.deep}`,
    }}
  />
);

const Full: React.FC<{ src: string; volume?: number | ((f: number) => number); dim?: number }> = ({ src, volume = 1, dim = 0 }) => (
  <AbsoluteFill>
    <OffthreadVideo src={P(src)} volume={volume} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    {dim > 0 && <AbsoluteFill style={{ background: `rgba(10,6,30,${dim})` }} />}
  </AbsoluteFill>
);

const CARD = { x: 80, y: 150, w: 1040, h: 585 };

const FootageCard: React.FC<{ src: string; volume?: number | ((f: number) => number) }> = ({ src, volume = 1 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 18, stiffness: 120 } });
  return (
    <div
      style={{
        position: "absolute", left: CARD.x, top: CARD.y, width: CARD.w, height: CARD.h, borderRadius: 28, overflow: "hidden",
        boxShadow: "0 40px 100px rgba(0,0,0,0.55)", border: "2px solid rgba(216,206,255,0.18)",
        transform: `translateX(${(1 - enter) * -60}px)`, opacity: enter,
      }}
    >
      <OffthreadVideo src={P(src)} volume={volume} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    </div>
  );
};

const PHONE = { h: 900 };
const Phone: React.FC<{ src: string; from?: number }> = ({ src, from = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - from, fps, config: { damping: 16, stiffness: 110 } });
  const screenH = PHONE.h - 28;
  const screenW = Math.round((screenH * 9) / 16);
  const w = screenW + 28;
  return (
    <div
      style={{
        position: "absolute", left: 1500 - w / 2, top: 540 - PHONE.h / 2, width: w, height: PHONE.h, borderRadius: 64,
        background: "linear-gradient(145deg, #3b3550, #15121f)", padding: 14, boxSizing: "border-box",
        boxShadow: "0 50px 120px rgba(0,0,0,0.6), inset 0 0 0 2px rgba(255,255,255,0.08)",
        transform: `translateY(${(1 - enter) * 80}px)`, opacity: enter,
      }}
    >
      <div style={{ width: screenW, height: screenH, borderRadius: 50, overflow: "hidden", background: "#000" }}>
        <OffthreadVideo src={P(src)} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
    </div>
  );
};

const Label: React.FC<{ text: string; tone?: string }> = ({ text, tone = C.pink }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 16 } });
  return (
    <div
      style={{
        position: "absolute", left: 80, top: 62, display: "flex", alignItems: "center", gap: 14, padding: "12px 24px",
        borderRadius: 999, background: "rgba(29,22,71,0.85)", border: `2px solid ${tone}66`, fontFamily: HEAD, fontWeight: 700,
        fontSize: 32, color: C.onDeep, opacity: enter, transform: `translateY(${(1 - enter) * -20}px)`,
      }}
    >
      <span style={{ width: 14, height: 14, borderRadius: 7, background: tone, boxShadow: `0 0 18px ${tone}` }} />
      {text}
    </div>
  );
};

type CalloutSpec = { at: number; text: string; tone: string };
const Callouts: React.FC<{ items: CalloutSpec[] }> = ({ items }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ position: "absolute", left: CARD.x, top: CARD.y + CARD.h + 34, width: CARD.w, display: "flex", flexWrap: "wrap", gap: 16 }}>
      {items.map((item, index) => {
        const enter = spring({ frame: frame - s(item.at), fps, config: { damping: 14, stiffness: 160 } });
        if (frame < s(item.at)) return null;
        return (
          <div
            key={item.text}
            style={{
              display: "flex", alignItems: "center", gap: 14, padding: "14px 22px", borderRadius: 18,
              background: "rgba(13,9,38,0.88)", border: `2px solid ${item.tone}`, fontFamily: HEAD, fontWeight: 700, fontSize: 30,
              color: "#fff", transform: `scale(${0.8 + enter * 0.2})`, opacity: enter,
            }}
          >
            <span
              style={{
                width: 34, height: 34, borderRadius: 17, background: item.tone, color: C.deep, display: "grid", placeItems: "center",
                fontSize: 20,
              }}
            >
              {index + 1}
            </span>
            {item.text}
          </div>
        );
      })}
    </div>
  );
};

type Area = { cx: number; bottom: number; maxWidth: number; size: number };
const FULL_AREA: Area = { cx: 960, bottom: 70, maxWidth: 1500, size: 54 };
const CARD_AREA: Area = { cx: CARD.x + CARD.w / 2, bottom: 1080 - (CARD.y + CARD.h) + 24, maxWidth: 980, size: 42 };

const Captions: React.FC<{ captions: Caption[]; area: Area }> = ({ captions, area }) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const { pages } = useMemo(() => createTikTokStyleCaptions({ captions, combineTokensWithinMilliseconds: 1100 }), [captions]);
  const nowMs = (frame / fps) * 1000;
  const page = pages.find((p, i) => {
    const next = pages[i + 1];
    const end = Math.min(next ? next.startMs : Infinity, p.startMs + p.durationMs + 400);
    return nowMs >= p.startMs && nowMs < end;
  });
  if (!page) return null;
  return (
    <div
      style={{
        position: "absolute", left: area.cx - area.maxWidth / 2, width: area.maxWidth, bottom: area.bottom,
        display: "flex", justifyContent: "center", pointerEvents: "none",
      }}
    >
      <div
        style={{
          padding: "12px 26px 14px", borderRadius: 18, background: "rgba(13, 9, 38, 0.88)", fontFamily: HEAD, fontWeight: 700,
          fontSize: area.size, lineHeight: 1.18, textAlign: "center", color: "#fff", whiteSpace: "pre-wrap",
          border: "2px solid rgba(242,169,250,0.22)",
        }}
      >
        {page.tokens.map((token) => {
          const active = token.fromMs <= nowMs && token.toMs > nowMs;
          return (
            <span key={token.fromMs} style={{ color: active ? C.pink : "#fff" }}>
              {token.text}
            </span>
          );
        })}
      </div>
    </div>
  );
};

const Kinetic: React.FC<{ lines: { at: number; text: string; color: string }[] }> = ({ lines }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", padding: "0 110px 150px" }}>
      {lines.map((line) => {
        const enter = spring({ frame: frame - s(line.at), fps, config: { damping: 15, stiffness: 140 } });
        if (frame < s(line.at)) return null;
        return (
          <div
            key={line.text}
            style={{
              fontFamily: HEAD, fontWeight: 700, fontSize: 104, letterSpacing: -3, lineHeight: 1.05, color: line.color,
              textShadow: "0 8px 40px rgba(0,0,0,0.6)", opacity: enter, transform: `translateY(${(1 - enter) * 40}px)`,
            }}
          >
            {line.text}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

const StatCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = spring({ frame, fps, config: { damping: 14 } });
  const b = spring({ frame: frame - 8, fps, config: { damping: 16 } });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", textAlign: "center" }}>
      <Background />
      <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 190, letterSpacing: -6, color: C.pink, transform: `scale(${0.7 + a * 0.3})`, opacity: a }}>
        €20 million
      </div>
      <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 58, color: C.onDeep, marginTop: 10, opacity: b }}>
        lost to phone scammers in Lithuania last year
      </div>
      <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: 30, color: C.onDeepMuted, marginTop: 28, opacity: b }}>
        Source: LRT, February 2026
      </div>
      <Grain opacity={0.06} />
    </AbsoluteFill>
  );
};

const caps = (key: keyof typeof data) => (data[key] as { captions: Caption[] }).captions;

// ---------------------------------------------------------------- sections

const Hook: React.FC = () => (
  <AbsoluteFill>
    <Sequence durationInFrames={s(8.3)}>
      <Full src="hookA.mp4" />
      <Captions captions={caps("hook")} area={FULL_AREA} />
    </Sequence>
    <Sequence from={s(8.3)}>
      <Full src="hookB.mp4" volume={0.45} dim={0.35} />
      <Audio src={P("alert.mp3")} volume={0.7} />
      <Kinetic
        lines={[
          { at: 0.5, text: "That was a scam call.", color: "#fff" },
          { at: 1.9, text: "Callback caught it.", color: C.pink },
        ]}
      />
    </Sequence>
  </AbsoluteFill>
);

const Title: React.FC = () => (
  <AbsoluteFill>
    <OffthreadVideo src={P("TitleCard.mp4")} muted style={{ width: "100%", height: "100%" }} />
    <Audio src={P("whoosh.mp3")} volume={0.55} />
  </AbsoluteFill>
);

const Problem: React.FC = () => (
  <AbsoluteFill>
    <Sequence durationInFrames={s(4.75)}>
      <Full src="introB1.mp4" />
    </Sequence>
    <Sequence from={s(4.75)} durationInFrames={s(3.2)}>
      <StatCard />
    </Sequence>
    <Sequence from={s(7.95)} durationInFrames={s(2.2)}>
      <Full src="introB2.mp4" />
    </Sequence>
    <Sequence from={s(10.15)}>
      <Full src="introA.mp4" />
    </Sequence>
    <Captions captions={caps("problem")} area={FULL_AREA} />
  </AbsoluteFill>
);

const cue = (key: keyof typeof data, name: string) => ((data[key] as { cues: Record<string, number> }).cues[name]);

const Shield: React.FC = () => {
  const split = 21.8;
  const vo2end = cue("shield", "vo2end");
  const callVolume = (f: number) => interpolate(f, [0, s(vo2end), s(vo2end + 0.5)], [0.22, 0.22, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill>
      <Sequence durationInFrames={s(split)}>
        <Background />
        <FootageCard src="shield.mp4" volume={callVolume} />
        <Sequence durationInFrames={s(16.5)}>
          <Phone src="p_shield.mp4" from={4} />
        </Sequence>
        <Sequence from={s(16.5)}>
          <Phone src="p_alert.mp4" />
        </Sequence>
        <Label text="Killer feature · Callback Shield" />
        <Callouts
          items={[
            { at: cue("shield", "listens"), text: "Listens during the call", tone: C.lavender },
            { at: cue("shield", "tricks"), text: "Spots the tricks: new number · urgency · secrecy · money today", tone: C.pink },
            { at: cue("shield", "red"), text: "Warns you within seconds", tone: C.danger },
            { at: cue("shield", "alert"), text: "Alerts your family", tone: C.good },
          ]}
        />
        <Captions captions={caps("shield")} area={CARD_AREA} />
        <Grain opacity={0.05} />
      </Sequence>
      <Sequence from={s(split)}>
        <Full src="shield.mp4" />
      </Sequence>
      <Sequence from={s(split)}>
        {/* the same clip continues full-bleed: offset its captions */}
        <Captions captions={caps("shield").map((c) => ({ ...c, startMs: c.startMs - split * 1000, endMs: c.endMs - split * 1000, timestampMs: (c.timestampMs ?? c.startMs) - split * 1000 })).filter((c) => c.endMs > 0)} area={FULL_AREA} />
      </Sequence>
      <Sequence from={s(0.5)}>
        <Audio src={P("vo1-shield.mp3")} volume={1} />
      </Sequence>
      <Sequence from={s(7.0)}>
        <Audio src={P("vo2-shield.mp3")} volume={1} />
      </Sequence>
      <Sequence from={s(cue("shield", "red"))}>
        <Audio src={P("alert.mp3")} volume={0.35} />
      </Sequence>
    </AbsoluteFill>
  );
};

const Split: React.FC<{
  label: string; tone?: string; left: string; leftVolume: number | ((f: number) => number); phone: string; callouts: CalloutSpec[];
  captionsKey: keyof typeof data; vo: string; voAt: number;
}> = ({ label, tone, left, leftVolume, phone, callouts, captionsKey, vo, voAt }) => (
  <AbsoluteFill>
    <Background />
    <FootageCard src={left} volume={leftVolume} />
    <Phone src={phone} from={4} />
    <Label text={label} tone={tone} />
    <Callouts items={callouts} />
    <Captions captions={caps(captionsKey)} area={CARD_AREA} />
    <Sequence from={s(voAt)}>
      <Audio src={P(vo)} volume={1} />
    </Sequence>
    <Grain opacity={0.05} />
  </AbsoluteFill>
);

const Roadmap: React.FC = () => (
  <AbsoluteFill>
    <OffthreadVideo src={P("Roadmap.mp4")} muted style={{ width: "100%", height: "100%" }} />
    <Sequence from={s(1.0)}>
      <Audio src={P("vo6-roadmap.mp3")} />
    </Sequence>
    <Captions captions={caps("roadmap")} area={{ ...FULL_AREA, bottom: 40, size: 46 }} />
  </AbsoluteFill>
);

const End: React.FC = () => (
  <AbsoluteFill>
    <OffthreadVideo src={P("EndCard.mp4")} muted style={{ width: "100%", height: "100%" }} />
    <Sequence from={s(0.6)}>
      <Audio src={P("vo7-end.mp3")} />
    </Sequence>
  </AbsoluteFill>
);

export const Pitch: React.FC = () => (
  <AbsoluteFill style={{ background: C.deep }}>
    <Sequence from={s(starts.hook)} durationInFrames={s(SECTIONS.hook)}><Hook /></Sequence>
    <Sequence from={s(starts.title)} durationInFrames={s(SECTIONS.title)}><Title /></Sequence>
    <Sequence from={s(starts.problem)} durationInFrames={s(SECTIONS.problem)}><Problem /></Sequence>
    <Sequence from={s(starts.shield)} durationInFrames={s(SECTIONS.shield)}><Shield /></Sequence>
    <Sequence from={s(starts.setup)} durationInFrames={s(SECTIONS.setup)}>
      <Split
        label="Set up in two minutes" tone={C.lavender} left="setup.mp4" leftVolume={0.12} phone="p_signup.mp4"
        captionsKey="setup" vo="vo3-setup.mp3" voAt={0.6}
        callouts={[
          { at: cue("setup", "create"), text: "Create a family plan", tone: C.lavender },
          { at: cue("setup", "add"), text: "Add the people you love", tone: C.pink },
          { at: cue("setup", "send"), text: "Send each a link", tone: C.good },
        ]}
      />
    </Sequence>
    <Sequence from={s(starts.consent)} durationInFrames={s(SECTIONS.consent)}>
      <Split
        label="Consent first" tone={C.good} left="consent.mp4"
        leftVolume={(f) => interpolate(f, [0, s(10.1), s(10.5)], [1, 1, 0.18], { extrapolateRight: "clamp" })}
        phone="p_join.mp4" captionsKey="consent" vo="vo4-consent.mp3" voAt={10.4}
        callouts={[
          { at: 1.0, text: "A short welcome call", tone: C.lavender },
          { at: cue("consent", "yes"), text: "Nothing happens without their yes", tone: C.good },
        ]}
      />
    </Sequence>
    <Sequence from={s(starts.sharp)} durationInFrames={s(SECTIONS.sharp)}>
      <Split
        label="Always sharp" tone={C.pink} left="sharp.mp4" leftVolume={0} phone="p_news.mp4" captionsKey="sharp"
        vo="vo5-more.mp3" voAt={0.5}
        callouts={[
          { at: cue("sharp", "practice"), text: "Practice calls", tone: C.pink },
          { at: cue("sharp", "news"), text: "Scam news every hour", tone: C.lavender },
        ]}
      />
    </Sequence>
    <Sequence from={s(starts.roadmap)} durationInFrames={s(SECTIONS.roadmap)}><Roadmap /></Sequence>
    <Sequence from={s(starts.end)} durationInFrames={s(SECTIONS.end)}><End /></Sequence>
    <Audio src={P("pitch-bed.mp3")} volume={0.08} />
  </AbsoluteFill>
);
