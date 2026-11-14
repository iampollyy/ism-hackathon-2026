import { Audio } from "@remotion/media";
import { AbsoluteFill, Img, interpolate, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { Grain, Vignette } from "../Grain";
import { Caps } from "./Caps";
import { BODY, C, ease, HEAD, P, T } from "./theme";

/* ---------- building blocks ---------- */

/** Full-frame clip with a slow eased push-in. */
const Clip: React.FC<{
  src: string;
  trim: number;
  dur: number;
  z0?: number;
  z1?: number;
  origin?: string;
  punchAt?: number;
  shiftY?: number;
  bg?: string;
}> = ({ src, trim, dur, z0 = 1.02, z1 = 1.08, origin = "50% 45%", punchAt, shiftY = 0, bg = C.ink }) => {
  const frame = useCurrentFrame();
  let z = interpolate(frame, [0, dur], [z0, z1], { extrapolateRight: "clamp" });
  if (punchAt !== undefined) z += 0.05 * ease(frame, punchAt, 10);
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: bg }}>
      <OffthreadVideo
        src={P(src)}
        trimBefore={trim}
        muted
        style={{ width: "100%", height: "100%", objectFit: "cover", transform: `translateY(${shiftY}px) scale(${z})`, transformOrigin: origin }}
      />
    </AbsoluteFill>
  );
};

/** A bold text sticker. */
const Sticker: React.FC<{
  at: number;
  text: string;
  bg: string;
  fg: string;
  size?: number;
  top: number;
  out?: number;
  rotate?: number;
}> = ({ at, text, bg, fg, size = 92, top, out, rotate = 0 }) => {
  const frame = useCurrentFrame();
  const inn = ease(frame, at, 9);
  const gone = out === undefined ? 0 : ease(frame, out, 7);
  if (frame < at) return null;
  return (
    <div
      style={{
        position: "absolute",
        top,
        left: 56,
        opacity: inn * (1 - gone),
        transform: `translateX(${(1 - inn) * -40}px) rotate(${rotate}deg)`,
        transformOrigin: "left center",
      }}
    >
      <div
        style={{
          display: "inline-block",
          padding: `${size * 0.16}px ${size * 0.34}px ${size * 0.22}px`,
          borderRadius: size * 0.26,
          background: bg,
          color: fg,
          fontFamily: HEAD,
          fontWeight: 700,
          fontSize: size,
          lineHeight: 1.02,
          letterSpacing: -size * 0.03,
          boxShadow: "0 22px 60px rgba(0,0,0,0.45)",
          whiteSpace: "nowrap",
        }}
      >
        {text}
      </div>
    </div>
  );
};

/* ---------- scenes ---------- */

const Hero: React.FC = () => {
  const frame = useCurrentFrame();
  // red flash when the Shield turns the screen red
  const flash = frame >= T.flip ? 1 - ease(frame, T.flip, 16) : 0;
  return (
    <AbsoluteFill>
      <Sequence from={T.a} durationInFrames={T.b - T.a}>
        <Clip src="heroA.mp4" trim={2} dur={T.b - T.a} z0={1.0} z1={1.07} origin="42% 45%" />
      </Sequence>
      <Sequence from={T.b} durationInFrames={T.c - T.b}>
        <Clip src="heroB.mp4" trim={3} dur={T.c - T.b} z0={1.06} z1={1.1} origin="42% 42%" punchAt={T.flip - T.b} />
      </Sequence>
      <Sequence from={T.c} durationInFrames={T.beat1 - T.c}>
        <Clip src="heroC.mp4" trim={4} dur={T.beat1 - T.c} z0={1.14} z1={1.2} origin="42% 40%" />
      </Sequence>
      <Vignette strength={0.45} />
      {/* soft top scrim so the stickers read over the bright carpet */}
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(13,9,38,0.55) 0%, rgba(13,9,38,0) 34%)" }} />
      <AbsoluteFill style={{ background: C.danger, opacity: flash * 0.42, mixBlendMode: "screen" }} />

      <Sticker at={3} text="My friend's voice." bg={C.deep} fg="#fff" top={300} out={T.flip - 12} />
      <Sticker at={70} text="Not my friend." bg={C.pink} fg={C.deep} top={420} out={T.flip - 12} rotate={-2} />

      <Sticker at={T.flip} text="Callback caught it." bg={C.deep} fg="#fff" top={300} size={88} />
      <Sticker at={T.flip + 22} text="During the call." bg={C.pink} fg={C.deep} top={414} size={88} rotate={-2} />
    </AbsoluteFill>
  );
};

