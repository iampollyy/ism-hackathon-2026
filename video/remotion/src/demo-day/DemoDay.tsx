// Demo Day backup video (see plan.ts for the spec, the sync and the measured event times).
// Silent render: the ring and alert chime are mixed in afterwards by work/demo-day/demo/build.sh.

import { AbsoluteFill, Easing, Img, interpolate, OffthreadVideo, Sequence, useCurrentFrame } from "remotion";
import { A, BODY, C, CAPS, f, HEAD, INSET, LABEL, LAP, PH, RINGS, T, TOTAL_S, ramp, type Cap } from "./plan";

/* ---------- shared pieces ---------- */

const Backdrop: React.FC = () => (
  <AbsoluteFill style={{ background: `radial-gradient(ellipse 90% 80% at 45% 35%, ${C.deep2} 0%, ${C.deep} 55%, ${C.ink} 100%)` }} />
);

/** A small pill tag sitting on the top edge of a panel. */
const Tag: React.FC<{ x: number; y: number; text: string; opacity?: number }> = ({ x, y, text, opacity = 1 }) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      opacity,
      padding: "6px 16px 8px",
      borderRadius: 999,
      background: C.deep,
      border: `2px solid ${C.accent}`,
      color: C.onDeep,
      fontFamily: BODY,
      fontWeight: 600,
      fontSize: 24,
      lineHeight: 1.1,
      whiteSpace: "nowrap",
      boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
    }}
  >
    {text}
  </div>
);

/** Persistent label, top left, the whole video. */
const Label: React.FC = () => (
  <div
    style={{
      position: "absolute",
      left: 60,
      top: 22,
      padding: "6px 16px 8px",
      borderRadius: 12,
      background: "rgba(13, 10, 36, 0.72)",
      color: C.onDeep,
      fontFamily: BODY,
      fontWeight: 600,
      fontSize: 26,
      lineHeight: 1.15,
      whiteSpace: "nowrap",
    }}
  >
    {LABEL}
  </div>
);

/** An accent ring around a UI element (canvas px), visible between two V times. */
const Ring: React.FC<{ x: number; y: number; w: number; h: number; from: number; to: number }> = ({ x, y, w, h, from, to }) => {
  const frame = useCurrentFrame();
  const a = ramp(frame, f(from), f(from) + 8);
  const b = 1 - ramp(frame, f(to) - 6, f(to));
  const o = Math.min(a, b);
  if (o <= 0) return null;
  const grow = (1 - a) * 10;
  return (
    <div
      style={{
        position: "absolute",
        left: x - grow,
        top: y - grow,
        width: w + 2 * grow,
        height: h + 2 * grow,
        borderRadius: 18,
        border: `5px solid ${C.accent}`,
        boxShadow: `0 0 0 3px rgba(216,206,255,0.55), 0 0 28px rgba(115,90,200,0.75)`,
        opacity: o,
      }}
    />
  );
};

/** The caption band: one caption at a time, white on deep at 85%, bottom left, Inter SemiBold. */
const Caption: React.FC<{ cap: Cap; centred?: boolean; size?: number }> = ({ cap, centred = false, size = 46 }) => {
  const frame = useCurrentFrame();
  const inn = ramp(frame, f(cap.from), f(cap.from) + 6);
  if (frame < f(cap.from) || frame >= f(cap.to)) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: centred ? 0 : 60,
        right: centred ? 0 : undefined,
        bottom: 30,
        display: "flex",
        justifyContent: centred ? "center" : "flex-start",
        opacity: inn,
        transform: `translateY(${(1 - inn) * 12}px)`,
      }}
    >
      <div
        style={{
          maxWidth: centred ? 1500 : 1140,
          padding: "16px 28px 19px",
          borderRadius: 18,
          background: "rgba(29, 22, 71, 0.85)",
          boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
          color: "#ffffff",
          fontFamily: BODY,
          fontWeight: 600,
          fontSize: size,
          lineHeight: 1.22,
          letterSpacing: -0.3,
          textAlign: centred ? "center" : "left",
        }}
      >
        {cap.heard ? (
          <>
            <span style={{ color: C.pink }}>Callback heard: </span>
            {cap.heard}
            {cap.text}
          </>
        ) : (
          cap.text
        )}
      </div>
    </div>
  );
};

/* ---------- scene 1: title card (0.0-2.5) ---------- */

