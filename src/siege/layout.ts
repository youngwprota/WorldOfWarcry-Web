// The siege map, shared by the map (world.ts) and the director. Metres; −z is forward (up the screen). The map lies at
// z 60..220, far from the island camp (0, −52), so the camp checks in game.ts never fire.
import type { SiegeDoor, SiegePack } from './types';

export const START = { x: 0, z: 212, facing: Math.PI };
/** Forest road centreline, from the start to the castle gate. */
export const ROAD: readonly [number, number][] = [[0, 214], [2, 200], [-3, 185], [1, 170], [-2, 155], [0, 140], [0, 128]];
export const ROAD_HALF_W = 2.2;
/** Walkable half-width of the forest corridor; tree walls stand at |x| 12..30. */
export const FOREST_HALF_W = 11;
/** Castle front wall: its z, thickness, half-length; the gate gap is |x| < halfW, the gate towers at |x| = towerX. */
export const GATE = { z: 132, thick: 2.4, wallHalfLen: 40, halfW: 3, towerX: 5.5 };
/** Inner faces of the yard walls. */
export const YARD = { x0: -24, x1: 24, z0: 80, z1: 130 };
/** The keep behind the yard (z 70..80) and its door. */
export const KEEP = { z0: 70, z1: 80, door: { x: 0, z: 81 } };
export const WELL = { x: 0, z: 105, r: 1.6 };

export const KEEP_DOOR: SiegeDoor = { id: 'keep', x: 0, z: 83, dx: 0, dz: 1 };
/** Spawn sockets of the yard waves; 'gate' is behind the hero and used rarely. */
export const DOORS: readonly SiegeDoor[] = [
  KEEP_DOOR,
  { id: 'west', x: -22, z: 105, dx: 1, dz: 0 },
  { id: 'east', x: 22, z: 105, dx: -1, dz: 0 },
  { id: 'nw', x: -20, z: 86, dx: 0.7, dz: 0.7 },
  { id: 'ne', x: 20, z: 86, dx: -0.7, dz: 0.7 },
  { id: 'gate', x: 0, z: 127, dx: 0, dz: -1 },
];

export const FOREST_PACKS: readonly SiegePack[] = [
  { kinds: ['bandit', 'bandit', 'bandit'], at: { x: -4, z: 196 }, formation: 'ring' },
  { kinds: ['bandit', 'bandit', 'archer'], at: { x: 5, z: 182 }, formation: 'ring' },
  { kinds: ['elf_blade', 'elf_blade', 'elf_blade'], at: { x: -5, z: 168 }, formation: 'ring' },
  { kinds: ['bandit', 'bandit', 'bandit', 'bandit'], at: { x: 3, z: 157 }, formation: 'ring' },
  { kinds: ['bandit', 'elf_rogue'], at: { x: -9, z: 146 }, formation: 'line', trigger: 150 },
  { kinds: ['bandit', 'bandit'], at: { x: 9, z: 146 }, formation: 'line', trigger: 150 },
];
/** The squad in front of the closed gate: heavies and warriors in the middle, archers on the flanks. */
export const GATE_SQUAD: readonly SiegePack[] = [
  { kinds: ['heavy', 'heavy', 'warrior', 'warrior', 'warrior'], at: { x: 0, z: 137 }, formation: 'line' },
  { kinds: ['archer'], at: { x: -7, z: 135 }, formation: 'line' },
  { kinds: ['archer'], at: { x: 7, z: 135 }, formation: 'line' },
];

export const AREAS: readonly { name: string; x: number; z: number; r: number }[] = [
  { name: 'Ворота замка', x: 0, z: 136, r: 6 },
  { name: 'Внутренний двор', x: 0, z: 105, r: 22 },
];
