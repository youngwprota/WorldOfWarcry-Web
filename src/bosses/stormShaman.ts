import * as THREE from 'three';
import type { BossHost, BossKit, BossKitFactory } from './kit';
import type { Mob } from '../mobs/mob';

// Tunables
const STRIKE_CD = 3.6;        // s between lightning strikes
const STRIKE_CD_P2 = 2.6;
const STRIKE_MUL = 0.6;       // strike damage = boss dmg * this
const MAX_STACKS = 5;
const STACK_TIME = 6;         // s, refreshed by every new stack
const TICK_CD = 1;            // s between Charge ticks
const TICK_MUL = 0.07;        // tick damage = boss dmg * this * stacks
const TOTEM_CD = 6;           // s between totem waves
const TOTEM_LIFE = 4;
const TOTEM_DIST = 2;         // m in front of the hero, towards the boss
const TOTEM_R = 0.8;
const CORNER_ANGLE = 0.6;     // rad, phase 2: each totem is turned this far off the hero-boss line
const BOLT_LIFE = 0.28;
const CHARGE_COLOR = 0x9fd8ff;
const POOL = 4;

const v = new THREE.Vector3();
const dir = new THREE.Vector3();

interface Totem { mesh: THREE.Group; t: number; blocker: { remove(): void } | null }
interface Bolt { mesh: THREE.Group; core: THREE.Mesh; glow: THREE.Mesh; flash: THREE.Mesh; t: number; step: number }

const BOLT_SEGS = 9;
const BOLT_H = 12;
const BOLT_FLICKER = 0.085;   // s per flicker step: ~3 flashes over BOLT_LIFE
const boltPts = new Float32Array((BOLT_SEGS + 1) * 3);
let boltIdx: Uint16Array | null = null;
let flashGeo: THREE.BufferGeometry | null = null;

// Two crossed vertical ribbons per bolt so it reads from any camera angle.
function makeRibbon(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((BOLT_SEGS + 1) * 4 * 3), 3));
  if (!boltIdx) {
    boltIdx = new Uint16Array(BOLT_SEGS * 12);
    let n = 0;
    for (let i = 0; i < BOLT_SEGS; i++) {
      const a = i * 4;
      const b = a + 4;
      for (const q of [0, 2]) boltIdx.set([a + q, a + q + 1, b + q, a + q + 1, b + q + 1, b + q], n), n += 6;
    }
  }
  g.setIndex(new THREE.BufferAttribute(boltIdx, 1));
  return g;
}

function fillRibbon(g: THREE.BufferGeometry, w: number) {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const a = pos.array as Float32Array;
  for (let i = 0; i <= BOLT_SEGS; i++) {
    const x = boltPts[i * 3];
    const y = boltPts[i * 3 + 1];
    const z = boltPts[i * 3 + 2];
    const o = i * 12;
    a[o] = x - w; a[o + 1] = y; a[o + 2] = z;
    a[o + 3] = x + w; a[o + 4] = y; a[o + 5] = z;
    a[o + 6] = x; a[o + 7] = y; a[o + 8] = z - w;
    a[o + 9] = x; a[o + 10] = y; a[o + 11] = z + w;
  }
  pos.needsUpdate = true;
}

/** New jagged path from the sky (offset 0 at the ground so it lands on the hero). */
function shapeBolt(b: Bolt) {
  for (let i = 0; i <= BOLT_SEGS; i++) {
    const k = i / BOLT_SEGS; // 0 top .. 1 ground
    const j = i === BOLT_SEGS ? 0 : 0.9 * (1 - k * 0.5);
    boltPts[i * 3] = (Math.random() - 0.5) * 2 * j;
    boltPts[i * 3 + 1] = BOLT_H * (1 - k);
    boltPts[i * 3 + 2] = (Math.random() - 0.5) * 2 * j;
  }
  fillRibbon(b.core.geometry, 0.07);
  fillRibbon(b.glow.geometry, 0.28);
}

