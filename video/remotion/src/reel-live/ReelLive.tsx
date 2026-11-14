import { Audio, Video } from "@remotion/media";
import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Grain } from "../Grain";
import { LiveCaptions } from "./LiveCaptions";
import { AI_VOICE, BODY, C, Cam, HEAD, Mark, S, SCENES, Scene, TOTAL_S, V11_AT, VO_END, WORDS } from "./plan";

const f = (name: string) => staticFile(`reel-live/${name}`);
const EASE = Easing.bezier(0.45, 0, 0.2, 1);
const OUT = Easing.bezier(0.16, 1, 0.3, 1);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

// Layout (1080x1920). Platform UI covers the top 12% (230 px) and bottom 22% (from 1498 px).
const CARD = { x: 40, y: 318, w: 1000, h: 930 };
const LABEL_Y = 246;

export const ReelLive: React.FC = () => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: C.deeper }}>
      <Backdrop />
      {SCENES.map((scene, i) => (
        <Sequence
          key={i}
          from={Math.round(scene.from * fps)}
          durationInFrames={Math.round((scene.to - scene.from) * fps)}
          layout="absolute-fill"
        >
          <SceneView scene={scene} />
        </Sequence>
      ))}
      <LiveCaptions words={WORDS} hideFrom={S.shout} />
      <AiVoiceTag />
      <Grain opacity={0.05} />
      <Sound />
    </AbsoluteFill>
  );
};

