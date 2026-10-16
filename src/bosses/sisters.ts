import * as THREE from 'three';
import { MOBS, type MobDef } from '../config';
import type { Mob } from '../mobs/mob';
import type { BossHost, BossKit, BossKitFactory } from './kit';

// Tunables
const BOND_R = 6; // m between the sisters for the beam to hold
const BOND_R_ROOT = 12; // the beam is much harder to break while they are rooted
const HEAL = 0.02; // max HP fraction per second each sister heals the other (at point-blank)
const HEAL_FAR = 0.3; // heal multiplier at BOND_R, linear up to 1 at distance 0
const PULL_SPEED = 1.6; // m/s each sister walks toward the other, on top of chasing the hero
const MIN_GAP = 2.4; // they stop pulling closer than this
const KNOCK_BREAK = 6; // knock speed that severs the beam (hammer = 9, other weapons 3.5)
const BREAK_T = 3; // s the beam stays cut after a heavy knockback
const BEAM_W = 1.3; // hero this close to the beam line blocks the heal and burns
const DOT_MUL = 0.15; // beam damage per tick, × boss dmg
const DOT_TICK = 0.5;
const REVIVE_T = 10; // s until the survivor raises her sister
const REVIVE_HP = 0.4; // HP fraction a raised sister comes back with
const ROOT_T = 5; // phase 2: both sisters root themselves for this long
const ROOT_CD = 20; // s between roots
const SPAWN_GAP = 4;

const COL_AUTUMN = 0xd9822b;
const COL_SPRING = 0x6fcf5a;
const COL_BLOCKED = 0xff5a3a;
const COL_REVIVE = 0xffe28a;
const COL_GOLD = 0xffd84a;
const COL_FLASH = 0xfff04a;
const BEADS = 16; // light beads flowing along the link, half each way
const SPARKLE_T = 0.07;

const { boss: _bossDef, ...ELF } = MOBS.elf_priestess;
const SPRING: MobDef = {
  ...ELF, id: 'elf_priestess_spring', name: 'Весенняя сестра',
  scale: 1.8, reward: { hp: 0 }, respawn: 0,
};

const { drop: _dropDef, ...DRYAD } = MOBS.grove_dryad;
const JUNIOR: MobDef = {
  ...DRYAD, id: 'grove_dryad_junior', name: 'Младшая дриада',
  hp: Math.round(DRYAD.hp * 0.7), scale: 1.2, reward: { hp: 0 }, respawn: 0,
};

/** `fate`: shared fate (revive, fallen boss) and the phase 2 root; off for the mini-boss's lighter echo of the mechanic. */
interface SistersOpts { sister: MobDef; fate: boolean; dotMul: number; }
const BOSS_OPTS: SistersOpts = { sister: SPRING, fate: true, dotMul: DOT_MUL };
const MINI_OPTS: SistersOpts = { sister: JUNIOR, fate: false, dotMul: DOT_MUL * 0.5 };

const vA = new THREE.Vector3();
const vB = new THREE.Vector3();
const vP = new THREE.Vector3();
const vC = new THREE.Vector3();
const vD = new THREE.Vector3();

class Sisters implements BossKit {
  readonly knockable = true;
  private sister: Mob | null = null;
  private fallen = false; // the boss is down at 1 HP while the sister lives
  private fallenT = 0;
  private downT = -1; // s since the sister died; -1 while she lives
  private readonly grave = new THREE.Vector3();
  private rootT = 0;
  private rootCd = 0;
  private breakT = 0;
  private dotT = 0;
  private leafT = 0;
  private healT = 0;
  private healBoss = 0;
  private healSister = 0;
  private bondOn = false;
  private beamColor = -1;
  private readonly link = new THREE.Group();
  private readonly beam: THREE.Mesh;
  private readonly beamMat: THREE.MeshBasicMaterial;
  private readonly beads: THREE.Mesh[] = [];
  private readonly beadMat: THREE.MeshBasicMaterial[] = [];
  private readonly glow: THREE.Mesh[] = [];
  private readonly glowMat: THREE.MeshBasicMaterial[] = [];
  private readonly glowK = [0, 0]; // current glow strength: boss, sister
  private readonly glowTo = [0, 0];
  private sparkleT = 0;

