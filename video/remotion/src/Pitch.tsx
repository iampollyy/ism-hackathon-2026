// The Devpost pitch video (1920x1080, 30 fps): Callback Shield first.
// Footage, phone recordings, voice-over and cards live in public/pitch/
// (video/work/transcode_pitch.sh makes them); captions and cue times come
// from pitchData.json (built from the transcripts).

import { createTikTokStyleCaptions, type Caption } from "@remotion/captions";
import { Audio } from "@remotion/media";
import { useMemo } from "react";
import {
  AbsoluteFill, Easing, interpolate, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig,
} from "remotion";
import data from "./pitchData.json";
import { Grain } from "./Grain";
import { BODY, C, HEAD } from "./timing";

const FPS = 30;
const s = (seconds: number) => Math.round(seconds * FPS);
const P = (name: string) => staticFile(`pitch/${name}`);

type SectionRow = { key: string; start: number; dur: number };
const SECTION_ROWS = (data as unknown as { sections: SectionRow[] }).sections;
const TOTAL = (data as unknown as { total: number }).total;
const SPEECH = (data as unknown as { speech: [number, number][] }).speech;
export const PITCH_FRAMES = s(TOTAL);

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


type Key = { t: number; k: number; cx: number; cy: number };
const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
const PushIn: React.FC<{ src: string; keys: Key[]; from?: number }> = ({ src, keys, from = 0 }) => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  let a = keys[0];
  let b = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (t >= keys[i].t && t <= keys[i + 1].t) { a = keys[i]; b = keys[i + 1]; break; }
  }
  const span = Math.max(0.001, b.t - a.t);
  const x = t <= a.t ? 0 : t >= b.t ? 1 : ease((t - a.t) / span);
  const k = a.k + (b.k - a.k) * x;
  const cx = a.cx + (b.cx - a.cx) * x;
  const cy = a.cy + (b.cy - a.cy) * x;
  const tx = Math.min(0, Math.max(1920 - 1920 * k, 960 - cx * k));
  const ty = Math.min(0, Math.max(1080 - 1080 * k, 540 - cy * k));
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: "#eef0fb" }}>
      <div style={{ position: "absolute", width: 1920, height: 1080, transformOrigin: "0 0", transform: `translate(${tx}px, ${ty}px) scale(${k})` }}>
        <OffthreadVideo src={P(src)} muted startFrom={from} style={{ width: 1920, height: 1080 }} />
      </div>
    </AbsoluteFill>
  );
};

const ChipStack: React.FC<{ items: CalloutSpec[] }> = ({ items }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ position: "absolute", left: 70, top: 150, display: "flex", flexDirection: "column", gap: 16 }}>
      {items.map((item, index) => {
        const enter = spring({ frame: frame - s(item.at), fps, config: { damping: 14, stiffness: 160 } });
        if (frame < s(item.at)) return null;
        return (
          <div
            key={item.text}
            style={{
              display: "flex", alignItems: "center", gap: 14, padding: "14px 24px", borderRadius: 18, alignSelf: "flex-start",
              background: "rgba(13,9,38,0.9)", border: `2px solid ${item.tone}`, fontFamily: HEAD, fontWeight: 700, fontSize: 34,
              color: "#fff", boxShadow: "0 20px 50px rgba(13,9,38,0.35)", transform: `translateX(${(1 - enter) * -40}px)`, opacity: enter,
            }}
          >
            <span style={{ width: 36, height: 36, borderRadius: 18, background: item.tone, color: C.deep, display: "grid", placeItems: "center", fontSize: 20 }}>
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
  const ease = (from: number) => interpolate(frame, [from, from + 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const a = ease(0);
  const b = ease(8);
  const c = ease(16);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", textAlign: "center" }}>
      <Background />
      <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 180, letterSpacing: -6, color: C.pink, opacity: a, transform: `translateY(${(1 - a) * 24}px)` }}>
        €20 million
      </div>
      <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 56, color: C.onDeep, marginTop: 6, opacity: b, transform: `translateY(${(1 - b) * 16}px)` }}>
        lost to phone scammers in Lithuania in a year
      </div>
      <div style={{ marginTop: 40, opacity: c, display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
        <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: 30, color: C.onDeepMuted }}>
          Source: LRT.lt, 27 February 2026
        </div>
        <div style={{ fontFamily: BODY, fontWeight: 500, fontSize: 26, color: C.onDeepMuted, opacity: 0.85, fontStyle: "italic" }}>
          "Twenty million euros, 15 million calls: Lithuanian authorities tackle phone swindlers"
        </div>
      </div>
      <Grain opacity={0.06} />
    </AbsoluteFill>
  );
};

