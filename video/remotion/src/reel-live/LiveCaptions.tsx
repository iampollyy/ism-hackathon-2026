import { useMemo } from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { C, HEAD, Word } from "./plan";

const OUT = Easing.bezier(0.16, 1, 0.3, 1);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

type Page = { words: Word[]; start: number; end: number };

/** Short pages: break on punctuation, on pauses, or after ~3 words / 18 characters. */
function paginate(words: Word[]): Page[] {
  const pages: Page[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (cur.length) pages.push({ words: cur, start: cur[0].start, end: cur[cur.length - 1].end });
    cur = [];
  };
  words.forEach((w, i) => {
    const prev = cur[cur.length - 1];
    if (prev && w.start - prev.end > 0.45) flush();
    const chars = cur.reduce((n, x) => n + x.text.length + 1, 0) + w.text.length;
    if (cur.length >= 3 || chars > 18) flush();
    cur.push(w);
    const next = words[i + 1];
    if (/[.,!?"]$/.test(w.text) || w.brk || !next) flush();
  });
  // each page stays up until the next one starts (or a short hold)
  return pages.map((p, i) => {
    const next = pages[i + 1];
    const hold = p.end + 0.5;
    return { ...p, end: next ? Math.min(next.start, Math.max(hold, p.end + 0.15)) : hold };
  });
}

/** Word-by-word captions in brand style; each word rises in as it is spoken, the spoken word in pink. */
export const LiveCaptions: React.FC<{ words: Word[]; hideFrom: number }> = ({ words, hideFrom }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pages = useMemo(() => paginate(words), [words]);
  const t = frame / fps;
  if (t >= hideFrom) return null;
  const page = pages.find((p) => t >= p.start - 0.06 && t < p.end);
  if (!page) return null;
  const pf = (page.start - 0.06) * fps;
  const enter = interpolate(frame, [pf, pf + 5], [0, 1], { ...clamp, easing: OUT });
  const isShout = page.words.length === 1 && page.words[0].text.startsWith("Callbaa");
  return (
    <div
      style={{
        position: "absolute",
        left: 60,
        right: 60,
        top: 1288,
        height: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: enter,
        translate: `0px ${(1 - enter) * 16}px`,
      }}
    >
      <div
        style={{
          padding: "18px 36px 22px",
          borderRadius: 30,
          background: "rgba(13, 9, 38, 0.88)",
          border: `2px solid ${C.pink}40`,
          boxShadow: "0 24px 70px rgba(0,0,0,0.55)",
          fontFamily: HEAD,
          fontWeight: 700,
          fontSize: isShout ? 96 : 74,
          lineHeight: 1.1,
          letterSpacing: -1.5,
          textAlign: "center",
          color: "#fff",
        }}
      >
        {page.words.map((w, i) => {
          const wf = w.start * fps;
          const k = interpolate(frame, [wf - 2, wf + 3], [0, 1], { ...clamp, easing: OUT });
          const active = t >= w.start - 0.03 && t < w.end + 0.05;
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                marginRight: i < page.words.length - 1 ? "0.26em" : 0,
                opacity: 0.42 + 0.58 * k,
                translate: `0px ${(1 - k) * 10}px`,
                color: active || isShout ? C.pink : "#fff",
                textShadow: active ? `0 0 22px ${C.pink}77` : "none",
              }}
            >
              {w.text.replace(/"/g, "")}
            </span>
          );
        })}
      </div>
    </div>
  );
};
