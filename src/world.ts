import * as THREE from 'three';
import { assets } from './assets';
import { blobShadow } from './character';
import { FogOfWar } from './fog';
import { FACTIONS, SPAWN_PRESETS, VIEW, FOREST_TREES, GLOVES_BANDITS, GUARD_PACKS, MID_SPAWNERS, CEMETERY_AREAS, LAND_ELITES, MINI_SPAWNER, MINI_SPAWNER_OF, MOBS, PEAKS_SPAWNERS, PROP_SPAWNERS, SPAWNERS, WITHERED, ZONES, ZOO, type PackDef, type SpawnPreset, type SpawnPresetId, type SpawnerDef, type FactionId, type ZoneId } from './config';
import {
  ARENA, BOSS_GUARDS, BRANCH_PATHS, CAMP_EXIT, CAMP_WALL, FORT, FOREST_PINS, GATE, GLOVES_PACKS, MID_UV, campToFortAt, GATE_GUARDS, ISLAND, LAND_BOSSES, LAND_TRAILS, MAP_BOX, OLD_TRAIL, PATH, PATH_W, GATES, RIDGE_POINTS, angleOf, ringSpots, coastDist, gateDist, edgePoint, heightAt, inCamp, inland, outside,
  borderAway, borderRoom, pathAt, pathDist, progressAt, rimCliff, rimTrees, walkable, zoneAt, zoneIdAt, zoneWeights,
} from './island';
import type { Gate } from './island';
import {
  GroundLayers, bakeGroundMaps, buildCobbles, buildGrassField, buildGround, buildRitual, buildMist, groundColorTexture, windTime, zoneTexture, type Pond,
} from './terrain';
import { buildOcean, buildPond, pondR } from './water';
import { applyScenery, patchScenery, scenery, type SceneryLook } from './atmos';
import { buildDecor } from './decor';
import { BREAKABLES } from './config';
export { BREAKABLES, type BreakableDef, type BreakEvent } from './config';

/** Deterministic RNG so the map is the same every session. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Obstacle { x: number; z: number; r: number; }
/**
 * A spawn: one unit (config SPAWNERS / PROP_SPAWNERS) or a pack (PackDef). `id` keys its saved charge state;
 * `charges`: cooldowns per clear; (x, z): its centre.
 */
export interface SpawnGroup { id: string; charges: number[]; link: PackDef['link']; x: number; z: number; zone: ZoneId }
/**
 * One unit of a spawn — a mob or a breakable prop. `unit` + `kind`: MOBS id or BREAKABLES kind;
 * `depth` 0..1: how far along its zone's stretch of the trail a mob sits (DEPTH scaling); `rot`: a prop's facing;
 * `behavior`: the pack slot's override.
 */
export interface SpawnPoint {
  id: string; unit: 'mob' | 'prop'; kind: string; x: number; z: number; zone: ZoneId; depth: number; rot: number;
  group: SpawnGroup; behavior?: PackDef['slots'][number]['behavior'];
}


const bushGeo = new THREE.IcosahedronGeometry(0.55, 0);
const bushMat = new THREE.MeshLambertMaterial({ color: 0x4c9a35, flatShading: true });

export function makeBreakable(kind: string): THREE.Object3D {
  const d = BREAKABLES[kind];
  const g = new THREE.Group();
  // (the level size goes on the parts: the game wobbles the group itself on hits)
  if (d.model) {
    const m = assets.clone(d.model);
    m.scale.multiplyScalar(d.scale * ENV);
    // Per-instance material clone so hit flashes stay local; it gets the level look (clouds, contact shade, sway).
    const look = lookOf(d.model);
    m.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) { mesh.material = patchScenery((mesh.material as THREE.Material).clone(), look); mesh.castShadow = true; }
    });
    g.add(m);
  } else {
    const mat = bushMat.clone();
    const bush = new THREE.Group();
    bush.scale.setScalar(ENV);
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(bushGeo, mat);
      b.position.set(Math.cos(i * 2.1) * 0.35, 0.45 + (i % 2) * 0.15, Math.sin(i * 2.1) * 0.35);
      b.scale.setScalar(0.9 + i * 0.15);
      b.castShadow = true;
      bush.add(b);
    }
    g.add(bush);
  }
  g.add(blobShadow(d.r * 2.6 * ENV));
  return g;
}

/** An instanced copy: position, scale, turn, height override, tint and `k` = tint brightness (> 1 lightens a dark texture). */
interface Inst { x: number; z: number; s: number; r?: number; y?: number; tint?: number; k?: number }

/** Size of everything placed in the level (VIEW.env): trees, buildings, props, breakables. */
const ENV = VIEW.env;
/** Models whose size the layout depends on (the bone gate: its posts and the barrier are placed for it). */
const FIXED_SIZE = new Set(['undead_tusk_gate']);

/** Foliage models and how much they bend in the wind (SceneryLook.sway; the bend grows with height²). */
const FOLIAGE: Record<string, number> = { elf_tree: 0.55, elf_foliage_small: 4, elf_foliage_mid: 6, elf_foliage_big: 2.5 };
/** Level look of a model: foliage sways; everything gets contact shade at its base. */
const lookOf = (name: string): SceneryLook => ({ sway: FOLIAGE[name] ?? 0, base: 1 });
/** World.scatter options: the level look, and `snow` (flat white instead of the model's textures). */
type ScatterLook = SceneryLook & { snow?: boolean };

/** Snow Pass roads as polylines (World.snowRoadDist). */
const SNOW_ROADS: [number, number][][] = [LAND_TRAILS[4], LAND_TRAILS[8], OLD_TRAIL.x.map((x, i): [number, number] => [x, OLD_TRAIL.z[i]])];

/** Abandoned-village look (World.abandonedVillage): the model's materials darkened and greyed, cached per material. */
const RUIN_TINT = new THREE.Color(0x8c8496);
const ruinMats = new Map<THREE.Material, THREE.Material>();
function ruinLook(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    let m = ruinMats.get(mesh.material);
    if (!m) {
      const c = mesh.material.clone() as THREE.MeshStandardMaterial;
      c.color?.multiply(RUIN_TINT);
      c.onBeforeCompile = mesh.material.onBeforeCompile;
      c.customProgramCacheKey = mesh.material.customProgramCacheKey;
      ruinMats.set(mesh.material, (m = c));
    }
    mesh.material = m;
  });
}

const snowMats = new Map<THREE.Material, THREE.Material>();
function snowMat(src: THREE.Material) {
  let m = snowMats.get(src);
  if (!m) {
    const c = src.clone() as THREE.MeshLambertMaterial;
    c.map = null;
    c.color.set(0xffffff);
    snowMats.set(src, m = c);
  }
  return m;
}

/** Foliage tints (multiply the elf texture) so groves are not all the same lime green. */
const LEAF_TINTS = [0xffffff, 0xd4ecb0, 0xa8d488, 0x8fc47a, 0xc2e09a];
const leaf = (r: () => number) => LEAF_TINTS[Math.floor(r() * LEAF_TINTS.length)];

/** Position in a local frame: `fwd` along angle a (0 = +Z), `side` to its local +X. */
const local = (cx: number, cz: number, a: number, side: number, fwd: number) =>
  ({ x: cx + side * Math.cos(a) + fwd * Math.sin(a), z: cz - side * Math.sin(a) + fwd * Math.cos(a) });
/** Position in the frame of the camp exit: `side` to the left as seen walking out, `fwd` outward. */
const campGate = (side: number, fwd: number) => local(CAMP_EXIT.x, CAMP_EXIT.z, Math.atan2(CAMP_EXIT.dirX, CAMP_EXIT.dirZ), side, fwd);
/** Angle (0 = +Z) of the trail where it leaves a circle of radius r around a point, going backward or forward. */
function trailExit(cx: number, cz: number, r: number, forward: boolean) {
  const sc = progressAt(cx, cz);
  for (let s = sc; forward ? s < PATH.length : s > 0; s += forward ? 0.5 : -0.5) {
    const p = pathAt(s);
    if (Math.hypot(p.x - cx, p.z - cz) >= r) return Math.atan2(p.x - cx, p.z - cz);
  }
  return forward ? Math.PI : 0;
}
/** The outer locations' paths (LAND_TRAILS) sampled every metre, bucketed by 8 m cells: decor keeps off them. */
const LAND_TRAIL_GRID = (() => {
  const g = new Map<number, [number, number][]>();
  for (const line of LAND_TRAILS) {
    for (let i = 0; i < line.length - 1; i++) {
      const [x0, z0] = line[i];
      const [x1, z1] = line[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0)));
      for (let k = 0; k <= n; k++) {
        const x = x0 + ((x1 - x0) * k) / n;
        const z = z0 + ((z1 - z0) * k) / n;
        const key = Math.floor(x / 8) * 1000 + Math.floor(z / 8);
        if (!g.has(key)) g.set(key, []);
        g.get(key)!.push([x, z]);
      }
    }
  }
  return g;
})();
/** Metres to the nearest outer-location path (up to ~16; 99 when none is near). */
function landTrailDist(x: number, z: number) {
  let best = 99;
  const cx = Math.floor(x / 8);
  const cz = Math.floor(z / 8);
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
    for (const [px, pz] of LAND_TRAIL_GRID.get((cx + i) * 1000 + cz + j) ?? []) best = Math.min(best, Math.hypot(px - x, pz - z));
  }
  return best;
}

/** Murky pools of the swamp: off its paths, its boss and mini spots and the passages, apart from each other. */
function swampPonds(): Pond[] {
  const r = rng(91);
  const land = LAND_BOSSES.find((l) => l.zone === 'swamp')!;
  const keep = [land.boss!, ...land.minis];
  const out: Pond[] = [];
  for (let i = 0; i < 4000 && out.length < 6; i++) {
    const x = MAP_BOX.x + r() * MAP_BOX.size;
    const z = MAP_BOX.z + r() * MAP_BOX.size;
    const pr = 3.2 + r() * 2.8;
    if (zoneIdAt(x, z) !== 'swamp' || !walkable(x, z, pr + 2) || landTrailDist(x, z) < pr + 4 || gateDist(x, z) < pr + 9) continue;
    if (keep.some(([kx, kz]) => Math.hypot(kx - x, kz - z) < pr + 11)) continue;
    if (out.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + pr + 7)) continue;
    out.push({ x, z, r: pr, murky: true });
  }
  return out;
}

const bandKey = (x: number, z: number) => Math.floor(x / 24) * 1000 + Math.floor(z / 24);
function bands(items: Inst[]) {
  const b = new Map<number, Inst[]>();
  for (const it of items) {
    const k = bandKey(it.x, it.z);
    if (!b.has(k)) b.set(k, []);
    b.get(k)!.push(it);
  }
  return [...b.values()];
}

/** Everything placed into the level (static models are cloned; repeated decor is instanced). */
export class World {
  readonly group = new THREE.Group();
  readonly obstacles: Obstacle[] = [];
  /** Every spawner on the island: mobs and breakable props alike. */
  readonly spawns: SpawnPoint[] = [];
  readonly bosses: { mob: string; x: number; z: number }[] = [];
  /** Spawn presets shown in the dunes (debug teleport): which preset and its centre. */
  readonly presets: { id: SpawnPresetId; x: number; z: number }[] = [];
  /** Trail point just outside the bandit fort's entrance and the trail direction there (where reinforcements arrive). */
  readonly fortExit = { x: 0, z: 0, tx: 0, tz: 0 };
  readonly ponds: Pond[] = [{ x: 11, z: -83, r: 5 }];
  /** Baked island picture (ground + ocean) for the minimap and the world map; see mapToCanvas. */
  readonly mapCanvas: HTMLCanvasElement;
  readonly gate = GATE;
  /** Fog of war over unexplored land (state is loaded/saved by Game). */
  readonly fog: FogOfWar;
  /** Passages between locations; each is shut by a magic barrier until opened. */
  private gateStones: Inst[] = [];
  readonly gates: { def: Gate; mesh: THREE.Mesh; mat: THREE.ShaderMaterial; obstacles: Obstacle[]; open: boolean }[] = [];
  private flames: THREE.Mesh[] = [];
  private time = { value: 0 };
  private mist: ReturnType<typeof buildMist>;
  /** Grass, flowers and the rest of the knee-high clutter (hidden on low graphics). */
  private grass: THREE.Object3D[] = [];
  private grassField: ReturnType<typeof buildGrassField>;
  /** Contact shadows and grass holes under everything placed (painted while building, then uploaded). */
  private layers: GroundLayers;
  /** Trunk spots of every tree (mushrooms and ferns grow round them). */
  private treeSpots: [number, number][] = [];
  private sizeCache = new Map<string, THREE.Vector3>();
  private packCenters: [number, number][] = [];
  /** Circles [x, z, r] trail mobs never stand in (cemetery village and chapel). */
  private keepOut: [number, number, number][] = [];
  /** Named areas of the cemetery (config CEMETERY_AREAS + Death's arena): the game shows the name on stepping in. */
  readonly areas: { name: string; x: number; z: number; r: number }[] = [];

  constructor(public faction: FactionId) {
    this.ponds.push(...swampPonds());
    const maps = bakeGroundMaps(this.ponds);
    this.mapCanvas = maps.map;
    const colorMap = groundColorTexture(maps.ground);
    this.layers = new GroundLayers(maps.grass);
    this.group.add(buildGround(colorMap, this.layers));
    const zoneTex = zoneTexture();
    this.group.add(buildOcean(maps.shoreTex));
    for (const p of this.ponds) {
      this.group.add(buildPond(p));
      this.obstacles.push({ x: p.x, z: p.z, r: p.r * 0.85 });
    }
    this.buildCamp();
    this.buildForest();
    this.buildBarrier();
    this.buildCemetery();
    this.buildOuterLands();
    this.buildRim();
    this.layers.commit(); // (no grass in the ponds: the bake follows their shores)
    this.grassField = buildGrassField(colorMap, this.layers);
    const clutter = [this.grassField.mesh, ...buildDecor((x, z, pad) => this.free(x, z, pad), this.treeSpots)];
    this.grass.push(...clutter);
    this.group.add(...clutter);
    this.mist = buildMist(this.time, zoneTex);
    this.group.add(this.mist.group);
    this.fog = new FogOfWar(this.time);
    this.group.add(this.fog.mesh);
  }

