// The procedural phone: navy titanium body, black glass, a camera plateau on the back.
// Units: the phone is 1.62 tall; the screen (drei Html) sits on the glass.
import { forwardRef, useMemo } from 'react';
import * as THREE from 'three';

export const PHONE_W = 0.78;
export const PHONE_H = 1.62;
export const PHONE_D = 0.085;
export const FRONT_Z = PHONE_D / 2;

export function roundedRect(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** An extruded rounded rectangle with softly bevelled edges, centred on z. */
export function phoneBodyGeometry(segments = 6) {
  const bevel = 0.016;
  const depth = PHONE_D - bevel * 2;
  const g = new THREE.ExtrudeGeometry(roundedRect(PHONE_W - bevel * 2, PHONE_H - bevel * 2, 0.11 - bevel), {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: segments,
    curveSegments: segments * 3,
  });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  return g;
}

export const PhoneModel = forwardRef<THREE.Group, { bodyColor?: string }>(function PhoneModel({ bodyColor = '#22394c' }, ref) {
  const body = useMemo(() => phoneBodyGeometry(6), []);
  const glass = useMemo(() => new THREE.ShapeGeometry(roundedRect(0.742, 1.582, 0.098), 24), []);
  const plateau = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(roundedRect(0.3, 0.3, 0.07), {
      depth: 0.008,
      bevelEnabled: true,
      bevelThickness: 0.006,
      bevelSize: 0.006,
      bevelSegments: 3,
      curveSegments: 12,
    });
    return g;
  }, []);
  const lens = useMemo(() => new THREE.CylinderGeometry(0.048, 0.05, 0.022, 32), []);
  const lensRing = useMemo(() => new THREE.TorusGeometry(0.052, 0.008, 10, 36), []);
  const button = useMemo(() => new THREE.BoxGeometry(0.012, 1, 0.032), []);

  const mats = useMemo(
    () => ({
      body: new THREE.MeshPhysicalMaterial({
        color: bodyColor,
        metalness: 0.72,
        roughness: 0.38,
        clearcoat: 0.3,
        clearcoatRoughness: 0.3,
        envMapIntensity: 0.45,
      }),
      glass: new THREE.MeshPhysicalMaterial({
        color: '#04080c',
        metalness: 0,
        roughness: 0.06,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        envMapIntensity: 0.9,
      }),
      back: new THREE.MeshPhysicalMaterial({
        color: '#1f364a',
        metalness: 0.35,
        roughness: 0.55,
        clearcoat: 0.3,
        envMapIntensity: 0.8,
      }),
      lens: new THREE.MeshPhysicalMaterial({ color: '#05090d', metalness: 0.2, roughness: 0.08, clearcoat: 1 }),
      ring: new THREE.MeshStandardMaterial({ color: '#2a3d4d', metalness: 0.9, roughness: 0.25 }),
    }),
    [bodyColor],
  );

  return (
    <group ref={ref}>
      <mesh geometry={body} material={mats.body} />
      {/* Glass, just proud of the front face. */}
      <mesh geometry={glass} material={mats.glass} position={[0, 0, FRONT_Z + 0.0006]} />
      {/* Matte back panel. */}
      <mesh geometry={glass} material={mats.back} position={[0, 0, -FRONT_Z - 0.0006]} rotation={[0, Math.PI, 0]} />
      {/* Camera plateau and three lenses, on the back. */}
      <group position={[0.19, 0.58, -FRONT_Z - 0.001]} rotation={[0, Math.PI, 0]}>
        <mesh geometry={plateau} material={mats.back} />
        {(
          [
            [-0.065, 0.065],
            [0.065, 0.0],
            [-0.065, -0.065],
          ] as const
        ).map(([x, y], i) => (
          <group key={i} position={[x, y, 0.02]}>
            <mesh geometry={lens} material={mats.lens} rotation={[Math.PI / 2, 0, 0]} />
            <mesh geometry={lensRing} material={mats.ring} />
          </group>
        ))}
      </group>
      {/* Side buttons. */}
      <mesh geometry={button} material={mats.body} position={[PHONE_W / 2 + 0.002, 0.32, 0]} scale={[1, 0.16, 1]} />
      <mesh geometry={button} material={mats.body} position={[-PHONE_W / 2 - 0.002, 0.42, 0]} scale={[1, 0.1, 1]} />
      <mesh geometry={button} material={mats.body} position={[-PHONE_W / 2 - 0.002, 0.26, 0]} scale={[1, 0.1, 1]} />
    </group>
  );
});
