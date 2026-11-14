// The organiser's LAPTOP during a live scam call (the traffic light, the
// transcript, the Shield alert) and the call's result page, recorded from the
// live site for the Devpost video. Shares its capture code with record_demo.mjs.
//
//   node tools/record_demo.mjs                 # every clip, in order
//   node tools/record_demo.mjs signup protection join call alert news
//
// UI clips use the frame-stepped capture of record_setup.mjs (sharp, smooth
// 30 fps). The call clip runs in real time instead (a live call needs a real
// clock): screenshots are taken as fast as the page allows and stretched to
// 30 fps by their real timestamps.
//
// One new demo account and family ("Polina's family": Polina, Anna, Ivan,
// Gangbi) is created by the signup clip; its email, password and cookies stay
// in video/.secrets/demo-phone.json (git-ignored, never printed). Fake data
// only; invite links and QR codes are blurred before any frame is taken.

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.CALLBACK_URL || 'https://callback.denishoti.dev';
const STATE = path.join(ROOT, '.secrets', 'demo-phone.json');
const SCAM_WAV = process.env.SCAM_WAV
  || '/private/tmp/claude-501/-Users-denishoti-Denis-Hackathons-Unfair-Weekend/7d9d063b-84a6-4238-a249-b7436cbe667f/scratchpad/livecall/scam-line.wav';
const FPS = 30, STEP = 1000 / FPS;
const OUT = '1920:1080';
const DESKTOP = { viewport: { width: 1440, height: 810 }, deviceScaleFactor: 4 / 3 };
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const PHONE = { viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA, out: [1080, 1920] };
const MEDIA_ARGS = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'];

const VIRTUAL_CLOCK = () => {
  let vt = performance.now();
  const offset = Date.now() - vt;
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
};

