// Real screen recordings of the setup flow on the live site, for the Devpost
// video (a friend is shown how to register and set up a family). Same
// frame-stepped capture as record_app.mjs: the page's clock only moves when we
// take a frame, so typing, clicks and scrolls come out smooth at 30 fps and
// network waits are simply left out of the footage.
//
//   node tools/record_setup.mjs              # all clips
//   node tools/record_setup.mjs desktop      # or: phone-join, phone-home
//
// The desktop clip registers ONE new demo account (an @example.com address and
// a generated password, both kept in video/.secrets/setup-demo.json, never
// printed) and creates "Polina's family". The phone clips reuse that family.
// Invite links and QR codes are blurred in the page before any frame is taken.

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.CALLBACK_URL || 'https://callback.denishoti.dev';
const STATE = path.join(ROOT, '.secrets', 'setup-demo.json');
const FPS = 30, STEP = 1000 / FPS;
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const PHONE = { viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA, out: [1080, 1920] };
const DESK = { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5, isMobile: false, hasTouch: false, out: [1920, 1080] };

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

// Blur anything that could let a viewer join the family, and add a pointer
// (desktop) or a tap ring (phone) that the script moves.
const PAGE_EXTRAS = (phone) => {
  const style = document.createElement('style');
  style.textContent = `.onb-qr, .onb-link, .onb-invite-actions code, .fh-link-text, code, [class*="invite-link"], [class*="qr"] svg, [class*="qr"] canvas, canvas[aria-label*="QR"], svg[aria-label*="QR"]
    { filter: blur(9px) !important; }
    #cb-pointer { position: fixed; z-index: 2147483647; pointer-events: none; left: 0; top: 0; }`;
  const add = () => {
    document.head.appendChild(style);
    const p = document.createElement('div');
    p.id = 'cb-pointer';
    p.innerHTML = phone
      ? '<div style="width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(255,255,255,.35);border:2px solid rgba(53,42,124,.55);opacity:0;transition:none" id="cb-tap"></div>'
      : '<svg width="26" height="30" viewBox="0 0 26 30" style="filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))"><path d="M2 2 L2 24 L8 18 L12.5 28 L16.5 26.2 L12 16.5 L20 16.5 Z" fill="#fff" stroke="#1d1647" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    if (!phone) p.style.transform = 'translate(640px, 420px)';
    document.body.appendChild(p);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
};

class Recorder {
  constructor(page, name, device) {
    this.page = page; this.name = name; this.device = device; this.i = 0;
    this.frames = path.join(ROOT, 'work', 'rec', name);
    rmSync(this.frames, { recursive: true, force: true });
    mkdirSync(this.frames, { recursive: true });
    this.pointer = { x: 640, y: 420 };
  }
  async frame() {
    await this.page.evaluate((ms) => window.__cbStep(ms), STEP);
    await this.page.screenshot({ path: path.join(this.frames, `${String(this.i++).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92 });
  }
  async hold(seconds) { for (let n = Math.round(seconds * FPS); n > 0; n--) await this.frame(); }
  async settle() { // after a real-time wait: let the new screen render and animate in
    for (let n = 0; n < 12; n++) await this.page.evaluate((ms) => window.__cbStep(ms), STEP);
  }
  async scrollTo(y, seconds = 0.8) {
    const from = await this.page.evaluate(() => window.scrollY);
    const n = Math.max(1, Math.round(seconds * FPS));
    for (let k = 1; k <= n; k++) {
      const t = k / n, e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      await this.page.evaluate((top) => window.scrollTo(0, top), from + (y - from) * e);
      await this.frame();
    }
  }
  async reveal(locator) { // smooth-scroll so the element sits comfortably in view
    const { top, h } = await locator.evaluate((el) => ({ top: el.getBoundingClientRect().top, h: window.innerHeight }));
    if (top < 90 || top > h * 0.72) {
      const y = await this.page.evaluate(() => window.scrollY);
      await this.scrollTo(Math.max(0, y + top - h * 0.35), 0.7);
    }
  }
  async point(locator) {
    await this.reveal(locator);
    const box = await locator.boundingBox();
    const tx = box.x + Math.min(box.width / 2, 60), ty = box.y + box.height / 2;
    if (this.device === PHONE) { this.pointer = { x: tx, y: ty }; return; }
    const { x: fx, y: fy } = this.pointer, n = 12;
    for (let k = 1; k <= n; k++) {
      const t = k / n, e = 1 - (1 - t) ** 3;
      await this.page.evaluate(([x, y]) => { document.getElementById('cb-pointer').style.transform = `translate(${x}px, ${y}px)`; },
        [fx + (tx - fx) * e, fy + (ty - fy) * e]);
      await this.frame();
    }
    this.pointer = { x: tx, y: ty };
  }
  async tap() { // a short ring where the finger lands (phone)
    if (this.device !== PHONE) return;
    const { x, y } = this.pointer;
    for (let k = 0; k < 8; k++) {
      await this.page.evaluate(([px, py, o, s]) => {
        const p = document.getElementById('cb-pointer'); const r = document.getElementById('cb-tap');
        p.style.transform = `translate(${px}px, ${py}px)`; r.style.opacity = o; r.style.transform = `scale(${s})`;
      }, [x, y, String(0.9 - k * 0.11), String(0.7 + k * 0.06)]);
      await this.frame();
    }
    await this.page.evaluate(() => { document.getElementById('cb-tap').style.opacity = '0'; });
  }
  async click(locator, after = 0.3) {
    await this.point(locator);
    await this.hold(0.15);
    await locator.click({ force: true, timeout: 15000 });
    await this.tap();
    await this.hold(after);
  }
  async type(locator, text, cps = 13) {
    await this.click(locator, 0.1);
    for (const ch of text) {
      await this.page.keyboard.type(ch);
      const n = Math.max(1, Math.round(FPS / cps + (Math.random() - 0.5)));
      for (let k = 0; k < n; k++) await this.frame();
    }
    await this.hold(0.25);
  }
  encode(target) {
    const [w, h] = this.device.out;
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-framerate', String(FPS), '-i', path.join(this.frames, '%05d.jpg'),
      '-vf', `scale=${w}:${h}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', target]);
    console.log(`${path.relative(ROOT, target)}: ${(this.i / FPS).toFixed(1)} s`);
  }
}

async function open(browser, device, cookies) {
  const { out, ...options } = device;
  const ctx = await browser.newContext({ ...options, reducedMotion: 'no-preference' });
  if (cookies) await ctx.addCookies(cookies);
  await ctx.addInitScript(VIRTUAL_CLOCK);
  await ctx.addInitScript(PAGE_EXTRAS, device === PHONE);
  const page = await ctx.newPage();
  return { ctx, page };
}

// Wait for an element with a plain check in the page itself (Playwright's own
// polling stalls under the stepped clock).
async function waitFor(page, selector, ms = 25000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const ok = await page.evaluate((s) => { const el = document.querySelector(s); if (!el) return false;
      const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }, selector).catch(() => false);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 120));
  }
  await page.screenshot({ path: path.join(ROOT, 'work', 'record-setup-timeout.jpg') }).catch(() => {});
  throw new Error(`timed out waiting for ${selector} at ${page.url()}`);
}

async function waitForText(page, text, ms = 25000) {
  const until = Date.now() + ms;
  const warm = setInterval(() => page.evaluate((s) => window.__cbStep?.(s), STEP).catch(() => {}), 30);
  try {
    while (Date.now() < until) {
      if (await page.evaluate((s) => document.body.innerText.includes(s), text).catch(() => false)) return;
      await new Promise((r) => setTimeout(r, 120));
    }
  } finally {
    clearInterval(warm);
  }
  throw new Error(`timed out waiting for the text "${text}" at ${page.url()}`);
}

// Let a page load with its clock running, then freeze it.
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

// ---------------------------------------------------------------- clip 1: desktop sign-up

async function desktop(browser) {
  const email = `polina.${randomBytes(3).toString('hex')}@example.com`;
  const password = `Cb-${randomBytes(9).toString('base64url')}`;
  const { ctx, page } = await open(browser, DESK);
  await load(page, BASE + '/', '.lp-btn--nav');
  let rec = new Recorder(page, 'setup-desktop-1', DESK);
  await rec.hold(2.2);
  await rec.click(page.locator('.lp-btn--nav').first(), 0);
  await waitForText(page, 'First, your organiser account');
  await rec.settle();
  await rec.hold(1.8);
  await rec.click(page.locator('main').getByText('Create an account', { exact: true }).first(), 0);
  await load(page, null, '#register-name');
  await rec.settle();
  await rec.hold(0.8);
  await rec.type(page.locator('#register-name'), 'Polina');
  await rec.type(page.locator('#register-email'), email, 18);
  await rec.type(page.locator('#register-password'), password, 16);
  await rec.click(page.getByRole('button', { name: /Create account/ }), 0);
  await load(page, null, '#family-name');
  await rec.settle();
  await rec.hold(1.2);
  writeFileSync(STATE, JSON.stringify({ email, password }, null, 1));

  await rec.type(page.locator('#family-name'), "Polina's family");
  await rec.click(page.locator('.onb-word input[type=checkbox]'), 0.4);
  const people = () => page.locator('.onb-person');
  const fill = async (index, name, relationship) => {
    const row = people().nth(index);
    const nameBox = row.locator('input[id^="name-"]');
    if ((await nameBox.inputValue()) !== name) {
      await nameBox.fill('', { force: true });
      await rec.type(nameBox, name);
    }
    await rec.type(row.locator('input[id^="relationship-"]'), relationship);
  };
  await fill(0, 'Polina', 'granddaughter');
  const me = people().nth(0);
  await rec.click(me.getByText('I agree to receive practice calls without knowing when'), 0.25);
  await rec.click(me.getByText(/Callback may copy my voice/), 0.4);
  await fill(1, 'Anna', 'grandmother');
  await rec.click(page.getByRole('button', { name: /Add a person/ }), 0.3);
  await fill(2, 'Ivan', 'grandfather');
  await rec.click(page.getByRole('button', { name: /Add a person/ }), 0.3);
  await fill(3, 'Gangbi', 'friend');
  await rec.hold(0.6);
  await rec.click(page.getByRole('button', { name: /Create the family and get invite links/ }), 0);
  await load(page, null, '.onb-invite-card');
  await rec.settle();
  await rec.hold(1.5);
  rec.encode(path.join(ROOT, 'raw', 'setup-desktop-1.mp4'));

  // Clip 1b: the invites (blurred), the plan, the family page with Protection on.
  rec = new Recorder(page, 'setup-desktop-2', DESK);
  rec.pointer = { x: 900, y: 500 };
  await rec.hold(1.8);
  const cards = page.locator('.onb-invite-card');
  await rec.reveal(cards.nth(1));
  await rec.hold(1.6);
  await rec.click(page.getByRole('button', { name: /Next: choose a plan/ }), 0);
  await load(page, null, '.onb-trial');
  await rec.settle();
  await rec.hold(1.6);
  await rec.click(page.locator('.onb-trial button').first(), 0);
  await load(page, null, '[role="switch"][aria-label="Protection"]');
  await rec.settle();
  await rec.hold(1.8);
  const familyId = new URL(page.url()).pathname.split('/')[2];
  const sw = page.locator('[role="switch"][aria-label="Protection"]').first();
  if ((await sw.getAttribute('aria-checked')) !== 'true') {
    await rec.click(sw, 0);
    await load(page, null, '[role="switch"][aria-label="Protection"][aria-checked="true"]');
    await rec.settle();
  }
  await rec.hold(1.6);
  const y = await page.evaluate(() => window.scrollY);
  await rec.scrollTo(y + 520, 1.6);
  await rec.hold(1.6);
  rec.encode(path.join(ROOT, 'raw', 'setup-desktop-2.mp4'));

  const family = await (await ctx.request.get(`${BASE}/api/families/${familyId}`)).json();
  const members = Object.fromEntries((family.members || []).map((m) => [m.name, m.id]));
  const cookies = await ctx.cookies();
  writeFileSync(STATE, JSON.stringify({ email, password, familyId, members, cookies }, null, 1));
  console.log(JSON.stringify({ email, familyId, members }));
  await ctx.close();
}

// ---------------------------------------------------------------- clip 2: a grandparent's invite on a phone

async function phoneJoin(browser, state) {
  const anna = state.members.Anna;
  const { ctx, page } = await open(browser, PHONE);
  await load(page, `${BASE}/join/${anna}`, '.join-install__sheet');
  const rec = new Recorder(page, 'setup-phone', PHONE);
  await rec.hold(3.2);
  await rec.click(page.getByRole('button', { name: 'Continue here instead' }), 0);
  await rec.settle();
  await rec.hold(1.6);
  await rec.reveal(page.locator('.join-how'));
  await rec.hold(1.8);
  const ticks = page.locator('.join-tick');
  await rec.click(ticks.nth(0), 0.5);
  await rec.click(ticks.nth(1), 0.8);
  await rec.reveal(page.getByRole('button', { name: /Join and start my welcome call/ }));
  await rec.hold(2.2);
  rec.encode(path.join(ROOT, 'raw', 'setup-phone.mp4'));
  await ctx.close();
}

// ---------------------------------------------------------------- clip 3: Polina's phone, home and News

async function phoneHome(browser, state) {
  const polina = state.members.Polina;
  // Her first visit would ring her automatic welcome call: let it start and
  // decline it first, so the home screen is calm on camera.
  const api = await browser.newContext({ userAgent: IPHONE_UA });
  await api.request.get(`${BASE}/api/members/${polina}/phone-state`);
  const ringing = await (await api.request.get(`${BASE}/api/members/${polina}/phone-state`)).json();
  if (ringing.incoming_call) await api.request.post(`${BASE}/api/calls/${ringing.incoming_call.call_id}/decline`);
  await api.close();

  const { ctx, page } = await open(browser, PHONE);
  await load(page, `${BASE}/phone/${polina}`, '.phone-tabs');
  const rec = new Recorder(page, 'phone-home', PHONE);
  await rec.hold(3);
  await rec.scrollTo(420, 1.6);
  await rec.hold(1.4);
  await rec.scrollTo(0, 1);
  await rec.click(page.getByRole('tab', { name: 'News' }), 0);
  await load(page, null, '.news-hero');
  await rec.settle();
  await rec.hold(2.4);
  await rec.scrollTo(560, 2.6);
  await rec.hold(2);
  rec.encode(path.join(ROOT, 'raw', 'phone-home.mp4'));
  await ctx.close();
}

// ---------------------------------------------------------------- clip 4: the family page, Protection on, the members

async function familyPage(browser, state) {
  const { ctx, page } = await open(browser, DESK, state.cookies);
  await load(page, `${BASE}/family/${state.familyId}`, '.fh-member-main');
  const rec = new Recorder(page, 'family-page', DESK);
  rec.pointer = { x: 1100, y: 600 };
  await rec.hold(2.5);
  const first = page.locator('.fh-member-main').first();
  const top = await first.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  await rec.scrollTo(Math.max(0, top - 140), 2.2);
  await rec.hold(3.2);
  rec.encode(path.join(ROOT, 'raw', 'family-page.mp4'));
  await ctx.close();
}

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : ['desktop', 'phone-join', 'phone-home', 'family-page'];
mkdirSync(path.join(ROOT, 'raw'), { recursive: true });
mkdirSync(path.dirname(STATE), { recursive: true });
const browser = await chromium.launch();
try {
  if (wanted.includes('desktop')) await desktop(browser);
  const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : null;
  if (!state?.familyId && (wanted.includes('phone-join') || wanted.includes('phone-home') || wanted.includes('family-page'))) throw new Error('run the desktop clip first');
  if (wanted.includes('phone-join')) await phoneJoin(browser, state);
  if (wanted.includes('phone-home')) await phoneHome(browser, state);
  if (wanted.includes('family-page')) await familyPage(browser, state);
} finally {
  await browser.close();
}
