import { sfx } from '../audio';
import type { Game } from '../game';
import type { GameWorld } from '../gameworld';
import type { MobBehavior } from '../mobs/behavior';
import type { Mob } from '../mobs/mob';
import type { Spawn } from '../mobs/spawn';
import { SIEGE_BAL, balanceIn, miniStats, mobStats } from './balance';
import { DOORS, FOREST_PACKS, GATE, GATE_SQUAD, KEEP_DOOR } from './layout';
import { SPEED_MAX, SPEED_MIN, miniDef, siegeDef } from './roster';
import { SIEGE_GATE_ID } from './types';
import type { BalanceIn, DirectorEvents, SiegeDoor, SiegeKind, SiegePack, SiegePhase, SiegeResult } from './types';
import { MINIS, WAVE, maxKills, schedule, type Beat } from './waves';

/** Doors the waves use: this far from the hero (off screen, inside the mobs' wake radius). */
const DOOR_NEAR = 14;
const DOOR_FAR = 32;
/** A yard mob this far from the hero for STRAY_T s is carried to a door. */
const STRAY_D2 = 34 * 34;
const STRAY_T = 2;
const MAX_PER_FRAME = 2;
const CHAIN_WINDOW = 1.2;
const MINI_WARN = 3;
/** The gate door is behind the hero, so it is picked rarely. */
const GATE_DOOR_CHANCE = 0.12;
/** The 'gate' phase starts when the hero walks this close to the gate wall. */
const GATE_PHASE_Z = GATE.z + 24;

const enum Where { Forest, Gate, Yard }

class Tracked {
  far = 0;
  constructor(readonly m: Mob, readonly where: Where, readonly mini: boolean) {}
}

/** A yard group waiting in the spawn queue; spawned one mob at a time, all from one door. */
class Group {
  door: SiegeDoor | null = null;
  bal: BalanceIn | null = null;
  pack: Spawn | undefined = undefined;
  next = 0;
  constructor(readonly beat: Beat) {}
}

interface Spot { x: number; z: number }

/** Spot `j` of `n` round (cx, cz): a ring, or a line across the direction (dx, dz). */
function spot(cx: number, cz: number, dx: number, dz: number, ring: boolean, j: number, n: number, out: Spot) {
  if (n === 1) { out.x = cx; out.z = cz; return; }
  if (ring) {
    const a = (j / n) * Math.PI * 2;
    const r = 0.9 + n * 0.2;
    out.x = cx + Math.cos(a) * r;
    out.z = cz + Math.sin(a) * r;
  } else {
    const o = (j - (n - 1) / 2) * 1.3;
    out.x = cx - dz * o;
    out.z = cz + dx * o;
  }
}

const rollSpeed = () => SPEED_MIN + Math.random() * (SPEED_MAX - SPEED_MIN);

const FLANK: Partial<MobBehavior> = { combat: 'flank' };

export class SiegeDirector {
  private g: Game | null = null;
  private phase: SiegePhase = 'forest';
  private readonly tracked: Tracked[] = [];
  private readonly ambush: SiegePack[] = [];
  private readonly beats: Beat[] = schedule(Math.random);
  private beatI = 0;
  private miniI = 0;
  private miniWarned = false;
  private readonly queue: Group[] = [];
  private qHead = 0;
  private lastDoor = '';
  /** Seconds since the hero's first hit on any siege mob; the run clock. */
  private t = 0;
  private started = false;
  private kills = 0;
  private minis = 0;
  private chain = 0;
  private sinceKill = 99;
  private timerShown = -1;
  private completed = false;
  // scratch, reused by every spawn (spawnExtra reads them at once)
  private readonly defBuf = [siegeDef('bandit', 1, 1)];
  private readonly atBuf: Spot[] = [{ x: 0, z: 0 }];

  constructor(private readonly world: GameWorld, private readonly ev: DirectorEvents, private readonly maxAlive: number) {}

  /** Places the forest packs and the gate squad. */
  bind(g: Game) {
    this.g = g;
    const bal = balanceIn(g);
    for (const p of FOREST_PACKS) {
      if (p.trigger === undefined) this.place(p, bal, false, Where.Forest);
      else this.ambush.push(p);
    }
    for (const p of GATE_SQUAD) this.place(p, bal, false, Where.Gate);
    this.ev.phase('forest');
    this.ev.timer(null);
  }