const TitleCard: React.FC = () => {
  const frame = useCurrentFrame();
  const logo = ramp(frame, 0, 14);
  const head = ramp(frame, 5, 20);
  const sub = ramp(frame, 12, 28);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <Img src={A("mark.png")} style={{ width: 150, height: 150, opacity: logo, transform: `scale(${0.85 + 0.15 * logo})` }} />
      <div
        style={{
          marginTop: 44,
          fontFamily: HEAD,
          fontWeight: 700,
          fontSize: 82,
          letterSpacing: -2.5,
          color: C.onDeep,
          opacity: head,
          transform: `translateY(${(1 - head) * 20}px)`,
        }}
      >
        A Shield call, recorded on the live site.
      </div>
      <div style={{ marginTop: 26, fontFamily: BODY, fontWeight: 600, fontSize: 44, color: C.lavender, opacity: sub }}>
        The caller is an AI voice. The scam is simulated.
      </div>
    </AbsoluteFill>
  );
};

/* ---------- scene 2: the call, side by side (2.5-30.0) ---------- */

const LaptopPanel: React.FC = () => {
  const lStart = f(T.lStart) - f(T.split); // frames into this scene
  const media = {
    position: "absolute" as const,
    left: -LAP.cropX * LAP.scale,
    top: 0,
    width: 1920 * LAP.scale,
    height: 1080 * LAP.scale,
  };
  return (
    <div
      style={{
        position: "absolute",
        left: LAP.x,
        top: LAP.y,
        width: LAP.w,
        height: LAP.h,
        borderRadius: 18,
        overflow: "hidden",
        background: "#eef0ff",
        boxShadow: "0 30px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.10)",
      }}
    >
      <Sequence durationInFrames={lStart} layout="none">
        <Img src={A("L0.png")} style={media} />
      </Sequence>
      <Sequence from={lStart} layout="none">
        <OffthreadVideo src={A("L.mp4")} muted style={media} />
      </Sequence>
    </div>
  );
};

const PhonePanel: React.FC = () => {
  const bezel = 14;
  // P = V - 0.5, so the scene opens on P frame 60. The ring starts at P frame 66: hold that frame
  // for the first 6 frames, then play P 66..864, then hold P frame 865.
  const ringAt = 6;
  const pFrames = 865 - 60;
  const media = { position: "absolute" as const, left: 0, top: 0, width: PH.w, height: PH.h };
  return (
    <div
      style={{
        position: "absolute",
        left: PH.x - bezel,
        top: PH.y - bezel,
        width: PH.w + 2 * bezel,
        height: PH.h + 2 * bezel,
        borderRadius: 54,
        padding: bezel,
        background: "linear-gradient(150deg, #4a4a55 0%, #15151b 22%, #0b0b10 60%, #34343d 100%)",
        boxShadow: "0 40px 90px rgba(0,0,0,0.65), inset 0 0 0 2px rgba(255,255,255,0.10)",
      }}
    >
      <div style={{ position: "relative", width: PH.w, height: PH.h, borderRadius: 40, overflow: "hidden", background: "#000" }}>
        <Sequence durationInFrames={ringAt} layout="none">
          <Img src={A("Pring.png")} style={media} />
        </Sequence>
        <Sequence from={ringAt} durationInFrames={pFrames - ringAt} layout="none">
          <OffthreadVideo src={A("P.mp4")} trimBefore={60 + ringAt} muted style={media} />
        </Sequence>
        <Sequence from={pFrames} layout="none">
          <Img src={A("Pend.png")} style={media} />
        </Sequence>
      </div>
    </div>
  );
};

/** The family member's phone, slid in over the top right of the laptop when the alert goes out. */
const FamilyInset: React.FC = () => {
  const frame = useCurrentFrame(); // frames since T.alert
  const inn = ramp(frame, 0, 12);
  const media = {
    position: "absolute" as const,
    left: 0,
    top: -INSET.cropY * INSET.scale,
    width: 1080 * INSET.scale,
    height: 1920 * INSET.scale,
  };
  return (
    <div style={{ position: "absolute", inset: 0, opacity: inn, transform: `translateY(${(1 - inn) * -36}px)` }}>
      <div
        style={{
          position: "absolute",
          left: INSET.x,
          top: INSET.y,
          width: INSET.w,
          height: INSET.h,
          borderRadius: 20,
          overflow: "hidden",
          border: `3px solid ${C.onDeep}`,
          boxShadow: "0 30px 80px rgba(13,10,36,0.6), 0 10px 26px rgba(13,10,36,0.45)",
          background: "#eef0ff",
        }}
      >
        <Sequence durationInFrames={135} layout="none">
          <OffthreadVideo src={A("F.mp4")} muted style={media} />
        </Sequence>
        <Sequence from={135} layout="none">
          <Img src={A("Fend.png")} style={media} />
        </Sequence>
      </div>
      <Tag x={INSET.x + 20} y={INSET.y - 20} text="Family phone" />
    </div>
  );
};