const Beats: React.FC = () => (
  <AbsoluteFill>
    <Sequence from={T.beat1} durationInFrames={T.beat2 - T.beat1}>
      <Clip src="shield.mp4" trim={99} dur={T.beat2 - T.beat1} z0={1.0} z1={1.05} origin="50% 30%" shiftY={120} bg="#1e1840" />
    </Sequence>
    <Sequence from={T.beat2} durationInFrames={T.beat3 - T.beat2}>
      <Clip src="shield.mp4" trim={613} dur={T.beat3 - T.beat2} z0={1.06} z1={1.12} origin="50% 12%" />
    </Sequence>
    <Sequence from={T.beat3} durationInFrames={T.team1 - T.beat3}>
      <Clip src="alert.mp4" trim={0} dur={T.team1 - T.beat3} z0={1.1} z1={1.15} origin="50% 0%" />
    </Sequence>
    <BeatChip />
  </AbsoluteFill>
);

/** Step counter for the three beats (1 2 3), top left under the platform UI. */
const BeatChip: React.FC = () => {
  const frame = useCurrentFrame();
  const starts = [T.beat1 + 87, T.beat2, T.beat3];
  if (frame < starts[0] || frame >= T.team1) return null;
  const idx = frame >= starts[2] ? 2 : frame >= starts[1] ? 1 : 0;
  const o = ease(frame, starts[0], 8) * (1 - ease(frame, T.team1 - 6, 6));
  return (
    <div style={{ position: "absolute", top: 268, right: 56, display: "flex", gap: 10, opacity: o }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            width: i === idx ? 70 : 22,
            height: 22,
            borderRadius: 11,
            background: i <= idx ? C.pink : "rgba(255,255,255,0.35)",
          }}
        />
      ))}
    </div>
  );
};

const Team: React.FC = () => {
  const frame = useCurrentFrame();
  const local = frame - T.team1;
  const inn = ease(local, 0, 10);
  const bandTop = 520;
  const bw = 1350;
  const bh = 760;
  const names = [
    { n: "Polina", x: 0.215 },
    { n: "Gangbi", x: 0.49 },
    { n: "Denis", x: 0.77 },
  ];
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse 90% 60% at 50% 40%, ${C.navy} 0%, ${C.deep} 60%, ${C.ink} 100%)` }}>
      <div style={{ position: "absolute", top: bandTop, left: 0, width: 1080, height: bh, overflow: "hidden", opacity: inn }}>
        <Sequence durationInFrames={T.team2 - T.team1} layout="none">
          <OffthreadVideo src={P("team1.mp4")} trimBefore={8} muted style={{ position: "absolute", left: (1080 - bw) / 2, width: bw, height: bh, objectFit: "cover" }} />
        </Sequence>
        <Sequence from={T.team2 - T.team1} layout="none">
          <OffthreadVideo src={P("team2.mp4")} trimBefore={5} muted style={{ position: "absolute", left: (1080 - bw) / 2, width: bw, height: bh, objectFit: "cover" }} />
        </Sequence>
        {names.map((p, i) => {
          const o = ease(local, 8 + i * 4, 10);
          return (
            <div
              key={p.n}
              style={{
                position: "absolute",
                bottom: 22,
                left: (1080 - bw) / 2 + p.x * bw,
                transform: `translateX(-50%) translateY(${(1 - o) * 10}px)`,
                opacity: o,
                padding: "8px 20px 10px",
                borderRadius: 999,
                background: "rgba(16, 11, 44, 0.85)",
                fontFamily: HEAD,
                fontWeight: 700,
                fontSize: 34,
                color: "#fff",
              }}
            >
              {p.n}
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", top: 272, left: 0, right: 0, textAlign: "center", opacity: ease(local, 2, 10), transform: `translateY(${(1 - ease(local, 2, 10)) * 16}px)` }}>
        <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 110, color: "#fff", letterSpacing: -3, lineHeight: 1 }}>Plan C</div>
        <div style={{ marginTop: 16, fontFamily: BODY, fontWeight: 600, fontSize: 38, color: C.lavender }}>
          Built in 48 hours · Unfair Weekend, Vilnius
        </div>
      </div>
    </AbsoluteFill>
  );
};

const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const local = frame - T.end;
  const logo = ease(local, 2, 14);
  const vote = ease(local, 26, 12);
  const small = ease(local, 38, 12);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse 90% 55% at 50% 38%, ${C.navy} 0%, ${C.deep} 58%, ${C.ink} 100%)` }}>
      <div style={{ position: "absolute", top: 470, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
        <Img
          src={P("callback-lockup-on-dark.png")}
          style={{ width: 760, opacity: logo, transform: `scale(${0.9 + 0.1 * logo})` }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          top: 880,
          left: 70,
          right: 70,
          textAlign: "center",
          opacity: vote,
          transform: `translateY(${(1 - vote) * 24}px)`,
          fontFamily: HEAD,
          fontWeight: 700,
          fontSize: 96,
          lineHeight: 1.06,
          letterSpacing: -2.5,
          color: "#fff",
        }}
      >
        Vote for Callback
        <br />
        <span style={{ color: C.pink }}>· link in bio</span>
      </div>
      <div
        style={{
          position: "absolute",
          top: 1170,
          left: 70,
          right: 70,
          textAlign: "center",
          opacity: small,
          fontFamily: BODY,
          fontWeight: 600,
          fontSize: 36,
          lineHeight: 1.4,
          color: C.lavender,
        }}
      >
        Plan C · Denis, Gangbi, Polina
        <br />
        Built in 48 hours in Vilnius
      </div>
    </AbsoluteFill>
  );
};

