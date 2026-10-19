// Ambient particles in the air round the hero, by location: sunlit pollen in the forest, wisps rising on the
// cemetery, snow on the pass, fireflies over the swamp, leaves drifting down in the grove, sand dust in the dunes.
// One point cloud whose positions wrap round the hero in the vertex shader (like the grass field); its look
// (colour, size, drift, rise or fall, flicker) is blended from the zone weights where the hero stands.
import * as THREE from 'three';
import { ZONE_IDS, zoneWeights } from './island';
import type { ZoneId } from './config';
import { STORMS, WIND, stormGust, stormPower, type StormLook } from './sandstorm';

interface Style {
  color: number;
  /** Point size, m. */
  size: number;
  /** Vertical speed, m/s (negative = falls). */
  rise: number;
  /** Side-to-side wander, m. */
  wobble: number;
  /** Horizontal drift with the wind, m/s. */
  drift: number;
  /** Flicker 0..1 (fireflies, wisps). */
  flicker: number;
  /** Share of the points shown 0..1. */
  amount: number;
  /** 1 = glows (bright core), 0 = flat (snow, leaves). */
  glow: number;
  /** 0..1: points stretch into streaks along the wind (sandstorm). */
  streak?: number;
  /** Look at the height of this zone's storm (STORMS), blended in by its power; streaks only in gusts. */
  storm?: { size: number; rise: number; drift: number; amount: number; streak: number };
}

const STYLES: Record<ZoneId, Style> = {
  forest: { color: 0xfff2b0, size: 0.07, rise: 0.12, wobble: 0.5, drift: 0.35, flicker: 0.35, amount: 0.19, glow: 1 },
  cemetery: { color: 0x9ef0ff, size: 0.16, rise: 0.35, wobble: 0.7, drift: 0.15, flicker: 0.8, amount: 0.29, glow: 1 },
  peaks: { color: 0xffffff, size: 0.09, rise: -0.9, wobble: 0.45, drift: 0.6, flicker: 0, amount: 0.38, glow: 0,
    storm: { size: 0.12, rise: -2.2, drift: 8, amount: 1, streak: 0.7 } },
  swamp: { color: 0xd8ff6a, size: 0.1, rise: 0.05, wobble: 0.9, drift: 0.1, flicker: 1, amount: 0.23, glow: 1 },
  grove: { color: 0xf09a3a, size: 0.13, rise: -0.45, wobble: 0.9, drift: 0.5, flicker: 0, amount: 0.21, glow: 0 },
  dunes: { color: 0xf4e2b0, size: 0.4, rise: -0.05, wobble: 0.15, drift: 9, flicker: 0, amount: 1, glow: 0, streak: 1 },
  hills: { color: 0xf0f0e8, size: 0.06, rise: 0.08, wobble: 0.4, drift: 0.8, flicker: 0.2, amount: 0.13, glow: 0.5 },
};

/** Box of air round the hero the points live in (x, height, z), m; it sits mostly up the screen (−z). */
const BOX = new THREE.Vector3(30, 6, 42);
const AHEAD = 6;

export class Ambient {
  readonly points: THREE.Points;
  private u = {
    uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uBox: { value: BOX },
    uColor: { value: new THREE.Color() }, uSize: { value: 0.1 }, uRise: { value: 0 }, uWobble: { value: 0 }, uDrift: { value: 0 },
    // rise and drift integrated over time (m): the blended speeds change as the hero walks, so time × speed would jump
    uRiseOff: { value: 0 }, uDriftOff: { value: 0 },
    uFlicker: { value: 0 }, uAmount: { value: 0 }, uGlow: { value: 1 }, uScale: { value: 400 },
    uStreak: { value: 0 }, uWind: { value: WIND }, uSlant: { value: 0 }, uAlphaK: { value: 1 },
  };
  /** Storm zone weight × its power 0..1 where the hero stands (sandstorm.ts follows it), and that storm's look. */
  storm = 0;
  stormLook: StormLook | null = null;
  private w: number[] = [];
  private last = -1;
  private tmp = new THREE.Color();
  /** Always this location's look (scenes off the island, e.g. the prologue); null = blended where the hero stands. */
  fixed: ZoneId | null = null;

