// Whether this visit gets the WebGL phone. Everywhere else the CSS phone is used:
// phones, tablets, reduced motion, small or slow machines, Save-Data.

export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function can3D(): boolean {
  try {
    if (new URLSearchParams(window.location.search).has('lite')) return false;
    if (prefersReducedMotion()) return false;
    if (window.innerWidth < 1024 || window.innerHeight < 640) return false;
    if (!window.matchMedia('(pointer: fine)').matches) return false;
    const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
    if ((nav.hardwareConcurrency ?? 4) < 4) return false;
    if (nav.deviceMemory !== undefined && nav.deviceMemory < 4) return false;
    if (nav.connection?.saveData) return false;
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** Runs fn after the window has loaded and the browser is idle. */
export function afterLoadIdle(fn: () => void): () => void {
  let cancelled = false;
  let idle = 0;
  const run = () => {
    if (cancelled) return;
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
      .requestIdleCallback;
    if (ric) idle = ric(() => !cancelled && fn(), { timeout: 1500 });
    else idle = window.setTimeout(() => !cancelled && fn(), 300);
  };
  if (document.readyState === 'complete') run();
  else window.addEventListener('load', run, { once: true });
  return () => {
    cancelled = true;
    window.removeEventListener('load', run);
    const cic = (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
    if (cic) cic(idle);
    window.clearTimeout(idle);
  };
}
