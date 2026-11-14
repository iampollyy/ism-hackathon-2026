// The submission video's animated cards: TitleCard, HowItWorks, Roadmap and
// EndCard. Each lays itself out for 1920x1080 or 1080x1920 (the *Vertical
// compositions in Root.tsx). Silent: the team records the voice-over.
// Words live in COPY below, so a text edit never touches the animation.

import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Grain, Vignette } from "./Grain";
import { BODY, C, HEAD } from "./timing";

export const COPY = {
  title: "Callback",
  tagline: "A voice agent that guards your family's phone.",
  howTitle: "How Callback guards a call",
  steps: [
    { title: "The caller speaks", text: "A real call, through Callback" },
    { title: "Every sentence turned into text", text: "Live, with ElevenLabs" },
    { title: "A risk check on each sentence", text: "Money today, secrecy, a new number" },
    { title: "A warning on the phone", text: "In about 2 seconds" },
    { title: "The family is alerted", text: "Everyone on the family plan" },
  ],
  consent: "Consent at every step",
  newsNote: "Scam news rebuilt every hour from official warnings",
  roadmapTitle: "Where Callback goes",
  stages: [
    { when: "Today", text: "Guards calls through Callback" },
    { when: "Next", text: "Answers unknown numbers for your parents and lets only real people through" },
    {
      when: "Later",
      text: "Makes the boring calls for you (waiting on hold, bookings) and hands over when a person answers, always saying it's an assistant",
    },
  ],
  pricing: "Families €4.99 a month · Banks pay to protect their customers",
  endLine: "Set a family word tonight.",
  url: "callback.denishoti.dev",
};

/** Layout helpers: portrait or landscape, and a unit that scales with the frame. */
function useLayout() {
  const { width, height, fps } = useVideoConfig();
  const portrait = height > width;
  const u = (portrait ? width : height) / 1080; // 1 at 1080 on the short side
  return { width, height, fps, portrait, u };
}

const appear = (frame: number, fps: number, from: number, damping = 16) =>
  spring({ frame: frame - from, fps, config: { damping, stiffness: 110 } });

/** Deep indigo with two soft, slowly drifting lights. */
const Backdrop: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useLayout();
  const lights = [
    { x: 0.18, y: 0.22, r: 0.42, c: C.accent, o: 0.32 },
    { x: 0.84, y: 0.78, r: 0.38, c: C.pink, o: 0.16 },
  ];
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse 90% 80% at 50% 40%, ${C.deep2} 0%, ${C.deep} 55%, #0d0a24 100%)` }}>
      {lights.map((l, i) => {
        const size = Math.max(width, height) * l.r;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: l.x * width - size / 2 + Math.sin((frame + i * 60) / 80) * 30,
              top: l.y * height - size / 2 + Math.cos((frame + i * 50) / 95) * 24,
              width: size,
              height: size,
              borderRadius: "50%",
              background: l.c,
              opacity: l.o,
              filter: `blur(${size / 5}px)`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

const Frame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill>
    <Backdrop />
    {children}
    <Vignette strength={0.45} />
    <Grain opacity={0.05} />
  </AbsoluteFill>
);

// ---------------------------------------------------------------- icons (stroke, 24x24)

const Icon: React.FC<{ d: string; size: number; color: string }> = ({ d, size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    {d.split("|").map((part, i) => (
      <path key={i} d={part} />
    ))}
  </svg>
);

const ICONS = [
  // phone with sound waves: the caller speaks
  "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2|M15 3a6 6 0 0 1 6 6|M15 7a2 2 0 0 1 2 2",
  // lines of text: the transcript
  "M4 6h16|M4 10h12|M4 14h16|M4 18h9",
  // a gauge: the risk check
  "M12 14l4-4|M3.5 18a9 9 0 1 1 17 0|M7 18h10",
  // a warning triangle
  "M12 3l10 18H2z|M12 10v4|M12 17.5v.5",
  // a group: the family
  "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8|M2 21v-1a6 6 0 0 1 12 0v1|M17 11a3 3 0 1 0 0-6|M18 21v-1a5 5 0 0 0-3-4.6",
];

// ---------------------------------------------------------------- TitleCard (4 s)

export const TitleCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, portrait, u } = useLayout();
  const logo = appear(frame, fps, 0, 13);
  const word = appear(frame, fps, 8);
  const line = appear(frame, fps, 22, 20);
  const out = interpolate(frame, [104, 120], [1, 0], { extrapolateLeft: "clamp" });
  return (
    <Frame>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: out }}>
        <div style={{ display: "flex", flexDirection: portrait ? "column" : "row", alignItems: "center", gap: 44 * u }}>
          <Img
            src={staticFile("brand/callback-mark-white.svg")}
            style={{ width: 190 * u, height: 190 * u, transform: `scale(${logo}) rotate(${(1 - logo) * -40}deg)` }}
          />
          <div
            style={{
              fontFamily: HEAD,
              fontWeight: 700,
              fontSize: 176 * u,
              letterSpacing: -6 * u,
              color: C.onDeep,
              opacity: word,
              transform: `translateX(${portrait ? 0 : (1 - word) * -40 * u}px) translateY(${portrait ? (1 - word) * 30 * u : 0}px)`,
            }}
          >
            {COPY.title}
          </div>
        </div>
        <div
          style={{
            marginTop: 54 * u,
            maxWidth: (portrait ? 900 : 1400) * u,
            textAlign: "center",
            fontFamily: BODY,
            fontWeight: 600,
            fontSize: 52 * u,
            lineHeight: 1.3,
            color: C.lavender,
            opacity: line,
            transform: `translateY(${(1 - line) * 24 * u}px)`,
          }}
        >
          {COPY.tagline}
        </div>
      </AbsoluteFill>
    </Frame>
  );
};

