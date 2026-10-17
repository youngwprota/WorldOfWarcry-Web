import * as THREE from 'three';
import { MOBS } from '../config';
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
const SUMMON = 'mummy_archer';
const SUMMON_CD = 7;          // s between the boss's mummy archers
const SUMMON_R = 2.5;         // m from the boss
const BOLT_LIFE = 0.28;
const CHARGE_COLOR = 0x9fd8ff;

const v = new THREE.Vector3();

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

/** `summonCd`: s between mummy archers during the fight (0: none); `opening`: archers called once as the fight starts. */
interface Opts { strikeCd: number; strikeCdP2: number; maxStacks: number; summonCd: number; opening: number; own: boolean }
const FULL: Opts = { strikeCd: STRIKE_CD, strikeCdP2: STRIKE_CD_P2, maxStacks: MAX_STACKS, summonCd: SUMMON_CD, opening: 0, own: true };
const MINI: Opts = { strikeCd: 5.5, strikeCdP2: 5.5, maxStacks: 3, summonCd: 0, opening: 2, own: false };

const make = (o: Opts): BossKitFactory => (host: BossHost, boss: Mob): BossKit => {
  flashGeo ??= new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
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
  let summonT = o.summonCd;
  let opened = false;
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

  function summon() {
    const a = Math.random() * Math.PI * 2;
    v.set(boss.pos.x + Math.cos(a) * SUMMON_R, 0, boss.pos.z + Math.sin(a) * SUMMON_R);
    host.spawnMinion(boss, MOBS[SUMMON], v);
    host.particles.burst(v.setY(0.3), 0xcdb080, 10, 0.14, 4, 0.6);
    host.puffs.cloud(v.setY(0), 1, 0xcdb080, 4);
  }

  function clearAll() {
    stacks = 0;
    stackT = 0;
    for (const b of bolts) { b.t = -1; b.mesh.visible = false; }
    strikeT = 2;
    summonT = o.summonCd;
    opened = false;
  }

  function animate(dt: number) {
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
      const p2 = boss.phase2;
      if (!opened) {
        opened = true;
        for (let i = 0; i < o.opening; i++) summon();
      }
      strikeT -= dt;
      if (strikeT <= 0) {
        strikeT = p2 ? o.strikeCdP2 : o.strikeCd;
        strike();
      }
      if (o.summonCd > 0) {
        summonT -= dt;
        if (summonT <= 0) {
          summonT = o.summonCd;
          summon();
        }
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
      for (const b of bolts) host.scene.remove(b.mesh);
    },
  };
};

export const stormShaman = make(FULL);
export const stormShamanMini = make(MINI);
