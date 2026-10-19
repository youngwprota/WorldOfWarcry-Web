import { FOREST_PACKS, GATE_SQUAD } from './layout';
import type { MiniKind, SiegeKind } from './types';

/** One group of the yard schedule, `t` seconds after the gate falls. */
export interface Beat { t: number; type: 'squad' | 'horde' | 'single'; kinds: SiegeKind[] }

/** Yard waves: a beat every `every` s from `first` to `last`; the timer runs `duration` s. */
export const WAVE = { first: 3, every: 8, last: 275, duration: 300 };
/** Mini-bosses, `t` seconds after the gate falls, from the keep door. */
export const MINIS: readonly { t: number; kind: MiniKind }[] = [{ t: 75, kind: 'frost' }, { t: 165, kind: 'flame' }, { t: 245, kind: 'frost' }];

const pick = <T>(rng: () => number, a: readonly T[]) => a[Math.floor(rng() * a.length) % a.length];
const MELEE_OPP: readonly SiegeKind[] = ['warrior', 'bandit'];
const MELEE_ELF: readonly SiegeKind[] = ['elf_blade', 'elf_rogue'];

/** Counts are fixed (35 beats: 60 horde + 137 squad + 15 single = 212); `rng` picks only the kinds. */
export function schedule(rng: () => number): Beat[] {
  const out: Beat[] = [];
  const n = Math.floor((WAVE.last - WAVE.first) / WAVE.every) + 1;
  let hordes = 0, squads = 0, singles = 0;
  for (let i = 0; i < n; i++) {
    const t = WAVE.first + WAVE.every * i;
    if (i % 4 === 3) {
      const size = 6 + Math.floor(i / 9);
      const kinds: SiegeKind[] = [];
      const fodder: SiegeKind = hordes++ % 2 ? 'elf_rogue' : 'bandit';
      for (let j = 0; j < size; j++) kinds.push(fodder);
      out.push({ t, type: 'horde', kinds });
    } else {
      const size = Math.min(7, 3 + Math.floor((i + 3) / 8));
      const elf = squads++ % 2 === 1;
      const kinds: SiegeKind[] = [];
      const archers = Math.floor(size / 3);
      for (let j = 0; j < archers; j++) kinds.push(elf ? 'elf_archer' : 'archer');
      if (i >= 12) kinds.push('heavy');
      while (kinds.length < size) kinds.push(pick(rng, elf ? MELEE_ELF : MELEE_OPP));
      out.push({ t, type: 'squad', kinds });
    }
    if (i >= 6 && i % 2 === 0) out.push({ t, type: 'single', kinds: [singles++ % 2 ? (rng() < 0.5 ? 'archer' : 'elf_archer') : 'heavy'] });
  }
  return out;
}

let total = -1;
/** Every mob of the run but the minis: forest packs + gate squad + the yard schedule. */
export function maxKills(): number {
  if (total < 0) {
    total = 0;
    for (const p of FOREST_PACKS) total += p.kinds.length;
    for (const p of GATE_SQUAD) total += p.kinds.length;
    for (const b of schedule(Math.random)) total += b.kinds.length;
  }
  return total;
}