  tick(dt: number) {
    const g = this.g;
    if (!g || this.phase === 'done') return;
    const hp = g.hero.position;
    this.sinceKill += dt;
    const alive = this.poll(dt, hp.x, hp.z);

    if (!this.started) this.started = this.anyHurt();
    if (this.started) {
      this.t += dt;
      const left = Math.max(0, Math.ceil(WAVE.duration - this.t));
      if (left !== this.timerShown) { this.timerShown = left; this.ev.timer(left); }
      if (this.t >= WAVE.duration) { this.finish(); return; }
      // beats queue up from the first hit; they only pour out once the yard is open
      while (this.beatI < this.beats.length && this.beats[this.beatI].t <= this.t) this.queue.push(new Group(this.beats[this.beatI++]));
    }

    if (this.phase !== 'yard') {
      if (this.phase === 'forest' && hp.z < GATE_PHASE_Z) this.setPhase('gate');
      for (let i = this.ambush.length - 1; i >= 0; i--) {
        const p = this.ambush[i];
        if (hp.z < p.trigger!) {
          this.ambush[i] = this.ambush[this.ambush.length - 1];
          this.ambush.pop();
          this.place(p, balanceIn(g), true, Where.Forest);
        }
      }
      if (!this.anyAt(Where.Gate)) this.openGate();
      return;
    }

    this.updateMini();
    this.drain(hp.x, hp.z, alive);
  }

  private anyHurt() {
    for (const t of this.tracked) if (t.m.hp < t.m.maxHp) return true;
    return false;
  }

  /** The hero's regen grows a little with every kill: +0.5% each, up to double. */
  regenMul() { return 1 + Math.min(SIEGE_BAL.regenBonusMax, this.kills * SIEGE_BAL.regenPerKill); }

  result(): SiegeResult {
    const maxK = maxKills();
    const w = SIEGE_BAL.miniWeight;
    return {
      completed: this.completed, kills: this.kills, minis: this.minis, maxKills: maxK, maxMinis: MINIS.length,
      pct: Math.min(1, (this.kills + w * this.minis) / (maxK + w * MINIS.length)), time: Math.min(this.t, WAVE.duration),
    };
  }

  private setPhase(p: SiegePhase) { this.phase = p; this.ev.phase(p); }

  private openGate() {
    this.world.openGate(SIEGE_GATE_ID);
    sfx.barrier();
    this.ev.announce('Ворота пали!', 'gate');
    this.setPhase('yard');
  }

  private finish() {
    this.completed = true;
    this.setPhase('done');
    this.ev.timer(0);
    this.ev.done(true);
  }

  private anyAt(w: Where) {
    for (const t of this.tracked) if (t.where === w) return true;
    return false;
  }

  /** Counts the dead, relocates stragglers; returns the living yard mobs the cap applies to (minis are outside it). */
  private poll(dt: number, hx: number, hz: number) {
    let alive = 0;
    const list = this.tracked;
    for (let i = list.length - 1; i >= 0; i--) {
      const t = list[i];
      const m = t.m;
      if (m.alive && !m.removed) {
        if (t.where !== Where.Yard || t.mini) continue;
        alive++;
        const dx = m.pos.x - hx;
        const dz = m.pos.z - hz;
        if (dx * dx + dz * dz > STRAY_D2) {
          t.far += dt;
          if (t.far > STRAY_T) { this.relocate(m, hx, hz); t.far = 0; }
        } else t.far = 0;
        continue;
      }
      list[i] = list[list.length - 1];
      list.pop();
      if (m.alive) continue; // removed while alive (the game is being disposed): not a kill
      if (t.mini) this.ev.mini(++this.minis, MINIS.length);
      else {
        this.chain = this.sinceKill <= CHAIN_WINDOW ? this.chain + 1 : 1;
        this.sinceKill = 0;
        this.ev.kill(++this.kills, this.chain);
      }
    }
    return alive;
  }

  private relocate(m: Mob, hx: number, hz: number) {
    const d = this.pickDoor(hx, hz, '');
    m.pos.set(d.x + d.dx * 2 + (Math.random() - 0.5) * 2, 0, d.z + d.dz * 2 + (Math.random() - 0.5) * 2);
    m.knock.set(0, 0, 0);
  }

  private doorFits(d: SiegeDoor, hx: number, hz: number, exclude: string, gateOk: boolean) {
    if (d.id === exclude || (d.id === 'gate' && !gateOk)) return false;
    const dist = Math.hypot(d.x - hx, d.z - hz);
    return dist >= DOOR_NEAR && dist <= DOOR_FAR;
  }