  constructor(count = 1100) {
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    const geo = new THREE.BufferGeometry();
    // positions are made in the shader; the attribute only gives three.js a count
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform float uTime; uniform vec3 uCenter; uniform vec3 uBox; uniform float uSize; uniform float uRise; uniform float uWobble;
        uniform float uDrift; uniform vec2 uWind; uniform float uSlant; uniform float uFlicker; uniform float uAmount; uniform float uScale; uniform float uRiseOff; uniform float uDriftOff;
        varying float vAlpha; varying vec2 vDir;
        void main(){
          float k = 0.7 + aSeed.w * 0.6;
          float t = uTime * k;
          vec3 p = aSeed.xyz * uBox;
          p.y += uRiseOff * k;
          p.x += uDriftOff * k * uWind.x + sin(t * 0.9 + aSeed.w * 40.0) * uWobble;
          p.z += uDriftOff * k * uWind.y + cos(t * 0.7 + aSeed.x * 31.0) * uWobble;
          // wrap round the hero
          vec3 lo = uCenter - uBox * vec3(0.5, 0.0, 0.5);
          p = lo + mod(p - lo, uBox);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          // fade at the edges of the box (so wrapping never pops) and near the ground / ceiling
          vec3 e = abs(p - uCenter - vec3(0.0, uBox.y * 0.5, 0.0)) / (uBox * 0.5);
          float edge = (1.0 - smoothstep(0.75, 1.0, max(e.x, e.z))) * (1.0 - smoothstep(0.6, 1.0, e.y));
          float flick = mix(1.0, 0.5 + 0.5 * sin(uTime * (2.0 + aSeed.y * 5.0) + aSeed.z * 50.0), uFlicker);
          vAlpha = edge * flick * step(aSeed.w, uAmount);
          // screen direction of the wind, for streaks
          vec4 ahead = projectionMatrix * (mv + viewMatrix * vec4(uWind.x, uSlant, uWind.y, 0.0));
          vec2 sd = ahead.xy / ahead.w - gl_Position.xy / gl_Position.w;
          vDir = normalize(vec2(sd.x * projectionMatrix[1][1] / projectionMatrix[0][0], -sd.y) + 1e-5);
          gl_PointSize = uSize * projectionMatrix[1][1] * uScale / -mv.z;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uGlow; uniform float uStreak; uniform float uAlphaK;
        varying float vAlpha; varying vec2 vDir;
        void main(){
          vec2 d = gl_PointCoord - 0.5;
          // streaks: thin ellipse along the wind direction
          vec2 q = vec2(dot(d, vDir), dot(d, vec2(-vDir.y, vDir.x)));
          q.y /= mix(1.0, 0.1, uStreak);
          float r = length(q) * 2.0;
          float soft = 1.0 - smoothstep(0.2, 1.0, r);
          float disc = 1.0 - smoothstep(0.6, 0.85, r);
          float a = mix(disc, soft, uGlow) * vAlpha * uAlphaK;
          if (a < 0.01) discard;
          // glowing points get a white-hot core (the post glow picks it up)
          vec3 c = uColor * (1.0 + uGlow * 1.8 * (1.0 - smoothstep(0.0, 0.45, r)));
          gl_FragColor = vec4(c, a);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
  }

  /** `viewH`: drawing-buffer height in pixels (point sizes are in metres). */
  update(time: number, hero: THREE.Vector3, viewH: number) {
    const u = this.u;
    u.uTime.value = time;
    u.uCenter.value.set(hero.x, 0, hero.z - AHEAD);
    u.uScale.value = viewH * 0.5;
    const wt = this.w;
    if (this.fixed) for (let i = 0; i < ZONE_IDS.length; i++) wt[i] = ZONE_IDS[i] === this.fixed ? 1 : 0;
    else zoneWeights(hero.x, hero.z, wt);
    let sum = 0;
    for (let i = 0; i < wt.length; i++) sum += wt[i];
    if (!sum) sum = 1;
    u.uColor.value.setRGB(0, 0, 0);
    let size = 0, rise = 0, wobble = 0, drift = 0, flicker = 0, amount = 0, glow = 0, streak = 0, gusty = 0;
    this.storm = 0;
    this.stormLook = null;
    const gust = stormGust(time);
    for (let i = 0; i < ZONE_IDS.length; i++) {
      const k = wt[i] / sum;
      if (k <= 0) continue;
      const id = ZONE_IDS[i];
      const s = STYLES[id];
      const look = STORMS[id];
      const p = look ? stormPower(look, time) : 0;
      const st = s.storm;
      u.uColor.value.add(this.tmp.set(s.color).multiplyScalar(k));
      size += (st ? s.size + (st.size - s.size) * p : s.size) * k;
      rise += (st ? s.rise + (st.rise - s.rise) * p : s.rise) * k;
      drift += (st ? s.drift + (st.drift - s.drift) * p : s.drift) * k;
      amount += (st ? s.amount + (st.amount - s.amount) * p : s.amount) * k;
      wobble += s.wobble * k; flicker += s.flicker * k; glow += s.glow * k;
      streak += (s.streak ?? 0) * k;
      if (st) gusty += st.streak * p * gust * k;
      if (look && k * p > this.storm) { this.storm = k * p; this.stormLook = look; }
    }
    // dt clamped: a hidden tab or a pause must not throw the points far
    const dt = this.last < 0 ? 0 : Math.min(0.1, Math.max(0, time - this.last));
    this.last = time;
    u.uRiseOff.value += rise * dt;
    // gusts speed the sand / snow up in a storm (integrated: no jumps in the pattern)
    u.uDriftOff.value += drift * (1 + 0.7 * this.storm * gust) * dt;
    u.uSize.value = size; u.uRise.value = rise; u.uWobble.value = wobble; u.uDrift.value = drift;
    streak += gusty;
    u.uStreak.value = streak; u.uAlphaK.value = 1 - 0.45 * streak;
    // falling snow streaks tilt down along its path (the sand streaks stay level)
    u.uSlant.value = gusty > 0 ? rise / Math.max(drift, 0.1) : 0;
    u.uFlicker.value = flicker; u.uAmount.value = amount; u.uGlow.value = glow;
  }

  dispose() {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}
