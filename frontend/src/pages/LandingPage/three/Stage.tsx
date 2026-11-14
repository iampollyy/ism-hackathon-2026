// The WebGL stage (a lazy chunk, loaded only on capable desktops after the page has
// loaded). One fixed canvas behind the night sections. The phone flies between the
// CSS phone boxes (the anchors), so it always lands where the lite phone was.
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { live, store, useLp, type CallState, type StageKey } from '../store';
import {
  CallingScreen,
  HeroScreen,
  IncomingScreen,
  RiskScreen,
  ShieldScreen,
  StoryScreen,
  riskAt,
} from '../components/screens';
import { FRONT_Z, PHONE_H, PhoneModel } from './PhoneModel';
import { RING_PLANE, glowMaterial, ringsMaterial } from './materials';
import { Field, type FieldHandle } from './Field';

const CAM_Z = 5.2;
const FOV = 32;
const ORDER: StageKey[] = ['hero', 'problem', 'habit', 'story', 'shield'];
const DEG = Math.PI / 180;
const HTML_DF = (0.72 * 400) / 390; // 390 design px cover the 0.72-wide screen

const C = {
  scam: new THREE.Color('#e0475e'),
  safe: new THREE.Color('#3cc58f'),
  doubt: new THREE.Color('#f5b94d'),
  cool: new THREE.Color('#605886'),
  red: new THREE.Color('#e0475e'),
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (t: number) => t * t * (3 - 2 * t);
const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const damp = THREE.MathUtils.damp;

type Rot = [number, number, number];

const leaning = (c: CallState) => c === 'in-call' || c === 'hung-up' || c === 'glitch' || c === 'reveal';

function rotFor(key: StageKey, s: ReturnType<typeof store.get>): Rot {
  switch (key) {
    case 'hero':
      return [-4 * DEG, (leaning(s.call) ? -6 : -14) * DEG, 2 * DEG];
    case 'problem':
      return [0, (-6 + 12 * s.problemP) * DEG, 0];
    case 'habit':
      return [-3 * DEG, -10 * DEG, 0];
    case 'story': {
      const p = s.chapterP;
      if (s.chapter <= 0) return [-3 * DEG, -18 * DEG, 0];
      if (s.chapter === 1) return [-3 * DEG, (-18 + 30 * smooth(clamp01(p / 0.25))) * DEG, 0];
      if (s.chapter === 2) return [-3 * DEG, (12 - 18 * smooth(p)) * DEG, 0];
      if (s.chapter === 3) return [-2 * DEG, -8 * DEG, 0];
      return [-5 * DEG, -10 * DEG, 0];
    }
    case 'shield':
      return [-2 * DEG, 8 * DEG, -3 * DEG];
  }
}

function turnFor(s: ReturnType<typeof store.get>) {
  if (s.chapter < 3) return 0;
  if (s.chapter === 3) return easeInOutCubic(clamp01(s.chapterP / 0.35));
  return 1;
}

interface Look {
  color: THREE.Color;
  rings: number;
  ringColor: THREE.Color;
  glow: number;
}

function lookFor(key: StageKey, s: ReturnType<typeof store.get>): Look {
  switch (key) {
    case 'hero': {
      const c = s.call;
      if (c === 'ringing' || c === 'connecting') return { color: C.scam, rings: 1, ringColor: C.scam, glow: 0.22 };
      if (c === 'in-call') return { color: C.scam, rings: 0, ringColor: C.scam, glow: 0.18 + live.audioLevel * 0.3 };
      if (c === 'calling-back') return { color: C.safe, rings: 1, ringColor: C.safe, glow: 0.3 };
      if (c === 'connected' || c === 'done') return { color: C.safe, rings: 0, ringColor: C.safe, glow: 0.24 };
      if (c === 'reveal' && s.lesson) return { color: C.safe, rings: 0.8, ringColor: C.safe, glow: 0.2 };
      return { color: C.cool, rings: 0, ringColor: C.safe, glow: 0.16 };
    }
    case 'problem':
      return { color: C.scam, rings: 0.55, ringColor: C.scam, glow: 0.14 };
    case 'habit':
      return s.habitP >= 0.5
        ? { color: C.safe, rings: 0.6, ringColor: C.safe, glow: 0.24 }
        : { color: C.scam, rings: 0.3, ringColor: C.scam, glow: 0.12 };
    case 'story': {
      const p = s.chapterP;
      if (s.chapter <= 0) return { color: C.cool, rings: 0, ringColor: C.safe, glow: 0.14 };
      if (s.chapter === 1) return { color: C.scam, rings: p < 0.08 ? 1 - p / 0.08 : 0, ringColor: C.scam, glow: 0.18 };
      if (s.chapter === 2) {
        const level = riskAt(p).level;
        const color = level === 'green' ? C.safe : level === 'yellow' ? C.doubt : C.scam;
        return { color, rings: 0, ringColor: C.safe, glow: 0.42 };
      }
      if (s.chapter === 3)
        return p >= 0.7
          ? { color: C.safe, rings: (p - 0.7) / 0.3, ringColor: C.safe, glow: 0.26 }
          : { color: C.cool, rings: 0, ringColor: C.safe, glow: 0.14 };
      return { color: C.safe, rings: 0, ringColor: C.safe, glow: 0.18 };
    }
    case 'shield':
      return { color: C.red, rings: 0, ringColor: C.scam, glow: 0.3 };
  }
}

/** A night-time studio for reflections: a dark navy room with a few soft light panels. */
function makeEnvScene() {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.SphereGeometry(20, 32, 16),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#0f0b23'), side: THREE.BackSide }),
  );
  env.add(room);
  const panel = (w: number, h: number, color: string, k: number, pos: [number, number, number]) => {
    const c = new THREE.Color(color).multiplyScalar(k);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  panel(6, 3, '#dce6ee', 2.4, [-6, 5, 6]); // key, high on the left
  panel(10, 1.2, '#ffffff', 1.6, [0, 9, 0]); // top strip for the upper edges
  panel(5, 5, '#867fa8', 1.3, [7, -2, 5]); // cool fill
  panel(4, 6, '#e0475e', 0.9, [8, 1, -6]); // warm rim behind
  panel(8, 2, '#342a67', 1.4, [0, -8, 2]); // floor bounce
  return env;
}

function useAnchors() {
  const ref = useRef<Partial<Record<StageKey, HTMLElement>>>({});
  const get = useCallback((k: StageKey) => {
    let el = ref.current[k];
    if (!el || !el.isConnected) {
      el = document.querySelector<HTMLElement>(`[data-phone-anchor="${k}"]`) ?? undefined;
      if (el) ref.current[k] = el;
    }
    return el;
  }, []);
  return get;
}

// ------------------------------------------------------------------ the screen on the glass

function StageScreen() {
  const stage = useLp((s) => s.stage);
  const chapter = useLp((s) => s.chapter);
  const p = useLp((s) => s.chapterP);
  const turned = useLp((s) => s.turned);
  const habitP = useLp((s) => s.habitP);
  const shieldP = useLp((s) => s.shieldP);
  let content;
  if (stage === 'hero') content = <HeroScreen interactive />;
  else if (stage === 'problem') content = <IncomingScreen />;
  else if (stage === 'habit')
    content = habitP >= 0.5 ? <CallingScreen name="Son" timer={0} connected={false} /> : <IncomingScreen />;
  else if (stage === 'story') {
    if (chapter === 3 && !turned) content = <RiskScreen p={1} />;
    else content = <StoryScreen chapter={chapter} p={p} />;
  } else content = <ShieldScreen p={shieldP} />;
  return (
    <div className="lp-3dscreen" inert={stage !== 'hero' || undefined} aria-hidden={stage !== 'hero' || undefined}>
      {content}
    </div>
  );
}

// ------------------------------------------------------------------ the scene

function Scene({
  portal,
  onReady,
  onFail,
  wrap,
}: {
  portal: RefObject<HTMLDivElement | null>;
  onReady: () => void;
  onFail: () => void;
  wrap: RefObject<HTMLDivElement | null>;
}) {
  const { gl, scene, size, invalidate, camera } = useThree();
  const anchor = useAnchors();
  const rig = useRef<THREE.Group>(null);
  const screenWrap = useRef<HTMLDivElement>(null);
  const ringsMat = useMemo(() => ringsMaterial(), []);
  const glowMat = useMemo(() => glowMaterial(), []);
  const ringsRig = useRef<THREE.Group>(null);
  const keyLight = useRef<THREE.PointLight>(null);
  const rimLight = useRef<THREE.DirectionalLight>(null);
  const field = useRef<FieldHandle | null>(null);
  const [interactive, setInteractive] = useState(true);
  const frames = useRef(0);
  const placed = useRef(false);
  const settled = useRef(0);
  const readyCalled = useRef(false);
  const lastScroll = useRef(0);
  const perf = useRef({ acc: 0, n: 0, slowFor: 0 });
  const glitchSeed = useRef({ t: 0, x: 0, y: 0, r: 0 });
  const colorNow = useRef(new THREE.Color('#e0475e'));
  const ringColorNow = useRef(new THREE.Color('#e0475e'));
  const force3d = useMemo(() => new URLSearchParams(window.location.search).has('3d'), []);

  // Lighting: a procedural room for reflections (no download) plus state-coloured lights.
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const envScene = makeEnvScene();
    const env = pmrem.fromScene(envScene, 0.035).texture;
    envScene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    });
    scene.environment = env;
    scene.environmentIntensity = 1;
    scene.fog = new THREE.Fog('#0a071a', 9, 23);
    return () => {
      env.dispose();
      pmrem.dispose();
      scene.environment = null;
      scene.fog = null;
    };
  }, [gl, scene]);

  // Render on scroll; otherwise only while something moves.
  useEffect(() => {
    const onScroll = () => {
      lastScroll.current = performance.now();
      invalidate();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    const unsub = store.subscribe(() => invalidate());
    const lost = (e: Event) => {
      e.preventDefault();
      onFail();
    };
    gl.domElement.addEventListener('webglcontextlost', lost);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      unsub();
      gl.domElement.removeEventListener('webglcontextlost', lost);
    };
  }, [invalidate, gl, onFail]);

  // The glitch on the canvas element: three short frames, at least 180 ms apart.
  useEffect(() => {
    let prev = store.get().call;
    const timers: number[] = [];
    const unsub = store.subscribe(() => {
      const c = store.get().call;
      if (c === prev) return;
      prev = c;
      if (c !== 'glitch' || store.get().reducedMotion) return;
      [0, 180, 420].forEach((at, i) => {
        timers.push(
          window.setTimeout(() => {
            const el = wrap.current;
            if (!el) return;
            el.dataset.glitch = String(i % 2);
            timers.push(window.setTimeout(() => delete el.dataset.glitch, 50));
          }, at),
        );
      });
    });
    return () => {
      unsub();
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [wrap]);

  const onField = useCallback((h: FieldHandle) => {
    field.current = h;
  }, []);

  const tmp = useMemo(
    () => ({
      a: new THREE.Vector3(),
      b: new THREE.Vector3(),
      n: new THREE.Vector3(),
      toCam: new THREE.Vector3(),
      q: new THREE.Quaternion(),
    }),
    [],
  );

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const s = store.get();
    const g = rig.current;
    if (!g) return;
    const W = size.width;
    const H = size.height;
    const wpp = (2 * CAM_Z * Math.tan((FOV / 2) * DEG)) / H;
    const vc = H / 2;

    // Where are the anchors?
    const rects = ORDER.map((k) => anchor(k)?.getBoundingClientRect() ?? null);
    let i = 0;
    for (let k = 0; k < ORDER.length; k += 1) {
      const r = rects[k];
      if (r && r.top + r.height / 2 <= vc) i = k;
    }
    let t = 0;
    const ra = rects[i];
    const rb = rects[i + 1];
    if (ra && rb && i < ORDER.length - 1) {
      const ca = ra.top + ra.height / 2;
      const cb = rb.top + rb.height / 2;
      t = cb === ca ? 0 : clamp01((vc - ca) / (cb - ca));
    }
    const ts = smooth(t);
    const ka = ORDER[i];
    const kb = ORDER[Math.min(i + 1, ORDER.length - 1)];
    const stage: StageKey = ts < 0.5 ? ka : kb;
    if (s.stage !== stage) store.set({ stage });
    const heroOn = stage === 'hero';
    if (heroOn !== interactive) setInteractive(heroOn);

    const proj = (r: DOMRect | null, out: THREE.Vector3) => {
      if (!r) return out.set(0, 0, 0);
      return out.set((r.left + r.width / 2 - W / 2) * wpp, -(r.top + r.height / 2 - H / 2) * wpp, (r.height * wpp) / PHONE_H);
    };
    proj(ra, tmp.a);
    proj(rb ?? ra, tmp.b);
    const target = tmp.a.lerp(tmp.b, ts);
    let scale = target.z;

    // Rotation, with the reveal's full turn carried by everything after it.
    const rA = rotFor(ka, s);
    const rB = rotFor(kb, s);
    const turn = ka === 'story' || ka === 'shield' ? turnFor(s) * Math.PI * 2 : 0;
    const time = state.clock.elapsedTime;
    let rx = rA[0] + (rB[0] - rA[0]) * ts;
    let ry = rA[1] + (rB[1] - rA[1]) * ts + turn;
    let rz = rA[2] + (rB[2] - rA[2]) * ts;
    let px = target.x;
    let py = target.y;

    // The hero: idle float, lean-in during the call, glitch jitter.
    const heroW = ka === 'hero' ? 1 - ts : 0;
    if (heroW > 0) {
      const ringingNow = s.call === 'ringing' || s.call === 'connecting';
      const fl = s.reducedMotion ? 0 : 1;
      py += 0.03 * scale * Math.sin(time * Math.PI * 2 * 0.25) * heroW * fl;
      ry += 2 * DEG * Math.sin(time * Math.PI * 2 * 0.1) * heroW * fl * (ringingNow ? 1 : 0.5);
      if (leaning(s.call)) scale *= 1 + 0.06 * heroW;
      if (s.call === 'glitch' && live.glitch > 0) {
        const gs = glitchSeed.current;
        if (time - gs.t > 0.06) {
          gs.t = time;
          gs.x = (Math.random() - 0.5) * 0.04;
          gs.y = (Math.random() - 0.5) * 0.04;
          gs.r = (Math.random() - 0.5) * 3 * DEG;
        }
        px += gs.x * heroW;
        py += gs.y * heroW;
        rz += gs.r * heroW;
      }
    }

    // Shield's end: both phones drift up as the night ends.
    let nightEnd = 0;
    if (ka === 'shield' || kb === 'shield') {
      nightEnd = clamp01((s.shieldP - 0.85) / 0.15) * (ka === 'shield' ? 1 : ts);
      py += 0.3 * nightEnd;
      if (wrap.current) wrap.current.style.opacity = String(1 - nightEnd);
    } else if (wrap.current && wrap.current.style.opacity !== '') wrap.current.style.opacity = '';

    // Damped towards the targets (position faster than rotation). The first frame
    // lands exactly on the CSS phone, so the swap from the CSS phone is invisible.
    const before = g.position.x + g.position.y + g.rotation.y + g.scale.x;
    if (!placed.current) {
      placed.current = true;
      g.position.set(px, py, 0);
      g.scale.setScalar(scale);
      g.rotation.set(rx, ry, rz);
    } else {
      g.position.x = damp(g.position.x, px, 7, dt);
      g.position.y = damp(g.position.y, py, 7, dt);
      g.scale.setScalar(damp(g.scale.x, scale, 7, dt));
      g.rotation.x = damp(g.rotation.x, rx, 4.5, dt);
      g.rotation.y = damp(g.rotation.y, ry, 4.5, dt);
      g.rotation.z = damp(g.rotation.z, rz, 4.5, dt);
    }
    const moving = Math.abs(before - (g.position.x + g.position.y + g.rotation.y + g.scale.x)) > 1e-4;

    // The screen swaps for the reveal while the phone shows its back.
    const turned = g.rotation.y > Math.PI * 0.95 - 8 * DEG;
    if (s.turned !== turned) store.set({ turned });

    // Hide the glass's DOM when the phone faces away.
    tmp.n.set(0, 0, 1).applyQuaternion(g.getWorldQuaternion(tmp.q));
    tmp.toCam.copy(camera.position).sub(g.position).normalize();
    const facing = tmp.n.dot(tmp.toCam);
    const sw = screenWrap.current;
    if (sw) {
      const vis = facing > 0.08 ? '1' : '0';
      if (sw.style.opacity !== vis) sw.style.opacity = vis;
    }

    // Rings, glow and lights follow the scene's state.
    const la = lookFor(ka, s);
    const lb = lookFor(kb, s);
    const look = ts < 0.5 ? la : lb;
    const ringsTarget = la.rings * (1 - ts) + lb.rings * ts;
    colorNow.current.lerp(look.color, 1 - Math.exp(-2.5 * dt));
    ringColorNow.current.lerp(look.ringColor, 1 - Math.exp(-4 * dt));
    const u = ringsMat.uniforms;
    u.uTime.value = time;
    u.uIntensity.value = damp(u.uIntensity.value, s.reducedMotion ? 0 : ringsTarget, 5, dt);
    (u.uColor.value as THREE.Color).copy(ringColorNow.current);
    u.uGlitch.value = s.call === 'glitch' && heroW > 0 ? live.glitch : 0;
    if (u.uGlitch.value > 0 && time - glitchSeed.current.t < 0.02) u.uSeed.value = Math.random() * 100;
    const glowTarget = la.glow * (1 - ts) + lb.glow * ts;
    glowMat.uniforms.uOpacity.value = damp(glowMat.uniforms.uOpacity.value, glowTarget, 4, dt);
    (glowMat.uniforms.uColor.value as THREE.Color).copy(colorNow.current);
    if (keyLight.current) {
      keyLight.current.color.copy(colorNow.current);
      keyLight.current.intensity = 0.4 + live.audioLevel * 1.8 * heroW;
    }
    if (rimLight.current) rimLight.current.color.copy(colorNow.current);
    if (ringsRig.current) {
      ringsRig.current.position.set(g.position.x, g.position.y, -0.2);
      ringsRig.current.scale.setScalar(g.scale.x);
    }

    // The field, behind the phone in the problem and habit sections.
    let fieldOpacity = 0;
    if (ka === 'hero' && kb === 'problem') fieldOpacity = ts;
    else if (ka === 'problem') fieldOpacity = 1;
    else if (ka === 'habit') fieldOpacity = 1 - ts;
    const f = field.current;
    if (f) {
      const fu = f.screens.uniforms;
      fu.uOpacity.value = damp(fu.uOpacity.value, fieldOpacity, 4, dt);
      fu.uTime.value = time;
      fu.uShare.value = 0.3 + 0.4 * s.problemP;
      fu.uDim.value = damp(fu.uDim.value, ka === 'habit' || kb === 'habit' ? clamp01(s.habitP / 0.5) : 0, 4, dt);
      f.bodies.opacity = fu.uOpacity.value * 0.9;
      f.group.visible = fu.uOpacity.value > 0.005;
    }

    // Keep rendering only while something moves.
    const fieldOn = !!f && f.group.visible;
    const animating =
      moving ||
      performance.now() - lastScroll.current < 1200 ||
      u.uIntensity.value > 0.01 ||
      fieldOn ||
      (heroW > 0 && s.call !== 'done' && s.call !== 'declined' && s.call !== 'stopped');
    const off = s.segment === 'after';
    if (wrap.current) wrap.current.classList.toggle('is-off', off);
    // The glass's DOM lives in its own fixed layer: it fades and hides with the canvas.
    const ui = portal.current;
    if (ui) {
      const o = off ? '0' : nightEnd > 0 ? String(1 - nightEnd) : '';
      if (ui.style.opacity !== o) ui.style.opacity = o;
      const v = off ? 'hidden' : '';
      if (ui.style.visibility !== v) ui.style.visibility = v;
    }
    if (animating && !off) invalidate();

    // Ready once the glass has rendered and the phone has sat on its target for two
    // frames (the idle float moves the target a little, hence the small allowance).
    frames.current += 1;
    const off3 = Math.abs(g.position.x - px) + Math.abs(g.position.y - py) + Math.abs(g.scale.x - scale) * 0.5;
    settled.current = off3 < 0.012 ? settled.current + 1 : 0;
    if (!readyCalled.current && frames.current > 4 && settled.current >= 2) {
      readyCalled.current = true;
      wrap.current?.classList.add('is-ready');
      onReady();
    }

    // Too slow for this machine: hand back to the CSS phone for the rest of the visit.
    if (!force3d && dtRaw < 0.25) {
      const pf = perf.current;
      pf.acc += dtRaw;
      pf.n += 1;
      if (pf.n >= 30) {
        const avg = pf.acc / pf.n;
        pf.slowFor = avg > 0.034 ? pf.slowFor + pf.acc : 0;
        pf.acc = 0;
        pf.n = 0;
        if (pf.slowFor > 2) onFail();
      }
    }
  });

  return (
    <>
      <ambientLight intensity={0.25} color="#b9b2e0" />
      <directionalLight position={[-3, 2, 3]} intensity={0.6} color="#cfdbe6" />
      <directionalLight ref={rimLight} position={[3, 0.5, -2]} intensity={1.4} color="#e0475e" />
      <directionalLight position={[0, -3, 1]} intensity={0.35} color="#605886" />
      <group ref={ringsRig}>
        <mesh material={ringsMat} renderOrder={-1}>
          <planeGeometry args={[RING_PLANE, RING_PLANE]} />
        </mesh>
        <mesh material={glowMat} position={[0, 0, -0.1]} renderOrder={-2}>
          <planeGeometry args={[5.2, 5.2]} />
        </mesh>
      </group>
      <Field onReady={onField} />
      <group ref={rig} position={[2, 0, 0]} scale={0.001}>
        <PhoneModel />
        <pointLight ref={keyLight} position={[0, 0, 0.6]} intensity={0.4} distance={3} color="#e0475e" />
        <Html
          transform
          portal={portal as RefObject<HTMLElement>}
          distanceFactor={HTML_DF}
          position={[0, 0, FRONT_Z + 0.0012]}
          pointerEvents={interactive ? 'auto' : 'none'}
          zIndexRange={[20, 0]}
        >
          <div ref={screenWrap} className="lp-3dscreen__wrap">
            <StageScreen />
          </div>
        </Html>
      </group>
    </>
  );
}

export default function Stage({
  portal,
  onReady,
  onFail,
}: {
  portal: RefObject<HTMLDivElement | null>;
  onReady: () => void;
  onFail: () => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  return (
    <div className="lp-canvas" ref={wrap} aria-hidden="true">
      <Canvas
        dpr={[1, 1.75]}
        frameloop="demand"
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        camera={{ fov: FOV, position: [0, 0, CAM_Z], near: 0.1, far: 40 }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
          gl.setClearColor(0x000000, 0);
        }}
        style={{ pointerEvents: 'none' }}
      >
        <Scene portal={portal} onReady={onReady} onFail={onFail} wrap={wrap} />
      </Canvas>
    </div>
  );
}
