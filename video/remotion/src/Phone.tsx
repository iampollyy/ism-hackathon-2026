import { useAudioData, visualizeAudio } from "@remotion/media-utils";
import { interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { BODY, C, RING_END, VOICE_FROM } from "./timing";

const W = 780;
const H = 1600;
const BEZEL = 20;

const ink = "#ffffff";
const muted = "rgba(255,255,255,0.62)";

/** A dark modern phone: titanium frame, island, glass reflection, deep shadow. */
export const Phone: React.FC = () => {
  return (
    <div
      style={{
        position: "absolute",
        left: (1080 - W) / 2,
        top: (1920 - H) / 2 - 10,
        width: W,
        height: H,
        borderRadius: 124,
        padding: BEZEL,
        background: "linear-gradient(150deg, #4a4a55 0%, #15151b 22%, #0b0b10 60%, #34343d 100%)",
        boxShadow:
          "0 80px 160px rgba(0,0,0,0.75), 0 30px 60px rgba(0,0,0,0.55), inset 0 0 0 2px rgba(255,255,255,0.10), inset 0 0 0 8px rgba(0,0,0,0.6)",
      }}
    >
      {/* side buttons */}
      <div style={{ position: "absolute", left: -6, top: 300, width: 6, height: 90, borderRadius: 3, background: "#2a2a31" }} />
      <div style={{ position: "absolute", left: -6, top: 420, width: 6, height: 150, borderRadius: 3, background: "#2a2a31" }} />
      <div style={{ position: "absolute", left: -6, top: 590, width: 6, height: 150, borderRadius: 3, background: "#2a2a31" }} />
      <div style={{ position: "absolute", right: -6, top: 460, width: 6, height: 220, borderRadius: 3, background: "#2a2a31" }} />
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          borderRadius: 106,
          overflow: "hidden",
          background: "#000",
        }}
      >
        <Screens />
        {/* dynamic island */}
        <div
          style={{
            position: "absolute",
            top: 24,
            left: (W - 2 * BEZEL - 230) / 2,
            width: 230,
            height: 66,
            borderRadius: 40,
            background: "#000",
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.04)",
          }}
        />
        {/* glass reflection */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(118deg, rgba(255,255,255,0.13) 0%, rgba(255,255,255,0.04) 28%, rgba(255,255,255,0) 29%, rgba(255,255,255,0) 100%)",
            pointerEvents: "none",
          }}
        />
      </div>
    </div>
  );
};

const Wallpaper: React.FC<{ dim: number }> = ({ dim }) => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 60) * 30;
  return (
    <div
      style={{
        position: "absolute",
        inset: -60,
        background: `radial-gradient(circle at ${30 + drift / 10}% 20%, ${C.accent} 0%, transparent 45%),
          radial-gradient(circle at 80% ${70 - drift / 12}%, ${C.pink}88 0%, transparent 40%),
          radial-gradient(circle at 20% 85%, ${C.navy} 0%, transparent 50%),
          ${C.deep}`,
        filter: `blur(40px) brightness(${1 - dim})`,
      }}
    />
  );
};

const StatusBar: React.FC = () => (
  <div
    style={{
      position: "absolute",
      top: 34,
      left: 70,
      right: 64,
      display: "flex",
      justifyContent: "space-between",
      fontFamily: BODY,
      fontSize: 30,
      color: ink,
    }}
  >
    <span>21:47</span>
    <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
      <svg width="38" height="24" viewBox="0 0 38 24">
        {[0, 1, 2, 3].map((i) => (
          <rect key={i} x={i * 10} y={18 - i * 5} width="7" height={6 + i * 5} rx="2" fill={ink} />
        ))}
      </svg>
      <svg width="52" height="26" viewBox="0 0 52 26">
        <rect x="1" y="1" width="44" height="24" rx="7" fill="none" stroke={ink} strokeOpacity="0.5" strokeWidth="2" />
        <rect x="5" y="5" width="30" height="16" rx="4" fill={ink} />
        <rect x="47" y="9" width="4" height="8" rx="2" fill={ink} fillOpacity="0.5" />
      </svg>
    </span>
  </div>
);

const Avatar: React.FC<{ size: number }> = ({ size }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: "50%",
      background: "linear-gradient(180deg, #8f8aa8, #5f5a78)",
      overflow: "hidden",
      position: "relative",
    }}
  >
    <div
      style={{
        position: "absolute",
        width: size * 0.38,
        height: size * 0.38,
        borderRadius: "50%",
        background: "#d9d6e6",
        left: size * 0.31,
        top: size * 0.2,
      }}
    />
    <div
      style={{
        position: "absolute",
        width: size * 0.72,
        height: size * 0.6,
        borderRadius: "50%",
        background: "#d9d6e6",
        left: size * 0.14,
        top: size * 0.64,
      }}
    />
  </div>
);

const PhoneGlyph: React.FC<{ rotate?: number }> = ({ rotate = 0 }) => (
  <svg width="64" height="64" viewBox="0 0 24 24" style={{ transform: `rotate(${rotate}deg)` }}>
    <path
      fill="#fff"
      d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z"
    />
  </svg>
);