  zoneAt(x: number, z: number) { return zoneAt(x, z); }

  /** Environment colours (and fog density) blended across zone borders. */
  envAt(x: number, z: number, out: { sky: THREE.Color; fog: THREE.Color; hemiSky: THREE.Color; hemiGround: THREE.Color; density: number }) {
    const w = zoneWeights(x, z);
    const sum = w.reduce((a, b) => a + b, 0) || 1;
    const tmp = new THREE.Color();
    out.sky.setRGB(0, 0, 0); out.fog.setRGB(0, 0, 0); out.hemiSky.setRGB(0, 0, 0); out.hemiGround.setRGB(0, 0, 0);
    out.density = 0;
    ZONES.forEach((zd, i) => {
      const k = w[i] / sum;
      if (k <= 0) return;
      out.sky.add(tmp.set(zd.sky).multiplyScalar(k));
      out.fog.add(tmp.set(zd.fog).multiplyScalar(k));
      out.hemiSky.add(tmp.set(zd.hemi[0]).multiplyScalar(k));
      out.hemiGround.add(tmp.set(zd.hemi[1]).multiplyScalar(k));
      out.density += zd.fogDensity * k;
    });
  }

  // ---------- placement helpers ----------
  private size(name: string) {
    let s = this.sizeCache.get(name);
    if (!s) {
      const m = assets.clone(name);
      m.updateMatrixWorld(true);
      s = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3());
      this.sizeCache.set(name, s);
    }
    return s;
  }

  private minYCache = new Map<string, number>();
  private minY(name: string) {
    let y = this.minYCache.get(name);
    if (y === undefined) {
      const m = assets.clone(name);
      m.updateMatrixWorld(true);
      y = new THREE.Box3().setFromObject(m).min.y;
      this.minYCache.set(name, y < -0.3 ? y : 0);
    }
    return this.minYCache.get(name)!;
  }

  /** Is a spot on the walkable island, free of obstacles, ponds and (optionally) the trail? */
  free(x: number, z: number, pad = 0.6, avoidPath = false) {
    if (!walkable(x, z, pad)) return false;
    if (avoidPath && pathDist(x, z) < PATH_W * 0.5 + 1.6) return false;
    for (const o of this.obstacles) if ((x - o.x) ** 2 + (z - o.z) ** 2 < (o.r + pad) ** 2) return false;
    return true;
  }

  private nearPack(x: number, z: number, d: number) {
    return this.packCenters.some(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 < d * d);
  }

  /** Cloned model with shadows; `collide: 'auto'` derives a circle from the footprint. */
  private place(name: string, x: number, z: number, scale = 1, rot = 0, collide: number | 'auto' = 'auto') {
    if (!assets.has(name)) { console.warn('level model not loaded:', name); return null; }
    if (!FIXED_SIZE.has(name)) {
      scale *= ENV;
      if (collide !== 'auto') collide *= ENV;
    }
    const m = assets.clone(name);
    m.scale.multiplyScalar(scale);
    // Some props are pivoted at the top (hanging lamps, drums): stand them on the ground.
    const lift = Math.max(0, -this.minY(name)) * scale;
    m.position.set(x, heightAt(x, z) + lift, z);
    m.rotation.y = rot;
    m.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; }
    });
    applyScenery(m, lookOf(name));
    this.group.add(m);
    const sz = this.size(name);
    this.groundUnder(name, x, z, sz.x * scale, sz.y * scale, sz.z * scale);
    const r = collide === 'auto' ? Math.min(sz.x, sz.z) * scale * 0.45 : collide;
    if (r > 0) this.obstacles.push({ x, z, r });
    return m;
  }

  /** Contact shadow under a model (footprint sx × sz, height sy, already scaled) and no grass inside it; trees keep grass round the trunk. */
  private groundUnder(name: string, x: number, z: number, sx: number, sy: number, sz: number) {
    if (sy < 0.25) return; // flat bits (stepping stones) sit in the ground already
    const fr = Math.max(sx, sz) * 0.5;
    const k = Math.min(0.6, 0.18 + sy * 0.07);
    this.layers.occlude(x, z, fr + 0.6, k * 0.65);
    this.layers.occlude(x, z, Math.max(0.45, fr * 0.45), k);
    const foliage = name in FOLIAGE;
    this.layers.clear(x, z, foliage ? Math.min(0.5, fr * 0.25) : fr * 0.8);
    if (foliage && sy > 2) this.treeSpots.push([x, z]);
  }

  /**
   * Like place(), at the nearest spot round (x, z) that is walkable with `pad` room, in the same location and clear of the trail
   * (rings out to 24 m); skipped when there is none, so a building never lands on a road or in the next location.
   */
  private placeInside(name: string, x: number, z: number, scale: number, rot: number, pad = 3, collide: number | 'auto' = 'auto') {
    const zone = zoneIdAt(x, z);
    const ok = (px: number, pz: number) => walkable(px, pz, pad) && zoneIdAt(px, pz) === zone && pathDist(px, pz) > PATH_W + pad;
    for (let d = 0; d <= 24; d += 1.5) {
      const n = d ? Math.ceil((d * Math.PI * 2) / 3) : 1;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const px = x + Math.sin(a) * d;
        const pz = z + Math.cos(a) * d;
        if (ok(px, pz)) return this.place(name, px, pz, scale, rot, collide);
      }
    }
    return null;
  }

  /**
   * Instanced copies of a model (trees, rocks, poles). Items are split into 24 m tiles so each tile
   * has its own bounding sphere and off-screen tiles are frustum-culled.
   */
  /** `look`: the level look over the model's own (src/atmos.ts); `snow`: its textures are dropped for a flat white (tint still applies). */
  private scatter(name: string, items: Inst[], shadow = true, look: ScatterLook = {}) {
    for (const band of bands(items)) this.scatterBand(name, band, shadow, look);
  }

  private scatterBand(name: string, items: Inst[], shadow: boolean, { snow, ...lookOver }: ScatterLook) {
    if (!items.length) return;
    if (!assets.has(name)) { console.warn('level model not loaded:', name); return; }
    const src = assets.clone(name);
    src.updateMatrixWorld(true);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    const look = { ...lookOf(name), ...lookOver };
    const sz = this.size(name);
    const k = FIXED_SIZE.has(name) ? 1 : ENV;
    for (const t of items) this.groundUnder(name, t.x, t.z, sz.x * t.s * k, sz.y * t.s * k, sz.z * t.s * k);
    src.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      const mat = mesh.material as THREE.Material | THREE.Material[];
      const patch = (x: THREE.Material) => scenery(snow ? snowMat(x) : x, look);
      const im = new THREE.InstancedMesh(geo, Array.isArray(mat) ? mat.map(patch) : patch(mat), items.length);
      items.forEach((t, i) => {
        q.setFromAxisAngle(up, t.r ?? 0);
        m.compose(new THREE.Vector3(t.x, t.y ?? heightAt(t.x, t.z), t.z), q, new THREE.Vector3(t.s * k, t.s * k, t.s * k));
        im.setMatrixAt(i, m);
        im.setColorAt(i, col.set(t.tint ?? 0xffffff).multiplyScalar(t.k ?? 1));
      });
      im.castShadow = shadow;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      this.group.add(im);
    });
  }

  /** Cheap low-poly pines for the rim (~30 triangles each vs ~2000 for the elf trees). */
  private pines(items: Inst[]) {
    items = items.map((t) => ({ ...t, s: t.s * ENV }));
    const trunk = new THREE.CylinderGeometry(0.15, 0.25, 1.4, 5).translate(0, 0.7, 0);
    const c1 = new THREE.ConeGeometry(1.4, 2.6, 7).translate(0, 2.4, 0);
    const c2 = new THREE.ConeGeometry(1.0, 2.0, 7).translate(0, 3.6, 0);
    const trunkMat = scenery(new THREE.MeshLambertMaterial({ color: 0x6b4a2f, flatShading: true }), { sway: 0.5 });
    const leafMat = scenery(new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), { sway: 0.5 });
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    for (const t of items) {
      this.layers.occlude(t.x, t.z, 2.2 * t.s, 0.4);
      this.layers.occlude(t.x, t.z, 0.8 * t.s, 0.5);
      this.treeSpots.push([t.x, t.z]);
    }
    for (const band of bands(items)) {
      const meshes = [new THREE.InstancedMesh(trunk, trunkMat, band.length), new THREE.InstancedMesh(c1, leafMat, band.length), new THREE.InstancedMesh(c2, leafMat, band.length)];
      band.forEach((t, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.r ?? 0);
        m.compose(new THREE.Vector3(t.x, heightAt(t.x, t.z), t.z), q, new THREE.Vector3(t.s, t.s, t.s));
        col.set(t.tint ?? 0x4f8a3c);
        meshes.forEach((im, j) => { im.setMatrixAt(i, m); if (j) im.setColorAt(i, col); });
      });
      for (const im of meshes) { im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); this.group.add(im); }
    }
  }

  /** Bare spooky trees: instanced trunk + three crooked branches. */
  private deadTrees(items: Inst[], color = 0x4a3f5a) {
    for (const band of bands(items.map((t) => ({ ...t, s: t.s * ENV })))) this.deadTreeBand(band, color);
  }

  private deadTreeBand(items: Inst[], color: number) {
    if (!items.length) return;
    const trunk = new THREE.CylinderGeometry(0.12, 0.3, 2.6, 6).translate(0, 1.3, 0);
    const branch = new THREE.CylinderGeometry(0.04, 0.1, 1.5, 5).translate(0, 0.75, 0);
    const mat = scenery(new THREE.MeshLambertMaterial({ color, flatShading: true }));
    for (const t of items) {
      this.layers.occlude(t.x, t.z, 1.6 * t.s, 0.3);
      this.layers.occlude(t.x, t.z, 0.6 * t.s, 0.45);
    }
    const trunks = new THREE.InstancedMesh(trunk, mat, items.length);
    const branches = new THREE.InstancedMesh(branch, mat, items.length * 4);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    items.forEach((t, i) => {
      const y = t.y ?? heightAt(t.x, t.z);
      q.setFromEuler(e.set((Math.sin(t.x) * 0.12), t.r ?? 0, Math.cos(t.z) * 0.12));
      m.compose(new THREE.Vector3(t.x, y, t.z), q, new THREE.Vector3(t.s, t.s, t.s));
      trunks.setMatrixAt(i, m);
      for (let k = 0; k < 4; k++) {
        const a = k * 1.7 + (t.r ?? 0);
        q.setFromEuler(e.set(Math.cos(a) * 0.95, 0, Math.sin(a) * 0.95));
        m.compose(new THREE.Vector3(t.x, y + (1.3 + k * 0.32) * t.s, t.z), q, new THREE.Vector3(t.s, t.s * (1.1 - k * 0.15), t.s));
        branches.setMatrixAt(i * 4 + k, m);
      }
    });
    for (const im of [trunks, branches]) { im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); this.group.add(im); }
  }

  /** Ring of palisade poles with gaps (gates) at the given directions (radians, 0 = +Z/south, PI = north). */
  private palisade(cx: number, cz: number, radius: number, gates: number[], gateHalf: number, model = 'palisade_pole', scale = 0.75, skip?: (x: number, z: number) => boolean) {
    const items: Inst[] = [];
    const step = 0.95 / radius;
    for (let a = 0; a < Math.PI * 2; a += step) {
      if (gates.some((g) => Math.abs(Math.atan2(Math.sin(a - g), Math.cos(a - g))) < gateHalf)) continue;
      const x = cx + Math.sin(a) * radius;
      const z = cz + Math.cos(a) * radius;
      if (skip?.(x, z)) continue;
      items.push({ x, z, s: scale * (0.9 + ((a * 7.3) % 0.2)), r: a * 3.7 });
      this.obstacles.push({ x, z, r: 0.45 });
    }
    this.scatter(model, items);
  }

  /** Spots already taken by spread(): everything scattered with it keeps its distance from the rest. */
  private taken: [number, number][] = [];

  /** Up to `count` spots from `gen` that pass `ok` and are at least `minD` from every earlier spread() spot. */
  private spread(count: number, minD: number, gen: () => { x: number; z: number }, ok: (x: number, z: number) => boolean, all = false) {
    const out: { x: number; z: number }[] = [];
    // `all`: spawners from the config must all get a spot, so the spacing is relaxed step by step if needed
    for (let d = minD; out.length < count && d >= (all ? 2 : minD); d *= 0.8) {
      for (let i = 0; i < count * 40 && out.length < count; i++) {
        const p = gen();
        if (!ok(p.x, p.z) || this.taken.some(([x, z]) => (x - p.x) ** 2 + (z - p.z) ** 2 < d * d)) continue;
        out.push(p);
        this.taken.push([p.x, p.z]);
      }
    }
    return out;
  }

  /**
   * Single mobs spread evenly along stretches of the trail ([s0, s1] arc-length ranges), alternating sides,
   * 6–13 m off it and away from each other (no clumps). Each spawn gets `depth` 0..1
   * (first..last) for zone depth scaling.
   */
  private mobsAlong(ranges: [number, number][], mobs: SpawnerDef[], zone: ZoneId, r: () => number, pins: Record<string, [number, number]> = {}) {
    const total = ranges.reduce((t, [a, b]) => t + (b - a), 0);
    const sAt = (d: number) => {
      for (const [a, b] of ranges) { if (d <= b - a) return a + d; d -= b - a; }
      return ranges[ranges.length - 1][1];
    };
    this.mobsOnCurve(total, (d) => pathAt(sAt(d)), mobs, zone, r, pins);
  }

  /** mobsAlong() for any curve: `at(d)` gives the point and unit tangent at distance d of `total`. */
  private mobsOnCurve(total: number, at: (d: number) => { x: number; z: number; tx: number; tz: number }, mobs: SpawnerDef[], zone: ZoneId, r: () => number, pins: Record<string, [number, number]> = {}) {
    const ok = (q: { x: number; z: number }) => walkable(q.x, q.z, 3) && zoneIdAt(q.x, q.z) === zone && pathDist(q.x, q.z) > 4 && !inCamp(q.x, q.z, 4)
      && !this.packCenters.some(([x, z]) => Math.hypot(x - q.x, z - q.z) < 9)
      && !this.keepOut.some(([x, z, kr]) => Math.hypot(x - q.x, z - q.z) < kr);
    mobs.forEach((def, i) => {
      const pin = pins[def.id];
      if (pin) {
        this.packCenters.push(pin);
        this.taken.push(pin);
        this.addSpawn(`${zone}:${i}`, def, pin[0], pin[1], zone, mobs.length > 1 ? i / (mobs.length - 1) : 0, 0);
        return;
      }
      const d = ((i + 0.5) / mobs.length) * total;
      let c: { x: number; z: number } | null = null;
      for (const ds of [0, 4, -4, 8, -8]) {
        const p = at(Math.min(total, Math.max(0, d + ds)));
        for (const side of [i % 2 ? 1 : -1, i % 2 ? -1 : 1]) {
          for (const off of i % 4 < 2 ? [7, 10, 13] : [12, 9, 6]) {
            const q = { x: p.x + p.tz * side * off, z: p.z - p.tx * side * off };
            if (ok(q)) { c = q; break; }
          }
          if (c) break;
        }
        if (c) break;
      }
      if (!c) { const p = at(d); c = { x: p.x + p.tz * 6, z: p.z - p.tx * 6 }; }
      c.x += (r() - 0.5) * 1.5;
      c.z += (r() - 0.5) * 1.5;
      this.packCenters.push([c.x, c.z]);
      this.taken.push([c.x, c.z]);
      this.addSpawn(`${zone}:${i}`, def, c.x, c.z, zone, mobs.length > 1 ? i / (mobs.length - 1) : 0, 0);
    });
  }

  /**
   * "Zoo" (config ZOO): the WoW creatures together on the meadow beside the trail right outside the camp gate
   * (the pond side). Own spawner ids (`zoo:i`), so the forest spawners and their saved charges keep their places.
   * No rng calls: the rest of the forest layout stays as it was.
   */
  private buildZoo() {
    const sGate = progressAt(CAMP_EXIT.x, CAMP_EXIT.z);
    const ok = (x: number, z: number, pad: number) => this.free(x, z, pad, true) && zoneIdAt(x, z) === 'forest'
      && !inCamp(x, z, 3) && !this.taken.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 4)
      && !this.packCenters.some(([px, pz]) => Math.hypot(px - x, pz - z) < 6);
    ZOO.forEach((def, i) => {
      const side = -1;
      let c: { x: number; z: number } | null = null;
      search: for (const sd of [side, -side]) {
        for (const ds of [0, 3, 6, 9, 12, 15, 18]) {
          const p = pathAt(sGate + 3 + i * 3.5 + ds);
          for (const off of [6, 8, 10]) {
            const q = { x: p.x + p.tz * sd * off, z: p.z - p.tx * sd * off };
            if (ok(q.x, q.z, 1.8)) { c = q; break search; }
          }
        }
      }
      if (!c) { const p = pathAt(sGate + 3 + i * 3.5); c = { x: p.x + p.tz * side * 7, z: p.z - p.tx * side * 7 }; }
      this.taken.push([c.x, c.z]);
      this.addSpawn(`zoo:${i}`, def, c.x, c.z, 'forest', 0, 0);
    });
  }

  // ---------- camp ----------
  private buildCamp() {
    const H = this.faction === 'human';
    const cz = ISLAND.campZ;
    // palisade around the camp; the wide gate faces the trail
    this.palisade(0, cz, CAMP_WALL, [Math.atan2(CAMP_EXIT.dirX, CAMP_EXIT.dirZ)], 0.4);
    const tower = H ? 'tower_human_small_1' : 'orc_high_stand';
    // buildings of the hero's race around the plaza
    const B = H
      ? { big: 'human_house_large', mid: 'human_house_mid', small: 'human_house_small', barrack: 'barrack_Lv2', tower: 'tower_big' }
      : { big: 'orc_house_Lv2', mid: 'orc_house_Lv1', small: 'orc_cabin', barrack: 'orc_barrack_Lv2', tower: 'orc_tower_Lv2' };
    this.place(B.big, -8.5, cz + 7.2, 0.62, Math.PI * 0.8);
    this.place(B.mid, 8.5, cz + 7.7, 0.62, -Math.PI * 0.78);
    this.place(B.small, -9.8, cz - 3, H ? 0.62 : 0.85, Math.PI / 2);
    this.place(B.barrack, 0, cz + 10.6, 0.5, Math.PI);
    this.place(B.tower, -10, cz - 8.8, 0.45, 0.6);
    // yard props
    const f = FACTIONS[this.faction];
    for (const side of [-1, 1]) {
      const t = campGate(side * 6.3, -0.7);
      this.place(tower, t.x, t.z, H ? 0.75 : 0.65, 0, 1.4);
      const b = campGate(side * 3.6, -2.4); // banners at the gate
      this.place(f.campProps[0], b.x, b.z, 0.42, 0, 0.4);
      const l = campGate(side * 2.8, -7.6);
      this.place(H ? 'lantern_street' : 'orc_head_lantern', l.x, l.z, H ? 0.6 : 0.45, side > 0 ? 0 : Math.PI, 0.3);
      if (!H) { const k = campGate(side * 5.2, 0); this.place('orc_horned_skull', k.x, k.z, 1.2, 0, 0); }
    }
    this.place(H ? 'practice_dummy' : 'orc_practice_dummy', -6.4, cz - 7.2, 0.65, 0.2, 0.5);
    this.place(H ? 'practice_dummy' : 'orc_practice_dummy', -8.3, cz - 6.1, 0.65, -0.4, 0.5);
    this.place(H ? 'target' : 'orc_practice_aim', 10.6, cz - 2, 0.9, -0.3, 0.5);
    this.place('elf_well', 3.8, cz + 3.8, 0.36, 0, 1.0);
    this.place(H ? 'wood_pile_big' : 'orc_wood_pile_big', -11.9, cz + 1.7, 0.5, 0.4);
    this.place(H ? 'wood_pile_small' : 'orc_wood_pile_small', 11.2, cz + 3, 0.65, 1.2);
    this.place(H ? 'lantern_street' : 'orc_head_lantern', -5.1, cz + 4.7, H ? 0.6 : 0.45, 0.8, 0.3);
    this.place(H ? 'flag' : 'orc_flag_red', 0, cz + 7.2, 0.7, 0, 0.3);
    // clutter: crates & barrels stacked by the walls (decor, not breakable)
    const crates: [string, number, number, number][] = [
      ['box_large_2', -5.5, cz + 9.4, 0.4], ['box_small_2', -4.6, cz + 9.9, 0.9], ['barrel', 5.3, cz + 9.5, 0.3],
      ['box_large_2', 11.9, cz - 6, 1], ['barrel', 11, cz - 7, 0.2], ['box_small_2', -12, cz - 6.8, 0.6],
      ['bucket', 4.8, cz + 2.6, 0], ['barrel', -11.4, cz + 4.9, 0.7],
    ];
    for (const [n, x, z, rr] of crates) this.place(H ? n : n === 'barrel' ? 'orc_barrel' : n.startsWith('box_large') ? 'orc_box_large_2' : n === 'bucket' ? 'orc_bucket' : 'orc_box_small_1', x, z, 0.8, rr, 0.5);
    if (!H) {
      this.place('orc_drum_big', -3.1, cz + 7.3, 0.45, 0.5, 0.6);
      this.place('orc_altar', 3.2, cz + 7.5, 0.55, 0, 0.8);
    } else {
      this.place('cauldron', -3.2, cz + 7.3, 0.55, 0, 0.5);
      this.place('shield', 9.9, cz - 5.5, 0.8, -Math.PI / 2, 0);
      this.place('spear', 9.9, cz - 6.2, 0.8, -Math.PI / 2, 0);
    }
    this.campfireDecor(-3.8, cz - 0.8); // decoration only
    // cobbled square round the fire and the well, a cobbled road out of the gate (no grass on it)
    const sq = { x: 0.2, z: cz + 0.8, r: 6.4 };
    const road = { x: CAMP_EXIT.x + CAMP_EXIT.dirX * 1.2, z: CAMP_EXIT.z + CAMP_EXIT.dirZ * 1.2 };
    this.group.add(buildCobbles(sq, road));
    for (let t = 0; t <= 1; t += 0.05) this.layers.clear(sq.x + (road.x - sq.x) * t, sq.z + (road.z - sq.z) * t, 1.5);
    // breakable supply crates inside the camp, left and right of the spawn, clear of the walk to the exit
    const spots = [[6.5, -6], [8, -4.6], [6.6, 1.4], [7.9, 0.6], [-6, -4], [-7, -2.2], [-6.8, 2.6], [-6.2, 1.6]];
    PROP_SPAWNERS.camp.slice(0, spots.length).forEach((d, i) => {
      this.addProp('camp', i, d, spots[i][0], cz + spots[i][1], 'forest', i * 1.3);
    });
  }

  /** A spawner from the config; without `charges` it has one endless charge with the unit's own respawn time. */
  private addSpawn(id: string, d: SpawnerDef, x: number, z: number, zone: ZoneId, depth: number, rot: number, slotOf?: { group: SpawnGroup; behavior: SpawnPoint['behavior'] }) {
    // nothing spawns in the no-walk band along the ridges: slide the spot out of it
    for (let i = 0; i < 30 && borderRoom(x, z) < 1; i++) {
      const n = borderAway(x, z);
      x += n.x * 0.5;
      z += n.z * 0.5;
    }
    const respawn = d.unit === 'mob' ? MOBS[d.id].respawn : BREAKABLES[d.id].respawn;
    const group = slotOf?.group ?? { id, charges: d.charges ?? [respawn], link: 'none', x, z, zone };
    this.spawns.push({ id, unit: d.unit, kind: d.id, x, z, zone, depth, rot, group, behavior: slotOf?.behavior });
  }
  /** A pack (config PackDef): its mobs at `spots` (one per slot), saved under `id` as one spawn. */
  private addPack(id: string, p: PackDef, spots: { x: number; z: number }[], zone: ZoneId, depth: number) {
    let respawn = 0;
    let x = 0;
    let z = 0;
    for (let j = 0; j < spots.length; j++) {
      respawn = Math.max(respawn, MOBS[p.slots[j].id].respawn);
      x += spots[j].x / spots.length;
      z += spots[j].z / spots.length;
    }
    const group: SpawnGroup = { id, charges: p.charges ?? [respawn], link: p.link, x, z, zone };
    for (let j = 0; j < p.slots.length; j++) {
      const s = p.slots[j];
      this.addSpawn(`${id}:${j}`, { unit: 'mob', id: s.id }, spots[j].x, spots[j].z, zone, depth, 0, { group, behavior: s.behavior });
    }
  }
  /** A breakable prop spawner from config PROP_SPAWNERS[group][i]. */
  private addProp(group: string, i: number, d: SpawnerDef, x: number, z: number, zone: ZoneId, rot: number) {
    this.addSpawn(`prop:${group}:${i}`, d, x, z, zone, 0, rot);
  }

  /** The camp's fire: model and a flickering flame, no gameplay. */
  private campfireDecor(x: number, z: number) {
    this.place(FACTIONS[this.faction].campfire, x, z, 0.42, 0, 0.8);
    // brighter than white in the HDR frame, so the post glow lights round it
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.35, 1, 6).translate(0, 0.5, 0),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa020).multiplyScalar(2.4), transparent: true, opacity: 0.85 }),
    );
    flame.position.set(x, 0.15, z);
    this.group.add(flame);
    this.flames.push(flame);
  }

  /** Big houses at the user's map marks, each turned to face the nearest trail (long side along it). */
  private hubHouses() {
    const kit: [string, number, number, number?][] = [
      ['house_Lv1', -10.2, -94.8], ['human_house_mid', 24.1, -90.3], ['house_Lv2', -37.8, -77.2], ['house_Lv1', -20, -61.3],
      ['human_house_mid', 15.5, -56.8], ['human_house_large', -20, -44.4], ['house_Lv2', 14, -26, Math.PI / 2], ['house_Lv1', 15.5, -8.5],
    ];
    const curves = [PATH, ...BRANCH_PATHS];
    /** Nearest trail point (main trail and its branches). */
    const nearest = (x: number, z: number) => {
      let best = Infinity;
      let nx = x;
      let nz = z;
      for (const c of curves) {
        for (let i = 0; i < c.x.length; i += 2) {
          const d = (c.x[i] - x) ** 2 + (c.z[i] - z) ** 2;
          if (d < best) { best = d; nx = c.x[i]; nz = c.z[i]; }
        }
      }
      return { nx, nz, d: Math.sqrt(best) };
    };
    // room to stand (off the pond and other obstacles), 6+ m off every trail (the house is ~4 m across), clear of the camp wall
    const ok = (x: number, z: number) => this.free(x, z, 3) && nearest(x, z).d >= 6
      && Math.hypot(x - ISLAND.campX, z - ISLAND.campZ) >= ISLAND.campR + 4;
    for (const [name, x0, z0, turn = 0] of kit) {
      // the nearest such spot round the map mark (rings out to 20 m); no room — no house
      let spot: { x: number; z: number } | null = null;
      search: for (let d = 0; d <= 20; d += 1) {
        const n = d ? Math.ceil((d * Math.PI * 2) / 2) : 1;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2;
          if (ok(x0 + Math.sin(a) * d, z0 + Math.cos(a) * d)) { spot = { x: x0 + Math.sin(a) * d, z: z0 + Math.cos(a) * d }; break search; }
        }
      }
      if (!spot) continue;
      const { nx, nz } = nearest(spot.x, spot.z);
      this.place(name, spot.x, spot.z, 0.5, Math.atan2(nx - spot.x, nz - spot.z) + turn);
      this.packCenters.push([spot.x, spot.z]);
    }
  }

  /** Two bandit trios in the trees by the gloves elite. */
  private glovesGuards() {
    const packs = GLOVES_PACKS;
    GLOVES_BANDITS.forEach((p, i) => {
      const [px, pz] = packs[i];
      const spots = ringSpots(px, pz, p.slots.length, 1.6, Math.PI / 2);
      for (const q of spots) this.taken.push([q.x, q.z]);
      this.addPack(`forest:gloves:${i}`, p, spots, 'forest', 0.3);
    });
    for (const p of packs) this.packCenters.push([p[0], p[1]]);
  }

  /** Wood north of the straight line from the settlement to the fort (hard to push through), bandits either side ([along, side] m). */
  private campToFort(r: () => number) {
    const at = campToFortAt;
    const ok = (x: number, z: number) => this.free(x, z, 1.2) && pathDist(x, z) > PATH_W + 1
      && !inCamp(x, z, 1) && Math.hypot(x - FORT.x, z - FORT.z) > FORT.r + 1.5;
    const trees: Inst[] = [];
    for (const uv of [
      [14.5, -2], [16.5, -4.5], [17.5, -1.5], [19.5, -6], [20, -3], [22, -1.2], [22.5, -5], [24.5, -7.5], [25, -3],
      [27, -5.5], [28, -9], [29.5, -3.5], [30.5, -7], [32, -10],
    ]) {
      const { x, z } = at(uv);
      // single trees, crowns apart (a solid clump looked messy)
      if (!ok(x, z) || trees.some((t) => Math.hypot(t.x - x, t.z - z) < 6.5)) continue;
      trees.push({ x, z, s: 0.6 + r() * 0.3, r: r() * 6, tint: leaf(r) });
      this.obstacles.push({ x, z, r: 0.5 });
    }
    this.scatter('elf_tree', trees);
    MID_UV.forEach((uv, i) => {
      const { x, z } = at(uv);
      if (!ok(x, z)) return;
      this.taken.push([x, z]);
      this.addSpawn(`forest:mid:${i}`, MID_SPAWNERS[i], x, z, 'forest', 0.5, 0);
    });
  }

  // ---------- forest: the hub in the middle of the island, the settlement at its centre ----------
  private buildForest() {
    const r = rng(23);
    const H = this.faction === 'human';
    const sFort = progressAt(FORT.x, FORT.z);
    const s0 = progressAt(-3, -80);
    this.hubHouses();
    // The guards come first so the roaming mobs keep away from them.
    for (const [id, spots] of [['boss_guard', BOSS_GUARDS], ['gate_guard', GATE_GUARDS]] as const) {
      for (const p of spots) {
        this.packCenters.push([p.x, p.z]);
        this.taken.push([p.x, p.z]);
      }
      this.addPack(`forest:${id}`, GUARD_PACKS[id], spots, 'forest', 0);
    }
    // Pinned: the mini-boss, the armour and gloves elites, «Громила» by the hills door; the rest spread along the trail up to the fort.
    this.mobsAlong([[s0, sFort - 28]], SPAWNERS.forest ?? [], 'forest', r, FOREST_PINS);
    this.campToFort(r);
    this.glovesGuards();
    this.buildZoo();

    // Lumber camp in the east of the forest, outside the trail's north-east loop (every piece 5+ m off the trail)
    const L = { x: 38, z: -58 };
    this.place('wood_pile_big', L.x - 1.5, L.z + 6.5, 0.5, 0.3);
    this.place('elf_log_pile', L.x - 2, L.z - 3, 0.5, 1.2);
    this.place('saw', L.x + 1.5, L.z - 6, 0.45, 0.4, 0.8);
    this.place('wood_pile_small', L.x - 3.5, L.z + 1.5, 0.6, 0.8, 0.6);
    // Abandoned farm (south-west of the settlement) with a well
    const F = { x: -19, z: -32 };
    this.place('human_house_small', F.x - 4, F.z - 1, 0.5, Math.PI / 2);
    this.place('elf_well', F.x + 2.5, F.z + 4, 0.36, 0, 1.1);
    this.place('wood_pile_small', F.x - 0.5, F.z - 6.5, 0.6, 0.2, 0.6);
    this.place('bucket', F.x + 4, F.z + 2.5, 0.8, 0, 0);
    // Rocks around the pond
    const pond = this.ponds[0];
    for (const [dx, dz, s] of [[-5.5, 4, 1.6], [5.5, -4, 1.3], [-3, -6, 1.1]] as const) this.place('orc_stone_big', pond.x + dx, pond.z + dz, s, dx * 3);
    // Bandit fort around the boss, built from the enemy race's kit. The trail comes in through its one gap;
    // the far side runs into the ridge up to its crest (no poles past it or in the passage), so the ridge gate is the only way on.
    const fx = FORT.x;
    const fz = FORT.z;
    const aIn = trailExit(fx, fz, FORT.r, false);
    const aOut = Math.atan2(GATE.x - fx, GATE.z - fz);
    this.palisade(fx, fz, FORT.r, [aIn], 0.36, 'palisade_pole', 0.75, (x, z) => zoneIdAt(x, z) !== 'forest' || gateDist(x, z) < 4.5);
    // decorations laid out with the entrance at local +Z; skip anything standing in the trail
    const exitDir = { x: Math.sin(aOut), z: Math.cos(aOut) };
    const inTrail = (x: number, z: number) => {
      const dx = x - fx;
      const dz = z - fz;
      const along = dx * exitDir.x + dz * exitDir.z;
      return pathDist(x, z) < 2.6 || (along > 0 && Math.abs(dx * exitDir.z - dz * exitDir.x) < 2.6);
    };
    const deco = (name: string, side: number, fwd: number, scale: number, rot: number, collide: number | 'auto' = 'auto') => {
      const p = local(fx, fz, aIn, side, fwd);
      if (!inTrail(p.x, p.z)) this.place(name, p.x, p.z, scale, aIn + rot, collide);
    };
    if (H) {
      deco('orc_tower_Lv2', -8.5, -7, 0.38, 0.4);
      deco('orc_throne', -6, -8.5, 0.9, 0.5, 1);
      deco('orc_drum_big', -9.8, 1, 0.45, 0.5, 0.7);
      deco('orc_tusk_standing', -4.6, 12.4, 0.9, 0.3, 0.5);
      deco('orc_tusk_standing', 4.6, 12.4, 0.9, -0.3, 0.5);
      deco('orc_horned_skull', -6, -10, 1.4, 0, 0);
    } else {
      deco('tower_Lv2', -8.5, -7, 0.38, 0.4);
      deco('throne_Lv1', -6, -9, 0.3, 0.5, 1.4);
      deco('banner', -4.6, 12.4, 0.45, 0, 0.4);
      deco('banner', 4.6, 12.4, 0.45, 0, 0.4);
    }
    // the second tower is a real one: a turret prop that can be destroyed (BREAKABLES.fort_tower_*), against the south wall
    // where it meets the ridge: walk the wall from the gate round the south side to the first spot with room for it
    const south = Math.cos(aOut + 1) > Math.cos(aOut - 1) ? 1 : -1;
    const tr = FORT.r - 2.6;
    let tp = { x: fx, z: fz + tr };
    for (let a = 0.3; a < Math.PI; a += 0.05) {
      const q = { x: fx + Math.sin(aOut + south * a) * tr, z: fz + Math.cos(aOut + south * a) * tr };
      if (walkable(q.x, q.z, 2.2)) { tp = q; break; }
    }
    this.addSpawn('forest:fort_tower', { unit: 'prop', id: H ? 'fort_tower_orc' : 'fort_tower_human' }, tp.x, tp.z, 'forest', 0, aIn - 0.4);
    this.obstacles.push({ x: tp.x, z: tp.z, r: BREAKABLES[H ? 'fort_tower_orc' : 'fort_tower_human'].r });
    const aFar = trailExit(fx, fz, FORT.r + 1.5, false);
    const ex = fx + Math.sin(aFar) * (FORT.r + 1.5);
    const ez = fz + Math.cos(aFar) * (FORT.r + 1.5);
    const dir = pathAt(progressAt(ex, ez));
    Object.assign(this.fortExit, { x: ex, z: ez, tx: dir.tx, tz: dir.tz });
    deco(H ? 'orc_beam_pile' : 'wood_pile_big', -9.5, 4.5, 0.5, 0.6);
    deco(H ? 'orc_wood_pile_small' : 'wood_pile_small', 9.8, -2, 0.65, 1.1);
    deco(H ? 'orc_box_large_2' : 'box_large_2', 9.2, 4, 0.8, 0.3, 0.6);
    deco(H ? 'orc_barrel' : 'barrel', 10.2, 5.3, 0.8, 0.3, 0.5);
    deco(H ? 'orc_head_lantern' : 'lantern_street', -4, -9, 0.45, 0, 0.3);
    deco(H ? 'orc_head_lantern' : 'lantern_street', 4, -9, 0.45, 0, 0.3);
    this.bosses.push({ mob: 'bandit_chief', x: fx, z: fz });
    this.packCenters.push([fx, fz]);

    // Stepping stones on the trail
    const stones: Inst[] = [];
    for (let s = 2; s < GATE.s - 3; s += 2.6 + r() * 1.5) {
      const p = pathAt(s);
      if (Math.hypot(p.x - fx, p.z - fz) < FORT.r + 1) continue;
      const off = (r() - 0.5) * PATH_W * 0.5;
      stones.push({ x: p.x + p.tz * off, z: p.z - p.tx * off, s: 0.2 + r() * 0.1, r: r() * 6, y: 0.01 });
    }
    this.scatter('elf_rock_small', stones, false);

    // Trees, bushes and boulders one by one, evenly spread (no clumps), off the trail, mobs and the fort.
    const trees: Inst[] = [];
    const tall: Inst[] = [];
    const bushes: Inst[] = [];
    const rocks: Inst[] = [];
    const inForest = (x: number, z: number) => zoneIdAt(x, z) === 'forest';
    const open = (x: number, z: number) =>
      inForest(x, z) && !inCamp(x, z, 3) && this.free(x, z, 1, true) && !this.nearPack(x, z, 5) && Math.hypot(x - fx, z - fz) > FORT.r + 4;
    const randomSpot = () => {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * 56;
      return { x: ISLAND.cx + Math.sin(a) * d, z: ISLAND.cz + Math.cos(a) * d };
    };
    // the old fort clearing (north-west) is grown over with a denser wood
    const woodSpot = () => {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * 14;
      return { x: -22 + Math.sin(a) * d, z: -75 + Math.cos(a) * d };
    };
    for (const { x, z } of [...this.spread(85, 7, randomSpot, open), ...this.spread(16, 4.5, woodSpot, open)]) {
      const t = r();
      if (t < 0.5) {
        trees.push({ x, z, s: 0.55 + r() * 0.35, r: r() * 6, tint: leaf(r) });
        this.obstacles.push({ x, z, r: 0.5 });
      } else if (t < 0.7) {
        tall.push({ x, z, s: 0.5 + r() * 0.3, r: r() * 6, tint: leaf(r) });
        this.obstacles.push({ x, z, r: 0.55 });
      } else if (t < 0.88) {
        const s = 0.16 + r() * 0.12;
        bushes.push({ x, z, s, r: r() * 6, y: 1.0 * s });
        this.obstacles.push({ x, z, r: 2.4 * s });
      } else {
        const s = 0.3 + r() * 0.3;
        rocks.push({ x, z, s, r: r() * 6 });
        this.obstacles.push({ x, z, r: 1.1 * s });
      }
    }
    // Some of the trees become static units (FOREST_TREES): by the trail where the hero passes, well apart;
    // a looser second pass fills the list when the strict one finds too few.
    const statics: Inst[] = [];
    // (pathDist reads 99 once the trail is out of its grid cells: 99 = "anywhere it still sees the trail")
    for (const [near, gap] of [[12, 12], [99, 9], [99, 6]]) {
      for (const t of trees) {
        if (statics.length >= FOREST_TREES.length) break;
        const d = pathDist(t.x, t.z);
        if (statics.includes(t) || d <= PATH_W + 2 || d >= near || statics.some((o) => Math.hypot(o.x - t.x, o.z - t.z) < gap)) continue;
        statics.push(t);
      }
    }
    statics.forEach((t, i) => {
      this.addSpawn(`forest:tree:${i}`, FOREST_TREES[i], t.x, t.z, 'forest', 0, t.r ?? 0);
      // the unit itself stands in the way while it lives; a felled tree leaves no invisible trunk behind
      const k = this.obstacles.findIndex((o) => o.x === t.x && o.z === t.z);
      if (k >= 0) this.obstacles.splice(k, 1);
    });
    this.scatter('elf_tree', trees.filter((t) => !statics.includes(t)));
    this.scatter('elf_foliage_small', tall);
    this.scatter('elf_foliage_mid', bushes);
    this.scatter('orc_stone_big', rocks.map((k) => ({ ...k, s: k.s * 2.6 })));
    // roots and stumps (decor, no collision)
    this.scatter('elf_tree_root_1', this.spread(20, 6, randomSpot, open).map(({ x, z }) => ({ x, z, s: 0.3 + r() * 0.2, r: r() * 6 })), false);

    // Breakables: single barrels/boxes/bushes beside the trail, well apart
    const nearTrail = () => {
      const p = pathAt(s0 - 6 + r() * (GATE.s - s0));
      const off = (r() < 0.5 ? -1 : 1) * (PATH_W + 1 + r() * 2);
      return { x: p.x + p.tz * off, z: p.z - p.tx * off };
    };
    const okProp = (x: number, z: number) =>
      inForest(x, z) && !inCamp(x, z, 2) && Math.hypot(x - fx, z - fz) > FORT.r + 2 && this.free(x, z, 1) && pathDist(x, z) > PATH_W + 0.5;
    const list = PROP_SPAWNERS.forest;
    this.spread(list.length, 6, nearTrail, okProp, true).forEach(({ x, z }, i) => this.addProp('forest', i, list[i], x, z, 'forest', r() * 6));
  }

  // ---------- rocky ridges round every location, a barrier in every passage ----------
  private buildBarrier() {
    const shader = {
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `varying vec2 vUv; uniform float t; uniform float a;
        void main(){
          float s = sin(vUv.x*40.0 + t*3.0)*0.5+0.5;
          float r = sin(vUv.y*18.0 - t*4.0 + vUv.x*8.0)*0.5+0.5;
          float edge = smoothstep(0.0,0.15,vUv.y)*(1.0-smoothstep(0.7,1.0,vUv.y));
          vec3 c = mix(vec3(0.55,0.25,1.0), vec3(0.9,0.7,1.0), s*r);
          gl_FragColor = vec4(c, (0.35+0.45*s*r)*edge*a);
        }`,
    };
    for (const G of GATES) {
      const N = { x: G.tz, z: -G.tx }; // across the passage
      const rot = Math.atan2(G.tx, G.tz);
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { t: this.time, a: { value: 1 } }, ...shader,
      });
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 4.2), mat);
      wall.position.set(G.x + G.tx * 1.2, 2.1, G.z + G.tz * 1.2);
      wall.rotation.y = rot;
      this.group.add(wall);
      const obstacles: Obstacle[] = [];
      for (let k = -2.8; k <= 2.81; k += 0.8) obstacles.push({ x: G.x + G.tx * 1.2 + N.x * k, z: G.z + G.tz * 1.2 + N.z * k, r: 0.7 });
      this.gates.push({ def: G, mesh: wall, mat, obstacles, open: false });
      // The bone gate (the project's gate model), its posts collide; the barrier fills its opening.
      const gx = G.x + G.tx * 1.2;
      const gz = G.z + G.tz * 1.2;
      this.place('undead_tusk_gate', gx, gz, 1.15, rot + Math.PI, 0);
      this.obstacles.push({ x: gx - N.x * 3.7, z: gz - N.z * 3.7, r: 0.9 }, { x: gx + N.x * 3.7, z: gz + N.z * 3.7, r: 0.9 });
      // Lamp posts on both sides of the gate, offset so each side shows a pair
      for (const k of [-1, 1]) {
        for (const f of [-2.4, 4.6]) {
          const x = G.x + G.tx * f + N.x * k * 4.6;
          const z = G.z + G.tz * f + N.z * k * 4.6;
          if (walkable(x, z, 0.2) && pathDist(x, z) > 1.5) this.place('undead_lamp_post', x, z, 0.6, rot, 0.3);
        }
      }
      // Stepping stones through the opening (the cemetery trail already has its own)
      if (G.id !== 'forest-cemetery') {
        const stones: Inst[] = [];
        for (let f = -6; f <= 7; f += 1.7) {
          const off = (((f * 7.13) % 1) - 0.5) * 0.5;
          stones.push({ x: G.x + G.tx * f + N.x * off, z: G.z + G.tz * f + N.z * off, s: 0.24, r: f * 2.1, y: 0.01 });
        }
        this.gateStones.push(...stones);
      }
    }

    // The ridges: two overlapping rows of collision circles, boulders on top, trees on either side
    // (dead ones on the cemetery side). Gaps are left at the passages.
    const r = rng(5);
    const trees: Inst[] = [];
    const dead: Inst[] = [];
    const boulders: Inst[] = [];
    for (const { x, z, nx, nz } of RIDGE_POINTS) {
      if (coastDist(x, z) < -2) continue;
      if (gateDist(x, z) < 5.5) continue;
      for (const k of [-1, 1]) this.obstacles.push({ x: x + nx * k, z: z + nz * k, r: 1.4 });
      boulders.push({ x: x + (r() - 0.5) * 1.6, z: z + (r() - 0.5) * 1.6, s: 0.5 + r() * 0.35, r: r() * 6 });
      for (const side of [-1, 1]) {
        if (r() > 0.3) continue;
        const d = 3.6 + r() * 1.5;
        const tx = x + nx * side * d;
        const tz = z + nz * side * d;
        if (!walkable(tx, tz, 0.3) || inCamp(tx, tz, 2) || pathDist(tx, tz) < 2) continue;
        if (zoneIdAt(tx, tz) === 'cemetery') {
          dead.push({ x: tx, z: tz, s: 0.9 + r() * 0.4, r: r() * 6 });
          this.obstacles.push({ x: tx, z: tz, r: 0.45 });
        } else {
          trees.push({ x: tx, z: tz, s: 0.55 + r() * 0.25, r: r() * 6, tint: leaf(r) });
          this.obstacles.push({ x: tx, z: tz, r: 0.5 });
        }
      }
    }
    this.scatter('elf_tree', trees);
    this.deadTrees(dead);
    this.scatter('orc_stone_big', boulders.map((k) => ({ ...k, s: k.s * 2.4 })));
    this.scatter('elf_rock_small', this.gateStones, false);
  }

  // ---------- cemetery: the eastern sector of the ring, behind the ridge ----------
  private buildCemetery() {
    const r = rng(41);
    const sArena = progressAt(ARENA.x, ARENA.z);
    const s0 = GATE.s + 12;
    const s1 = sArena - ARENA.r - 3;
    const pol = (deg: number, d: number) => ({ x: ISLAND.cx + Math.sin((deg * Math.PI) / 180) * d, z: ISLAND.cz + Math.cos((deg * Math.PI) / 180) * d });
    // Areas: the village and the chapel are built first and kept clear of trail mobs; their specials stand pinned in the centre
    const pins: Record<string, [number, number]> = {};
    const area: Record<string, { x: number; z: number }> = {};
    for (const a of CEMETERY_AREAS) {
      const p = (area[a.id] = pol(a.deg, a.d));
      this.areas.push({ name: a.name, x: p.x, z: p.z, r: a.r });
      if (a.pin) pins[a.pin] = [p.x, p.z];
      if (a.id !== 'field') this.keepOut.push([p.x, p.z, a.r]);
    }
    this.areas.push({ name: 'Арена Смерти', x: ARENA.x, z: ARENA.z, r: ARENA.r });
    this.abandonedVillage(area.village.x, area.village.z, r);
    this.chapelRuins(area.chapel.x, area.chapel.z, r);
    this.mobsAlong([[s0, s1]], SPAWNERS.cemetery ?? [], 'cemetery', r, pins);

    // Mausoleums, crypts and ruins, by angle (deg) and radius in the cemetery sector (slid inside the shore if needed)
    const ins = (name: string, deg: number, d: number, scale: number, rot: number, pad = 3, collide: number | 'auto' = 'auto') => {
      const p = pol(deg, d);
      this.placeInside(name, p.x, p.z, scale, rot, pad, collide);
    };
    ins('undead_house_tower', 65, 85, 0.5, 0.4);
    ins('undead_tower_small', 100, 64, 0.55, -Math.PI / 2);
    ins('undead_smithy_house', 68, 62, 0.5, Math.PI / 2);
    ins('undead_building', 116, 68, 0.5, -Math.PI / 2);
    ins('undead_tower', 80, 96, 0.55, 0.4);
    ins('undead_wheel_of_pain', 96, 64, 0.45, -0.5);
    ins('undead_cauldron', 62, 74, 0.55, 0, 2, 0.8);
    ins('undead_flag', 87, 76, 0.6, 0, 2, 0.3);
    ins('undead_ruins_01', 110, 64, 0.45, r() * 6);
    ins('undead_column_1', 78, 66, 0.5, r() * 6);
    ins('undead_column_1', 118, 92, 0.5, r() * 6);
    // Windmill and a tower on the eastern cliffs
    let best = -1;
    let hillA = 1.6;
    for (let a = 1.05; a < 2.1; a += 0.02) if (rimCliff(a) > best) { best = rimCliff(a); hillA = a; }
    const hill = edgePoint(hillA, -3.5);
    this.place('undead_windmill', hill.x, hill.z, 0.8, hillA + Math.PI, 0);
    const hill2 = edgePoint(hillA > 1.6 ? 1.15 : 2.0, -3);
    this.place('undead_tower_Lv2', hill2.x, hill2.z, 0.6, -0.8, 0);

    // Fences beside the trail, lamp posts along it
    for (let s = s0 - 6, i = 0; s < s1; s += 4.4, i++) {
      const p = pathAt(s);
      const rot = Math.atan2(p.tx, p.tz) + Math.PI / 2;
      for (const side of [-1, 1]) {
        if (r() < 0.6) continue;
        const x = p.x + p.tz * side * 4;
        const z = p.z - p.tx * side * 4;
        if (walkable(x, z, 0.5) && pathDist(x, z) > 3) this.place('undead_fence', x, z, 0.55, rot, 0);
      }
    }
    for (let s = GATE.s + 4, i = 0; s < sArena - ARENA.r; s += 12, i++) {
      const p = pathAt(s);
      const side = i % 2 ? 1 : -1;
      const x = p.x + p.tz * side * 2.2;
      const z = p.z - p.tx * side * 2.2;
      if (this.free(x, z, 0.4)) this.place('undead_lamp_post', x, z, 0.6, 0, 0.3);
    }

    // Boss arena: throne, floating stones and a ring of columns; the opening faces the incoming trail
    const ax = ARENA.x;
    const az = ARENA.z;
    const aIn = trailExit(ax, az, ARENA.r, false);
    const at = (side: number, fwd: number) => local(ax, az, aIn, side, fwd);
    let p = at(0, -13);
    this.place('undead_throne_Lv1', p.x, p.z, 0.55, aIn);
    p = at(0, -6.5);
    this.place('undead_throne', p.x, p.z, 1.1, aIn, 0.9);
    for (const sx of [-1, 1]) {
      p = at(sx * 12, 5);
      this.place('undead_floating_stone', p.x, p.z, 0.6, aIn + sx, 1);
      p = at(sx * 12.5, -6);
      this.place('undead_floating_coffin', p.x, p.z, 0.5, aIn + sx * 0.5, 1);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.5) continue; // opening toward the trail
      p = at(Math.sin(a) * ARENA.r, Math.cos(a) * ARENA.r);
      this.place('undead_column_2', p.x, p.z, 0.5, aIn + a, 'auto');
    }
    for (const sx of [-1, 1]) {
      p = at(sx * 4, ARENA.r + 3);
      if (this.free(p.x, p.z, 0.5)) this.place('undead_obelisk', p.x, p.z, 0.8, r() * 6);
    }
    this.group.add(buildRitual(ax, az, ARENA.r - 2.5, this.time));
    this.bosses.push({ mob: 'death', x: ax, z: az });
    this.packCenters.push([ax, az]);
    const nearArena = (x: number, z: number) => Math.hypot(x - ax, z - az) < ARENA.r + 1.5;

    // Graves: single breakable tombstones and coffins beside the trail, and a few in the southern dead end
    const inCem = (x: number, z: number) => zoneIdAt(x, z) === 'cemetery';
    const okGrave = (x: number, z: number) => inCem(x, z) && !nearArena(x, z) && this.free(x, z, 1) && pathDist(x, z) > 3;
    const besideTrail = () => {
      const q = pathAt(GATE.s + 6 + r() * (sArena - ARENA.r - GATE.s - 6));
      const off = (r() < 0.5 ? -1 : 1) * (5 + r() * 9);
      return { x: q.x + q.tz * off, z: q.z - q.tx * off };
    };
    const graves = (group: 'cemetery' | 'cemeteryField', at: () => { x: number; z: number }) => {
      const list = PROP_SPAWNERS[group];
      this.spread(list.length, 6, at, okGrave, true).forEach(({ x, z }, i) => this.addProp(group, i, list[i], x, z, 'cemetery', Math.PI + (r() - 0.5) * 0.4));
    };
    graves('cemetery', besideTrail);
    graves('cemeteryField', () => pol(100 + r() * 20, 64 + r() * 22));
    // Old grave field (the gravedigger's): a broken fence round it, a big bone and his wood pile
    const F = area.field;
    for (let i = 0; i < 16; i++) {
      if (r() < 0.35) continue;
      const a = (i / 16) * Math.PI * 2;
      const x = F.x + Math.sin(a) * 11;
      const z = F.z + Math.cos(a) * 11;
      if (inCem(x, z) && walkable(x, z, 0.5) && pathDist(x, z) > 3 && !nearArena(x, z)) {
        const f = this.place('undead_fence', x, z, 0.55, a + Math.PI / 2, 0);
        if (f) f.rotation.z = (r() - 0.5) * 0.4;
      }
    }
    this.place('undead_wood_pile', F.x - 3, F.z + 2.5, 0.5, r() * 6, 0.6);
    if (this.free(F.x + 4, F.z - 3, 1)) this.place('undead_big_bone', F.x + 4, F.z - 3, 0.45, r() * 6, 0.5);
    // Decorative old graves, bones and dead trees, evenly spread
    const old: Inst[] = [];
    const bones: Inst[] = [];
    const deadTrees: Inst[] = [];
    const anywhere = () => {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * 110;
      return { x: ISLAND.cx + Math.sin(a) * d, z: ISLAND.cz + Math.cos(a) * d };
    };
    const okDecor = (x: number, z: number) => inCem(x, z) && this.free(x, z, 1.4, true) && !this.nearPack(x, z, 4) && !nearArena(x, z);
    for (const { x, z } of this.spread(55, 6, anywhere, okDecor)) {
      const k = r();
      if (k < 0.4) old.push({ x, z, s: 0.55 + r() * 0.2, r: Math.PI + (r() - 0.5) * 0.6 });
      else if (k < 0.7) bones.push({ x, z, s: 0.3 + r() * 0.2, r: r() * 6 });
      else {
        deadTrees.push({ x, z, s: 0.8 + r() * 0.4, r: r() * 6 });
        this.obstacles.push({ x, z, r: 0.45 });
      }
    }
    this.scatter('undead_tomb_stone_5', old.filter((_, i) => i % 2 === 0));
    this.scatter('undead_tomb_stone_6', old.filter((_, i) => i % 2 === 1));
    this.scatter('undead_ground_bone_1', bones.filter((_, i) => i % 3 === 0), false);
    this.scatter('undead_ground_bone_2', bones.filter((_, i) => i % 3 === 1), false);
    this.scatter('undead_ground_bone_3', bones.filter((_, i) => i % 3 === 2), false);
    this.deadTrees(deadTrees);
  }

  /**
   * Abandoned human village at the cemetery's entrance (CEMETERY_AREAS.village): dark, greyed houses round a square
   * with a well, broken fences and dead lanterns; the square (its centre) is left for the looter elite.
   */
  private abandonedVillage(cx: number, cz: number, r: () => number) {
    const houses: [string, number, number][] = [
      ['human_house_small', 0.2, 8.5], ['house_Lv1', 1.5, 9], ['human_house_mid', 2.9, 8.5], ['human_house_small', 4.1, 8], ['house_Lv1', 5.3, 9],
    ];
    for (const [name, a, d] of houses) {
      // each house faces the square
      const m = this.place(name, cx + Math.sin(a) * d, cz + Math.cos(a) * d, 0.5, a + Math.PI + (r() - 0.5) * 0.3);
      if (m) ruinLook(m);
    }
    const w = this.place('elf_well', cx + 3.5, cz - 2, 0.36, 0.4, 1.1);
    if (w) ruinLook(w);
    this.place('undead_wood_pile', cx - 3.8, cz + 3.2, 0.5, 0.8, 0.6);
    // broken fence: pieces of a ring with gaps, some tilted
    for (let i = 0; i < 14; i++) {
      if (r() < 0.4) continue;
      const a = (i / 14) * Math.PI * 2;
      const x = cx + Math.sin(a) * 12.5;
      const z = cz + Math.cos(a) * 12.5;
      if (!walkable(x, z, 0.5) || pathDist(x, z) < 3) continue;
      const f = this.place('undead_fence', x, z, 0.55, a + Math.PI / 2, 0);
      if (f) f.rotation.z = (r() - 0.5) * 0.5;
    }
    for (const a of [1.0, 3.6]) {
      const m = this.place('lantern_street', cx + Math.sin(a) * 5.5, cz + Math.cos(a) * 5.5, 0.6, a, 0.3);
      if (m) { ruinLook(m); m.rotation.x = (r() - 0.5) * 0.25; }
    }
  }

  /** Chapel ruins (CEMETERY_AREAS.chapel): the oracle behind, ruined walls at the sides, a ring of columns and bones. */
  private chapelRuins(cx: number, cz: number, r: () => number) {
    // face the trail
    const p = pathAt(progressAt(cx, cz));
    const a = Math.atan2(p.x - cx, p.z - cz);
    const at = (side: number, fwd: number) => local(cx, cz, a, side, fwd);
    let q = at(0, -6);
    this.place('undead_oracle_Lv1', q.x, q.z, 0.5, a);
    for (const s of [-1, 1]) {
      q = at(s * 6, -2);
      this.place(s < 0 ? 'undead_ruins_01' : 'undead_ruins_02', q.x, q.z, 0.45, a + s * 1.2);
    }
    for (let i = 0; i < 6; i++) {
      const b = (i / 6) * Math.PI * 2 + Math.PI / 6;
      if (Math.cos(b) > 0.7) continue; // opening toward the trail
      q = at(Math.sin(b) * 8.5, Math.cos(b) * 8.5);
      if (r() < 0.25) continue; // fallen
      this.place('undead_column_1', q.x, q.z, 0.5, r() * 6);
    }
    q = at(0, 3.5);
    this.place('undead_obelisk', q.x, q.z, 0.6, a);
    const bones: Inst[] = [];
    for (let i = 0; i < 10; i++) {
      const b = r() * Math.PI * 2;
      const d = 2 + r() * 6;
      bones.push({ x: cx + Math.sin(b) * d, z: cz + Math.cos(b) * d, s: 0.3 + r() * 0.2, r: r() * 6 });
    }
    this.scatter('undead_bones_remains', bones, false);
  }

  // ---------- outer locations: mobs along their paths, a main boss, «Свирепый вожак» mini-bosses, Snow Pass trees ----------
  private buildOuterLands() {
    const r = rng(61);
    const PATH_OF: Partial<Record<ZoneId, number>> = { hills: 0, grove: 1, swamp: 2, dunes: 3 };
    const BOSS_OF: Partial<Record<ZoneId, string>> = { peaks: 'elf_queen', hills: 'orc_shaman', grove: 'elf_priestess', swamp: 'murloc_king', dunes: 'sand_boar' };
    for (const zone of ['hills', 'grove'] as const) {
      const line = LAND_TRAILS[PATH_OF[zone]!];
      const seg = line.slice(1).map((p, i) => Math.hypot(p[0] - line[i][0], p[1] - line[i][1]));
      const total = seg.reduce((a, b) => a + b, 0);
      const at = (d: number) => {
        let i = 0;
        while (i < seg.length - 1 && d > seg[i]) d -= seg[i++];
        const k = Math.min(1, d / seg[i]);
        const [x0, z0] = line[i];
        const [x1, z1] = line[i + 1];
        return { x: x0 + (x1 - x0) * k, z: z0 + (z1 - z0) * k, tx: (x1 - x0) / seg[i], tz: (z1 - z0) / seg[i] };
      };
      this.mobsOnCurve(total, at, SPAWNERS[zone] ?? [], zone, r);
    }
    for (const land of LAND_BOSSES) {
      if (land.boss) {
        const p = this.spotIn(land.zone, land.boss[0], land.boss[1], 4);
        this.bosses.push({ mob: BOSS_OF[land.zone]!, x: p.x, z: p.z });
        this.packCenters.push([p.x, p.z]);
        if (land.zone === 'peaks') this.frozenOutpost(p.x, p.z);
      }
      land.minis.forEach(([x0, z0], i) => {
        const p = this.spotIn(land.zone, x0, z0, 3);
        this.packCenters.push([p.x, p.z]);
        this.addSpawn(`mini:${land.zone}:${i}`, MINI_SPAWNER_OF[land.zone] ?? MINI_SPAWNER, p.x, p.z, land.zone, 0, 0);
      });
      (LAND_ELITES[land.zone] ?? []).forEach((e, i) => {
        const p = this.spotIn(land.zone, e.x, e.z, 3);
        this.packCenters.push([p.x, p.z]);
        this.taken.push([p.x, p.z]);
        this.addSpawn(`elite:${land.zone}:${i}`, e.def, p.x, p.z, land.zone, 0, 0);
      });
    }
    this.snowMobs(r);
    this.snowProps(r);
    this.snowBeasts(r);
    this.dunesPresets();
    this.dressOuterLands(r);
  }

  /** One pack of each spawn preset (config SPAWN_PRESETS) on the empty dunes, as a showcase. */
  private dunesPresets() {
    const r = rng(53);
    const spots: [SpawnPresetId, number, number][] = [['archer_escort', 35, 25], ['flankers', 60, 25], ['growing', 90, 35], ['skirmishers', 45, 65], ['horde', 30, 85], ['horde_mixed', 100, 62]];
    for (const [id, x0, z0] of spots) {
      const c = this.spotIn('dunes', x0, z0, 3);
      const preset: SpawnPreset = SPAWN_PRESETS[id];
      const p = preset.pack;
      const at = preset.horde === 'scatter' ? this.scatterSpots(c.x, c.z, p.slots.length, 7, r)
        : ringSpots(c.x, c.z, p.slots.length, preset.horde ? 3.5 : 1.8);
      this.packCenters.push([c.x, c.z]);
      for (const q of at) this.taken.push([q.x, q.z]);
      this.addPack(`dunes:preset:${id}`, p, at, 'dunes', 0);
      this.presets.push({ id, x: c.x, z: c.z });
    }
  }

  /** n random walkable spots within `radius` of (x, z), clear of its middle (a teleport lands there) and of each other. */
  private scatterSpots(x: number, z: number, n: number, radius: number, r: () => number) {
    const out: { x: number; z: number }[] = [];
    for (let t = 0; out.length < n && t < n * 40; t++) {
      const a = r() * Math.PI * 2;
      // sqrt: even spread over the disc, not bunched at the middle
      const d = 2 + Math.sqrt(r()) * (radius - 2);
      const q = { x: x + Math.sin(a) * d, z: z + Math.cos(a) * d };
      let near = false;
      for (const o of out) if (Math.hypot(o.x - q.x, o.z - q.z) < 1.4) near = true;
      if (!near && walkable(q.x, q.z, 1)) out.push(q);
    }
    while (out.length < n) out.push({ x: x + 2, z });
    return out;
  }

  /** Distance to the Snow Pass roads (its trail, the side branch and the abandoned path from the arena). */
  private snowRoadDist(x: number, z: number) {
    let best = Infinity;
    for (const line of SNOW_ROADS) {
      for (let i = 0; i < line.length - 1; i++) {
        const [ax, az] = line[i];
        const dx = line[i + 1][0] - ax;
        const dz = line[i + 1][1] - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
        best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
      }
    }
    return best;
  }

  /** Snow Pass mobs (config PEAKS_SPAWNERS): guards past the hub gate, sword packs on and beside the trail, lone assassins in the woods. */
  private snowMobs(r: () => number) {
    const g = GATES.find((t) => t.id === 'forest-peaks')!;
    // two either side of the road, the third behind their gap
    const guards: { x: number; z: number }[] = [];
    for (const side of [-1, 1, 0]) {
      const x = g.x + g.tx * (side ? 7 : 8.5) + g.tz * side * 2.6;
      const z = g.z + g.tz * (side ? 7 : 8.5) - g.tx * side * 2.6;
      guards.push({ x, z });
      this.packCenters.push([x, z]);
      this.taken.push([x, z]);
    }
    this.addPack('peaks:guards', PEAKS_SPAWNERS.guards, guards, 'peaks', 0);
    PEAKS_SPAWNERS.elites.forEach((e, i) => {
      const p = this.spotIn('peaks', e.x, e.z, 3);
      this.packCenters.push([p.x, p.z]);
      this.taken.push([p.x, p.z]);
      this.addSpawn(`peaks:elite:${i}`, e.def, p.x, p.z, 'peaks', 0, 0);
    });
    const line = LAND_TRAILS[4];
    const seg = line.slice(1).map((p, i) => Math.hypot(p[0] - line[i][0], p[1] - line[i][1]));
    const total = seg.reduce((a, b) => a + b, 0);
    const at = (d: number) => {
      let i = 0;
      while (i < seg.length - 1 && d > seg[i]) d -= seg[i++];
      const k = Math.min(1, d / seg[i]);
      const [x0, z0] = line[i];
      const [x1, z1] = line[i + 1];
      return { x: x0 + (x1 - x0) * k, z: z0 + (z1 - z0) * k, tx: (x1 - x0) / seg[i], tz: (z1 - z0) / seg[i] };
    };
    const okPack = (x: number, z: number) => zoneIdAt(x, z) === 'peaks' && walkable(x, z, 2) && gateDist(x, z) > 9 && !this.nearPack(x, z, 12);
    const packs = PEAKS_SPAWNERS.packs;
    packs.forEach((pack, i) => {
      // odd packs stand on the trail, even ones just beside it
      let c: { x: number; z: number } | null = null;
      for (const ds of [0, 5, -5, 10, -10]) {
        const p = at(Math.min(total, Math.max(0, ((i + 0.3 + r() * 0.4) / packs.length) * total + ds)));
        const off = i % 2 ? 0 : (r() < 0.5 ? -1 : 1) * (3 + r() * 2);
        const q = { x: p.x + p.tz * off, z: p.z - p.tx * off };
        if (okPack(q.x, q.z)) { c = q; break; }
      }
      if (!c) return;
      this.packCenters.push([c.x, c.z]);
      this.taken.push([c.x, c.z]);
      const a0 = r() * Math.PI * 2;
      const spots: { x: number; z: number }[] = [];
      for (let j = 0; j < pack.slots.length; j++) {
        const a = a0 + (j / pack.slots.length) * Math.PI * 2 + (r() - 0.5) * 0.8;
        const rr = 1.4 + r() * 1.2;
        spots.push({ x: c.x + Math.sin(a) * rr, z: c.z + Math.cos(a) * rr });
      }
      this.addPack(`peaks:pack:${i}`, pack, spots, 'peaks', 0);
    });
    const inPass = () => ({ x: MAP_BOX.x + r() * MAP_BOX.size, z: MAP_BOX.z + r() * MAP_BOX.size });
    const okLone = (x: number, z: number) => {
      const d = this.snowRoadDist(x, z);
      return zoneIdAt(x, z) === 'peaks' && walkable(x, z, 2) && d > 7 && d < 16 && gateDist(x, z) > 10 && !this.nearPack(x, z, 14);
    };
    this.spread(PEAKS_SPAWNERS.assassins.length, 16, inPass, okLone, true).forEach(({ x, z }, i) => {
      // not a pack centre: trees may grow close round them
      this.obstacles.push({ x, z, r: 1.2 });
      this.addSpawn(`peaks:lone:${i}`, PEAKS_SPAWNERS.assassins[i], x, z, 'peaks', 0, 0);
    });
    // the bear trio a few metres off the west mini-boss
    const [mx, mz] = LAND_BOSSES.find((b) => b.zone === 'peaks')!.minis[1];
    const mini = this.spotIn('peaks', mx, mz, 3);
    for (let t = 0; t < 24; t++) {
      const a = r() * Math.PI * 2;
      const x = mini.x + Math.sin(a) * 8;
      const z = mini.z + Math.cos(a) * 8;
      if (zoneIdAt(x, z) !== 'peaks' || !walkable(x, z, 2.5) || this.snowRoadDist(x, z) < 3) continue;
      this.packCenters.push([x, z]);
      this.taken.push([x, z]);
      this.addPack('peaks:bears', PEAKS_SPAWNERS.bears, ringSpots(x, z, PEAKS_SPAWNERS.bears.slots.length, 1.8, a), 'peaks', 0);
      break;
    }
    // attackable trees: one at a time along the trail, alternating sides, about a road's width off it
    const n = PEAKS_SPAWNERS.trees.length;
    PEAKS_SPAWNERS.trees.forEach((d, i) => {
      for (const ds of [0, 4, -4, 8, -8]) {
        const p = at(Math.min(total, Math.max(0, ((i + 0.5) / n) * total + ds + (r() - 0.5) * 6)));
        const side = i % 2 ? 1 : -1;
        const x = p.x + p.tz * side * 2.6;
        const z = p.z - p.tx * side * 2.6;
        if (zoneIdAt(x, z) !== 'peaks' || !this.free(x, z, 1) || this.nearPack(x, z, 6) || gateDist(x, z) < 8) continue;
        this.obstacles.push({ x, z, r: 0.8 });
        this.taken.push([x, z]);
        this.addSpawn(`peaks:tree:${i}`, d, x, z, 'peaks', 0, r() * 6);
        return;
      }
    });
  }

  /** Lone wolves and bears in the woods the props left empty. */
  private snowBeasts(r: () => number) {
    const inPass = () => ({ x: MAP_BOX.x + r() * MAP_BOX.size, z: MAP_BOX.z + r() * MAP_BOX.size });
    const ok = (x: number, z: number) => zoneIdAt(x, z) === 'peaks' && this.free(x, z, 2.5) && this.snowRoadDist(x, z) > 6
      && gateDist(x, z) > 10 && !this.nearPack(x, z, 12);
    this.spread(PEAKS_SPAWNERS.beasts.length, 14, inPass, ok, true).forEach(({ x, z }, i) => {
      this.packCenters.push([x, z]);
      this.addSpawn(`peaks:beast:${i}`, PEAKS_SPAWNERS.beasts[i], x, z, 'peaks', 0, 0);
    });
  }

  /**
   * Snow Pass props in clumps of uneven size and spacing (trees 1–4, rocks and stumps 1–3, snowy bushes 2–3),
   * kept off the roads by more than a road's width.
   */
  private snowProps(r: () => number) {
    const GREYS = [0xb4b8bd, 0xc6c9cc, 0xa3a8ae, 0xd3d5d7];
    const SNOW = [0xc9d0d6, 0xbcc4cb, 0xd2d7dc];
    const grey = () => GREYS[Math.floor(r() * GREYS.length)];
    const withered = () => WITHERED[Math.floor(r() * WITHERED.length)];
    const trees: Inst[] = [];
    const pines: Inst[] = [];
    const bare: Inst[] = [];
    const stumps: Inst[] = [];
    const rocks: Inst[] = [];
    const bigRocks: Inst[] = [];
    const logs: Inst[] = [];
    const bushes: Inst[] = [];
    const smallBushes: Inst[] = [];
    const inPass = () => ({ x: MAP_BOX.x + r() * MAP_BOX.size, z: MAP_BOX.z + r() * MAP_BOX.size });
    const ok = (clear: number, pad: number) => (x: number, z: number) => zoneIdAt(x, z) === 'peaks' && this.free(x, z, pad)
      && !this.nearPack(x, z, 5) && gateDist(x, z) > 7 && this.snowRoadDist(x, z) > clear;
    // `n` clumps spread minD…2·minD apart, each of `size` items `gap` metres from its first one
    const clumps = (n: number, minD: number, size: [number, number], gap: [number, number], fits: (x: number, z: number) => boolean,
      put: (x: number, z: number) => void) => {
      for (const c of this.spread(n, minD * (1 + r()), inPass, fits)) {
        put(c.x, c.z);
        const k = size[0] + Math.floor(r() * (size[1] - size[0] + 1));
        for (let i = 1; i < k; i++) {
          for (let t = 0; t < 8; t++) {
            const a = r() * Math.PI * 2;
            const d = gap[0] + r() * (gap[1] - gap[0]);
            const x = c.x + Math.sin(a) * d;
            const z = c.z + Math.cos(a) * d;
            if (fits(x, z)) { put(x, z); break; }
          }
        }
      }
    };
    clumps(34, 5, [1, 4], [2.2, 5], ok(4, 1.2), (x, z) => {
      const k = r();
      if (k < 0.35) trees.push({ x, z, s: 0.5 + r() * 0.45, r: r() * 6, tint: withered() });
      else if (k < 0.78) pines.push({ x, z, s: 0.8 + r() * 0.55, r: r() * 6, tint: grey() });
      else bare.push({ x, z, s: 0.7 + r() * 0.5, r: r() * 6 });
      this.obstacles.push({ x, z, r: 0.5 });
    });
    clumps(26, 4, [1, 3], [1.2, 3.5], ok(3, 0.8), (x, z) => {
      const k = r();
      const it = { x, z, s: 0, r: r() * 6, tint: grey() };
      if (k < 0.3) stumps.push({ ...it, s: 0.25 + r() * 0.25 });
      else if (k < 0.72) rocks.push({ ...it, s: 0.5 + r() * 0.6 });
      else if (k < 0.9) { bigRocks.push({ ...it, s: 0.45 + r() * 0.4 }); this.obstacles.push({ x, z, r: 1 }); }
      else { logs.push({ ...it, s: 0.45 + r() * 0.15 }); this.obstacles.push({ x, z, r: 0.8 }); }
    });
    clumps(40, 3, [2, 3], [0.8, 1.8], ok(2.6, 0.6), (x, z) => {
      const it = { x, z, s: 0, r: r() * 6, tint: SNOW[Math.floor(r() * SNOW.length)] };
      if (r() < 0.6) bushes.push({ ...it, s: 0.6 + r() * 0.5 });
      else smallBushes.push({ ...it, s: 0.7 + r() * 0.6 });
      this.obstacles.push({ x, z, r: 0.3 });
    });
    this.scatter('elf_tree', trees);
    this.pines(pines);
    this.deadTrees(bare, 0x6e6a66);
    this.scatter('elf_tree_root_1', stumps, false);
    this.scatter('elf_rock_small', rocks, false);
    this.scatter('elf_rock_big', bigRocks);
    this.scatter('elf_log_pile', logs);
    this.scatter('elf_foliage_mid', bushes, true, { snow: true });
    this.scatter('elf_foliage_small', smallBushes, false, { snow: true });
  }

  /**
   * The placeholder locations get a look of their own (decor only; trunks, rocks and logs collide): an autumn wood in
   * the grove, murky pools with reeds and lily pads, swamp trees and snags in the swamp, bleached rocks, dry scrub
   * and bones in the dunes, boulders and pines on the hills. Everything keeps off their paths, packs and passages.
   */
  private dressOuterLands(r: () => number) {
    const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
    const anywhere = () => ({ x: MAP_BOX.x + r() * MAP_BOX.size, z: MAP_BOX.z + r() * MAP_BOX.size });
    const room = (zone: ZoneId, pad: number, gap = 3.5) => (x: number, z: number) => zoneIdAt(x, z) === zone && this.free(x, z, pad)
      && !this.nearPack(x, z, 5) && gateDist(x, z) > 7 && landTrailDist(x, z) > gap;
    const tree = (list: Inst[], x: number, z: number, tint: number) => {
      list.push({ x, z, s: 0.55 + r() * 0.35, r: r() * 6, tint });
      this.obstacles.push({ x, z, r: 0.5 });
    };
    const bush = (list: Inst[], x: number, z: number, tint?: number) => {
      const s = 0.16 + r() * 0.12;
      list.push({ x, z, s, r: r() * 6, y: 1.0 * s, tint });
      this.obstacles.push({ x, z, r: 2.4 * s });
    };
    /** A boulder of scale s; `cr`: its collision radius, `k`: tint brightness. */
    const rock = (list: Inst[], x: number, z: number, s: number, cr: number, tint?: number, k = 1) => {
      list.push({ x, z, s, r: r() * 6, tint, k });
      this.obstacles.push({ x, z, r: cr });
    };

    // Autumn grove: orange, red and gold crowns, leafy scrub, stumps and fallen logs
    const AUTUMN = [0xff8a30, 0xffb040, 0xe85a28, 0xd8402a, 0xffd050, 0xc86a20];
    const gTrees: Inst[] = [], gBush: Inst[] = [], stumps: Inst[] = [], logs: Inst[] = [];
    for (const { x, z } of this.spread(90, 6, anywhere, room('grove', 1.2))) {
      const k = r();
      if (k < 0.62) tree(gTrees, x, z, pick(AUTUMN));
      else if (k < 0.86) bush(gBush, x, z, pick(AUTUMN));
      else if (k < 0.94) stumps.push({ x, z, s: 0.3 + r() * 0.2, r: r() * 6 });
      else { logs.push({ x, z, s: 0.5 + r() * 0.2, r: r() * 6 }); this.obstacles.push({ x, z, r: 0.8 }); }
    }
    this.scatter('elf_tree', gTrees, true, { recolor: true });
    this.scatter('elf_foliage_mid', gBush, true, { recolor: true });

    // Swamp: pools with reeds and lily pads, olive trees, snags, mossy logs and stones
    const MURK = [0x5e7030, 0x4e6229, 0x6a6e34, 0x445a26];
    const sTrees: Inst[] = [], sBush: Inst[] = [], snags: Inst[] = [], sRocks: Inst[] = [];
    for (const { x, z } of this.spread(70, 5.5, anywhere, room('swamp', 1.2))) {
      const k = r();
      if (k < 0.4) tree(sTrees, x, z, pick(MURK));
      else if (k < 0.62) { snags.push({ x, z, s: 0.8 + r() * 0.5, r: r() * 6 }); this.obstacles.push({ x, z, r: 0.45 }); }
      else if (k < 0.8) bush(sBush, x, z, pick(MURK));
      else if (k < 0.9) { logs.push({ x, z, s: 0.5 + r() * 0.2, r: r() * 6 }); this.obstacles.push({ x, z, r: 0.8 }); }
      else sRocks.push({ x, z, s: 0.4 + r() * 0.3, r: r() * 6, tint: 0x8a9a70 });
    }
    this.scatter('elf_tree', sTrees, true, { recolor: true });
    this.scatter('elf_foliage_mid', sBush, true, { recolor: true });
    this.deadTrees(snags, 0x4e5240);
    this.scatter('elf_rock_small', sRocks, false);
    const reeds: Inst[] = [];
    const pads: Inst[] = [];
    // (the forest pond gets a few too, greener)
    for (const p of this.ponds) {
      for (let k = 0; k < (p.murky ? 18 : 9); k++) {
        const a = r() * Math.PI * 2;
        const d = pondR(p, a) * (0.86 + r() * 0.24);
        const x = p.x + Math.sin(a) * d;
        const z = p.z + Math.cos(a) * d;
        reeds.push({ x, z, s: 0.7 + r() * 0.6, r: r() * 6, tint: pick(p.murky ? [0x6a7a34, 0x7e8a3c, 0x8a7a40] : [0x5a8a34, 0x6a9a3c, 0x78903e]) });
      }
      for (let k = 0; k < (p.murky ? 9 : 4); k++) {
        const a = r() * Math.PI * 2;
        const d = Math.sqrt(r()) * pondR(p, a) * 0.7;
        pads.push({ x: p.x + Math.sin(a) * d, z: p.z + Math.cos(a) * d, s: 0.7 + r() * 0.6, r: r() * 6, y: 0.055, tint: pick([0x4e8a36, 0x5e9a3e, 0x6aa040]) });
      }
    }
    this.reeds(reeds);
    this.lilyPads(pads);

    // Dunes: sun-bleached boulders and stones, dry scrub, white snags and old bones
    const SAND_ROCK = [0xe8d0a0, 0xd8c090, 0xf0dcb0];
    const dRocks: Inst[] = [], dSmall: Inst[] = [], scrub: Inst[] = [], bleached: Inst[] = [], bones: Inst[] = [];
    for (const { x, z } of this.spread(70, 6, anywhere, room('dunes', 1.2))) {
      const k = r();
      if (k < 0.3) { const s = 0.45 + r() * 0.35; rock(dRocks, x, z, s, 1.6 * s, pick(SAND_ROCK), 2.1); }
      else if (k < 0.5) dSmall.push({ x, z, s: 0.5 + r() * 0.5, r: r() * 6, tint: pick(SAND_ROCK), k: 1.8 });
      else if (k < 0.75) bush(scrub, x, z, pick([0xc8a048, 0xb89040, 0xd8b860]));
      else if (k < 0.88) { bleached.push({ x, z, s: 0.7 + r() * 0.4, r: r() * 6 }); this.obstacles.push({ x, z, r: 0.45 }); }
      else bones.push({ x, z, s: 0.35 + r() * 0.2, r: r() * 6 });
    }
    this.scatter('elf_rock_big', dRocks);
    this.scatter('elf_rock_small', dSmall, false);
    this.scatter('elf_foliage_small', scrub, true, { recolor: true });
    this.deadTrees(bleached, 0xb8a888);
    this.scatter('undead_bones_remains', bones, false);

    // Rocky hills: boulders, pines, loose stones
    const PINE = [0x3f7a32, 0x4f8a3c, 0x5c9a40, 0x37702e];
    const hRocks: Inst[] = [], hPines: Inst[] = [], hSmall: Inst[] = [];
    for (const { x, z } of this.spread(80, 6, anywhere, room('hills', 1.2))) {
      const k = r();
      if (k < 0.4) { const s = 0.45 + r() * 0.45; rock(hRocks, x, z, s * 2.6, 1.1 * s, pick([0xc8c0b4, 0xb0a89c, 0xd8d0c4])); }
      else if (k < 0.75) { hPines.push({ x, z, s: 0.9 + r() * 0.4, r: r() * 6, tint: pick(PINE) }); this.obstacles.push({ x, z, r: 0.5 }); }
      else hSmall.push({ x, z, s: 0.5 + r() * 0.5, r: r() * 6 });
    }
    this.scatter('orc_stone_big', hRocks);
    this.pines(hPines);
    this.scatter('elf_rock_small', hSmall, false);
    this.scatter('elf_tree_root_1', stumps, false);
    this.scatter('orc_log', logs);
  }

  /** Reed clumps round the swamp pools: tall thin blades swaying in the wind. */
  private reeds(items: Inst[]) {
    if (!items.length) return;
    const pos: number[] = [];
    for (let k = 0; k < 7; k++) {
      const a = k * 2.4;
      const bx = Math.cos(a) * 0.12 * (k % 3);
      const bz = Math.sin(a) * 0.12 * (k % 3);
      const h = 0.75 + (k % 4) * 0.12;
      const lx = Math.cos(a) * 0.12;
      const lz = Math.sin(a) * 0.12;
      pos.push(bx - 0.03, 0, bz, bx + 0.03, 0, bz, bx + lx, h, bz + lz);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    const mat = scenery(new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }), { sway: 9, base: 0 });
    this.instances(geo, mat, items, false);
  }

  /** Lily pads floating on the swamp pools: notched discs, a pale flower on some. */
  private lilyPads(items: Inst[]) {
    if (!items.length) return;
    const geo = new THREE.CircleGeometry(0.32, 9, 0.35, Math.PI * 2 - 0.7).rotateX(-Math.PI / 2);
    this.instances(geo, scenery(new THREE.MeshLambertMaterial({ color: 0xffffff }), { base: 0 }), items, false);
    const flowers = items.filter((_, i) => i % 3 === 0).map((p) => ({ ...p, y: 0.09, tint: 0xffd8ec }));
    const fgeo = new THREE.IcosahedronGeometry(0.08, 0).scale(1, 0.6, 1);
    this.instances(fgeo, scenery(new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), { base: 0 }), flowers, false);
  }

  /** Plain instanced copies of a geometry (tinted per item), in culling bands. */
  private instances(geo: THREE.BufferGeometry, mat: THREE.Material, items: Inst[], shadow: boolean) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    for (const band of bands(items)) {
      const im = new THREE.InstancedMesh(geo, mat, band.length);
      band.forEach((t, i) => {
        q.setFromAxisAngle(up, t.r ?? 0);
        im.setMatrixAt(i, m.compose(new THREE.Vector3(t.x, t.y ?? heightAt(t.x, t.z), t.z), q, new THREE.Vector3(t.s, t.s, t.s)));
        im.setColorAt(i, col.set(t.tint ?? 0xffffff));
      });
      im.castShadow = shadow;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      this.grass.push(im);
      this.group.add(im);
    }
  }

  /** Stone elf buildings round the Snow Pass boss, frosted (pale blue-white tint). */
  private frozenOutpost(cx: number, cz: number) {
    const FROST = 0xdce8f6;
    const kit: [string, number, number, number][] = [['elf_throne_Lv1', 0, -9, 0.5], ['elf_oracle_Lv1', -12, 2, 0.5], ['elf_mine_Lv1', 12, 3, 0.5], ['elf_fountain', 0, 10, 0.5]];
    for (const [name, dx, dz, scale] of kit) {
      const p = this.spotIn('peaks', cx + dx, cz + dz, 3);
      if (!this.free(p.x, p.z, 3)) continue;
      const rot = Math.atan2(cx - p.x, cz - p.z);
      this.scatter(name, [{ x: p.x, z: p.z, s: scale, r: rot, tint: FROST }]);
      this.obstacles.push({ x: p.x, z: p.z, r: Math.min(this.size(name).x, this.size(name).z) * scale * 0.45 });
    }
  }

  /** The walkable spot of `zone` nearest to (x, z), with `pad` metres of room (searched in rings). */
  private spotIn(zone: ZoneId, x: number, z: number, pad: number) {
    for (let d = 0; d < 40; d += 1) {
      for (let k = 0; k < Math.max(1, d * 6); k++) {
        const a = (k / Math.max(1, d * 6)) * Math.PI * 2;
        const q = { x: x + Math.sin(a) * d, z: z + Math.cos(a) * d };
        if (zoneIdAt(q.x, q.z) === zone && walkable(q.x, q.z, pad)) return q;
      }
    }
    return { x, z };
  }

  // ---------- island rim: sandy beaches, tree banks and cliffs down to the sea ----------
  private buildRim() {
    const r = rng(77);
    const trees: Inst[] = [];
    const tall: Inst[] = [];
    const cemTrees: Inst[] = [];
    const rocks: Inst[] = [];
    const bushes: Inst[] = [];
    const pines: Inst[] = [];
    const logs: Inst[] = [];
    const PINE = [0x3f7a32, 0x4f8a3c, 0x5c9a40, 0x37702e];
    // a jittered 3.3 m lattice over the band from just past the walkable edge out into the shallows
    for (let gz = MAP_BOX.z; gz < MAP_BOX.z + MAP_BOX.size; gz += 3.3) {
      for (let gx = MAP_BOX.x; gx < MAP_BOX.x + MAP_BOX.size; gx += 3.3) {
        const x = gx + r() * 3.3;
        const z = gz + r() * 3.3;
        const o = outside(x, z) - 1;
        if (o < 0 || o > 11.4) continue;
        const k = Math.floor(o / 3.2); // 0 = next to the walkable edge … 3 = furthest out
        const a = angleOf(x, z);
        const cliff = rimCliff(a);
        const treeBank = rimTrees(a);
        const h = heightAt(x, z);
        const s = 0.55 + r() * 0.45;
        if (h < ISLAND.water + 0.15) {
          // the odd sea stack just off cliffs
          if (cliff > 0.5 && coastDist(x, z) > -6 && r() < 0.08) rocks.push({ x, z, s: s * 1.1, r: r() * 6, y: ISLAND.water - 0.6 });
          continue;
        }
        const cem = zoneIdAt(x, z) === 'cemetery';
        if (cliff > 0.5) {
          if (r() < 0.55) rocks.push({ x, z, s: s * (0.9 + 0.5 * r()), r: r() * 6, tint: cem ? 0x9a92b0 : undefined });
          else if (cem) cemTrees.push({ x, z, s: s * 1.4, r: r() * 6 });
          else pines.push({ x, z, s: s * 1.2, r: r() * 6, tint: PINE[Math.floor(r() * 4)] });
        } else if (treeBank > 0.5) {
          if (cem) { if (r() < 0.7) cemTrees.push({ x, z, s: s * 1.4, r: r() * 6 }); else rocks.push({ x, z, s: s * 0.6, r: r() * 6, tint: 0x9a92b0 }); }
          else if (k >= 2) pines.push({ x, z, s: s * 1.2, r: r() * 6, tint: PINE[Math.floor(r() * 4)] });
          else if (r() < 0.25) bushes.push({ x, z, s: s * 0.4, r: r() * 6 });
          else if (r() < 0.5) tall.push({ x, z, s: s * 0.9, r: r() * 6, tint: leaf(r) });
          else trees.push({ x, z, s, r: r() * 6, tint: leaf(r) });
        } else if (r() < 0.06) {
          // open beach: driftwood and the odd rock
          if (r() < 0.5) logs.push({ x, z, s: 0.5 + r() * 0.3, r: r() * 6 });
          else rocks.push({ x, z, s: s * 0.4, r: r() * 6, tint: cem ? 0x9a92b0 : undefined });
        }
      }
    }
    // The rim is mostly out of the shadow box: only the big rocks and pines cast shadows.
    this.scatter('elf_tree', trees, false);
    this.scatter('elf_foliage_small', tall, false);
    this.deadTrees(cemTrees);
    this.pines(pines);
    this.scatter('orc_stone_big', rocks.map((k) => ({ ...k, s: k.s * 2.4 })));
    this.scatter('elf_foliage_mid', bushes.map((b) => ({ ...b, y: heightAt(b.x, b.z) + 1.0 * b.s })));
    this.scatter('orc_log', logs, false);
  }

  /** Low graphics: no ground mist, grass or ground clutter. */
  setLowDetail(low: boolean) {
    this.mist.group.visible = !low;
    for (const g of this.grass) g.visible = !low;
  }

  /** The forest -> cemetery barrier is down (opened by the first boss). */
  get barrierOpen() { return this.gates.find((g) => g.def.id === 'forest-cemetery')!.open; }

  openGate(id: string, instant = false) {
    const g = this.gates.find((q) => q.def.id === id);
    if (!g || g.open) return;
    g.open = true;
    if (instant) g.mesh.visible = false;
  }

  openBarrier(instant = false) { this.openGate('forest-cemetery', instant); }
  /** Name of the location a passage leads into (from the forest: the outer one). */
  gateTarget(id: string) { const g = this.gates.find((x) => x.def.id === id)!.def; return ZONES.find((z) => z.id === g.to)!.name; }

  openAllGates(instant = false) { for (const g of this.gates) this.openGate(g.def.id, instant); }

  update(dt: number, time: number, camTarget: THREE.Vector3) {
    this.time.value = time;
    windTime.value = time;
    this.mist.setCamera(camTarget);
    this.grassField.follow(camTarget);
    for (const g of this.gates) {
      if (!g.open || !g.mesh.visible) continue;
      const a = (g.mat.uniforms.a.value -= dt * 0.8);
      if (a <= 0) g.mesh.visible = false;
    }
    for (const [i, f] of this.flames.entries()) {
      const s = 1 + Math.sin(time * 13 + i) * 0.12 + Math.sin(time * 7.3 + i * 2) * 0.08;
      f.scale.set(1 / s, s, 1 / s);
    }
  }

  /**
   * Draws the baked island (ground + ocean) and the closed barrier onto a map canvas.
   * X / Y map world x / z to canvas pixels, `ppm` is pixels per metre.
   */
  drawMap(g: CanvasRenderingContext2D, X: (x: number) => number, Y: (z: number) => number, ppm: number) {
    g.fillStyle = '#2a86d0'; // open sea beyond the baked square (same colour as its deep-water edge)
    g.fillRect(-1e4, -1e4, 2e4, 2e4);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.mapCanvas, X(MAP_BOX.x), Y(MAP_BOX.z), MAP_BOX.size * ppm, MAP_BOX.size * ppm);
    g.strokeStyle = '#b06bff';
    g.lineWidth = Math.max(4, 1.2 * ppm);
    g.lineCap = 'round';
    for (const { def: G, open } of this.gates) {
      if (open) continue;
      g.beginPath();
      g.moveTo(X(G.x - G.tz * 4), Y(G.z + G.tx * 4));
      g.lineTo(X(G.x + G.tz * 4), Y(G.z - G.tx * 4));
      g.stroke();
    }
  }

  /** Push a circle out of static obstacles (and closed barriers) and keep it on the walkable island. */
  collide(p: THREE.Vector3, radius: number) {
    const push = (o: Obstacle) => {
      const dx = p.x - o.x;
      const dz = p.z - o.z;
      const rr = o.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        p.x = o.x + (dx / d) * rr;
        p.z = o.z + (dz / d) * rr;
      }
    };
    for (const o of this.obstacles) push(o);
    for (const gt of this.gates) if (!gt.open) for (const o of gt.obstacles) push(o);
    const o = outside(p.x, p.z) + radius * 0.5;
    if (o > 0) {
      const n = inland(p.x, p.z);
      p.x += n.x * o;
      p.z += n.z * o;
    }
    const b = -borderRoom(p.x, p.z);
    if (b > 0) {
      const n = borderAway(p.x, p.z);
      p.x += n.x * b;
      p.z += n.z * b;
    }
  }
}
