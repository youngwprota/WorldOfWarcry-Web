// Zone storms: the sandstorm of the dunes and the blizzard of the Snow Pass. ONE wind-blown sheet near the ground
// (streaks + a light veil that swells with gusts); the blown grains / flakes themselves are the ambient.ts points.
// Everything fades with the storm zone's weight where the hero stands (Ambient.storm), so it rises and falls at the
// borders like fog and mist do. The blizzard also comes in waves (stormWave); the sand blows all the time.
import * as THREE from 'three';
import { ATMOS } from './atmos';
import type { ZoneId } from './config';

/** Wind direction on the ground (unit x, z); ambient.ts blows the grains and flakes the same way. */
export const WIND = new THREE.Vector2(1, 0.45).normalize();

export interface StormLook {
  /** Colour of the sheet. */
  color: number;
  /** Sheet speed along the wind, m/s (gusts add up to `gustBoost` x). */
  speed: number;
  gustBoost: number;
  /** Peak opacity of the wind streaks. */
  sheetAlpha: number;
  /** Veil opacity inside the same sheet: always on / extra at the peak of a gust. */
  hazeBase: number;
  hazeGust: number;
  /** Sheet height above the ground, m. */
  height: number;
  /** Comes in waves (stormWave) instead of blowing all the time. */
  waves: boolean;
}

/** Tuning per storm zone. */
export const STORMS: Partial<Record<ZoneId, StormLook>> = {
  dunes: { color: 0xe6c488, speed: 16, gustBoost: 0.8, sheetAlpha: 0.5, hazeBase: 0.07, hazeGust: 0.16, height: 1.0, waves: false },
  // cool blue-grey white (the pass is tuned so white never burns out); veil only in gusts
  peaks: { color: 0xdfe7f0, speed: 13, gustBoost: 1.1, sheetAlpha: 0.38, hazeBase: 0, hazeGust: 0.1, height: 0.6, waves: true },
};

/** Blizzard waves, s: each cycle = calm, build-up, raging (with gusts), passing; calm between storms ~30-60 s. */
export const WAVES = {
  period: 80,
  /** Storm start inside its cycle: `start` + up to `startJitter`. */
  start: 20,
  startJitter: 12,
  build: 6,
  /** Raging: `rage` + up to `rageJitter`. */
  rage: 15,
  rageJitter: 10,
  pass: 8,
};

/** Gust strength 0..1: slow irregular swells (periods ~14 s and ~6 s) shared by the grains, sheets and haze. */
export function stormGust(time: number): number {
  const s = Math.sin(time * 0.45) + 0.6 * Math.sin(time * 1.05 + 1.3);
  const x = Math.min(1, Math.max(0, (s + 0.3) / 1.5));
  return x * x * (3 - 2 * x);
}

function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function smooth(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/** Blizzard strength 0..1 at `time`: one storm per WAVES.period, its start and length picked per cycle from a hash. */
export function stormWave(time: number): number {
  const w = WAVES;
  const n = Math.floor(time / w.period);
  const t = time - n * w.period - (w.start + w.startJitter * hash(n));
  const rage = w.rage + w.rageJitter * hash(n + 0.5);
  return smooth(t / w.build) * (1 - smooth((t - w.build - rage) / w.pass));
}

/** How hard `look` blows at `time` 0..1 (before the zone weight). */
export function stormPower(look: StormLook, time: number): number {
  return look.waves ? stormWave(time) : 1;
}

export class Sandstorm {
  readonly group = new THREE.Group();
  private sheet: THREE.Mesh;
  private u: {
    uOff: { value: number }; uStorm: { value: number }; uVeil: { value: number }; uCam: { value: THREE.Vector3 };
  };
  private uColor = { value: new THREE.Color() };
  private uAlpha = { value: 0 };
  private last = -1;
  private off = 0;

  constructor() {
    this.u = { uOff: { value: 0 }, uStorm: { value: 0 }, uVeil: { value: 0 }, uCam: { value: new THREE.Vector3() } };
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        ...this.u, uColor: this.uColor, uAlpha: this.uAlpha,
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
    this.sheet.renderOrder = 5;
    this.sheet.frustumCulled = false;
    this.group.add(this.sheet);
    this.group.visible = false;
  }

  /** `storm`: storm zone weight × its power where the hero stands (Ambient.storm, `look` = Ambient.stormLook);
   *  `low` graphics hides it all. */
  update(time: number, hero: THREE.Vector3, storm: number, look: StormLook | null, low: boolean) {
    const on = !!look && storm > 0.003 && !low;
    this.group.visible = on;
    const dt = this.last < 0 ? 0 : Math.min(0.1, Math.max(0, time - this.last));
    this.last = time;
    if (!on) return;
    const gust = stormGust(time);
    // integrated, so the gusts change the speed without jumping the pattern
    this.off += look.speed * (1 + look.gustBoost * gust) * dt;
    const u = this.u;
    u.uOff.value = this.off;
    u.uStorm.value = storm * (0.7 + 0.3 * gust);
    u.uVeil.value = look.hazeBase + look.hazeGust * gust;
    this.uColor.value.setHex(look.color);
    this.uAlpha.value = look.sheetAlpha;
    this.sheet.position.y = look.height;
    u.uCam.value.copy(hero);
    // centred on the hero, snapped to whole metres: the noise is in world space
    this.sheet.position.x = Math.round(hero.x);
    this.sheet.position.z = Math.round(hero.z);
  }

  /** The noise texture (ATMOS.noise) is module-level shared and stays. */
  dispose() {
    this.group.removeFromParent();
    this.sheet.geometry.dispose();
    (this.sheet.material as THREE.Material).dispose();
  }
}
