import { useEffect, useLayoutEffect, type RefObject } from 'react';
import { useLocation } from 'react-router-dom';
import { store } from './store';
import { callAudio } from './audio';
import { prefersReducedMotion } from './capability';
import { readSound } from './components/SoundToggle';

function upsertMeta(name: string, content: string, attr: 'name' | 'property' = 'name') {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`);
  const created = !el;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  const prev = el.getAttribute('content');
  el.setAttribute('content', content);
  return () => {
    if (created) el?.remove();
    else if (prev !== null) el?.setAttribute('content', prev);
  };
}

/** Title, description, theme colour and the night body background while on the landing. */
export function useLandingHead({ title, description, theme }: { title: string; description: string; theme: string }) {
  useLayoutEffect(() => {
    const html = document.documentElement;
    const prevTitle = document.title;
    const prevRoute = html.dataset.route;
    document.title = title;
    html.dataset.route = 'landing';
    const undo = [upsertMeta('description', description), upsertMeta('theme-color', theme)];
    return () => {
      document.title = prevTitle;
      if (prevRoute === undefined) delete html.dataset.route;
      else html.dataset.route = prevRoute;
      undo.forEach((u) => u());
    };
  }, [title, description, theme]);
}

/** A 64 x 64 tile of random greys, drawn once, used at 4% on night grounds to stop banding. */
let grainUrl: string | null = null;
export function grainTile(): string | null {
  if (grainUrl) return grainUrl;
  try {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    const img = ctx.createImageData(64, 64);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.floor(Math.random() * 255);
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 10; // about 4%
    }
    ctx.putImageData(img, 0, 0);
    grainUrl = c.toDataURL('image/png');
    return grainUrl;
  } catch {
    return null;
  }
}

/** Shared set-up for the landing and the pricing page. */
export function useLandingShell(rootRef: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const reduced = prefersReducedMotion();
    const soundOn = readSound();
    store.set({ reducedMotion: reduced, soundOn });
    callAudio.setMuted(!soundOn);
    const url = grainTile();
    if (url && rootRef.current) rootRef.current.style.setProperty('--grain', `url(${url})`);
  }, [rootRef]);

  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const id = window.setTimeout(() => {
      document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
    }, 60);
    return () => window.clearTimeout(id);
  }, [hash]);
}

