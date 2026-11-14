// Shaders for the rings that ripple out from the phone, the soft glow behind it and
// the screens of the field of phones. All procedural; nothing is downloaded.
import * as THREE from 'three';

export const RING_PLANE = 5.4;

export function ringsMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      uGlitch: { value: 0 },
      uSeed: { value: 0 },
      uColor: { value: new THREE.Color('#e76d52') },
      uSize: { value: RING_PLANE },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uIntensity;
      uniform float uGlitch;
      uniform float uSeed;
      uniform vec3 uColor;
      uniform float uSize;
      varying vec2 vUv;

      float sdRoundRect(vec2 p, vec2 b, float r) {
        vec2 q = abs(p) - b + r;
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
      }
      float hash(float n) { return fract(sin(n) * 43758.5453123); }

      void main() {
        vec2 p = (vUv - 0.5) * uSize;
        if (uGlitch > 0.0) {
          float band = floor(vUv.y * 6.0);
          p.x += (hash(band * 17.0 + uSeed) - 0.5) * 0.08 * uSize * uGlitch;
        }
        // Distance from the phone's outline: rings start phone-shaped and round off as they grow.
        float d = sdRoundRect(p, vec2(0.39, 0.81), 0.11);
        float a = 0.0;
        for (int i = 0; i < 3; i++) {
          float r = fract(uTime / 2.4 + float(i) / 3.0) * 1.5;
          float x = abs(d - r);
          float band = smoothstep(0.014, 0.0, x);
          float glow = exp(-x * 20.0) * 0.3;
          float fade = (1.0 - r / 1.5);
          a += fade * fade * (band + glow) * smoothstep(0.0, 0.06, r);
        }
        a *= uIntensity * 0.75;
        gl_FragColor = vec4(uColor * a, a);
        #include <colorspace_fragment>
      }
    `,
  });
}

export function glowMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color('#e76d52') },
      uOpacity: { value: 0.1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float a = pow(clamp(1.0 - d, 0.0, 1.0), 2.2) * uOpacity;
        gl_FragColor = vec4(uColor * a, a);
        #include <colorspace_fragment>
      }
    `,
  });
}

/** Screens of the field: each phone rings (an orange pulse) or sits dark; they switch off by distance. */
export function fieldScreenMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uShare: { value: 0.3 },
      uDim: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute float aPhase;
      attribute float aRing;
      attribute float aOff;
      varying vec2 vUv;
      varying float vPhase;
      varying float vRing;
      varying float vOff;
      varying float vDepth;
      void main() {
        vUv = uv;
        vPhase = aPhase;
        vRing = aRing;
        vOff = aOff;
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uOpacity;
      uniform float uShare;
      uniform float uDim;
      varying vec2 vUv;
      varying float vPhase;
      varying float vRing;
      varying float vOff;
      varying float vDepth;
      void main() {
        float on = 1.0 - smoothstep(vOff - 0.04, vOff + 0.04, uDim);
        float ringing = step(vRing, uShare) * on;
        vec2 p = vUv - vec2(0.5, 0.72);
        p.x *= 0.46;
        float t = fract(uTime / 2.4 + vPhase);
        float dot_ = smoothstep(0.035, 0.0, length(p));
        float ring = smoothstep(0.012, 0.0, abs(length(p) - t * 0.22)) * (1.0 - t);
        vec3 base = mix(vec3(0.002, 0.005, 0.009), vec3(0.008, 0.016, 0.026), vUv.y) * (0.4 + 0.6 * on);
        vec3 orange = vec3(0.8, 0.152, 0.085);
        vec3 col = base + orange * ringing * (dot_ * 1.4 + ring * 0.8 + 0.05 * (1.0 - length(vUv - vec2(0.5, 0.7))));
        float fog = smoothstep(23.0, 9.0, vDepth);
        float a = uOpacity * fog * (0.55 + 0.45 * on);
        gl_FragColor = vec4(col, a);
        #include <colorspace_fragment>
      }
    `,
  });
}