let totemGeo: { base: THREE.BufferGeometry; pole: THREE.BufferGeometry; head: THREE.BufferGeometry } | null = null;
const matBase = new THREE.MeshLambertMaterial({ color: 0x4a3626 });
const matPole = new THREE.MeshLambertMaterial({ color: 0x6b4a2e });
const matHead = new THREE.MeshLambertMaterial({ color: 0x3f7a35, emissive: 0x1a4a60 });

function makeTotem(): THREE.Group {
  totemGeo ??= {
    base: new THREE.BoxGeometry(1.1, 0.4, 1.1),
    pole: new THREE.CylinderGeometry(0.28, 0.36, 2.2, 8),
    head: new THREE.BoxGeometry(0.8, 0.7, 0.8),
  };
  const g = new THREE.Group();
  const base = new THREE.Mesh(totemGeo.base, matBase);
  base.position.y = 0.2;
  const pole = new THREE.Mesh(totemGeo.pole, matPole);
  pole.position.y = 1.5;
  const head = new THREE.Mesh(totemGeo.head, matHead);
  head.position.y = 2.85;
  g.add(base, pole, head);
  g.visible = false;
  return g;
}

interface Opts { strikeCd: number; strikeCdP2: number; maxStacks: number; totemCd: number; corner: boolean; own: boolean }
const FULL: Opts = { strikeCd: STRIKE_CD, strikeCdP2: STRIKE_CD_P2, maxStacks: MAX_STACKS, totemCd: TOTEM_CD, corner: true, own: true };
const MINI: Opts = { strikeCd: 5.5, strikeCdP2: 5.5, maxStacks: 3, totemCd: 8, corner: false, own: false };