  /** Default slam/cones pause while the sisters are rooted, channeling a revive or down. */
  get ownSpecials() { return this.fallen || this.rootT > 0 || (this.sister !== null && !this.sister.alive); }

  constructor(private host: BossHost, private boss: Mob, private opts: SistersOpts) {
    this.beamMat = new THREE.MeshBasicMaterial({ color: COL_AUTUMN, transparent: true, opacity: 0.6, depthWrite: false });
    this.beam = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.beamMat);
    this.beam.frustumCulled = false;
    this.link.add(this.beam);
    const add = (color: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
    this.beadMat.push(add(COL_SPRING), add(COL_GOLD));
    const beadGeo = new THREE.SphereGeometry(1, 6, 5);
    for (let i = 0; i < BEADS; i++) {
      const bead = new THREE.Mesh(beadGeo, this.beadMat[i & 1]);
      bead.frustumCulled = false;
      this.beads.push(bead);
      this.link.add(bead);
    }
    this.link.visible = false;
    host.scene.add(this.link);
    const glowGeo = new THREE.SphereGeometry(1, 16, 12);
    for (let i = 0; i < 2; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: COL_SPRING, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      const mesh = new THREE.Mesh(glowGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      host.scene.add(mesh);
      this.glow.push(mesh);
      this.glowMat.push(mat);
    }
  }

  fight(dt: number) {
    this.glowTo[0] = this.glowTo[1] = 0;
    this.step(dt);
    this.updateGlow(dt);
  }

  private step(dt: number) {
    const b = this.boss;
    if (!this.sister) this.spawnSister();
    const s = this.sister!;
    if (this.fallen) { b.hp = 1; this.hold(b); b.impact = -1; }

    if (!s.alive && !this.opts.fate) { this.bondOn = false; this.showBeam(null); return; }
    if (!s.alive) {
      if (this.downT < 0) {
        this.downT = 0;
        this.grave.copy(s.pos);
        this.rootT = 0;
        this.host.bark(b, 'Сестра!');
      }
      // both down: the boss's real death
      if (this.fallen) { this.showBeam(null); this.host.kill(b); return; }
      // the boss stands over the fallen sister until she raises her
      this.hold(b);
      this.downT += dt;
      this.channel(b.pos, this.grave, dt);
      if (this.downT >= REVIVE_T) this.reviveSister();
      return;
    }
    this.downT = -1;

    if (this.fallen) {
      this.hold(s);
      this.fallenT += dt;
      this.channel(s.pos, b.pos, dt);
      if (this.fallenT >= REVIVE_T) this.reviveBoss();
      return;
    }

    // phase 2: both root themselves, the knockback no longer moves them
    if (this.rootT > 0) {
      this.rootT -= dt;
      this.hold(b);
      this.hold(s);
      b.knock.set(0, 0, 0);
      s.knock.set(0, 0, 0);
      if (this.rootT <= 0) this.rootCd = ROOT_CD;
    } else if (this.opts.fate && b.phase2) {
      this.rootCd -= dt;
      if (this.rootCd <= 0) this.startRoot();
    }

    const rooted = this.rootT > 0;
    const dx = s.pos.x - b.pos.x;
    const dz = s.pos.z - b.pos.z;
    const d = Math.hypot(dx, dz);

    if (!rooted && (b.knock.lengthSq() > KNOCK_BREAK * KNOCK_BREAK || s.knock.lengthSq() > KNOCK_BREAK * KNOCK_BREAK)) {
      if (this.bondOn) this.snap();
      this.breakT = BREAK_T;
    }
    if (this.breakT > 0) this.breakT -= dt;

    if (!rooted && d > MIN_GAP) {
      const k = PULL_SPEED * dt / d;
      b.pos.x += dx * k;
      b.pos.z += dz * k;
      s.pos.x -= dx * k;
      s.pos.z -= dz * k;
    }

    const bonded = this.breakT <= 0 && d < (rooted ? BOND_R_ROOT : BOND_R);
    if (!bonded) {
      this.bondOn = false;
      this.showBeam(null);
      return;
    }
    this.bondOn = true;

    const blocked = this.heroInBeam(b.pos, s.pos);
    this.showBeam(b.pos, s.pos, blocked ? COL_BLOCKED : COL_AUTUMN, dt, blocked ? COL_BLOCKED : COL_SPRING);
    if (blocked) {
      this.dotT -= dt;
      if (this.dotT <= 0) {
        this.dotT = DOT_TICK;
        this.host.hurtHero(b.dmg * this.opts.dotMul, vP, b, true);
      }
      return;
    }
    const k = 1 - (1 - HEAL_FAR) * Math.min(1, d / BOND_R);
    const hb = Math.min(b.maxHp - b.hp, b.maxHp * HEAL * k * dt);
    const hs = Math.min(s.maxHp - s.hp, s.maxHp * HEAL * k * dt);
    b.hp += hb;
    s.hp += hs;
    this.glowTo[0] = hb > 0 ? k : 0;
    this.glowTo[1] = hs > 0 ? k : 0;
    this.healBoss += hb;
    this.healSister += hs;
    this.healT += dt;
    if (this.healT >= 1) {
      this.healT = 0;
      this.healText(b, this.healBoss);
      this.healText(s, this.healSister);
      this.healBoss = 0;
      this.healSister = 0;
    }
  }

  damageTaken(target: Mob, dmg: number) {
    const b = this.boss;
    if (!this.opts.fate || target !== b || !this.sister?.alive) return dmg;
    if (this.fallen) return 0;
    if (dmg < b.hp) return dmg;
    this.fall();
    return b.hp - 1;
  }

  reset() {
    this.sister = null;
    this.fallen = false;
    this.fallenT = 0;
    this.downT = -1;
    this.rootT = 0;
    this.rootCd = 0;
    this.breakT = 0;
    this.dotT = 0;
    this.bondOn = false;
    this.healBoss = this.healSister = this.healT = 0;
    this.boss.ch.root.rotation.x = 0;
    this.showBeam(null);
    this.hideGlow();
  }

  died() {
    this.boss.ch.root.rotation.x = 0;
    this.showBeam(null);
    this.hideGlow();
  }

  private hold(m: Mob) {
    m.stun = Math.max(m.stun, 0.2);
  }

  private spawnSister() {
    const b = this.boss;
    const a = b.ch.facing + Math.PI / 2;
    vA.set(b.pos.x + Math.sin(a) * SPAWN_GAP, 0, b.pos.z + Math.cos(a) * SPAWN_GAP);
    this.sister = this.host.spawnMinion(b, this.opts.sister, vA);
    if (this.opts.fate) this.host.bark(this.sister, 'Мы — одно целое!');
    this.host.waves.add(vA, 2.5, COL_SPRING, 0.6);
    this.host.particles.burst(vA.setY(0.3), COL_SPRING, 14, 0.16, 5, 0.9);
  }

  /** Lethal hit while the sister lives: the boss drops at 1 HP and the sister starts raising her. */
  private fall() {
    const b = this.boss;
    this.fallen = true;
    this.fallenT = 0;
    this.rootT = 0;
    b.impact = -1;
    b.knock.set(0, 0, 0);
    b.ch.root.rotation.x = -1.3;
    this.host.bark(b, 'Сестра... подними меня...');
    this.host.waves.add(b.pos, 3, COL_AUTUMN, 0.6);
    this.host.particles.burst(vA.copy(b.pos).setY(0.8), COL_AUTUMN, 16, 0.18, 6, 0.9);
  }

  private reviveBoss() {
    const b = this.boss;
    this.fallen = false;
    b.hp = b.maxHp * REVIVE_HP;
    b.ch.root.rotation.x = 0;
    b.stun = 0;
    this.host.bark(b, 'Роща не умирает!');
    this.host.waves.add(b.pos, 4, COL_REVIVE, 0.7);
    this.host.particles.burst(vA.copy(b.pos).setY(0.8), COL_REVIVE, 22, 0.18, 7, 1);
    this.showBeam(null);
  }

  private reviveSister() {
    const b = this.boss;
    this.sister = this.host.spawnMinion(b, SPRING, this.grave);
    this.sister.hp = this.sister.maxHp * REVIVE_HP;
    this.downT = -1;
    this.host.bark(this.sister, 'Мы вернулись!');
    this.host.waves.add(this.grave, 4, COL_REVIVE, 0.7);
    this.host.particles.burst(vA.copy(this.grave).setY(0.8), COL_REVIVE, 22, 0.18, 7, 1);
    this.showBeam(null);
  }

  private startRoot() {
    const b = this.boss;
    const s = this.sister!;
    this.rootT = ROOT_T;
    this.host.bark(b, 'Корни, держите!');
    this.host.waves.add(b.pos, 3.5, 0x6b4a2a, 0.7);
    this.host.waves.add(s.pos, 3.5, 0x6b4a2a, 0.7);
    this.host.particles.burst(vA.copy(b.pos).setY(0.2), 0x6b4a2a, 12, 0.16, 5, 0.8);
    this.host.particles.burst(vA.copy(s.pos).setY(0.2), 0x6b4a2a, 12, 0.16, 5, 0.8);
  }

  /** The beam is cut by a knockback: a yellow flash at both ends and the break point. */
  private snap() {
    const b = this.boss;
    const s = this.sister!;
    const w = this.host.waves;
    const p = this.host.particles;
    vA.lerpVectors(b.pos, s.pos, 0.5).setY(1.6);
    p.burst(vA, COL_FLASH, 16, 0.2, 7, 0.6);
    w.add(vA, 2.2, COL_FLASH, 0.3);
    vB.copy(b.pos).setY(1.6);
    p.burst(vB, COL_FLASH, 12, 0.18, 6, 0.6);
    w.add(b.pos, 3, COL_FLASH, 0.35);
    vB.copy(s.pos).setY(1.6);
    p.burst(vB, COL_FLASH, 12, 0.18, 6, 0.6);
    w.add(s.pos, 3, COL_FLASH, 0.35);
    this.host.bark(b, 'Связь!');
  }

  private healText(m: Mob, amount: number) {
    if (amount < 1) return;
    vB.copy(m.pos).setY(m.barY + 0.4);
    this.host.fx.spawn(vB, `+${Math.round(amount)}`, 'loot', 0.9, { color: '#7dff8a' });
  }

  /** Hero stands on the beam line: `vP` gets the nearest point of the line to the hero. */
  private heroInBeam(a: THREE.Vector3, c: THREE.Vector3) {
    if (this.host.heroDead()) return false;
    const h = this.host.heroPos();
    const dx = c.x - a.x;
    const dz = c.z - a.z;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 1e-6 ? Math.min(1, Math.max(0, ((h.x - a.x) * dx + (h.z - a.z) * dz) / l2)) : 0;
    vP.set(a.x + dx * t, 0, a.z + dz * t);
    return Math.hypot(h.x - vP.x, h.z - vP.z) < BEAM_W;
  }

  /** A revive channel: the survivor stays put and pours light into her sister. */
  private channel(from: THREE.Vector3, to: THREE.Vector3, dt: number) {
    this.showBeam(from, to, COL_REVIVE, dt, COL_REVIVE);
  }

  /** `a` null hides the link; otherwise lays the core line and the two flowing helix strands of light between the sisters. */
  private showBeam(a: THREE.Vector3 | null, c?: THREE.Vector3, color = COL_AUTUMN, dt = 0, leaf = COL_AUTUMN) {
    if (!a || !c) { this.link.visible = false; return; }
    if (color !== this.beamColor) {
      this.beamColor = color;
      this.beamMat.color.setHex(color);
      const tinted = color === COL_BLOCKED || color === COL_REVIVE;
      this.beadMat[0].color.setHex(tinted ? color : COL_SPRING);
      this.beadMat[1].color.setHex(tinted ? color : COL_GOLD);
    }
    const t = this.host.time();
    vA.set(a.x, a.y + 1.6, a.z);
    vB.set(c.x, c.y + 1.6, c.z);
    const len = Math.max(0.01, vA.distanceTo(vB));
    this.beam.position.lerpVectors(vA, vB, 0.5);
    this.beam.lookAt(vB);
    const w = 0.06 + 0.02 * Math.sin(t * 14);
    this.beam.scale.set(w, w, len);
    // perpendicular in the ground plane; the helix turns in (perp, up)
    vC.set(vB.z - vA.z, 0, vA.x - vB.x).multiplyScalar(1 / Math.max(0.01, Math.hypot(vB.x - vA.x, vB.z - vA.z)));
    const half = BEADS / 2;
    for (let i = 0; i < BEADS; i++) {
      const strand = i & 1;
      const u = (t * 0.7 + (i >> 1) / half) % 1;
      const p = strand ? 1 - u : u;
      const r = 0.3 * Math.sin(Math.PI * p);
      const phi = p * len * 2.2 + t * 4 + strand * Math.PI;
      const bead = this.beads[i];
      vD.lerpVectors(vA, vB, p);
      bead.position.set(vD.x + vC.x * Math.cos(phi) * r, vD.y + Math.sin(phi) * r, vD.z + vC.z * Math.cos(phi) * r);
      bead.scale.setScalar(0.07 + 0.09 * Math.sin(Math.PI * u));
    }
    this.link.visible = true;
    this.leafT -= dt;
    if (this.leafT <= 0) {
      this.leafT = 0.2;
      vA.lerp(vB, Math.random());
      this.host.particles.burst(vA, Math.random() < 0.5 ? leaf : COL_SPRING, 1, 0.14, 1.2, 0.8);
    }
  }

  /** Green halo around each sister the bond is healing, with rising sparkles; fades in and out. */
  private updateGlow(dt: number) {
    const t = this.host.time();
    const f = Math.min(1, dt * 6);
    this.sparkleT -= dt;
    const spark = this.sparkleT <= 0;
    if (spark) this.sparkleT = SPARKLE_T;
    for (let i = 0; i < 2; i++) {
      const m = i === 0 ? this.boss : this.sister;
      const g = (this.glowK[i] += (this.glowTo[i] - this.glowK[i]) * f);
      const mesh = this.glow[i];
      if (!m || g < 0.02) { mesh.visible = false; continue; }
      const pulse = 0.75 + 0.25 * Math.sin(t * 6 + i * 2);
      const sc = m.def.scale;
      mesh.visible = true;
      mesh.position.set(m.pos.x, m.pos.y + sc * 1.0, m.pos.z);
      mesh.scale.setScalar(sc * (0.8 + 0.1 * pulse));
      this.glowMat[i].opacity = 0.4 * g * pulse;
      if (spark && g > 0.2) {
        const a = Math.random() * Math.PI * 2;
        vD.set(m.pos.x + Math.sin(a) * 0.6 * sc, m.pos.y + 0.2 + Math.random() * sc, m.pos.z + Math.cos(a) * 0.6 * sc);
        this.host.particles.burst(vD, COL_SPRING, 1, 0.1, 1.5, 0.9);
      }
    }
  }

  private hideGlow() {
    for (let i = 0; i < 2; i++) { this.glowK[i] = this.glowTo[i] = 0; this.glow[i].visible = false; }
  }
}

/** The boss's twin, spawned into the fight: same HP and damage. */
export const SISTER = SPRING;
export const sisters: BossKitFactory = (host, boss) => new Sisters(host, boss, BOSS_OPTS);
export const sistersMini: BossKitFactory = (host, boss) => new Sisters(host, boss, MINI_OPTS);
