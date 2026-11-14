// The scroll driver. Section offsets are measured once and again whenever the page
// changes size; on scroll, one animation frame compares window.scrollY with those
// cached numbers, so nothing reads layout while scrolling. React reads quantised
// values from the store; it is small enough to ship in the landing chunk itself.
import { q, store, type Segment } from './store';

interface Span {
  start: number;
  end: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const prog = (y: number, s: Span) => (s.end <= s.start ? (y >= s.end ? 1 : 0) : clamp01((y - s.start) / (s.end - s.start)));
const inside = (y: number, s: Span) => y > s.start && y < s.end;

export function startScroll(root: HTMLElement): () => void {
  const hero = root.querySelector<HTMLElement>('#top');
  const problem = root.querySelector<HTMLElement>('#problem');
  const habit = root.querySelector<HTMLElement>('#habit');
  const shield = root.querySelector<HTMLElement>('#shield');
  const chapters = Array.from(root.querySelectorAll<HTMLElement>('[data-chapter]'));

  const none: Span = { start: Infinity, end: Infinity };
  let heroSpan = none;
  let problemSpan = none;
  let habitSpan = none;
  let shieldSpan = none;
  let chapterSpans: Span[] = [];

  // "Top of the element at the middle of the screen" to "bottom at the middle".
  const centred = (el: HTMLElement | null, y: number, vh: number): Span => {
    if (!el) return none;
    const r = el.getBoundingClientRect();
    const top = r.top + y;
    return { start: top - vh / 2, end: top + r.height - vh / 2 };
  };

  const measure = () => {
    const y = window.scrollY;
    const vh = window.innerHeight;
    if (hero) {
      const r = hero.getBoundingClientRect();
      heroSpan = { start: r.top + y, end: r.top + y + r.height };
    }
    problemSpan = centred(problem, y, vh);
    habitSpan = centred(habit, y, vh);
    shieldSpan = centred(shield, y, vh);
    chapterSpans = chapters.map((el) => centred(el, y, vh));
    update();
  };

  let lastChapter = 0;
  const update = () => {
    const y = window.scrollY;
    const patch: Parameters<typeof store.set>[0] = {
      heroLeave: q(prog(y, heroSpan), 0.01),
      problemP: q(prog(y, problemSpan), 0.01),
      habitP: q(prog(y, habitSpan), 0.01),
      shieldP: q(prog(y, shieldSpan), 0.01),
    };

    // The chapter on screen; before the first it is 0 at 0, after the last 4 at 1.
    if (chapterSpans.length) {
      let ch = chapterSpans.findIndex((s) => inside(y, s));
      if (ch < 0) {
        if (y >= chapterSpans[chapterSpans.length - 1].end) ch = chapterSpans.length - 1;
        else if (y <= chapterSpans[0].start) ch = 0;
        else ch = lastChapter;
      }
      lastChapter = ch;
      patch.chapter = ch;
      patch.chapterP = q(prog(y, chapterSpans[ch]));
    }

    let segment: Segment = 'hero';
    if (y >= shieldSpan.end) segment = 'after';
    else if (y > shieldSpan.start) segment = 'shield';
    else if (chapterSpans.length && y > chapterSpans[0].start) segment = 'story';
    else if (y > habitSpan.start) segment = 'habit';
    else if (y > problemSpan.start) segment = 'problem';
    patch.segment = segment;
    store.set(patch);
  };

  let raf = 0;
  const onScroll = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      update();
    });
  };

  // Fonts, the pricing answer and images can change heights: measure again once they settle.
  let timer = 0;
  const remeasure = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(measure, 120);
  };
  const ro = new ResizeObserver(remeasure);
  ro.observe(root);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', remeasure);
  document.fonts?.ready.then(remeasure).catch(() => undefined);
  measure();

  return () => {
    cancelAnimationFrame(raf);
    window.clearTimeout(timer);
    ro.disconnect();
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', remeasure);
  };
}
