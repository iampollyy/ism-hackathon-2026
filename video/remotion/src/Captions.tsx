import { createTikTokStyleCaptions, type Caption } from "@remotion/captions";
import { useMemo } from "react";
import { AbsoluteFill, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, HEAD } from "./timing";

/** Word-by-word captions: a few words per page, the spoken word in pink. */
export const Captions: React.FC<{ captions: Caption[] }> = ({ captions }) => {
  const { fps } = useVideoConfig();
  const { pages } = useMemo(
    () => createTikTokStyleCaptions({ captions, combineTokensWithinMilliseconds: 900 }),
    [captions],
  );
  return (
    <AbsoluteFill>
      {pages.map((page, index) => {
        const next = pages[index + 1];
        const from = Math.round((page.startMs / 1000) * fps);
        const until = next ? Math.round((next.startMs / 1000) * fps) : from + Math.round(1.2 * fps);
        return (
          <Sequence key={index} from={from} durationInFrames={Math.max(1, until - from)} layout="none">
            <Page page={page} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

const Page: React.FC<{ page: ReturnType<typeof createTikTokStyleCaptions>["pages"][number] }> = ({ page }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const nowMs = page.startMs + (frame / fps) * 1000;
  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 180 } });
  return (
    <div
      style={{
        position: "absolute",
        top: 1185,
        left: 70,
        right: 70,
        display: "flex",
        justifyContent: "center",
        transform: `scale(${0.85 + enter * 0.15}) translateY(${(1 - enter) * 20}px)`,
        opacity: enter,
      }}
    >
      <div
        style={{
          padding: "22px 40px 26px",
          borderRadius: 32,
          background: "rgba(13, 9, 38, 0.9)",
          border: "2px solid rgba(242, 169, 250, 0.25)",
          boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
          backdropFilter: "blur(8px)",
          fontFamily: HEAD,
          fontWeight: 700,
          fontSize: 86,
          lineHeight: 1.12,
          letterSpacing: -1.5,
          textAlign: "center",
          color: "#fff",
          whiteSpace: "pre-wrap",
        }}
      >
        {page.tokens.map((token) => {
          const active = token.fromMs <= nowMs && token.toMs > nowMs;
          return (
            <span
              key={token.fromMs}
              style={{
                color: active ? C.pink : "#fff",
                textShadow: active ? `0 0 24px ${C.pink}88` : "none",
              }}
            >
              {token.text}
            </span>
          );
        })}
      </div>
    </div>
  );
};
