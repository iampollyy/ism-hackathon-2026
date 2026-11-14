// The field: 56 phones ringing in the dark behind the one phone (the problem), which
// switch off one by one, nearest last, until only the one that called back is lit (the habit).
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { phoneBodyGeometry } from './PhoneModel';
import { fieldScreenMaterial } from './materials';

const COUNT = 56;

function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface FieldHandle {
  group: THREE.Group;
  screens: THREE.ShaderMaterial;
  bodies: THREE.MeshStandardMaterial;
}

export function Field({ onReady }: { onReady: (h: FieldHandle) => void }) {
  const group = useRef<THREE.Group>(null);
  const bodiesRef = useRef<THREE.InstancedMesh>(null);
  const screensRef = useRef<THREE.InstancedMesh>(null);
  const bodyGeo = useMemo(() => phoneBodyGeometry(2), []);
  const screenGeo = useMemo(() => {
    const g = new THREE.PlaneGeometry(0.72, 1.56);
    const r = rng(23);
    const phase = new Float32Array(COUNT);
    const ring = new Float32Array(COUNT);
    const off = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i += 1) {
      phase[i] = r();
      ring[i] = r();
    }
    // Off thresholds by distance from the centre: far ones go dark first.
    const pos = layout();
    pos.forEach((p, i) => {
      const d = Math.min(1, Math.hypot(p.y * 0.5, (p.z + 3) * 0.5, p.x * 0.15) / 6);
      off[i] = 0.08 + (1 - d) * 0.85;
    });
    g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    g.setAttribute('aRing', new THREE.InstancedBufferAttribute(ring, 1));
    g.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 1));
    return g;
  }, []);
  const screenMat = useMemo(() => fieldScreenMaterial(), []);
  const bodyMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#0b1620',
        metalness: 0.5,
        roughness: 0.55,
        transparent: true,
        opacity: 0,
        envMapIntensity: 0.35,
      }),
    [],
  );

  useLayoutEffect(() => {
    const bodies = bodiesRef.current;
    const screens = screensRef.current;
    if (!bodies || !screens || !group.current) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const v = new THREE.Vector3();
    const front = new THREE.Matrix4().makeTranslation(0, 0, 0.0435);
    layout().forEach((p, i) => {
      e.set(p.pitch, p.yaw, p.roll);
      q.setFromEuler(e);
      s.setScalar(p.scale);
      v.set(p.x, p.y, p.z);
      m.compose(v, q, s);
      bodies.setMatrixAt(i, m);
      screens.setMatrixAt(i, m.clone().multiply(front));
    });
    bodies.instanceMatrix.needsUpdate = true;
    screens.instanceMatrix.needsUpdate = true;
    onReady({ group: group.current, screens: screenMat, bodies: bodyMat });
  }, [onReady, screenMat, bodyMat]);

  return (
    <group ref={group} visible={false}>
      <instancedMesh ref={bodiesRef} args={[bodyGeo, bodyMat, COUNT]} frustumCulled={false} />
      <instancedMesh ref={screensRef} args={[screenGeo, screenMat, COUNT]} frustumCulled={false} renderOrder={2} />
    </group>
  );
}

interface Slot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  scale: number;
}

let cached: Slot[] | null = null;

/** A jittered grid on the right half of the view (never behind the text), deep into the dark. */
function layout(): Slot[] {
  if (cached) return cached;
  const r = rng(7);
  const out: Slot[] = [];
  const cols = 7;
  const tanHalf = Math.tan((16 * Math.PI) / 180);
  for (let i = 0; i < COUNT; i += 1) {
    const c = i % cols;
    const row = Math.floor(i / cols);
    const z = -5 - r() * 13;
    const dist = 5.2 - z;
    const halfH = dist * tanHalf;
    const halfW = halfH * 1.55;
    const u = 0.1 + ((c + 0.5 + (r() - 0.5) * 0.7) / cols) * 0.95;
    const v = -0.92 + ((row + 0.5 + (r() - 0.5) * 0.6) / 8) * 1.84;
    out.push({
      x: u * halfW,
      y: v * halfH,
      z,
      yaw: (r() - 0.5) * 0.87,
      pitch: (r() - 0.5) * 0.2,
      roll: (r() - 0.5) * 0.12,
      scale: 0.75 + r() * 0.2,
    });
  }
  cached = out;
  return out;
}
