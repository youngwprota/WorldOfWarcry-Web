import * as THREE from 'three';
import type { SpawnGroup } from '../world';
import type { Unit } from './unit';

/** A spawn on the field: its units come back together, once all of them are down (World SpawnGroup is its data). */
export class Spawn {
  readonly units: Unit[] = [];
  /** Leash centre and respawn loader spot. */
  readonly at: THREE.Vector3;
  constructor(readonly def: SpawnGroup) {
    this.at = new THREE.Vector3(def.x, 0, def.z);
  }
  get cleared() {
    for (const u of this.units) if (u.alive) return false;
    return true;
  }
  /** The unit that shows the spawn's respawn loader. */
  get leader() { return this.units[0]; }
  /** Place of `u` among the spawn's fighting units, and how many fight (flanking mobs spread by it). */
  fightSlot(u: Unit) {
    let i = 0;
    for (const o of this.units) {
      if (o === u) break;
      if (o.fighting) i++;
    }
    return i;
  }
  get fightCount() {
    let n = 0;
    for (const o of this.units) if (o.fighting) n++;
    return n;
  }
  /** A social spawn fights as one: true while another of its units is in a fight. */
  pulls(u: Unit) {
    if (this.def.link !== 'social') return false;
    for (const o of this.units) if (o !== u && o.fighting) return true;
    return false;
  }
}
