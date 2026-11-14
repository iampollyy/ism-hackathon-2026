// Scripted, sharp B-roll of the live app, captured frame by frame.
//
// Headless Chrome's own video recording is only 1x CSS pixels (360x640 for a
// phone), which looks soft in a reel. So this freezes the page's clock and steps
// it 1/30 s at a time (requestAnimationFrame, performance.now, Date.now and CSS
// animations all follow the stepped clock), taking a full-resolution screenshot
// at every step. Result: smooth 30 fps footage at
//   phone shots:   360x640 CSS px at 3x   = 1080x1920 (a 9:16 reel frame)
//   desktop shots: 1280x720 CSS px at 1.5x = 1920x1080
//
//   node tools/record_app.mjs                 # all shots
//   node tools/record_app.mjs news-phone      # one shot
//
// Uses an existing test family on the live site (its id and organiser cookie
// come from CALLBACK_TEST_DIR); it never creates families. Output: raw/app-<shot>.mp4

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.CALLBACK_URL || 'https://callback.denishoti.dev';
// A test family for the organiser screens: news-fam.txt (its id) and jar-news.txt
// (a curl cookie jar with its organiser's cb_session), in video/.secrets/ (never committed).
const SECRETS = process.env.CALLBACK_TEST_DIR || path.join(ROOT, '.secrets');
const FPS = 30, STEP = 1000 / FPS;

function testFamily() {
  try {
    const familyId = readFileSync(path.join(SECRETS, 'news-fam.txt'), 'utf8').trim();
    const jar = readFileSync(path.join(SECRETS, 'jar-news.txt'), 'utf8');
    const row = jar.split('\n').map((l) => l.split('\t')).find((f) => f.length >= 7 && f[5] === 'cb_session');
    const cookies = row ? [{ name: 'cb_session', value: row[6].trim(), domain: new URL(BASE).hostname, path: '/', httpOnly: true, secure: true }] : [];
    return { familyId, cookies };
  } catch {
    return { familyId: null, cookies: [] };
  }
}
const { familyId, cookies } = testFamily();

const PHONE = { viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, out: [1080, 1920] };
const DESK = { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5, isMobile: false, hasTouch: false, out: [1920, 1080] };

// Runs in the page before any of its scripts: a clock that only moves when we step it.
const VIRTUAL_CLOCK = () => {
  let vt = performance.now();
  const offset = Date.now() - vt;
  const realDateNow = Date.now;
  let queue = [], nextId = 1;
  performance.now = () => vt;
  Date.now = () => Math.round(offset + vt);
  window.requestAnimationFrame = (cb) => { const id = nextId++; queue.push([id, cb]); return id; };
  window.cancelAnimationFrame = (id) => { queue = queue.filter(([i]) => i !== id); };
  window.__cbStep = (ms) => {
    vt += ms;
    for (const a of document.getAnimations()) {
      try { if (a.playState !== 'finished') { a.pause(); a.currentTime = (a.currentTime ?? 0) + ms; } } catch {}
    }
    const run = queue; queue = [];
    for (const [, cb] of run) { try { cb(vt); } catch {} }
  };
  window.__cbRealNow = realDateNow;
};

// A smooth scroll driven by the stepped clock (call without awaiting the frames).
const SCROLL = ([to, ms]) => {
  const from = window.scrollY, t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / ms), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    window.scrollTo(0, from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
};

// Each shot: how to open it, then a timeline of [second, action] and a length in seconds.
const SHOTS = {
  'landing-phone': { device: PHONE, seconds: 10,
    open: async (page) => { await page.goto(BASE + '/', { waitUntil: 'networkidle' }); },
    timeline: [[5, (page) => page.evaluate(SCROLL, [900, 3000])]] },
  'news-phone': { device: PHONE, seconds: 10,
    open: async (page, ctx) => {
      if (!familyId) throw new Error('no test family (news-fam.txt / jar-news.txt)');
      const fam = await (await ctx.request.get(`${BASE}/api/families/${familyId}`)).json();
      const member = fam.members?.[0]?.id;
      if (!member) throw new Error('could not read the test family');
      await page.goto(`${BASE}/phone/${member}`, { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: 'News' }).click();
      await page.waitForSelector('.news-hero');
    },
    timeline: [[4, (page) => page.evaluate(SCROLL, [700, 3500])]] },
  'news-desktop': { device: DESK, seconds: 8,
    open: async (page) => {
      if (!familyId) throw new Error('no test family (news-fam.txt / jar-news.txt)');
      await page.goto(`${BASE}/family/${familyId}/news`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.np-pattern');
    },
    timeline: [[3, (page) => page.evaluate(SCROLL, [500, 3000])]] },
};

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SHOTS);
mkdirSync(path.join(ROOT, 'raw'), { recursive: true });
const browser = await chromium.launch();
for (const name of wanted) {
  const shot = SHOTS[name];
  if (!shot) { console.error(`unknown shot ${name}`); continue; }
  const began = Date.now();
  const frames = path.join(ROOT, 'work', 'rec', name);
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  const { out, ...device } = shot.device;
  const ctx = await browser.newContext({ ...device, reducedMotion: 'no-preference' });
  if (cookies.length) await ctx.addCookies(cookies);
  await ctx.addInitScript(VIRTUAL_CLOCK);
  const page = await ctx.newPage();
  // Let the page settle with the clock running while it loads.
  const warm = setInterval(() => page.evaluate((ms) => window.__cbStep?.(ms), STEP).catch(() => {}), 30);
  await shot.open(page, ctx);
  for (let i = 0; i < 45; i++) await page.evaluate((ms) => window.__cbStep(ms), STEP);
  clearInterval(warm);
  const total = Math.round(shot.seconds * FPS);
  const pending = [...shot.timeline];
  for (let i = 0; i < total; i++) {
    while (pending.length && pending[0][0] * FPS <= i) await pending.shift()[1](page);
    await page.evaluate((ms) => window.__cbStep(ms), STEP);
    await page.screenshot({ path: path.join(frames, `${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
  }
  await ctx.close();
  const target = path.join(ROOT, 'raw', `app-${name}.mp4`);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-framerate', String(FPS), '-i', path.join(frames, '%05d.jpg'),
    '-vf', `scale=${out[0]}:${out[1]}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', target]);
  console.log(`raw/app-${name}.mp4 (${shot.seconds} s, captured in ${Math.round((Date.now() - began) / 1000)} s)`);
}
await browser.close();
