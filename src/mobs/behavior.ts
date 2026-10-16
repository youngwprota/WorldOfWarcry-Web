import * as THREE from 'three';
import type { MobDef } from '../config';

/**
 * How a mob behaves, as independent axes:
 * - disposition: hostile attacks on sight (MobDef.aggro), neutral only once hit, passive never fights (no AI at all);
 * - idle: stand on the spawn point or wander round it;
 * - combat: chase into melee, hold its spot (hits whoever comes in reach), flank (melee that spreads round the hero
 *   and strikes from its own side), or kite inside the [near, far] band (default: 55–90% of its reach), sidestepping
 *   left / right meanwhile; with `zone` a kiter never leaves that radius round its spawn centre.
 * Ranged or melee comes from MobDef.shot.
 */
export interface MobBehavior {
  disposition: 'hostile' | 'neutral' | 'passive';
  idle: 'stand' | 'wander';
  combat: 'chase' | 'hold' | 'flank' | 'kite';
  kite?: [number, number];
  zone?: number;
}

const DEFAULT: MobBehavior = { disposition: 'hostile', idle: 'wander', combat: 'chase' };

/** The mob's own behavior with a spawn slot's override on top; a static unit is always passive and stands. */
export function behaviorOf(def: MobDef, slot?: Partial<MobBehavior>): MobBehavior {
  const b = { ...DEFAULT, ...def.behavior, ...slot };
  if (def.static) { b.disposition = 'passive'; b.idle = 'stand'; }
  return b;
}

/** What combatGoal needs of a mob; strafe / strafeT are its kiting state, fleeA / fleeT its zone-kiting flee turn. */
export interface Fighter { pos: THREE.Vector3; behavior: MobBehavior; strafe: number; strafeT: number; fleeA: number; fleeT: number }

/** Pulls `p` back inside the circle of radius `zone` round `home`. */
function clampZone(p: THREE.Vector3, home: THREE.Vector3, zone: number) {
  const dx = p.x - home.x;
  const dz = p.z - home.z;
  const d = Math.hypot(dx, dz);
  if (d > zone) {
    p.x = home.x + (dx / d) * zone;
    p.z = home.z + (dz / d) * zone;
  }
  return p;
}

/**
 * Where a fighting mob steps this frame, written to `out`; null: it stays where it is.
 * `home`: the spawn centre (kite zone); `slot` of `count`: this mob's place among the spawn's fighting units (flank).
 */
export function combatGoal(m: Fighter, hero: THREE.Vector3, dHero: number, reach: number, dt: number, out: THREE.Vector3,
  home: THREE.Vector3, slot: number, count: number) {
  const b = m.behavior;
  if (b.combat === 'hold') return null;
  if (b.combat === 'chase' || (b.combat === 'flank' && count < 2)) return dHero > reach * 0.85 ? out.copy(hero) : null;
  if (b.combat === 'flank') {
    // slots are spread evenly round the hero, slot 0 on the side facing the spawn centre
    const a = Math.atan2(home.x - hero.x, home.z - hero.z) + (slot / count) * Math.PI * 2;
    out.set(hero.x + Math.sin(a) * reach * 0.8, 0, hero.z + Math.cos(a) * reach * 0.8);
    return dHero <= reach * 0.85 && out.distanceTo(m.pos) < 0.5 ? null : out;
  }
  const zone = b.zone;
  const [near, far] = b.kite ?? [reach * 0.55, reach * 0.9];
  if (dHero > far) return zone ? clampZone(out.copy(hero), home, zone) : out.copy(hero);
  const k = 2 / (dHero || 1);
  const dx = (m.pos.x - hero.x) * k;
  const dz = (m.pos.z - hero.z) * k;
  if (dHero < near) {
    if (!zone) return out.set(m.pos.x + dx, 0, m.pos.z + dz);
    m.fleeT -= dt;
    if (m.fleeT <= 0) {
      m.fleeT = 0.8 + Math.random() * 1.7;
      // random turn off the straight-away line, never back towards the hero
      m.fleeA = (Math.random() * 2 - 1) * 1.9;
    }
    const c = Math.cos(m.fleeA);
    const s = Math.sin(m.fleeA);
    return clampZone(out.set(m.pos.x + dx * c - dz * s, 0, m.pos.z + dx * s + dz * c), home, zone);
  }
  m.strafeT -= dt;
  if (m.strafeT <= 0) {
    m.strafeT = 1.5 + Math.random() * 1.5;
    m.strafe = Math.random() < 0.5 ? -1 : 1;
  }
  // along the tangent of the circle round the hero: the distance stays about the same
  out.set(m.pos.x - dz * m.strafe, 0, m.pos.z + dx * m.strafe);
  return zone ? clampZone(out, home, zone) : out;
}