const Incoming: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pulse = (frame % 30) / 30;
  const press = spring({ frame: frame - (RING_END - 10), fps, config: { damping: 12 } });
  const name = spring({ frame: frame - 4, fps, config: { damping: 18 } });
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Wallpaper dim={0.1} />
      <StatusBar />
      <div
        style={{
          position: "absolute",
          top: 230,
          width: "100%",
          textAlign: "center",
          fontFamily: BODY,
          color: ink,
          opacity: name,
          transform: `translateY(${(1 - name) * 30}px)`,
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 40 }}>
          <Avatar size={190} />
        </div>
        <div style={{ fontSize: 68, letterSpacing: -1 }}>Unknown number</div>
        <div style={{ fontSize: 36, color: muted, marginTop: 14 }}>Mobile</div>
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 170,
          left: 110,
          right: 110,
          display: "flex",
          justifyContent: "space-between",
          fontFamily: BODY,
          color: ink,
          fontSize: 30,
          textAlign: "center",
        }}
      >
        <div>
          <div
            style={{
              width: 150,
              height: 150,
              borderRadius: "50%",
              background: "#eb4b3f",
              display: "grid",
              placeItems: "center",
            }}
          >
            <PhoneGlyph rotate={135} />
          </div>
          <div style={{ marginTop: 18 }}>Decline</div>
        </div>
        <div style={{ position: "relative" }}>
          {[0, 0.5].map((offset) => {
            const p = (pulse + offset) % 1;
            return (
              <div
                key={offset}
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: 150,
                  height: 150,
                  borderRadius: "50%",
                  border: `4px solid ${C.good}`,
                  transform: `scale(${1 + p * 0.6})`,
                  opacity: 1 - p,
                }}
              />
            );
          })}
          <div
            style={{
              width: 150,
              height: 150,
              borderRadius: "50%",
              background: "#34c759",
              display: "grid",
              placeItems: "center",
              transform: `scale(${1 + Math.max(0, press) * 0.12})`,
              boxShadow: `0 0 ${40 * Math.max(0, press)}px ${C.good}`,
            }}
          >
            <PhoneGlyph />
          </div>
          <div style={{ marginTop: 18 }}>Accept</div>
        </div>
      </div>
    </div>
  );
};

const Key: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
    <div
      style={{
        width: 150,
        height: 150,
        borderRadius: "50%",
        background: "rgba(255,255,255,0.16)",
        display: "grid",
        placeItems: "center",
      }}
    >
      {children}
    </div>
    <span style={{ fontFamily: BODY, fontSize: 26, color: ink }}>{label}</span>
  </div>
);

const icon = (d: string) => (
  <svg width="58" height="58" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const Waveform: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const audioData = useAudioData(staticFile("audio/voice.wav"));
  const local = frame - VOICE_FROM;
  const bars = 28;
  let values: number[] = new Array(bars).fill(0);
  if (audioData && local >= 0) {
    const v = visualizeAudio({ fps, frame: local, audioData, numberOfSamples: 64 });
    values = v.slice(2, 2 + bars);
  }
  return (
    <div style={{ display: "flex", gap: 9, alignItems: "center", height: 140, justifyContent: "center" }}>
      {values.map((_, i) => {
        // Low frequencies (the loudest part of a voice) in the middle, tapering out.
        const fromCentre = Math.abs(i - (bars - 1) / 2);
        const level = values[Math.min(bars - 1, Math.floor(fromCentre))] ?? 0;
        const h = 10 + Math.min(1, Math.sqrt(level) * 2.2) * 120;
        return (
          <div
            key={i}
            style={{
              width: 12,
              height: h,
              borderRadius: 6,
              background: `linear-gradient(180deg, ${C.pink}, ${C.accentFill})`,
              opacity: 0.9,
            }}
          />
        );
      })}
    </div>
  );
};

const InCall: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const seconds = Math.max(0, Math.floor((frame - RING_END) / fps));
  const timer = `00:${String(seconds).padStart(2, "0")}`;
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Wallpaper dim={0.45} />
      <StatusBar />
      <div style={{ position: "absolute", top: 200, width: "100%", textAlign: "center", fontFamily: BODY, color: ink }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 30 }}>
          <Avatar size={130} />
        </div>
        <div style={{ fontSize: 62, letterSpacing: -1 }}>Unknown number</div>
        <div style={{ fontSize: 36, color: muted, marginTop: 12, fontVariantNumeric: "tabular-nums" }}>{timer}</div>
      </div>
      <div style={{ position: "absolute", top: 560, width: "100%" }}>
        <Waveform />
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 330,
          left: 80,
          right: 80,
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          rowGap: 40,
          justifyItems: "center",
        }}
      >
        <Key label="mute">{icon("M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3")}</Key>
        <Key label="keypad">{icon("M6 6h.01M12 6h.01M18 6h.01M6 12h.01M12 12h.01M18 12h.01M6 18h.01M12 18h.01M18 18h.01")}</Key>
        <Key label="speaker">{icon("M4 10v4h4l5 4V6L8 10H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11")}</Key>
        <Key label="add call">{icon("M12 5v14M5 12h14")}</Key>
        <Key label="video">{icon("M3 7h12v10H3zM15 10l6-3v10l-6-3")}</Key>
        <Key label="contacts">{icon("M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0")}</Key>
      </div>
      <div style={{ position: "absolute", bottom: 120, width: "100%", display: "flex", justifyContent: "center" }}>
        <div style={{ width: 150, height: 150, borderRadius: "50%", background: "#eb4b3f", display: "grid", placeItems: "center" }}>
          <PhoneGlyph rotate={135} />
        </div>
      </div>
    </div>
  );
};

const Screens: React.FC = () => {
  const frame = useCurrentFrame();
  const swap = interpolate(frame, [RING_END - 2, RING_END + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <>
      {swap < 1 && (
        <div style={{ position: "absolute", inset: 0, opacity: 1 - swap }}>
          <Incoming />
        </div>
      )}
      {swap > 0 && (
        <div style={{ position: "absolute", inset: 0, opacity: swap, transform: `scale(${1.04 - swap * 0.04})` }}>
          <InCall />
        </div>
      )}
    </>
  );
};