const anyData = data as unknown as Record<string, { captions?: Caption[]; cues?: Record<string, number>; src?: string; dur?: number; b1?: number } | null>;
const caps = (key: string) => (anyData[key]?.captions ?? []) as Caption[];
const cue = (key: string, name: string) => (anyData[key]?.cues?.[name] ?? 0);

// ---------------------------------------------------------------- sections

const Hook: React.FC = () => (
  <AbsoluteFill>
    <Sequence durationInFrames={s(8.3)}>
      <Full src="hookA.mp4" />
      <Captions captions={caps("hook")} area={FULL_AREA} />
    </Sequence>
    <Sequence from={s(8.3)}>
      <Full src="hookB.mp4" volume={0.5} dim={0.35} />
      <Audio src={P("alert.mp3")} volume={0.45} />
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
    <Audio src={P("whoosh.mp3")} volume={0.4} />
  </AbsoluteFill>
);

const Team: React.FC<{ slot: "teamIntro" | "teamClose" }> = ({ slot }) => (
  <AbsoluteFill>
    <Full src={anyData[slot]?.src ?? ""} />
    {slot === "teamIntro" ? <Label text="The team behind Callback" tone={C.lavender} /> : null}
    <Captions captions={caps(slot)} area={FULL_AREA} />
  </AbsoluteFill>
);

const Problem: React.FC = () => {
  const b1 = anyData.problem?.b1 ?? 3.23;
  return (
    <AbsoluteFill>
      <Sequence durationInFrames={s(b1)}>
        <Full src="introB1.mp4" />
      </Sequence>
      <Sequence from={s(b1)} durationInFrames={s(3.2)}>
        <StatCard />
      </Sequence>
      <Sequence from={s(b1 + 3.2)} durationInFrames={s(2.2)}>
        <Full src="introB2.mp4" />
      </Sequence>
      <Sequence from={s(b1 + 5.4)}>
        <Full src="introA.mp4" />
      </Sequence>
      <Captions captions={caps("problem")} area={FULL_AREA} />
    </AbsoluteFill>
  );
};