const PAGE_EXTRAS = () => {
  const style = document.createElement('style');
  style.textContent = `.onb-qr, .onb-link, .onb-invite-actions code, .fh-link-text, code, [class*="invite-link"], [class*="qr"] svg, [class*="qr"] canvas, canvas[aria-label*="QR"], svg[aria-label*="QR"]
    { filter: blur(9px) !important; }
    #cb-pointer { position: fixed; z-index: 2147483647; pointer-events: none; left: 0; top: 0; }`;
  const add = () => {
    document.head.appendChild(style);
    const p = document.createElement('div');
    p.id = 'cb-pointer';
    p.innerHTML = '<div style="width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(255,255,255,.35);border:2px solid rgba(53,42,124,.55);opacity:0" id="cb-tap"></div>';
    document.body.appendChild(p);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Recorder {
  constructor(page, name) {
    this.page = page; this.name = name; this.i = 0;
    this.frames = path.join(ROOT, 'work', 'rec', name);
    rmSync(this.frames, { recursive: true, force: true });
    mkdirSync(this.frames, { recursive: true });
    this.pointer = { x: 180, y: 320 };
  }
  async frame() {
    await this.page.evaluate((ms) => window.__cbStep(ms), STEP);
    await this.page.screenshot({ path: path.join(this.frames, `${String(this.i++).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
  }
  async hold(seconds) { for (let n = Math.round(seconds * FPS); n > 0; n--) await this.frame(); }
  async settle() { for (let n = 0; n < 12; n++) await this.page.evaluate((ms) => window.__cbStep(ms), STEP); }
  async scrollTo(y, seconds = 0.8) {
    const from = await this.page.evaluate(() => window.scrollY);
    const n = Math.max(1, Math.round(seconds * FPS));
    for (let k = 1; k <= n; k++) {
      const t = k / n, e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      await this.page.evaluate((top) => window.scrollTo(0, top), from + (y - from) * e);
      await this.frame();
    }
  }
  async reveal(locator) {
    const { top, h } = await locator.evaluate((el) => ({ top: el.getBoundingClientRect().top, h: window.innerHeight }));
    if (top < 80 || top > h * 0.7) {
      const y = await this.page.evaluate(() => window.scrollY);
      await this.scrollTo(Math.max(0, y + top - h * 0.38), 0.6);
    }
  }
  async tap() {
    const { x, y } = this.pointer;
    for (let k = 0; k < 7; k++) {
      await this.page.evaluate(([px, py, o, s]) => {
        const p = document.getElementById('cb-pointer'); const r = document.getElementById('cb-tap');
        if (!p || !r) return;
        p.style.transform = `translate(${px}px, ${py}px)`; r.style.opacity = o; r.style.transform = `scale(${s})`;
      }, [x, y, String(0.9 - k * 0.12), String(0.7 + k * 0.07)]);
      await this.frame();
    }
    await this.page.evaluate(() => { const r = document.getElementById('cb-tap'); if (r) r.style.opacity = '0'; });
  }
  async click(locator, after = 0.25) {
    await this.reveal(locator);
    const box = await locator.boundingBox();
    this.pointer = { x: box.x + Math.min(box.width / 2, 60), y: box.y + box.height / 2 };
    await this.hold(0.12);
    await locator.click({ force: true, timeout: 15000 });
    await this.tap();
    await this.hold(after);
  }
  async type(locator, text, cps = 18) {
    await this.click(locator, 0.05);
    for (const ch of text) {
      await this.page.keyboard.type(ch);
      const n = Math.max(1, Math.round(FPS / cps + (Math.random() - 0.5)));
      for (let k = 0; k < n; k++) await this.frame();
    }
    await this.hold(0.2);
  }
  encode(target) {
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-framerate', String(FPS), '-i', path.join(this.frames, '%05d.jpg'),
      '-vf', `scale=${OUT}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', target]);
    console.log(`${path.relative(ROOT, target)}: ${(this.i / FPS).toFixed(1)} s`);
  }
}

// Real-time capture for the call: screenshots as fast as possible, each kept
// on screen until the next one, then resampled to 30 fps.
class LiveRecorder {
  constructor(page, name) {
    this.page = page; this.name = name; this.shots = [];
    this.frames = path.join(ROOT, 'work', 'rec', name);
    rmSync(this.frames, { recursive: true, force: true });
    mkdirSync(this.frames, { recursive: true });
    this.running = false;
  }
  start() {
    this.running = true;
    this.loop = (async () => {
      while (this.running) {
        const file = path.join(this.frames, `${String(this.shots.length).padStart(5, '0')}.jpg`);
        const t = Date.now();
        try { await this.page.screenshot({ path: file, type: 'jpeg', quality: 88 }); this.shots.push({ file, t }); } catch { await sleep(50); }
      }
    })();
  }
  async stop() { this.running = false; await this.loop; }
  async tapAt(locator) {
    const box = await locator.boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await this.page.evaluate(([px, py]) => {
      const p = document.getElementById('cb-pointer'); const r = document.getElementById('cb-tap');
      if (!p || !r) return;
      p.style.transform = `translate(${px}px, ${py}px)`; r.style.transition = 'opacity .45s, transform .45s';
      r.style.opacity = '0.9'; r.style.transform = 'scale(0.8)';
      setTimeout(() => { r.style.opacity = '0'; r.style.transform = 'scale(1.3)'; }, 120);
    }, [x, y]);
    await sleep(160);
    await locator.click({ force: true, timeout: 15000 });
  }
  encode(target) {
    const lines = ['ffconcat version 1.0'];
    this.shots.forEach((s, i) => {
      const next = this.shots[i + 1];
      lines.push(`file '${s.file}'`, `duration ${((next ? next.t - s.t : 400) / 1000).toFixed(3)}`);
    });
    lines.push(`file '${this.shots.at(-1).file}'`);
    const list = path.join(this.frames, 'list.ffconcat');
    writeFileSync(list, lines.join('\n') + '\n');
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-safe', '0', '-f', 'concat', '-i', list,
      '-vf', `fps=${FPS},scale=${OUT}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', target]);
    const seconds = (this.shots.at(-1).t - this.shots[0].t) / 1000;
    console.log(`${path.relative(ROOT, target)}: ${seconds.toFixed(1)} s from ${this.shots.length} shots`);
  }
}

async function openPhone(browser, { cookies = null, clock = true } = {}) {
  const { out, ...options } = PHONE;
  const ctx = await browser.newContext({ ...options, reducedMotion: 'no-preference', permissions: ['microphone'] });
  if (cookies) await ctx.addCookies(cookies);
  if (clock) await ctx.addInitScript(VIRTUAL_CLOCK);
  await ctx.addInitScript(PAGE_EXTRAS);
  return { ctx, page: await ctx.newPage() };
}

async function waitFor(page, selector, ms = 30000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const ok = await page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false;
      const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }, selector).catch(() => false);
    if (ok) return;
    await sleep(120);
  }
  await page.screenshot({ path: path.join(ROOT, 'work', 'record-demo-timeout.jpg') }).catch(() => {});
  throw new Error(`timed out waiting for ${selector} at ${page.url()}`);
}

async function waitForText(page, text, ms = 30000, warmClock = true) {
  const until = Date.now() + ms;
  const warm = warmClock ? setInterval(() => page.evaluate((s) => window.__cbStep?.(s), STEP).catch(() => {}), 30) : null;
  try {
    while (Date.now() < until) {
      if (await page.evaluate((s) => document.body.innerText.includes(s), text).catch(() => false)) return true;
      await sleep(150);
    }
  } finally {
    if (warm) clearInterval(warm);
  }
  return false;
}

async function load(page, url, selector) {
  const warm = setInterval(() => page.evaluate((ms) => window.__cbStep?.(ms), STEP).catch(() => {}), 30);
  try {
    if (url) await page.goto(url, { waitUntil: 'networkidle' });
    if (selector) await waitFor(page, selector);
  } finally {
    clearInterval(warm);
  }
  for (let n = 0; n < 30; n++) await page.evaluate((ms) => window.__cbStep(ms), STEP);
}

const saveState = (state) => writeFileSync(STATE, JSON.stringify(state, null, 1));
const readState = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {});

async function api(ctx, method, url, body) {
  const response = await ctx.request.fetch(`${BASE}/api${url}`, { method, data: body, headers: body ? { 'Content-Type': 'application/json' } : undefined });
  let json = null; try { json = await response.json(); } catch {}
  return { status: response.status(), body: json };
}

// A member's automatic welcome call rings on their first visit: decline it,
// so the screens we film are calm and the member is free for the next call.
async function declineWelcome(browser, memberId) {
  const ctx = await browser.newContext({ userAgent: IPHONE_UA });
  for (let i = 0; i < 6; i++) {
    const st = (await api(ctx, 'GET', `/members/${memberId}/phone-state`)).body;
    if (st?.incoming_call && !st.incoming_call.live) {
      await api(ctx, 'POST', `/calls/${st.incoming_call.call_id}/decline`);
      console.log(`declined ${st.incoming_call.kind} call for ${memberId}`);
    }
    await sleep(900);
  }
  await ctx.close();
}


async function openDesktop(browser, cookies, clock) {
  const ctx = await browser.newContext({ ...DESKTOP, reducedMotion: 'no-preference' });
  await ctx.addCookies(cookies);
  if (clock) await ctx.addInitScript(VIRTUAL_CLOCK);
  await ctx.addInitScript(PAGE_EXTRAS);
  // ZOOM=0.8 fits the whole live layout (traffic light included) on one screen.
  if (process.env.ZOOM) await ctx.addInitScript((z) => { document.documentElement.style.zoom = z; }, process.env.ZOOM);
  return { ctx, page: await ctx.newPage() };
}

// ---------------------------------------------------------------- the live view during a live scam call to Anna

async function live(browser, state) {
  const anna = state.members.Anna;
  await declineWelcome(browser, anna);
  const phone = await openPhone(browser, { clock: false });
  await phone.page.goto(`${BASE}/phone/${anna}`, { waitUntil: 'networkidle' });
  await waitFor(phone.page, '.phone-tabs');
  await sleep(2500);
  const sound = phone.page.getByRole('button', { name: /switch on sound/i });
  if (await sound.count()) { await sound.first().click({ force: true }).catch(() => {}); await sleep(600); }

  const organiser = await browser.newContext({ userAgent: IPHONE_UA });
  await organiser.addCookies(state.cookies);
  const started = await api(organiser, 'POST', `/families/${state.familyId}/live-call`, { member_id: anna });
  if (started.status !== 201) throw new Error(`live-call: ${started.status} ${JSON.stringify(started.body)}`);
  const callId = started.body.call_id;
  console.log('live call', callId);

  const laptop = await openDesktop(browser, state.cookies, false);
  await laptop.page.goto(`${BASE}/calls/${callId}`, { waitUntil: 'networkidle' });
  await waitFor(laptop.page, '.lc-conversation', 30000);
  await sleep(1200);
  const rec = new LiveRecorder(laptop.page, 'laptop-live');
  rec.start();

  const callerBrowser = await chromium.launch({ args: [...MEDIA_ARGS, `--use-file-for-fake-audio-capture=${SCAM_WAV}`] });
  const callerCtx = await callerBrowser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['microphone'] });
  await callerCtx.addCookies(state.cookies);
  const caller = await callerCtx.newPage();
  await caller.goto(`${BASE}/live/${callId}`);

  if (!(await waitForText(phone.page, 'Unknown number', 20000, false))) throw new Error('the call never rang');
  await sleep(1500);
  await phone.page.getByRole('button', { name: 'Answer' }).click({ force: true });
  const warned = await waitForText(phone.page, 'This sounds like a scam', 75000, false);
  console.log(warned ? 'warning shown' : 'NO WARNING within 75 s');
  await sleep(warned ? 6000 : 1000);
  const hangUp = phone.page.getByRole('button', { name: /^Hang up$/ });
  if (await hangUp.count()) await hangUp.first().click({ force: true });
  await sleep(3500);
  await rec.stop();
  rec.encode(path.join(ROOT, 'raw', 'laptop-live.mp4'));
  await callerBrowser.close();
  await phone.ctx.close();
  await laptop.ctx.close();

  // Wait for the result (the call is scored after it ends).
  let scored = false;
  for (let i = 0; i < 45 && !scored; i++) {
    const c = (await api(organiser, 'GET', `/calls/${callId}`)).body;
    scored = Boolean(c?.result) || c?.status === 'scored';
    if (!scored) await sleep(2000);
  }
  console.log(scored ? 'scored' : 'not scored within 90 s');
  await organiser.close();
  state.lastLiveCall = callId;
  return { callId, scored };
}

// ---------------------------------------------------------------- the result page, frame-stepped

async function result(browser, state, callId) {
  const { ctx, page } = await openDesktop(browser, state.cookies, true);
  await load(page, `${BASE}/calls/${callId}`, '.lc-result__head');
  const rec = new Recorder(page, 'laptop-result');
  await rec.settle();
  await rec.hold(2.5);
  const max = await page.evaluate(() => Math.max(0, document.documentElement.scrollHeight - window.innerHeight));
  await rec.scrollTo(Math.min(max, 420), 2.6);
  await rec.hold(2.2);
  await rec.scrollTo(Math.min(max, 900), 2.6);
  await rec.hold(2.2);
  await rec.scrollTo(0, 1.4);
  await rec.hold(1.2);
  rec.encode(path.join(ROOT, 'raw', 'laptop-result.mp4'));
  await ctx.close();
}

async function drills(browser, state) {
  const { ctx, page } = await openDesktop(browser, state.cookies, true);
  await load(page, `${BASE}/family/${state.familyId}/drills`, 'main');
  const rec = new Recorder(page, 'laptop-drills');
  await rec.settle();
  await rec.hold(2.5);
  const max = await page.evaluate(() => Math.max(0, document.documentElement.scrollHeight - window.innerHeight));
  await rec.scrollTo(Math.min(max, 500), 3.0);
  await rec.hold(2.0);
  rec.encode(path.join(ROOT, 'raw', 'laptop-drills.mp4'));
  await ctx.close();
}

async function latestScored(browser, state) {
  const ctx = await browser.newContext();
  await ctx.addCookies(state.cookies);
  const list = (await api(ctx, 'GET', `/families/${state.familyId}/drills?limit=20`)).body;
  await ctx.close();
  const items = list?.drills || list?.items || [];
  const done = items.find((d) => d.result || d.outcome || d.status === 'scored');
  return done ? (done.call_id || done.id) : null;
}

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : ['live', 'result', 'drills'];
const state = readState();
if (!state.familyId) throw new Error('no demo family in .secrets/demo-phone.json');
const browser = await chromium.launch({ args: MEDIA_ARGS });
try {
  let callId = process.env.CALL_ID || null, scored = Boolean(callId);
  if (wanted.includes('live')) ({ callId, scored } = await live(browser, state));
  if (wanted.includes('result')) {
    const target = scored ? callId : await latestScored(browser, state);
    if (target) await result(browser, state, target); else console.log('no scored call to show');
  }
  if (wanted.includes('drills')) await drills(browser, state);
} finally {
  await browser.close();
}