/* ---------- sound ---------- */

const Sound: React.FC = () => {
  const { durationInFrames } = useVideoConfig();
  const bed = (f: number) =>
    interpolate(
      f,
      [0, T.flip - 1, T.flip + 6, T.team1 - 1, T.team1 + 6, T.end + 30, T.end + 45, durationInFrames - 20, durationInFrames - 1],
      [0.035, 0.05, 0.08, 0.08, 0.065, 0.065, 0.28, 0.28, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );
  return (
    <>
      <Audio src={P("pitch-bed.mp3")} volume={bed} />
      {/* ring burst over the hook */}
      <Sequence durationInFrames={34}>
        <Audio src={P("ringtone.mp3")} volume={(f) => 0.5 * interpolate(f, [18, 33], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
      </Sequence>
      {/* call audio: the AI copy of Polina's voice, isolated and levelled (hero.wav starts at source 0.8 s) */}
      <Sequence from={T.a} durationInFrames={T.b - T.a}>
        <Audio src={P("hero.wav")} trimBefore={23} />
      </Sequence>
      <Sequence from={T.b} durationInFrames={T.c - T.b}>
        <Audio src={P("hero.wav")} trimBefore={690} />
      </Sequence>
      <Sequence from={T.c} durationInFrames={T.beat1 - T.c}>
        <Audio src={P("hero.wav")} trimBefore={985} volume={(f) => interpolate(f, [80, 89], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
      </Sequence>
      <Sequence from={T.flip - 1} durationInFrames={45}>
        <Audio src={P("alert.mp3")} volume={0.55} />
      </Sequence>
      <Sequence from={T.beat1 - 6} durationInFrames={40}>
        <Audio src={P("call-ended.mp3")} volume={0.25} />
      </Sequence>
      {/* Denis's cloned voice */}
      <Sequence from={388} durationInFrames={81}>
        <Audio src={P("vo.wav")} trimBefore={0} volume={0.86} />
      </Sequence>
      <Sequence from={472} durationInFrames={26}>
        <Audio src={P("vo.wav")} trimBefore={168} volume={1.08} />
      </Sequence>
      <Sequence from={504} durationInFrames={41}>
        <Audio src={P("vo.wav")} trimBefore={194} volume={1.08} />
      </Sequence>
      <Sequence from={552} durationInFrames={34}>
        <Audio src={P("vo.wav")} trimBefore={235} volume={1.08} />
      </Sequence>
      {[T.beat2 - 3, T.beat3 - 3, T.team1 - 4, T.end - 4].map((at) => (
        <Sequence key={at} from={at} durationInFrames={20}>
          <Audio src={P("whoosh.mp3")} volume={0.22} />
        </Sequence>
      ))}
      {/* the team */}
      <Sequence from={T.team1} durationInFrames={T.team2 - T.team1}>
        <Audio src={P("team1b.wav")} trimBefore={8} />
      </Sequence>
      <Sequence from={T.team2} durationInFrames={T.end - T.team2}>
        <Audio src={P("team2b.wav")} trimBefore={5} />
      </Sequence>
      <Sequence from={T.end + 3} durationInFrames={40}>
        <Audio src={P("team2.wav")} trimBefore={164} volume={(f) => interpolate(f, [32, 39], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
      </Sequence>
    </>
  );
};

/* ---------- the reel ---------- */

export const ReelShield: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: C.ink }}>
      {frame < T.beat1 && <Hero />}
      {frame >= T.beat1 && frame < T.team1 && <Beats />}
      {frame >= T.team1 && frame < T.end && <Team />}
      {frame >= T.end && <EndCard />}
      <Caps />
      <Grain opacity={0.05} />
      <Sound />
    </AbsoluteFill>
  );
};