const Shield: React.FC = () => {
  const split = 21.8;
  const vo2end = cue("shield", "vo2end");
  // the real call: quietly under the voice-over, then up on its own
  const callVolume = (f: number) => interpolate(f, [0, s(vo2end), s(vo2end + 0.6)], [0.42, 0.42, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill>
      <Sequence durationInFrames={s(split)}>
        <Background />
        <FootageCard src="shield.mp4" volume={callVolume} />
        <Phone src="p_shield2.mp4" from={4} />
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
        <Captions
          captions={caps("shield")
            .map((c) => ({ ...c, startMs: c.startMs - split * 1000, endMs: c.endMs - split * 1000, timestampMs: (c.timestampMs ?? c.startMs) - split * 1000 }))
            .filter((c) => c.endMs > 0)}
          area={FULL_AREA}
        />
      </Sequence>
      <Sequence from={s(cue("shield", "v1"))}>
        <Audio src={P("vo1-shield.wav")} />
      </Sequence>
      <Sequence from={s(cue("shield", "v2"))}>
        <Audio src={P("vo2-shield.wav")} />
      </Sequence>
      <Sequence from={s(cue("shield", "red"))}>
        <Audio src={P("alert.mp3")} volume={0.3} />
      </Sequence>
    </AbsoluteFill>
  );
};

// The family's laptop: the live view, with the camera moving onto each part.
const Laptop: React.FC = () => (
  <AbsoluteFill>
    <PushIn
      src="l_live.mp4"
      keys={[
        { t: 0, k: 1.0, cx: 960, cy: 540 },
        { t: 2.2, k: 1.55, cx: 1425, cy: 290 },
        { t: 6.0, k: 1.55, cx: 1425, cy: 290 },
        { t: 7.6, k: 1.5, cx: 1425, cy: 780 },
        { t: 11.4, k: 1.5, cx: 1425, cy: 780 },
        { t: 13.0, k: 1.7, cx: 690, cy: 735 },
        { t: 17.0, k: 1.7, cx: 690, cy: 735 },
        { t: 19.2, k: 1.0, cx: 960, cy: 540 },
      ]}
    />
    <Label text="Your family sees it live" tone={C.lavender} />
    <ChipStack
      items={[
        { at: cue("laptop", "c1"), text: "Every sentence, live", tone: C.lavender },
        { at: cue("laptop", "c2"), text: "Every trick, named", tone: C.pink },
        { at: cue("laptop", "c3"), text: "Family alerted automatically", tone: C.good },
      ]}
    />
    <Captions captions={caps("laptop")} area={FULL_AREA} />
    <Sequence from={s(cue("laptop", "vo"))}>
      <Audio src={P("vo8-laptop.wav")} />
    </Sequence>
    <Sequence from={s(12.2)}>
      <Audio src={P("alert.mp3")} volume={0.25} />
    </Sequence>
  </AbsoluteFill>
);

const Split: React.FC<{
  label: string; tone?: string; left: string; leftVolume: number | ((f: number) => number); phone: string; callouts: CalloutSpec[];
  captionsKey: string; vo: string; voAt: number;
}> = ({ label, tone, left, leftVolume, phone, callouts, captionsKey, vo, voAt }) => (
  <AbsoluteFill>
    <Background />
    <FootageCard src={left} volume={leftVolume} />
    <Phone src={phone} from={4} />
    <Label text={label} tone={tone} />
    <Callouts items={callouts} />
    <Captions captions={caps(captionsKey)} area={CARD_AREA} />
    <Sequence from={s(voAt)}>
      <Audio src={P(vo)} />
    </Sequence>
    <Grain opacity={0.05} />
  </AbsoluteFill>
);

// Consent: the real welcome call (two cuts), then the voice-over over a second shot.
const Consent: React.FC = () => {
  const a = cue("consent", "a");
  const b = cue("consent", "b");
  const v = cue("consent", "vo");
  return (
    <AbsoluteFill>
      <Background />
      <Sequence durationInFrames={s(a)}>
        <FootageCard src="consentA.mp4" />
      </Sequence>
      <Sequence from={s(a)} durationInFrames={s(b)}>
        <FootageCard src="consentB.mp4" />
      </Sequence>
      <Sequence from={s(a + b)}>
        <FootageCard src="consentC.mp4" volume={0} />
      </Sequence>
      <Phone src="p_join.mp4" from={4} />
      <Label text="Consent first" tone={C.good} />
      <Callouts
        items={[
          { at: 1.0, text: "A short welcome call", tone: C.lavender },
          { at: cue("consent", "yes"), text: "Nothing happens without their yes", tone: C.good },
        ]}
      />
      <Captions captions={caps("consent")} area={CARD_AREA} />
      <Sequence from={s(v)}>
        <Audio src={P("vo4-consent.wav")} />
      </Sequence>
      <Grain opacity={0.05} />
    </AbsoluteFill>
  );
};

// Practice, and how you did: the call's result page, then the drills list.
const Result: React.FC = () => (
  <AbsoluteFill>
    <Sequence durationInFrames={s(14.6)}>
      <PushIn
        src="l_result.mp4"
        keys={[
          { t: 0, k: 1.0, cx: 960, cy: 540 },
          { t: 1.4, k: 1.6, cx: 1200, cy: 470 },
          { t: 4.0, k: 1.6, cx: 1200, cy: 470 },
          { t: 5.6, k: 1.3, cx: 930, cy: 560 },
          { t: 12.6, k: 1.3, cx: 930, cy: 520 },
          { t: 14.6, k: 1.0, cx: 960, cy: 540 },
        ]}
      />
    </Sequence>
    <Sequence from={s(14.6)}>
      <PushIn src="l_drills.mp4" keys={[{ t: 0, k: 1.0, cx: 960, cy: 540 }, { t: 3.2, k: 1.12, cx: 1100, cy: 600 }]} />
    </Sequence>
    <Label text="Practice, and how you did" tone={C.pink} />
    <ChipStack
      items={[
        { at: cue("result", "how"), text: "How you did", tone: C.lavender },
        { at: cue("result", "tricks"), text: "Which tricks were tried", tone: C.pink },
        { at: cue("result", "fast"), text: "Seconds to hang up", tone: C.good },
      ]}
    />
    <Captions captions={caps("result")} area={FULL_AREA} />
    <Sequence from={s(cue("result", "vo"))}>
      <Audio src={P("vo9-result.wav")} />
    </Sequence>
  </AbsoluteFill>
);

const Roadmap: React.FC = () => (
  <AbsoluteFill>
    <OffthreadVideo src={P("Roadmap.mp4")} muted style={{ width: "100%", height: "100%" }} />
    <Sequence from={s(1.0)}>
      <Audio src={P("vo6-roadmap.wav")} />
    </Sequence>
    <Captions captions={caps("roadmap")} area={{ ...FULL_AREA, bottom: 40, size: 46 }} />
  </AbsoluteFill>
);

const End: React.FC = () => (
  <AbsoluteFill>
    <OffthreadVideo src={P("EndCard.mp4")} muted style={{ width: "100%", height: "100%" }} />
    <Sequence from={s(0.6)}>
      <Audio src={P("vo7-end.wav")} />
    </Sequence>
  </AbsoluteFill>
);

const BODY_OF: Record<string, React.FC> = {
  hook: Hook,
  title: Title,
  teamIntro: () => <Team slot="teamIntro" />,
  problem: Problem,
  shield: Shield,
  laptop: Laptop,
  setup: () => (
    <Split
      label="Set up in two minutes" tone={C.lavender} left="setup.mp4" leftVolume={0.12} phone="p_signup.mp4"
      captionsKey="setup" vo="vo3-setup.wav" voAt={cue("setup", "vo")}
      callouts={[
        { at: cue("setup", "create"), text: "Create a family plan", tone: C.lavender },
        { at: cue("setup", "add"), text: "Add the people you love", tone: C.pink },
        { at: cue("setup", "send"), text: "Send each a link", tone: C.good },
      ]}
    />
  ),
  consent: Consent,
  result: Result,
  sharp: () => (
    <Split
      label="Always sharp" tone={C.pink} left="sharp.mp4" leftVolume={0} phone="p_news.mp4" captionsKey="sharp"
      vo="vo5-more.wav" voAt={cue("sharp", "vo")}
      callouts={[
        { at: cue("sharp", "practice"), text: "Practice calls", tone: C.pink },
        { at: cue("sharp", "news"), text: "Scam news every hour", tone: C.lavender },
      ]}
    />
  ),
  roadmap: Roadmap,
  teamClose: () => <Team slot="teamClose" />,
  end: End,
};

// Music: quiet under speech, a little fuller in the gaps.
const musicVolume = (f: number) => {
  const t = f / FPS;
  const near = SPEECH.some(([a, b]) => t >= a - 0.35 && t <= b + 0.35);
  return near ? 0.12 : 0.24;
};

export const Pitch: React.FC = () => (
  <AbsoluteFill style={{ background: C.deep }}>
    {SECTION_ROWS.map((row) => {
      const Body = BODY_OF[row.key];
      return (
        <Sequence key={row.key} from={s(row.start)} durationInFrames={s(row.dur)}>
          <Body />
        </Sequence>
      );
    })}
    <Audio src={P("pitch-bed.mp3")} volume={musicVolume} loop />
  </AbsoluteFill>
);
