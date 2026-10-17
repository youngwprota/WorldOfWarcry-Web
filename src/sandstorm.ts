// Sandstorm of the dunes: ONE wind-blown sand sheet near the ground (streaks + a light sandy veil that swells with gusts).
// The blown sand grains themselves are the dunes style of ambient.ts. Everything fades with the dunes weight where the hero
// stands (Ambient.storm), so it rises and falls at the borders like fog and mist do.
import * as THREE from 'three';
import { ATMOS } from './atmos';

/** Wind direction on the ground (unit x, z); ambient.ts blows the sand grains the same way. */
export const WIND = new THREE.Vector2(1, 0.45).normalize();

/** Tuning. */
export const STORM = {
  /** Sand colour of the sheet. */
  color: 0xe6c488,
  /** Sheet speed along the wind, m/s (gusts add up to `gustBoost` x). */
  speed: 16,
  gustBoost: 0.8,
  /** Peak opacity of the wind streaks. */
  sheetAlpha: 0.5,
  /** Veil opacity inside the same sheet: always on / extra at the peak of a gust. */
  hazeBase: 0.07,
  hazeGust: 0.16,
  /** Sheet height above the ground, m. */
  height: 1.0,
};

/** Gust strength 0..1: slow irregular swells (periods ~14 s and ~6 s) shared by the grains, sheets and haze. */
export function stormGust(time: number): number {
  const s = Math.sin(time * 0.45) + 0.6 * Math.sin(time * 1.05 + 1.3);
  const x = Math.min(1, Math.max(0, (s + 0.3) / 1.5));
  return x * x * (3 - 2 * x);
}

export class Sandstorm {
  readonly group = new THREE.Group();
  private sheet: THREE.Mesh;
  private u: {
    uOff: { value: number }; uStorm: { value: number }; uVeil: { value: number }; uCam: { value: THREE.Vector3 };
  };
  private last = -1;
  private off = 0;

  constructor() {
    this.u = { uOff: { value: 0 }, uStorm: { value: 0 }, uVeil: { value: 0 }, uCam: { value: new THREE.Vector3() } };
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        ...this.u, uColor: { value: new THREE.Color(STORM.color) }, uAlpha: { value: STORM.sheetAlpha },
        uWind: { value: WIND }, uNoise: ATMOS.noise,
      },
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `varying vec3 vW; uniform float uOff; uniform float uStorm; uniform float uVeil; uniform vec3 uCam; uniform vec3 uColor;
        uniform float uAlpha; uniform vec2 uWind; uniform sampler2D uNoise;
        void main(){
          // distance fade and early-out before any texture sample
          float d = length(vW.xz - uCam.xz);
          float fade = uStorm * (1.0 - smoothstep(24.0, 38.0, d)) * mix(0.45, 1.0, smoothstep(1.5, 6.0, d));
          if (fade < 0.004) discard;
          // noise texture stretched along the wind and scrolled with it (1 uv = 256 px tile)
          vec2 q = vec2(dot(vW.xz, uWind) - uOff, dot(vW.xz, vec2(-uWind.y, uWind.x)));
          vec2 p = vec2(q.x * 0.012, q.y * 0.055);
          vec4 t = texture2D(uNoise, p);
          float streak = smoothstep(0.5, 0.82, t.g * 0.7 + t.b * 0.3);
          float a = (streak * uAlpha + uVeil * (0.5 + t.g)) * fade;
          if (a < 0.004) discard;
          gl_FragColor = vec4(uColor, a);
        }`,
    });
    this.sheet = new THREE.Mesh(new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2), mat);
    this.sheet.position.y = STORM.height;
    this.sheet.renderOrder = 5;
    this.sheet.frustumCulled = false;
    this.group.add(this.sheet);
    this.group.visible = false;
  }

  /** `storm`: dunes weight 0..1 where the hero stands (Ambient.storm); `low` graphics hides it all. */
  update(time: number, hero: THREE.Vector3, storm: number, low: boolean) {
    const on = storm > 0.003 && !low;
    this.group.visible = on;
    const dt = this.last < 0 ? 0 : Math.min(0.1, Math.max(0, time - this.last));
    this.last = time;
    if (!on) return;
    const gust = stormGust(time);
    // integrated, so the gusts change the speed without jumping the pattern
    this.off += STORM.speed * (1 + STORM.gustBoost * gust) * dt;
    const u = this.u;
    u.uOff.value = this.off;
    u.uStorm.value = storm * (0.7 + 0.3 * gust);
    u.uVeil.value = STORM.hazeBase + STORM.hazeGust * gust;
    u.uCam.value.copy(hero);
    // centred on the hero, snapped to whole metres: the noise is in world space
    this.sheet.position.x = Math.round(hero.x);
    this.sheet.position.z = Math.round(hero.z);
  }
}