/** Deep brand background with a slow drifting glow. */
const Backdrop: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / 30;
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse 80% 45% at ${50 + Math.sin(t / 3) * 12}% ${32 + Math.cos(t / 4) * 6}%, ${C.navy}cc 0%, transparent 70%),
          radial-gradient(ellipse 70% 40% at ${40 - Math.sin(t / 5) * 10}% 88%, ${C.accent}55 0%, transparent 70%),
          linear-gradient(180deg, ${C.deep} 0%, ${C.deeper} 100%)`,
      }}
    />
  );
};

const SceneView: React.FC<{ scene: Scene }> = ({ scene }) => {
  if (scene.kind === "screen") return <ScreenScene scene={scene} />;
  if (scene.kind === "phone") return <PhoneScene scene={scene} />;
  if (scene.kind === "team") return <TeamScene scene={scene} />;
  return <EndCard />;
};

const Label: React.FC<{ text: string; live?: boolean; still?: boolean }> = ({ text, live, still }) => {
  const frame = useCurrentFrame() + (still ? 100 : 0);
  const pulse = 0.55 + 0.45 * Math.abs(Math.sin(frame / 9));
  return (
    <div
      style={{
        position: "absolute",
        left: 48,
        top: LABEL_Y,
        display: "flex",
        alignItems: "center",
        gap: 14,
        fontFamily: BODY,
        fontWeight: 600,
        fontSize: 30,
        letterSpacing: 2.5,
        textTransform: "uppercase",
        color: C.lavender,
        opacity: interpolate(frame, [0, 8], [0, 1], { ...clamp, easing: OUT }),
        translate: `${interpolate(frame, [0, 10], [-18, 0], { ...clamp, easing: OUT })}px 0px`,
      }}
    >
      {live ? (
        <span style={{ width: 16, height: 16, borderRadius: 8, background: C.danger, opacity: pulse, boxShadow: `0 0 16px ${C.danger}` }} />
      ) : (
        <span style={{ width: 16, height: 16, borderRadius: 8, background: C.pink }} />
      )}
      {text}
    </div>
  );
};

// ---------- Screen recordings (16:9) re-framed for vertical ----------

const SRC_W = 1920;
const SRC_H = 1080;

function camAt(cam: [Cam, Cam], p: number): Cam {
  const lerp = (a: number, b: number) => a + (b - a) * p;
  const s = lerp(cam[0].s, cam[1].s);
  let cx = lerp(cam[0].cx, cam[1].cx);
  let cy = lerp(cam[0].cy, cam[1].cy);
  const hw = CARD.w / 2 / s;
  const hh = CARD.h / 2 / s;
  cx = hw * 2 >= SRC_W ? SRC_W / 2 : Math.min(Math.max(cx, hw), SRC_W - hw);
  cy = hh * 2 >= SRC_H ? SRC_H / 2 : Math.min(Math.max(cy, hh), SRC_H - hh);
  return { cx, cy, s };
}

const ScreenScene: React.FC<{ scene: Extract<Scene, { kind: "screen" }> }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const dur = (scene.to - scene.from) * fps;
  const p = interpolate(frame, [0, dur], [0, 1], { ...clamp, easing: scene.ease === "out" ? Easing.bezier(0.2, 0.7, 0.25, 1) : EASE });
  const cam = camAt(scene.cam, p);
  const enter = interpolate(frame, [0, 7], [0, 1], { ...clamp, easing: OUT });
  return (
    <AbsoluteFill>
      <Label text={scene.label} live={scene.label.startsWith("Live") || scene.label.includes("live view")} />
      <div
        style={{
          position: "absolute",
          left: CARD.x,
          top: CARD.y,
          width: CARD.w,
          height: CARD.h,
          borderRadius: 40,
          overflow: "hidden",
          background: "#eef0fb",
          boxShadow: `0 40px 120px rgba(0,0,0,0.55), 0 0 0 2px ${C.lavender}33`,
          scale: String(0.97 + enter * 0.03),
        }}
      >
        <div
          style={{
            position: "absolute",
            left: CARD.w / 2 - cam.cx * cam.s,
            top: CARD.h / 2 - cam.cy * cam.s,
            width: SRC_W,
            height: SRC_H,
            transformOrigin: "0 0",
            transform: `scale(${cam.s})`,
          }}
        >
          <Video
            src={f(scene.src)}
            trimBefore={Math.round(scene.srcFrom * fps)}
            playbackRate={scene.rate ?? 1}
            muted
            style={{ width: SRC_W, height: SRC_H }}
          />
          {(scene.marks ?? []).map((m, i) => (
            <MarkBox key={i} mark={m} s={cam.s} />
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const MarkBox: React.FC<{ mark: Mark; s: number }> = ({ mark, s }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const at = mark.at * fps;
  const k = interpolate(frame, [at, at + 8], [0, 1], { ...clamp, easing: OUT });
  const pad = 10;
  return (
    <div
      style={{
        position: "absolute",
        left: mark.x - pad,
        top: mark.y - pad,
        width: mark.w + pad * 2,
        height: mark.h + pad * 2,
        borderRadius: 16,
        border: `${4 / s}px solid ${mark.color}`,
        boxShadow: `0 0 ${24 / s}px ${mark.color}aa, inset 0 0 ${18 / s}px ${mark.color}44`,
        opacity: k,
        scale: String(1.12 - 0.12 * k),
      }}
    />
  );
};

// ---------- Anna's phone (vertical screen recording in a phone frame) ----------

const PH = { w: 584, bezel: 16, top: 306 };
const PH_SCREEN_W = PH.w - PH.bezel * 2;
const PH_SCREEN_H = Math.round((PH_SCREEN_W * 1920) / 1080);

const PhoneScene: React.FC<{ scene: Extract<Scene, { kind: "phone" }> }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const dur = (scene.to - scene.from) * fps;
  const hasRed = scene.redAt !== undefined;
  const redAt = hasRed ? (scene.redAt as number) * fps : 1e6;
  const red = hasRed ? interpolate(frame, [redAt - 2, redAt + 6], [0, 1], { ...clamp, easing: OUT }) : 0;
  const push = interpolate(frame, [0, dur], [1, 1.05], { ...clamp, easing: EASE });
  const punch = hasRed ? interpolate(frame, [redAt - 2, redAt + 10], [0, 0.06], { ...clamp, easing: OUT }) : 0;
  const enter = interpolate(frame, [0, 8], [0, 1], { ...clamp, easing: OUT });
  return (
    <AbsoluteFill>
      {/* red glow behind the phone once the Shield fires */}
      <AbsoluteFill
        style={{
          opacity: red,
          background: `radial-gradient(ellipse 70% 45% at 50% 45%, ${C.danger}cc 0%, ${C.danger}33 45%, transparent 75%)`,
        }}
      />
      <Label text={scene.label} live />
      <div
        style={{
          position: "absolute",
          left: (1080 - PH.w) / 2,
          top: PH.top,
          width: PH.w,
          height: PH_SCREEN_H + PH.bezel * 2,
          borderRadius: 92,
          padding: PH.bezel,
          background: "linear-gradient(150deg, #4a4a55 0%, #15151b 22%, #0b0b10 60%, #34343d 100%)",
          boxShadow: `0 60px 140px rgba(0,0,0,0.7), inset 0 0 0 2px rgba(255,255,255,0.1)${red > 0 ? `, 0 0 ${120 * red}px ${C.danger}aa` : ""}`,
          transformOrigin: "50% 30%",
          scale: String((push + punch) * (0.96 + 0.04 * enter)),
        }}
      >
        <div style={{ position: "relative", width: PH_SCREEN_W, height: PH_SCREEN_H, borderRadius: 78, overflow: "hidden", background: "#000" }}>
          <Video
            src={f(scene.src)}
            trimBefore={Math.round(scene.srcFrom * fps)}
            muted
            style={{ width: PH_SCREEN_W, height: PH_SCREEN_H }}
          />
          <div style={{ position: "absolute", top: 18, left: (PH_SCREEN_W - 150) / 2, width: 150, height: 42, borderRadius: 24, background: "#000" }} />
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------- The team ----------

const TEAM_W = 1080;
const TEAM_H = Math.round((TEAM_W * 1080) / 1920);
const TEAM_TOP = 470;

const TeamScene: React.FC<{ scene: Extract<Scene, { kind: "team" }> }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const dur = (scene.to - scene.from) * fps;
  const z = interpolate(frame, [0, dur], scene.zoom, { ...clamp, easing: EASE });
  const names = [
    { n: "Polina", x: 205, role: "Front end" },
    { n: "Gangbi", x: 545, role: "Data Science" },
    { n: "Denis", x: 880, role: "Back end · voice AI" },
  ];
  return (
    <AbsoluteFill>
      <Label text={scene.label} still={!scene.names} />
      <div
        style={{
          position: "absolute",
          left: 0,
          top: TEAM_TOP,
          width: TEAM_W,
          height: TEAM_H,
          overflow: "hidden",
          boxShadow: "0 40px 120px rgba(0,0,0,0.55)",
        }}
      >
        <div style={{ width: TEAM_W, height: TEAM_H, scale: String(z), transformOrigin: "50% 40%" }}>
          <Video
            src={f(scene.src)}
            trimBefore={Math.round(scene.srcFrom * fps)}
            volume={(fr) => scene.gain * interpolate(fr, [0, 2, dur - scene.fadeOut * fps, dur], [0, 1, 1, 0], { ...clamp })}
            style={{ width: TEAM_W, height: TEAM_H }}
          />
        </div>
      </div>
      {scene.names
        ? names.map((p, i) => {
            const k = interpolate(frame, [4 + i * 4, 14 + i * 4], [0, 1], { ...clamp, easing: OUT });
            return (
              <div
                key={p.n}
                style={{
                  position: "absolute",
                  left: p.x - 160,
                  width: 320,
                  top: TEAM_TOP + TEAM_H + 26,
                  textAlign: "center",
                  opacity: k,
                  translate: `0px ${(1 - k) * 14}px`,
                }}
              >
                <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 48, color: C.white }}>{p.n}</div>
                <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: 24, color: C.lavender, marginTop: 2 }}>{p.role}</div>
              </div>
            );
          })
        : null}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: TEAM_TOP - 150,
          textAlign: "center",
          fontFamily: HEAD,
          fontWeight: 700,
          fontSize: 64,
          color: C.white,
          letterSpacing: -1,
          opacity: scene.names ? interpolate(frame, [0, 8], [0, 1], { ...clamp, easing: OUT }) : 1,
        }}
      >
        Plan C
        <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: 28, letterSpacing: 0, color: C.lavender, marginTop: 6 }}>
          Unfair Weekend 2026 · Vilnius
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------- End card ----------

const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const a = (start: number) => interpolate(frame, [start, start + 10], [0, 1], { ...clamp, easing: OUT });
  const rise = (start: number) => `0px ${(1 - a(start)) * 26}px`;
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse 80% 50% at 50% 42%, ${C.navy} 0%, ${C.deep} 55%, ${C.deeper} 100%)` }}>
      <div style={{ position: "absolute", top: 420, left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <Img src={staticFile("brand/callback-app-icon.svg")} style={{ width: 190, height: 190, opacity: a(0), scale: String(0.9 + 0.1 * a(0)) }} />
        <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 112, color: C.white, letterSpacing: -3, marginTop: 30, opacity: a(3), translate: rise(3) }}>
          Callback
        </div>
        <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: 40, color: C.lavender, marginTop: 14, opacity: a(8), translate: rise(8) }}>
          Built in 48 hours by Plan C
        </div>
        <div
          style={{
            marginTop: 90,
            padding: "30px 56px",
            borderRadius: 999,
            background: C.pink,
            color: C.deep,
            fontFamily: HEAD,
            fontWeight: 700,
            fontSize: 72,
            letterSpacing: -1.5,
            opacity: a(12),
            translate: rise(12),
            boxShadow: `0 0 80px ${C.pink}66`,
          }}
        >
          Vote for Callback
        </div>
        <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 54, color: C.white, marginTop: 34, opacity: a(18), translate: rise(18) }}>
          link in bio
        </div>
        <div style={{ fontFamily: BODY, fontWeight: 600, fontSize: 28, color: C.lavender, marginTop: 40, opacity: a(22) * 0.8 }}>
          Unfair Weekend 2026 · Vilnius
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ---------- "AI voice" tag while Gangbi's cloned voice speaks ----------