// ---------------------------------------------------------------- HowItWorks (22 s)

const STEP_EVERY = 66; // a new step every 2.2 s
const STEP_FROM = 34;
const CONSENT_FROM = STEP_FROM + STEP_EVERY * 5 + 20;
const NOTE_FROM = CONSENT_FROM + 50;

export const HowItWorks: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, portrait, u, width, height } = useLayout();
  const head = appear(frame, fps, 0);

  // Card geometry: a row across (landscape) or a column down (portrait).
  const n = COPY.steps.length;
  const gap = (portrait ? 34 : 34) * u;
  const cardW = portrait ? 860 * u : (width - 2 * 110 * u - (n - 1) * gap) / n;
  const cardH = portrait ? 196 * u : 470 * u;
  const originX = portrait ? (width - cardW) / 2 : 110 * u;
  const originY = portrait ? 330 * u : 250 * u;
  const pos = (i: number) =>
    portrait ? { x: originX, y: originY + i * (cardH + gap) } : { x: originX + i * (cardW + gap), y: originY };

  return (
    <Frame>
      <div
        style={{
          position: "absolute",
          top: (portrait ? 150 : 120) * u,
          width: "100%",
          textAlign: "center",
          fontFamily: HEAD,
          fontWeight: 700,
          fontSize: (portrait ? 68 : 76) * u,
          letterSpacing: -2 * u,
          color: C.onDeep,
          opacity: head,
          transform: `translateY(${(1 - head) * 20 * u}px)`,
        }}
      >
        {COPY.howTitle}
      </div>

      {/* connectors, drawn as each next step arrives, with a light running along */}
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        {COPY.steps.slice(1).map((_, k) => {
          const i = k + 1;
          const a = pos(i - 1);
          const b = pos(i);
          const x1 = portrait ? a.x + cardW / 2 : a.x + cardW;
          const y1 = portrait ? a.y + cardH : a.y + cardH / 2;
          const x2 = portrait ? b.x + cardW / 2 : b.x;
          const y2 = portrait ? b.y : b.y + cardH / 2;
          const drawn = interpolate(frame, [STEP_FROM + i * STEP_EVERY - 18, STEP_FROM + i * STEP_EVERY], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const run = ((frame - (STEP_FROM + i * STEP_EVERY)) % 45) / 45;
          const show = frame > STEP_FROM + i * STEP_EVERY;
          return (
            <g key={i}>
              <line
                x1={x1}
                y1={y1}
                x2={x1 + (x2 - x1) * drawn}
                y2={y1 + (y2 - y1) * drawn}
                stroke={C.lavender}
                strokeOpacity={0.55}
                strokeWidth={3 * u}
              />
              {show && (
                <circle cx={x1 + (x2 - x1) * run} cy={y1 + (y2 - y1) * run} r={5 * u} fill={i === 3 ? C.danger : C.pink} />
              )}
            </g>
          );
        })}
      </svg>

      {COPY.steps.map((step, i) => {
        const from = STEP_FROM + i * STEP_EVERY;
        const s = appear(frame, fps, from);
        const warn = i === 3;
        const p = pos(i);
        const pulse = warn && frame > from ? 1 + Math.max(0, Math.sin((frame - from) / 6)) * 0.04 : 1;
        const accent = warn ? C.danger : i === 4 ? C.pink : C.accentFill;
        return (
          <div
            key={step.title}
            style={{
              position: "absolute",
              left: p.x,
              top: p.y,
              width: cardW,
              height: cardH,
              boxSizing: "border-box",
              padding: (portrait ? 30 : 34) * u,
              borderRadius: 30 * u,
              background: warn ? "rgba(224, 71, 94, 0.16)" : "rgba(241, 238, 255, 0.07)",
              border: `${2 * u}px solid ${warn ? C.danger : "rgba(241, 238, 255, 0.16)"}`,
              boxShadow: warn ? `0 0 ${60 * u}px rgba(224, 71, 94, 0.35)` : "none",
              display: "flex",
              flexDirection: portrait ? "row" : "column",
              alignItems: portrait ? "center" : "flex-start",
              gap: 26 * u,
              opacity: s,
              transform: `translateY(${(1 - s) * 36 * u}px) scale(${(0.96 + 0.04 * s) * pulse})`,
            }}
          >
            <div
              style={{
                flexShrink: 0,
                width: 96 * u,
                height: 96 * u,
                borderRadius: 26 * u,
                display: "grid",
                placeItems: "center",
                background: warn ? "rgba(224, 71, 94, 0.22)" : "rgba(145, 122, 229, 0.2)",
              }}
            >
              <Icon d={ICONS[i]} size={54 * u} color={accent} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 * u }}>
              <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: (portrait ? 38 : 35) * u, lineHeight: 1.15, color: C.onDeep }}>
                {step.title}
              </div>
              <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: 27 * u, lineHeight: 1.35, color: warn ? "#ffb3bf" : C.onDeepMuted }}>
                {step.text}
              </div>
            </div>
          </div>
        );
      })}

      {/* consent band and the news note, under everything */}
      {(() => {
        const s = appear(frame, fps, CONSENT_FROM);
        const nn = appear(frame, fps, NOTE_FROM, 20);
        const bandTop = portrait ? originY + n * (cardH + gap) + 10 * u : originY + cardH + 60 * u;
        const bandW = portrait ? cardW : width - 2 * 110 * u;
        return (
          <>
            <div
              style={{
                position: "absolute",
                left: portrait ? originX : 110 * u,
                top: bandTop,
                width: bandW,
                height: 92 * u,
                borderRadius: 24 * u,
                background: "rgba(145, 122, 229, 0.18)",
                border: `${2 * u}px solid rgba(216, 206, 255, 0.35)`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 18 * u,
                fontFamily: HEAD,
                fontWeight: 700,
                fontSize: 40 * u,
                color: C.onDeep,
                opacity: s,
                transform: `scaleX(${0.85 + 0.15 * s})`,
              }}
            >
              <Icon d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z|M8.5 12l2.5 2.5 4.5-5" size={44 * u} color={C.lavender} />
              {COPY.consent}
            </div>
            <div
              style={{
                position: "absolute",
                top: bandTop + 92 * u + 34 * u,
                width: "100%",
                textAlign: "center",
                fontFamily: BODY,
                fontWeight: 600,
                fontSize: 30 * u,
                color: C.onDeepMuted,
                opacity: nn,
              }}
            >
              {COPY.newsNote}
            </div>
          </>
        );
      })()}
    </Frame>
  );
};