  /** A door 14-32 m from the hero (the gate one rarely, `exclude` never); none fits: the farthest one. */
  private pickDoor(hx: number, hz: number, exclude: string): SiegeDoor {
    const gateOk = Math.random() < GATE_DOOR_CHANCE;
    let n = 0;
    for (const d of DOORS) if (this.doorFits(d, hx, hz, exclude, gateOk)) n++;
    if (n > 0) {
      let k = Math.floor(Math.random() * n);
      for (const d of DOORS) {
        if (!this.doorFits(d, hx, hz, exclude, gateOk)) continue;
        if (k === 0) return d;
        k--;
      }
    }
    let best = KEEP_DOOR;
    let bd = -1;
    for (const d of DOORS) {
      if (d.id === 'gate') continue;
      const dist = Math.hypot(d.x - hx, d.z - hz);
      if (dist > bd) { bd = dist; best = d; }
    }
    return best;
  }

  private spawnOne(kind: SiegeKind, bal: BalanceIn, chase: boolean, behavior: Partial<MobBehavior> | undefined, pack: Spawn | undefined, where: Where) {
    const st = mobStats(kind, bal);
    this.defBuf[0] = siegeDef(kind, st.hp, st.dmg, rollSpeed());
    const r = this.g!.spawnExtra(this.defBuf, this.atBuf, { chase, behavior, pack });
    this.tracked.push(new Tracked(r.mobs[0], where, false));
    return r.pack;
  }

  private place(p: SiegePack, bal: BalanceIn, chase: boolean, where: Where) {
    const n = p.kinds.length;
    let pack: Spawn | undefined;
    for (let j = 0; j < n; j++) {
      spot(p.at.x, p.at.z, 0, 1, p.formation === 'ring', j, n, this.atBuf[0]);
      pack = this.spawnOne(p.kinds[j], bal, chase, undefined, pack, where);
    }
  }

  /** Spawns up to MAX_PER_FRAME mobs of the queued groups while the yard has room under the cap. */
  private drain(hx: number, hz: number, alive: number) {
    let budget = MAX_PER_FRAME;
    while (budget > 0 && alive < this.maxAlive && this.qHead < this.queue.length) {
      const gr = this.queue[this.qHead];
      const kinds = gr.beat.kinds;
      if (!gr.door) {
        // a single comes from another door than the squad beside it
        gr.door = this.pickDoor(hx, hz, gr.beat.type === 'single' ? this.lastDoor : '');
        gr.bal = balanceIn(this.g!);
        this.lastDoor = gr.door.id;
      }
      const d = gr.door;
      spot(d.x + d.dx * 2, d.z + d.dz * 2, d.dx, d.dz, gr.beat.type === 'horde', gr.next, kinds.length, this.atBuf[0]);
      gr.pack = this.spawnOne(kinds[gr.next], gr.bal!, true, gr.beat.type === 'horde' ? FLANK : undefined, gr.pack, Where.Yard);
      gr.next++;
      alive++;
      budget--;
      if (gr.next >= kinds.length) this.qHead++;
    }
    if (this.qHead > 0 && this.qHead === this.queue.length) { this.queue.length = 0; this.qHead = 0; }
  }

  /** Warns MINI_WARN s ahead, then lets the next mini-boss out of the keep door (outside the alive cap). */
  private updateMini() {
    if (this.miniI >= MINIS.length) return;
    const mini = MINIS[this.miniI];
    if (!this.miniWarned && this.t >= mini.t - MINI_WARN) {
      this.miniWarned = true;
      this.ev.announce(mini.kind === 'frost' ? 'Ледяной страж!' : 'Пламенный страж!', 'mini');
      sfx.combo();
    }
    if (this.t < mini.t) return;
    this.miniI++;
    this.miniWarned = false;
    const st = miniStats(mini.kind, balanceIn(this.g!));
    this.defBuf[0] = miniDef(mini.kind, st.hp, st.dmg, rollSpeed());
    this.atBuf[0].x = KEEP_DOOR.x + KEEP_DOOR.dx * 2;
    this.atBuf[0].z = KEEP_DOOR.z + KEEP_DOOR.dz * 2;
    const r = this.g!.spawnExtra(this.defBuf, this.atBuf, { chase: true });
    this.tracked.push(new Tracked(r.mobs[0], Where.Yard, true));
  }
}