const AiVoiceTag: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const on = AI_VOICE.map(([a, b]) =>
    interpolate(t, [a, a + 0.2, b, b + 0.2], [0, 1, 1, 0], { ...clamp }),
  ).reduce((x, y) => Math.max(x, y), 0);
  if (on <= 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        right: 44,
        top: LABEL_Y - 8,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 18px",
        borderRadius: 999,
        background: "rgba(13,9,38,0.72)",
        border: `1.5px solid ${C.lavender}55`,
        fontFamily: BODY,
        fontWeight: 600,
        fontSize: 24,
        color: C.lavender,
        opacity: on,
      }}
    >
      <svg width="26" height="20" viewBox="0 0 26 20">
        {[6, 14, 20, 12, 7].map((h, i) => (
          <rect key={i} x={i * 5 + 1} y={(20 - h) / 2} width="3" height={h} rx="1.5" fill={C.pink} />
        ))}
      </svg>
      AI voice · Gangbi
    </div>
  );
};

// ---------- Sound ----------

const Sound: React.FC = () => {
  const { fps } = useVideoConfig();
  const total = TOTAL_S * fps;
  const answer = 6.45;
  return (
    <>
      <Audio src={f("vo.wav")} volume={1} />
      <Sequence from={Math.round(V11_AT * fps)} layout="none">
        <Audio src={f("v11.wav")} volume={1} />
      </Sequence>
      {/* the phone rings under the hook until Anna answers */}
      <Sequence durationInFrames={Math.round(answer * fps)} layout="none">
        <Audio
          src={f("ringtone.mp3")}
          loop
          volume={(fr) => interpolate(fr, [0, 2, answer * fps - 10, answer * fps], [0.3, 0.3, 0.22, 0], { ...clamp })}
        />
      </Sequence>
      {/* bed: low under the narration, out for the team's own voices, back up for the end card */}
      <Audio
        src={f("pitch-bed.mp3")}
        volume={(fr) =>
          interpolate(
            fr,
            [0, 8, (VO_END - 0.2) * fps, S.hungup * fps, S.shout * fps - 4, S.shout * fps + 6, total - 20, total],
            [0, 0.1, 0.1, 0.04, 0.04, 0.14, 0.14, 0],
            { ...clamp },
          )
        }
      />
      <Sfx at={24.25 - 0.05} src="alert.mp3" volume={0.4} />
      {[S.hook, S.phone1, S.red, S.alerted, S.hungup, S.shout].map((t) => (
        <Sfx key={t} at={t - 0.12} src="whoosh.mp3" volume={0.22} />
      ))}
    </>
  );
};

const Sfx: React.FC<{ at: number; src: string; volume: number }> = ({ at, src, volume }) => {
  const { fps } = useVideoConfig();
  return (
    <Sequence from={Math.max(0, Math.round(at * fps))} layout="none">
      <Audio src={f(src)} volume={volume} />
    </Sequence>
  );
};