// ---------------------------------------------------------------- Roadmap (20 s)

const STAGE_FROM = [30, 165, 300];
const PRICE_FROM = 440;

export const Roadmap: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, portrait, u, width } = useLayout();
  const head = appear(frame, fps, 0);
  const n = COPY.stages.length;
  const gap = 40 * u;
  const colW = portrait ? 880 * u : (width - 2 * 120 * u - (n - 1) * gap) / n;
  const top = portrait ? 360 * u : 300 * u;
  const rowH = portrait ? 330 * u : 0;
  const lineProgress = interpolate(frame, [STAGE_FROM[0], STAGE_FROM[2] + 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const price = appear(frame, fps, PRICE_FROM, 18);
  return (
    <Frame>
      <div
        style={{
          position: "absolute",
          top: (portrait ? 160 : 120) * u,
          width: "100%",
          textAlign: "center",
          fontFamily: HEAD,
          fontWeight: 700,
          fontSize: 76 * u,
          letterSpacing: -2 * u,
          color: C.onDeep,
          opacity: head,
        }}
      >
        {COPY.roadmapTitle}
      </div>

      {/* the track the stages sit on */}
      {portrait ? (
        <div
          style={{
            position: "absolute",
            left: (width - colW) / 2 + 22 * u,
            top: top + 22 * u,
            width: 4 * u,
            height: (n - 1) * rowH * lineProgress,
            background: `linear-gradient(${C.pink}, ${C.accentFill})`,
            borderRadius: 4 * u,
          }}
        />
      ) : (
        <div
          style={{
            position: "absolute",
            left: 120 * u + 22 * u,
            top: top + 22 * u,
            height: 4 * u,
            width: (width - 2 * 120 * u - colW) * lineProgress,
            background: `linear-gradient(90deg, ${C.pink}, ${C.accentFill})`,
            borderRadius: 4 * u,
          }}
        />
      )}

      {COPY.stages.map((stage, i) => {
        const s = appear(frame, fps, STAGE_FROM[i]);
        const now = i === 0;
        const x = portrait ? (width - colW) / 2 : 120 * u + i * (colW + gap);
        const y = portrait ? top + i * rowH : top;
        const glow = now ? 0.6 + Math.sin(frame / 9) * 0.4 : 0;
        return (
          <div key={stage.when} style={{ position: "absolute", left: x, top: y, width: colW, opacity: s }}>
            <div
              style={{
                width: 48 * u,
                height: 48 * u,
                borderRadius: "50%",
                background: now ? C.pink : C.deep,
                border: `${4 * u}px solid ${now ? C.pink : C.accentFill}`,
                boxShadow: now ? `0 0 ${36 * u * glow}px ${C.pink}` : "none",
                transform: `scale(${s})`,
              }}
            />
            <div
              style={{
                marginLeft: portrait ? 90 * u : 0,
                marginTop: portrait ? -48 * u : 36 * u,
                transform: `translateY(${(1 - s) * 26 * u}px)`,
              }}
            >
              <div
                style={{
                  fontFamily: HEAD,
                  fontWeight: 700,
                  fontSize: 58 * u,
                  color: now ? C.pink : C.onDeep,
                  letterSpacing: -1 * u,
                }}
              >
                {stage.when}
              </div>
              <div
                style={{
                  marginTop: 14 * u,
                  maxWidth: portrait ? 760 * u : colW - 20 * u,
                  fontFamily: BODY,
                  fontWeight: 600,
                  fontSize: 34 * u,
                  lineHeight: 1.4,
                  color: C.onDeepMuted,
                }}
              >
                {stage.text}
              </div>
            </div>
          </div>
        );
      })}

      <div
        style={{
          position: "absolute",
          bottom: (portrait ? 230 : 120) * u,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          opacity: price,
          transform: `translateY(${(1 - price) * 24 * u}px)`,
        }}
      >
        <div
          style={{
            padding: `${22 * u}px ${44 * u}px`,
            maxWidth: portrait ? 900 * u : undefined,
            textAlign: "center",
            borderRadius: 999,
            background: "rgba(241, 238, 255, 0.1)",
            border: `${2 * u}px solid rgba(241, 238, 255, 0.22)`,
            fontFamily: HEAD,
            fontWeight: 700,
            fontSize: 40 * u,
            color: C.onDeep,
          }}
        >
          {COPY.pricing}
        </div>
      </div>
    </Frame>
  );
};

// ---------------------------------------------------------------- EndCard (5 s)

export const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, u } = useLayout();
  const logo = appear(frame, fps, 0, 13);
  const line = appear(frame, fps, 10);
  const url = appear(frame, fps, 24, 20);
  const glow = 0.5 + Math.sin(frame / 10) * 0.15;
  return (
    <Frame>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div style={{ position: "relative", display: "grid", placeItems: "center" }}>
          <div
            style={{
              position: "absolute",
              width: 460 * u,
              height: 460 * u,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${C.pink}55 0%, transparent 65%)`,
              opacity: glow,
            }}
          />
          <Img src={staticFile("brand/callback-mark-white.svg")} style={{ width: 230 * u, height: 230 * u, transform: `scale(${logo})` }} />
        </div>
        <div
          style={{
            marginTop: 70 * u,
            textAlign: "center",
            fontFamily: HEAD,
            fontWeight: 700,
            fontSize: 96 * u,
            letterSpacing: -3 * u,
            lineHeight: 1.1,
            color: C.onDeep,
            maxWidth: 1500 * u,
            opacity: line,
            transform: `translateY(${(1 - line) * 30 * u}px)`,
          }}
        >
          {COPY.endLine}
        </div>
        <div style={{ marginTop: 36 * u, fontFamily: BODY, fontWeight: 600, fontSize: 44 * u, color: C.lavender, opacity: url }}>
          {COPY.url}
        </div>
      </AbsoluteFill>
    </Frame>
  );
};

export const CARDS = [
  { id: "TitleCard", component: TitleCard, frames: 120 },
  { id: "HowItWorks", component: HowItWorks, frames: 660 },
  { id: "Roadmap", component: Roadmap, frames: 600 },
  { id: "EndCard", component: EndCard, frames: 150 },
] as const;
