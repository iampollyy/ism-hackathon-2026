import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import data from "./data.json";
import { BODY, C, ease, HEAD } from "./theme";

type Token = { text: string; startMs: number; endMs: number };
type Page = { startMs: number; endMs: number; tokens: Token[] };
type Group = { startMs: number; endMs: number; speaker: string; kind: string; pages: Page[] };

const groups = data.groups as Group[];

const TAG: Record<string, string | null> = { ai: "AI voice · copy of Polina", denis: "AI voice · Denis", team: null };

/**
 * Word-by-word captions, one box per run of a speaker, kept clear of the bottom 22%.
 * The spoken word turns pink; a cloned voice carries an "AI voice" tag inside the box.
 */
export const Caps: React.FC = () => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {groups.map((g, i) => {
        const from = Math.round((g.startMs / 1000) * fps);
        const until = Math.round((g.endMs / 1000) * fps);
        return (
          <Sequence key={i} from={from} durationInFrames={Math.max(1, until - from)} layout="none">
            <Box group={g} frames={until - from} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const Box: React.FC<{ group: Group; frames: number }> = ({ group, frames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const nowMs = group.startMs + (frame / fps) * 1000;
  const beat = group.kind === "beat";
  const enter = ease(frame, 0, beat ? 8 : 7);
  const exit = ease(frame, frames - 4, 4);
  const page = [...group.pages].reverse().find((p) => p.startMs <= nowMs + 1) ?? group.pages[0];
  const pageFrame = Math.round(((nowMs - page.startMs) / 1000) * fps);
  const pageIn = page === group.pages[0] ? 1 : ease(pageFrame, 0, 5);
  const tag = TAG[group.speaker];
  const size = beat ? 98 : 72;
  return (
    <div
      style={{
        position: "absolute",
        bottom: 450,
        left: 56,
        right: 56,
        display: "flex",
        justifyContent: "center",
        opacity: enter * (1 - exit),
        transform: `translateY(${(1 - enter) * 16}px)`,
      }}
    >
      <div
        style={{
          padding: beat ? "22px 40px 30px" : "16px 34px 22px",
          borderRadius: beat ? 34 : 28,
          background: beat ? C.deep : "rgba(16, 11, 44, 0.9)",
          border: beat ? `3px solid ${C.pink}55` : "2px solid rgba(216, 206, 255, 0.16)",
          boxShadow: "0 26px 70px rgba(0,0,0,0.5)",
          textAlign: "center",
          maxWidth: 968,
        }}
      >
        {tag ? (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              marginBottom: beat ? 10 : 6,
              fontFamily: BODY,
              fontWeight: 600,
              fontSize: 28,
              letterSpacing: 0.4,
              color: C.lavender,
              opacity: 0.9,
            }}
          >
            <span style={{ width: 12, height: 12, borderRadius: 6, background: C.pink, display: "inline-block" }} />
            {tag}
          </div>
        ) : null}
        <div
          style={{
            fontFamily: HEAD,
            fontWeight: 700,
            fontSize: size,
            lineHeight: 1.06,
            letterSpacing: beat ? -2.4 : -1.2,
            color: "#fff",
            opacity: pageIn,
            transform: `translateY(${(1 - pageIn) * 8}px)`,
          }}
        >
          {page.tokens.map((t, i) => {
            const active = t.startMs <= nowMs && nowMs < t.endMs + 60;
            const shown = beat ? ease(nowMs, t.startMs - 40, 160) : 1;
            return (
              <span key={i} style={{ color: active ? C.pink : "#fff", opacity: 0.22 + 0.78 * shown }}>
                {(i ? " " : "") + t.text}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
};
