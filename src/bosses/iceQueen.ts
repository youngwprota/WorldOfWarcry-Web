import * as THREE from 'three';
import { ATTACK_HIT, HERO } from '../config';
import type { BossKitFactory } from './kit';

interface IceCfg {
  /** Snow zone radius (m), its phase 2 growth, how fast the radius changes (m/s). */
  zoneR: number;
  zoneR2: number;
  /** Blizzard flakes per metre of the largest zone radius (the edge whirl adds `WHIRL_PER_M`). */
  flakesPerM: number;
  /** Heavy blow: ground circle radius (m) frozen at the cast spot, start range (m), phase 2 rate. */
  blowR: number;
  blowStart: number;
  rate2: number;
  /** Blow damage = boss.dmg × dmgMul (× phase2Dmg for a boss). */
  dmgMul: number;
  /** Seconds between blows; 0 = 1 / the def's aps. */
  period: number;
}
const QUEEN: IceCfg = { zoneR: 7, zoneR2: 1.3, flakesPerM: 60, blowR: 5.5, blowStart: 4.5, rate2: 1.4, dmgMul: 1, period: 0 };
// the warden's own dmg is low (24 vs the queen's 100): 4.2× lands about half of the queen's 200 blow
const WARDEN: IceCfg = { zoneR: 4, zoneR2: 1, flakesPerM: 40, blowR: 3.5, blowStart: 3.2, rate2: 1, dmgMul: 4.2, period: 5 };
const ZONE_SLOW = 0.6;
const ZONE_GROW = 3;
const BLOW_DELAY = 1.2;
const BLOW_ANIM = 'MeleeHigh';
const SNOW = 0xdff3ff;
const FROST = 0x9fd8ff;
const SNOW_PUFF_EVERY = 0.1;
const GATHER_EVERY = 0.08;
/** Blizzard: flake size per metre of zone radius, fall height, sideways slant per metre of fall, whirl flakes per metre of radius. */
const FLAKE_SIZE_PER_M = 0.04;
const FLAKE_TOP = 4.5;
const FLAKE_SLANT = 0.35;
const WHIRL_PER_M = 7;
const LOW_EVERY = 4;

function flakeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(235,245,255,0.7)');
  grad.addColorStop(1, 'rgba(220,240,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

function softDiscTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.35)');
  grad.addColorStop(0.7, 'rgba(210,235,255,0.3)');
  grad.addColorStop(1, 'rgba(200,230,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/**
 * Ice Queen: a check of armour. The snow zone slows the hero (defense doesn't change it), and she presses on
 * with rare, very heavy blows (MobDef dmg / aps) that only defense can soften.
 * Shared by the queen and her mini-boss (frost_warden), tuned by `IceCfg`.
 */
const iceKit = (cfg: IceCfg): BossKitFactory => (host, boss) => {
  const at = new THREE.Vector3();
  let radius = cfg.zoneR;
  let blowCd = 1;
  let winding = false;
  let windT = 0;
  let gen = 0;
  let snowT = 0;
  let gatherT = 0;
  let disc: THREE.Mesh | null = null;
  let edge: THREE.Mesh | null = null;
  let tex: THREE.CanvasTexture | null = null;
  let flakeTex: THREE.CanvasTexture | null = null;
  let flakes: THREE.Points | null = null;

  // blizzard pool: flakes [0, whirlN) orbit the zone edge, the rest fall inside it (every LOW_EVERY-th drifts low)
  const maxR = cfg.zoneR * cfg.zoneR2;
  const whirlN = Math.round(WHIRL_PER_M * maxR);
  const mainN = Math.round(cfg.flakesPerM * maxR);
  const total = whirlN + mainN;
  const ang = new Float32Array(total);
  const rf = new Float32Array(total);
  const fy = new Float32Array(total);
  const vy = new Float32Array(total);
  const sp = new Float32Array(total);
  const ph = new Float32Array(total);
  const flakePos = new Float32Array(total * 3);
  let clock = 0;

  function seedFlake(i: number, anywhere: boolean) {
    if (i < whirlN) {
      rf[i] = 0.93 + Math.random() * 0.07;
      fy[i] = anywhere ? Math.random() * 1.8 : 0.05;
      vy[i] = 0.4 + Math.random() * 0.6;
      sp[i] = 0.8 + Math.random() * 0.5;
      return;
    }
    // squared so the flakes crowd toward the centre
    const u = Math.random();
    rf[i] = u * u;
    fy[i] = FLAKE_TOP * (anywhere ? Math.random() : 0.8 + Math.random() * 0.2);
    vy[i] = 1.2 + Math.random() * 1.3;
    sp[i] = 0.6 + Math.random() * 0.8;
    ph[i] = Math.random() * 6.28;
  }

  for (let i = 0; i < total; i++) {
    ang[i] = Math.random() * Math.PI * 2;
    seedFlake(i, true);
  }

  function updateFlakes(dt: number, bx: number, bz: number) {
    clock += dt;
    const count = whirlN + Math.round(mainN * (radius / maxR));
    for (let i = 0; i < count; i++) {
      const r = radius * rf[i];
      let y: number;
      let slant = 0;
      if (i < whirlN) {
        ang[i] += dt * 4 * sp[i] / r;
        fy[i] += vy[i] * dt;
        if (fy[i] > 1.8) { fy[i] = 0.05; ang[i] = Math.random() * Math.PI * 2; }
        y = fy[i];
      } else if (i % LOW_EVERY === 0) {
        ang[i] += dt * 4.5 * sp[i] / (r + 1.5);
        y = 0.12 + 0.25 * (0.5 + 0.5 * Math.sin(clock * 2 + ph[i]));
      } else {
        ang[i] += dt * 3 * sp[i] / (r + 1.5);
        fy[i] -= vy[i] * dt;
        if (fy[i] < 0.05) seedFlake(i, false);
        y = fy[i];
        slant = (FLAKE_TOP - y) * FLAKE_SLANT;
      }
      const o = i * 3;
      flakePos[o] = bx + Math.sin(ang[i]) * r + slant;
      flakePos[o + 1] = y;
      flakePos[o + 2] = bz + Math.cos(ang[i]) * r;
    }
    const g = flakes!.geometry;
    g.setDrawRange(0, count);
    g.attributes.position.needsUpdate = true;
  }

  function ensureVisuals() {
    if (disc) { disc.visible = edge!.visible = flakes!.visible = true; return; }
    tex = softDiscTexture();
    flakeTex = flakeTexture();
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(flakePos, 3).setUsage(THREE.DynamicDrawUsage));
    flakes = new THREE.Points(fg, new THREE.PointsMaterial({
      // normal blending, pale blue: additive white vanishes on the snow ground
      map: flakeTex, color: 0xdcecff, size: cfg.zoneR * FLAKE_SIZE_PER_M, transparent: true, depthWrite: false,
    }));
    flakes.frustumCulled = false;
    flakes.renderOrder = 2;
    host.scene.add(flakes);
    disc = new THREE.Mesh(
      new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
    );
    edge = new THREE.Mesh(
      new THREE.RingGeometry(0.97, 1, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: FROST, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    disc.renderOrder = edge.renderOrder = 1;
    host.scene.add(disc, edge);
  }

  function hideVisuals() {
    if (disc) disc.visible = edge!.visible = flakes!.visible = false;
  }

  function disposeVisuals() {
    if (!disc) return;
    host.scene.remove(disc, edge!, flakes!);
    flakes!.geometry.dispose();
    (flakes!.material as THREE.Material).dispose();
    flakeTex!.dispose();
    flakes = flakeTex = null;
    disc.geometry.dispose();
    (disc.material as THREE.Material).dispose();
    edge!.geometry.dispose();
    (edge!.material as THREE.Material).dispose();
    tex!.dispose();
    disc = edge = tex = null;
  }

  function restore() {
    gen++;
    winding = false;
    blowCd = 1;
    radius = cfg.zoneR;
    boss.animDelay = -1;
    hideVisuals();
  }

  function onBlow(tag?: unknown) {
    if (tag !== gen || boss.state === 'dead') return;
    winding = false;
    const hp = host.heroPos();
    const dx = hp.x - at.x;
    const dz = hp.z - at.z;
    at.y = 0.2;
    host.particles.burst(at, FROST, 16, 0.2, 8, 0.8);
    host.waves.add(at, cfg.blowR, FROST, 0.45);
    host.puffs.cloud(at, cfg.blowR * 0.8, SNOW, 8, 1.2);
    if (!host.heroDead() && dx * dx + dz * dz < (cfg.blowR + HERO.radius) * (cfg.blowR + HERO.radius)) {
      host.hurtHero(boss.dmg * cfg.dmgMul * (boss.phase2 ? boss.def.boss!.phase2Dmg : 1), at, boss);
    }
  }

  return {
    ownSpecials: true,

    fight(dt) {
      const phase2 = boss.phase2;
      ensureVisuals();
      radius = Math.min(radius + ZONE_GROW * dt, phase2 ? cfg.zoneR * cfg.zoneR2 : cfg.zoneR);

      const bp = boss.pos;
      disc!.position.set(bp.x, 0.03, bp.z);
      edge!.position.set(bp.x, 0.035, bp.z);
      disc!.scale.setScalar(radius);
      edge!.scale.setScalar(radius);
      updateFlakes(dt, bp.x, bp.z);

      const hp = host.heroPos();
      const dx = hp.x - bp.x;
      const dz = hp.z - bp.z;
      const dHero = Math.sqrt(dx * dx + dz * dz);
      if (!host.heroDead() && dHero < radius) host.slowHero(ZONE_SLOW);

      snowT -= dt;
      if (snowT <= 0) {
        snowT = SNOW_PUFF_EVERY;
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * radius;
        at.set(bp.x + Math.sin(a) * r, 0.4 + Math.random() * 1.6, bp.z + Math.cos(a) * r);
        host.puffs.spawn(at, SNOW, 0.7 + Math.random() * 0.6, 1.6, 0.35);
      }

      // the game's own swing is held back: the heavy blow below replaces it
      boss.atkCd = Math.max(boss.atkCd, 0.5);

      if (winding) {
        windT -= dt;
        gatherT -= dt;
        if (gatherT <= 0) {
          gatherT = GATHER_EVERY;
          // frost drawn in from the edge of the circle toward the queen, the closer to the blow the denser
          const a = Math.random() * Math.PI * 2;
          const r = cfg.blowR * (0.5 + 0.5 * Math.random());
          at.set(bp.x + Math.sin(a) * r, 0.3 + Math.random() * 1.5, bp.z + Math.cos(a) * r);
          host.puffs.spawn(at, FROST, 0.8, 0.5 + windT * 0.3, 0.5);
        }
        return;
      }

      blowCd -= dt;
      if (blowCd > 0 || dHero > cfg.blowStart || host.heroDead()) return;
      blowCd = (cfg.period || 1 / boss.def.aps) / (phase2 ? cfg.rate2 : 1);
      winding = true;
      windT = BLOW_DELAY;
      gatherT = 0;
      at.set(bp.x, 0, bp.z);
      host.telegraphs.add(at, cfg.blowR, BLOW_DELAY, onBlow, gen);
      boss.animNext = BLOW_ANIM;
      boss.animDelay = Math.max(0, BLOW_DELAY - ATTACK_HIT[BLOW_ANIM]);
      host.bark(boss, phase2 ? 'Замри!' : 'Холод...');
    },

    reset: restore,

    died() {
      restore();
      disposeVisuals();
    },
  };
};

export const iceQueen = iceKit(QUEEN);
export const iceQueenMini = iceKit(WARDEN);
