import type * as THREE from 'three';
import type { ZoneDef, ZoneId } from './config';
import type { FogOfWar } from './fog';
import type { Obstacle, SpawnPoint } from './world';

/** Sky, fog and light of a spot (World.envAt). */
export interface EnvOut { sky: THREE.Color; fog: THREE.Color; hemiSky: THREE.Color; hemiGround: THREE.Color; density: number; light: number }

/** The level a Game plays on: the island (World) or a mode's own map (src/siege/world.ts). */
export interface GameWorld {
  readonly group: THREE.Group;
  readonly obstacles: Obstacle[];
  readonly spawns: readonly SpawnPoint[];
  readonly bosses: readonly { mob: string; x: number; z: number }[];
  readonly areas: readonly { name: string; x: number; z: number; r: number }[];
  readonly fires: readonly THREE.Object3D[];
  readonly fortExit: { x: number; z: number; tx: number; tz: number };
  readonly fog: Pick<FogOfWar, 'dirty' | 'load' | 'update' | 'reveal' | 'isExplored' | 'serialize' | 'drawOnMap' | 'open' | 'revealAll' | 'reset'>;
  zoneAt(x: number, z: number): ZoneDef;
  envAt(x: number, z: number, out: EnvOut): void;
  collide(p: THREE.Vector3, radius: number): void;
  update(dt: number, time: number, camTarget: THREE.Vector3): void;
  setLowDetail(low: boolean): void;
  openGate(id: string, instant?: boolean): void;
  openAllGates(instant?: boolean): void;
  gateTarget(id: string): string;
  drawMap(g: CanvasRenderingContext2D, X: (x: number) => number, Y: (z: number) => number, ppm: number, worldMap?: boolean): void;
  dispose?(): void;
}

/** A game mode on its own map (the siege): the Game runs it instead of the island, never saves and never respawns the hero. */
export interface GameMode {
  readonly world: GameWorld;
  readonly start: { x: number; z: number; facing: number };
  /** Ambient.fixed: the air particles' look. */
  readonly ambient: ZoneId;
  /** Every simulated frame (game time, hit-stop scaled, not while paused), after mobs and respawns. */
  tick(dt: number): void;
  /** The hero's death clip has played: the mode ends the run instead of the camp respawn. */
  heroDied(): void;
  /** Multiplies the hero's HP regen (the siege's kill-streak heal bonus). */
  regenMul?(): number;
}
