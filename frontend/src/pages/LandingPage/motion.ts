// The scroll driver, loaded after first paint. GSAP's ScrollTrigger caches section
// offsets (refreshed on resize) and reports progress; nothing here reads layout on
// scroll. React reads quantised values from the store; the 3D stage reads raw ones.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { q, store, type Segment } from './store';

gsap.registerPlugin(ScrollTrigger);

export const progress = {
  hero: 0,
  problem: 0,
  habit: 0,
  chapters: [0, 0, 0, 0, 0],
  shield: 0,
  /** Raw progress through the story's chapter list, 0..5. */
  story: 0,
};

const setP = (key: 'problem' | 'habit' | 'shield', v: number) => {
  if (key === 'problem') store.set({ problemP: v });
  else if (key === 'habit') store.set({ habitP: v });
  else store.set({ shieldP: v });
};

export function startScroll(root: HTMLElement): () => void {
  const triggers: ScrollTrigger[] = [];
  const active = new Map<string, boolean>();

  const pickSegment = () => {
    let seg: Segment = 'hero';
    const order: Segment[] = ['problem', 'habit', 'story', 'shield'];
    for (const s of order) if (active.get(s)) seg = s;
    if (!order.some((s) => active.get(s)) && progress.shield >= 1) seg = 'after';
    if (!order.some((s) => active.get(s)) && progress.problem <= 0) seg = 'hero';
    store.set({ segment: seg });
  };

  const add = (vars: ScrollTrigger.Vars) => {
    const t = ScrollTrigger.create(vars);
    triggers.push(t);
    return t;
  };

  const heroEl = root.querySelector<HTMLElement>('#top');
  if (heroEl)
    add({
      trigger: heroEl,
      start: 'top top',
      end: 'bottom top',
      onUpdate: (self) => {
        progress.hero = self.progress;
        store.set({ heroLeave: q(self.progress, 0.01) });
      },
    });

  const section = (sel: string, key: 'problem' | 'habit' | 'shield') => {
    const el = root.querySelector<HTMLElement>(sel);
    if (!el) return;
    add({
      trigger: el,
      start: 'top center',
      end: 'bottom center',
      onUpdate: (self) => {
        progress[key] = self.progress;
        setP(key, q(self.progress, 0.01));
      },
      onToggle: (self) => {
        active.set(key, self.isActive);
        pickSegment();
      },
      onLeave: () => {
        progress[key] = 1;
        setP(key, 1);
        pickSegment();
      },
      onLeaveBack: () => {
        progress[key] = 0;
        setP(key, 0);
        pickSegment();
      },
    });
  };
  section('#problem', 'problem');
  section('#habit', 'habit');

  const chapters = Array.from(root.querySelectorAll<HTMLElement>('[data-chapter]'));
  const chapterActive = chapters.map(() => false);
  const syncStory = () => {
    let ch = -1;
    chapterActive.forEach((a, i) => {
      if (a) ch = i;
    });
    active.set('story', ch >= 0);
    if (ch >= 0) store.set({ chapter: ch, chapterP: q(progress.chapters[ch]) });
    else if (progress.chapters[4] >= 1) store.set({ chapter: 4, chapterP: 1 });
    else if (progress.chapters[0] <= 0) store.set({ chapter: 0, chapterP: 0 });
    progress.story = progress.chapters.reduce((a, b) => a + b, 0);
    pickSegment();
  };
  chapters.forEach((el, i) => {
    add({
      trigger: el,
      start: 'top center',
      end: 'bottom center',
      onUpdate: (self) => {
        progress.chapters[i] = self.progress;
        if (self.isActive) store.set({ chapter: i, chapterP: q(self.progress) });
        progress.story = progress.chapters.reduce((a, b) => a + b, 0);
      },
      onToggle: (self) => {
        chapterActive[i] = self.isActive;
        if (!self.isActive) progress.chapters[i] = self.progress >= 0.5 ? 1 : 0;
        syncStory();
      },
    });
  });

  section('#shield', 'shield');

  // Fonts and the pricing answer can change heights; refresh once both settle.
  const refresh = () => ScrollTrigger.refresh();
  document.fonts?.ready.then(refresh).catch(() => undefined);
  let refreshTimer = 0;
  const ro = new ResizeObserver(() => {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(refresh, 150);
  });
  ro.observe(root);

  return () => {
    window.clearTimeout(refreshTimer);
    ro.disconnect();
    triggers.forEach((t) => t.kill());
  };
}

export function scrollToChapter(root: HTMLElement, i: number, smooth: boolean) {
  const el = root.querySelectorAll<HTMLElement>('[data-chapter]')[i];
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.5 + 40;
  window.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
}