const CallScene: React.FC = () => {
  const frame = useCurrentFrame(); // frames since T.split
  const inn = ramp(frame, 0, 9);
  return (
    <AbsoluteFill style={{ opacity: inn }}>
      <LaptopPanel />
      <PhonePanel />
      <Tag x={LAP.x + 22} y={LAP.y - 18} text="The family's live view" />
      <Tag x={PH.x + 22} y={PH.y - 32} text="Anna's phone" />
      <Sequence from={f(T.alert) - f(T.split)} layout="none">
        <FamilyInset />
      </Sequence>
    </AbsoluteFill>
  );
};

/* ---------- scene 3: full-frame still of the red warning (30.0-36.0) ---------- */

const RedStill: React.FC = () => {
  const frame = useCurrentFrame(); // frames since the scene starts (V 29.85)
  const dur = f(T.end) - f(T.still);
  const p = interpolate(frame, [5, dur + 5], [0, 1], {
    easing: Easing.inOut(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // source point (540, cy) sits at canvas (960, Y), scale s: from headline + labels to the six labels
  // ends at scale 1.55 with "What we heard" (source y ~721) at canvas y ~150, clear of the label bar
  const s = 0.94 + 0.61 * p;
  const cy = 700 + 245 * p;
  const Y = 522 - 25 * p;
  const top = Y - cy * s;
  const h = 1920 * s;
  const inn = ramp(frame, 0, 9);
  return (
    <AbsoluteFill style={{ opacity: inn, overflow: "hidden", background: "#9e1d29" }}>
      {/* the screen's own red gradient, stretched sideways so the edges match */}
      <Img src={A("Pred-edge.png")} style={{ position: "absolute", left: 0, top, width: 1920, height: h }} />
      <Img src={A("Pred.png")} style={{ position: "absolute", left: 960 - 540 * s, top, width: 1080 * s, height: h }} />
      {/* calm band under the caption */}
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(29,22,71,0) 72%, rgba(29,22,71,0.92) 90%, rgba(29,22,71,0.96) 100%)" }} />
    </AbsoluteFill>
  );
};

/* ---------- scene 4: end card (36.0-40.0) ---------- */

const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const inn = ramp(frame, 0, 9);
  const logo = ramp(frame, 3, 18);
  const line = ramp(frame, 9, 24);
  const sub = ramp(frame, 16, 32);
  return (
    <AbsoluteFill style={{ opacity: inn }}>
      <Backdrop />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <Img src={A("lockup.png")} style={{ width: 560, opacity: logo, transform: `scale(${0.92 + 0.08 * logo})` }} />
        <div
          style={{
            marginTop: 60,
            fontFamily: HEAD,
            fontWeight: 700,
            fontSize: 84,
            letterSpacing: -2.5,
            color: C.onDeep,
            opacity: line,
            transform: `translateY(${(1 - line) * 20}px)`,
          }}
        >
          Live on callback.denishoti.dev
        </div>
        <div style={{ marginTop: 26, fontFamily: BODY, fontWeight: 600, fontSize: 44, color: C.lavender, opacity: sub }}>
          Calls run through the Callback app today. Forwarding phone calls is next.
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ---------- the whole video ---------- */

export const DemoDay: React.FC = () => {
  const frame = useCurrentFrame();
  const titleOut = 1 - ramp(frame, f(2.3), f(2.6));
  const X = 5; // crossfade overlap, frames
  return (
    <AbsoluteFill style={{ backgroundColor: C.deep }}>
      <Backdrop />
      <Sequence from={f(T.split)} durationInFrames={f(T.still) - f(T.split) + X} layout="none">
        <CallScene />
      </Sequence>
      <Sequence durationInFrames={f(2.6)} layout="none">
        <AbsoluteFill style={{ opacity: titleOut }}>
          <Backdrop />
          <TitleCard />
        </AbsoluteFill>
      </Sequence>
      <Sequence from={f(T.still) - X} durationInFrames={f(T.end) - f(T.still) + 2 * X} layout="none">
        <RedStill />
      </Sequence>
      <Sequence from={f(T.end) - X} layout="none">
        <EndCard />
      </Sequence>

      {RINGS.map((r, i) => (
        <Ring key={i} {...r} />
      ))}
      {CAPS.map((cap, i) => (
        <Caption key={i} cap={cap} />
      ))}
      <Caption cap={{ from: T.still, to: T.end, text: "It never judged the voice. Only what was asked." }} centred size={60} />
      {frame < f(TOTAL_S) && <Label />}
    </AbsoluteFill>
  );
};
