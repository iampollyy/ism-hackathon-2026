// Demo Day slide 2 hook: "The clone calls". 11.5 s, 1920x1080.
// Spec: work/demo-day/outline.md, "Hook clip spec". Source IMG_2157 (pitch v6 framing, public/pitch/hookA.mp4 = IMG_2157 1.5-9.8 s
// with the cleaned call audio). The ask plays as audio only over a dimmed freeze, because the red Shield screen is up from 27.5 s.

import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from "remotion";
import { A, BODY, C, HEAD, f, ramp } from "./plan";

export const HOOK_S = 11.5;

const CAPS: { from: number; to: number; text: string }[] = [
  { from: 0.24, to: 3.1, text: "Denis?" },
  { from: 3.16, to: 4.2, text: "It's me." },
  { from: 4.24, to: 6.7, text: "I dropped my phone, so this is a new number." },
  { from: 7.3, to: 10.2, text: "Could you transfer a few hundred euros to my friend's account?" },
];

const Cap: React.FC<{ from: number; to: number; text: string }> = ({ from, to, text }) => {
  const frame = useCurrentFrame();
  if (frame < f(from) || frame >= f(to)) return null;
  const inn = ramp(frame, f(from), f(from) + 5);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 64, display: "flex", justifyContent: "center", opacity: inn }}>
      <div
        style={{
          maxWidth: 1500,
          padding: "16px 30px 19px",
          borderRadius: 18,
          background: "rgba(29, 22, 71, 0.85)",
          boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
          color: "#ffffff",
          fontFamily: BODY,
          fontWeight: 600,
          fontSize: 56,
          lineHeight: 1.2,
          letterSpacing: -0.3,
          textAlign: "center",
        }}
      >
        {text}
      </div>
    </div>
  );
};

const Label: React.FC = () => (
  <div
    style={{
      position: "absolute",
      left: 60,
      top: 40,
      padding: "8px 18px 10px",
      borderRadius: 12,
      background: "rgba(13, 10, 36, 0.72)",
      color: C.onDeep,
      fontFamily: BODY,
      fontWeight: 600,
      fontSize: 30,
      lineHeight: 1.15,
      whiteSpace: "nowrap",
    }}
  >
    AI voice · Polina's clone, made with her consent
  </div>
);

const Freeze: React.FC = () => {
  const frame = useCurrentFrame(); // from 6.7 s
  const dim = ramp(frame, 0, 8);
  const later = Math.min(ramp(frame, 2, 9), 1 - ramp(frame, f(3.4), f(3.4) + 8));
  const end = ramp(frame, f(3.5), f(3.5) + 9);
  return (
    <AbsoluteFill>
      <Img src={A("hook-freeze.png")} style={{ width: 1920, height: 1080 }} />
      <AbsoluteFill style={{ background: C.deep, opacity: 0.65 * dim }} />
      <div
        style={{
          position: "absolute",
          top: 170,
          left: 0,
          right: 0,
          textAlign: "center",
          opacity: later,
          color: C.onDeep,
          fontFamily: BODY,
          fontWeight: 600,
          fontSize: 40,
          letterSpacing: 0.5,
        }}
      >
        Later in the same call
      </div>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: end }}>
        <div
          style={{
            fontFamily: HEAD,
            fontWeight: 700,
            fontSize: 132,
            letterSpacing: -4,
            lineHeight: 1.02,
            color: "#ffffff",
            textAlign: "center",
            transform: `translateY(${(1 - end) * 14}px)`,
          }}
        >
          Her voice.
          <br />
          <span style={{ color: C.pink }}>Not her words.</span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const DemoDayHook: React.FC = () => (
  <AbsoluteFill style={{ background: C.deep }}>
    <Sequence durationInFrames={f(6.7)}>
      <OffthreadVideo src={staticFile("pitch/hookA.mp4")} startFrom={f(0.8)} style={{ width: 1920, height: 1080 }} />
    </Sequence>
    <Sequence from={f(6.7)}>
      <Freeze />
    </Sequence>
    <Sequence from={f(7.2)} durationInFrames={f(3.0)}>
      <Audio src={A("hook-ask.wav")} />
    </Sequence>
    {CAPS.map((c) => (
      <Cap key={c.text} {...c} />
    ))}
    <Label />
  </AbsoluteFill>
);