const make = (o: Opts): BossKitFactory => (host: BossHost, boss: Mob): BossKit => {
  flashGeo ??= new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
  const totems: Totem[] = [];
  for (let i = 0; i < POOL; i++) {
    const mesh = makeTotem();
    host.scene.add(mesh);
    totems.push({ mesh, t: -1, blocker: null });
  }
  const bolts: Bolt[] = [];
  for (let i = 0; i < 2; i++) {
    const add = (color: number) => new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const core = new THREE.Mesh(makeRibbon(), add(0xf2fbff));
    const glow = new THREE.Mesh(makeRibbon(), add(0x4a90ff));
    const flash = new THREE.Mesh(flashGeo, add(0x9fd8ff));
    flash.position.y = 0.06;
    core.frustumCulled = glow.frustumCulled = false;
    const mesh = new THREE.Group();
    mesh.add(glow, core, flash);
    mesh.visible = false;
    host.scene.add(mesh);
    bolts.push({ mesh, core, glow, flash, t: -1, step: -1 });
  }

  let strikeT = 2;
  let totemT = 3;
  let stacks = 0;
  let stackT = 0;
  let tickT = 0;

  function strike() {
    const p = host.heroPos();
    const b = bolts.find((x) => x.t < 0);
    if (b) {
      b.t = 0;
      b.step = -1;
      b.mesh.position.set(p.x, 0, p.z);
      b.mesh.visible = true;
    }
    host.particles.burst(v.copy(p).setY(0.3), 0xe8f6ff, 16, 0.12, 8, 0.5);
    host.particles.burst(v, CHARGE_COLOR, 8, 0.18, 5, 0.6);
    host.waves.add(p, 1.4, CHARGE_COLOR, 0.3);
    const before = host.heroHp();
    host.hurtHero(boss.dmg * STRIKE_MUL, boss.pos, boss);
    if (host.heroDead()) return;
    // a dodged strike leaves no stack
    if (host.heroHp() < before) addStack(p);
  }

  function addStack(p: THREE.Vector3) {
    stacks = Math.min(o.maxStacks, stacks + 1);
    stackT = STACK_TIME;
    if (stacks === 1) tickT = TICK_CD;
    host.fx.spawn(v.copy(p).setY(3.2), `Charge x${stacks}`, 'bark', 1, { color: '#9fd8ff' });
  }

  function placeTotem(x: number, z: number) {
    const t = totems.find((o) => o.t < 0);
    if (!t) return;
    t.t = 0;
    t.mesh.position.set(x, 0, z);
    t.mesh.scale.set(1, 0.01, 1);
    t.mesh.visible = true;
    t.blocker = host.addBlocker(x, z, TOTEM_R, TOTEM_LIFE);
    host.particles.burst(v.set(x, 0.2, z), 0x8a7a6a, 8, 0.15, 4, 0.6);
  }

  function spawnTotems(phase2: boolean) {
    const h = host.heroPos();
    dir.set(boss.pos.x - h.x, 0, boss.pos.z - h.z);
    if (dir.lengthSq() < 1e-6) return;
    dir.normalize();
    if (!phase2) {
      placeTotem(h.x + dir.x * TOTEM_DIST, h.z + dir.z * TOTEM_DIST);
      return;
    }
    // two totems either side of the line: the hero is boxed into a corner
    for (let s = -1; s <= 1; s += 2) {
      const a = s * CORNER_ANGLE;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      placeTotem(h.x + (dir.x * c - dir.z * sn) * TOTEM_DIST * 1.2, h.z + (dir.x * sn + dir.z * c) * TOTEM_DIST * 1.2);
    }
  }

  function clearTotem(t: Totem) {
    t.t = -1;
    t.mesh.visible = false;
    t.blocker?.remove();
    t.blocker = null;
  }

  function clearAll() {
    stacks = 0;
    stackT = 0;
    for (const t of totems) clearTotem(t);
    for (const b of bolts) { b.t = -1; b.mesh.visible = false; }
    strikeT = 2;
    totemT = 3;
  }

  function animate(dt: number) {
    for (const t of totems) {
      if (t.t < 0) continue;
      t.t += dt;
      if (t.t >= TOTEM_LIFE) { clearTotem(t); continue; }
      // rises in 0.25 s, sinks over the last 0.4 s
      const k = Math.min(t.t / 0.25, (TOTEM_LIFE - t.t) / 0.4, 1);
      t.mesh.scale.y = Math.max(0.01, k);
    }
    for (const b of bolts) {
      if (b.t < 0) continue;
      b.t += dt;
      if (b.t >= BOLT_LIFE) { b.t = -1; b.mesh.visible = false; continue; }
      const k = b.t / BOLT_LIFE;
      const step = Math.floor(b.t / BOLT_FLICKER);
      if (step !== b.step) { b.step = step; shapeBolt(b); }
      // odd steps are the dim gaps between flashes
      const lit = (step & 1) === 0 ? 1 : 0.25;
      const fade = 1 - k * k;
      (b.core.material as THREE.MeshBasicMaterial).opacity = lit * fade;
      (b.glow.material as THREE.MeshBasicMaterial).opacity = lit * fade * 0.4;
      (b.flash.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - k) * (1 - k);
      b.flash.scale.setScalar(1 + k * 1.2);
    }
  }

  return {
    ownSpecials: o.own,

    fight(dt) {
      animate(dt);
      if (host.heroDead()) { clearAll(); return; }
      const p2 = o.corner && boss.phase2;
      strikeT -= dt;
      if (strikeT <= 0) {
        strikeT = p2 ? o.strikeCdP2 : o.strikeCd;
        strike();
      }
      totemT -= dt;
      if (totemT <= 0) {
        totemT = o.totemCd;
        spawnTotems(p2);
      }
      if (stacks > 0) {
        stackT -= dt;
        tickT -= dt;
        if (stackT <= 0) stacks = 0;
        else if (tickT <= 0) {
          tickT = TICK_CD;
          const p = host.heroPos();
          host.hurtHero(boss.dmg * TICK_MUL * stacks, boss.pos, boss, true);
          host.waves.add(p, 0.5 + stacks * 0.2, CHARGE_COLOR, 0.35);
          host.particles.burst(v.copy(p).setY(1.2), CHARGE_COLOR, stacks * 2, 0.1, 3, 0.5);
        }
      }
    },

    reset: clearAll,
    died() {
      clearAll();
      for (const t of totems) host.scene.remove(t.mesh);
      for (const b of bolts) host.scene.remove(b.mesh);
    },
  };
};

export const stormShaman = make(FULL);
export const stormShamanMini = make(MINI);
