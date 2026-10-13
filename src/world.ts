import * as THREE from 'three';
import { assets } from './assets';
import { blobShadow } from './character';
import {
  FACTIONS, HERO, WORLD, ZONES, type DamageType, type FactionId, type OrbKind, type ResistTier, type ZoneId,
} from './config';
import {
  buildFlowers, buildGrass, buildGround, buildMist, buildPond, fbm, heightAt, pathX, windTime, zoneAt, type Pond,
} from './terrain';

export { pathX };

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
export interface SpawnPoint { x: number; z: number; mob: string; zone: ZoneId; }
export interface BreakableSpot { x: number; z: number; kind: string; zone: ZoneId; rot: number; }
export interface Campfire { id: string; name: string; x: number; z: number; zone: ZoneId; }

/**
 * Something that happens when a prop is destroyed (data-driven; add new types here).
 * - spawnMob: a mob crawls out of the prop (e.g. a skeleton rising from a grave).
 */
export type BreakEvent = { type: 'spawnMob'; mob: string; chance: number; count?: number; bark?: string };

export interface BreakableDef {
  model: string | null;
  hits: number; // HP in "normal hits"
  color: number;
  scale: number;
  gold: [number, number];
  /** Fixed power orbs, shown above the HP bar like on mobs. */
  reward: Partial<Record<OrbKind, number>>;
  /** Material resistances: wood is easy to chop, stone needs a hammer. */
  resist: Partial<Record<DamageType, ResistTier>>;
  r: number;
  /** Respawn cooldown, seconds (GDD 7.3: 30–60 s). */
  respawn: number;
  onBreak?: BreakEvent[];
}
const GRAVE_RISE: BreakEvent[] = [{ type: 'spawnMob', mob: 'skeleton_worker', chance: 0.35, bark: 'Кто потревожил мой сон?!' }];
const WOOD: BreakableDef['resist'] = { slash: 'weak', crush: 'resist' };
const STONE: BreakableDef['resist'] = { slash: 'resist', crush: 'weak' };
export const BREAKABLES: Record<string, BreakableDef> = {
  barrel: { model: 'barrel', hits: 2, color: 0x8a5a2b, scale: 0.85, gold: [1, 3], reward: { hp: 1 }, resist: WOOD, r: 0.5, respawn: 40 },
  orc_barrel: { model: 'orc_barrel', hits: 2, color: 0x7a4a22, scale: 0.85, gold: [1, 3], reward: { hp: 1 }, resist: WOOD, r: 0.5, respawn: 40 },
  box: { model: 'box_small_1', hits: 1, color: 0xa87a45, scale: 0.9, gold: [0, 2], reward: { power: 1 }, resist: WOOD, r: 0.45, respawn: 30 },
  box_large: { model: 'box_large_1', hits: 3, color: 0xa87a45, scale: 0.8, gold: [3, 6], reward: { power: 1, hp: 1 }, resist: WOOD, r: 0.7, respawn: 60 },
  orc_box: { model: 'orc_box_small_1', hits: 1, color: 0x8a5a2b, scale: 0.9, gold: [0, 2], reward: { power: 1 }, resist: WOOD, r: 0.45, respawn: 30 },
  bush: { model: null, hits: 1, color: 0x3f8f2f, scale: 1, gold: [0, 1], reward: { regen: 1 }, resist: { slash: 'weak', crush: 'resist' }, r: 0.6, respawn: 25 },
  tomb1: { model: 'undead_tomb_stone_1', hits: 2, color: 0x77748a, scale: 0.75, gold: [1, 4], reward: { power: 1 }, resist: STONE, r: 0.55, respawn: 45, onBreak: GRAVE_RISE },
  tomb2: { model: 'undead_tomb_stone_2', hits: 2, color: 0x77748a, scale: 0.75, gold: [1, 4], reward: { regen: 1 }, resist: STONE, r: 0.55, respawn: 45, onBreak: GRAVE_RISE },
  tomb3: { model: 'undead_tomb_stone_3', hits: 2, color: 0x77748a, scale: 0.75, gold: [1, 4], reward: { hp: 1 }, resist: STONE, r: 0.55, respawn: 45, onBreak: GRAVE_RISE },
  tomb4: { model: 'undead_tomb_stone_4', hits: 2, color: 0x77748a, scale: 0.75, gold: [1, 4], reward: { speed: 1 }, resist: STONE, r: 0.55, respawn: 45, onBreak: GRAVE_RISE },
  coffin: { model: 'undead_coffin', hits: 3, color: 0x5a3c2c, scale: 0.34, gold: [4, 8], reward: { power: 1, hp: 1 }, resist: { crush: 'weak' }, r: 0.7, respawn: 75, onBreak: [{ type: 'spawnMob', mob: 'skeleton_warrior', chance: 0.7, bark: 'Вечный покой окончен!' }] },
};

const bushGeo = new THREE.IcosahedronGeometry(0.55, 0);
const bushMat = new THREE.MeshLambertMaterial({ color: 0x4c9a35, flatShading: true });

export function makeBreakable(kind: string): THREE.Object3D {
  const d = BREAKABLES[kind];
  const g = new THREE.Group();
  if (d.model) {
    const m = assets.clone(d.model);
    m.scale.multiplyScalar(d.scale);
    // Per-instance material clone so hit flashes stay local.
    m.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) { mesh.material = (mesh.material as THREE.Material).clone(); mesh.castShadow = true; }
    });
    g.add(m);
  } else {
    const mat = bushMat.clone();
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(bushGeo, mat);
      b.position.set(Math.cos(i * 2.1) * 0.35, 0.45 + (i % 2) * 0.15, Math.sin(i * 2.1) * 0.35);
      b.scale.setScalar(0.9 + i * 0.15);
      b.castShadow = true;
      g.add(b);
    }
  }
  g.add(blobShadow(d.r * 2.6));
  return g;
}

interface Inst { x: number; z: number; s: number; r?: number; y?: number; tint?: number; }

/** Foliage tints (multiply the elf texture) so groves are not all the same lime green. */
const LEAF_TINTS = [0xffffff, 0xd4ecb0, 0xa8d488, 0x8fc47a, 0xc2e09a];
const leaf = (r: () => number) => LEAF_TINTS[Math.floor(r() * LEAF_TINTS.length)];

/** Everything placed into the level (static models are cloned; repeated decor is instanced). */
export class World {
  readonly group = new THREE.Group();
  readonly obstacles: Obstacle[] = [];
  readonly spawns: SpawnPoint[] = [];
  readonly breakables: BreakableSpot[] = [];
  readonly campfires: Campfire[] = [];
  readonly bosses: { mob: string; x: number; z: number }[] = [];
  readonly ponds: Pond[] = [{ x: -21, z: -74, r: 5.5 }];
  smithy = new THREE.Vector3();
  barrier!: THREE.Group;
  barrierOpen = false;
  private barrierMat!: THREE.ShaderMaterial;
  private flames: THREE.Mesh[] = [];
  private time = { value: 0 };
  private mist: ReturnType<typeof buildMist>;
  private grass: THREE.Object3D[] = [];
  private sizeCache = new Map<string, THREE.Vector3>();
  private packCenters: [number, number][] = [];

  constructor(public faction: FactionId) {
    this.group.add(buildGround(this.ponds));
    for (const p of this.ponds) {
      this.group.add(buildPond(p, this.time));
      this.obstacles.push({ x: p.x, z: p.z, r: p.r * 0.85 });
    }
    this.buildCamp();
    this.buildForest();
    this.buildBarrier();
    this.buildCemetery();
    this.buildWilderness();
    const free = (x: number, z: number) => this.free(x, z, 0.2);
    this.grass = [buildGrass(free, this.ponds), buildFlowers(free)];
    this.group.add(...this.grass);
    this.mist = buildMist(this.time);
    this.group.add(this.mist.group);
  }

  zoneAt(z: number) { return zoneAt(z); }

  /** Environment colours (and fog density) blended across zone borders. */
  envAt(z: number, out: { sky: THREE.Color; fog: THREE.Color; hemiSky: THREE.Color; hemiGround: THREE.Color; density: number }) {
    const h = 8;
    const i = ZONES.indexOf(zoneAt(z));
    const zone = ZONES[i];
    let other = zone;
    let k = 0;
    const dNorth = z - zone.z[1];
    const dSouth = zone.z[0] - z;
    if (dNorth < h && ZONES[i + 1]) { other = ZONES[i + 1]; k = 0.5 * (1 - dNorth / h); }
    else if (dSouth < h && ZONES[i - 1]) { other = ZONES[i - 1]; k = 0.5 * (1 - dSouth / h); }
    const tmp = new THREE.Color();
    out.sky.set(zone.sky).lerp(tmp.set(other.sky), k);
    out.fog.set(zone.fog).lerp(tmp.set(other.fog), k);
    out.hemiSky.set(zone.hemi[0]).lerp(tmp.set(other.hemi[0]), k);
    out.hemiGround.set(zone.hemi[1]).lerp(tmp.set(other.hemi[1]), k);
    out.density = THREE.MathUtils.lerp(zone.fogDensity, other.fogDensity, k);
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

  /** Is a spot free of obstacles, ponds and the main path? */
  free(x: number, z: number, pad = 0.6, avoidPath = false) {
    if (Math.abs(x) > WORLD.halfWidth || z > WORLD.zMax || z < WORLD.zMin) return false;
    if (avoidPath && z < -12 && Math.abs(x - pathX(z)) < 3) return false;
    for (const o of this.obstacles) if ((x - o.x) ** 2 + (z - o.z) ** 2 < (o.r + pad) ** 2) return false;
    return true;
  }

  private nearPack(x: number, z: number, d: number) {
    return this.packCenters.some(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 < d * d);
  }

  /** Cloned model with shadows; `collide: 'auto'` derives a circle from the footprint. */
  private place(name: string, x: number, z: number, scale = 1, rot = 0, collide: number | 'auto' = 'auto') {
    if (!assets.has(name)) { console.warn('level model not loaded:', name); return null; }
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
    this.group.add(m);
    const r = collide === 'auto' ? Math.min(this.size(name).x, this.size(name).z) * scale * 0.45 : collide;
    if (r > 0) this.obstacles.push({ x, z, r });
    return m;
  }

  /**
   * Instanced copies of a model (trees, rocks, poles). Items are split into 24 m bands along the
   * map so each band has its own bounding sphere and off-screen bands are frustum-culled.
   */
  private scatter(name: string, items: Inst[], shadow = true) {
    const bands = new Map<number, Inst[]>();
    for (const it of items) {
      const k = Math.floor(it.z / 24);
      if (!bands.has(k)) bands.set(k, []);
      bands.get(k)!.push(it);
    }
    for (const band of bands.values()) this.scatterBand(name, band, shadow);
  }

  private scatterBand(name: string, items: Inst[], shadow: boolean) {
    if (!items.length) return;
    if (!assets.has(name)) { console.warn('level model not loaded:', name); return; }
    const src = assets.clone(name);
    src.updateMatrixWorld(true);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    src.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      const im = new THREE.InstancedMesh(geo, mesh.material as THREE.Material, items.length);
      items.forEach((t, i) => {
        q.setFromAxisAngle(up, t.r ?? 0);
        m.compose(new THREE.Vector3(t.x, t.y ?? heightAt(t.x, t.z), t.z), q, new THREE.Vector3(t.s, t.s, t.s));
        im.setMatrixAt(i, m);
        im.setColorAt(i, col.set(t.tint ?? 0xffffff));
      });
      im.castShadow = shadow;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      this.group.add(im);
    });
  }

  /** Cheap low-poly pines for the far hills (~30 triangles each vs ~2000 for the elf trees). */
  private pines(items: Inst[]) {
    const bands = new Map<number, Inst[]>();
    for (const it of items) {
      const k = Math.floor(it.z / 24);
      if (!bands.has(k)) bands.set(k, []);
      bands.get(k)!.push(it);
    }
    const trunk = new THREE.CylinderGeometry(0.15, 0.25, 1.4, 5).translate(0, 0.7, 0);
    const c1 = new THREE.ConeGeometry(1.4, 2.6, 7).translate(0, 2.4, 0);
    const c2 = new THREE.ConeGeometry(1.0, 2.0, 7).translate(0, 3.6, 0);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2f, flatShading: true });
    const leafMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    for (const band of bands.values()) {
      const meshes = [new THREE.InstancedMesh(trunk, trunkMat, band.length), new THREE.InstancedMesh(c1, leafMat, band.length), new THREE.InstancedMesh(c2, leafMat, band.length)];
      band.forEach((t, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.r ?? 0);
        m.compose(new THREE.Vector3(t.x, heightAt(t.x, t.z), t.z), q, new THREE.Vector3(t.s, t.s, t.s));
        col.set(t.tint ?? 0x4f8a3c);
        meshes.forEach((im, j) => { im.setMatrixAt(i, m); if (j) im.setColorAt(i, col); });
      });
      for (const im of meshes) { im.receiveShadow = true; im.computeBoundingSphere(); this.group.add(im); }
    }
  }

  /** Bare spooky trees: instanced trunk + three crooked branches. */
  private deadTrees(items: Inst[]) {
    const bands = new Map<number, Inst[]>();
    for (const it of items) {
      const k = Math.floor(it.z / 24);
      if (!bands.has(k)) bands.set(k, []);
      bands.get(k)!.push(it);
    }
    for (const band of bands.values()) this.deadTreeBand(band);
  }

  private deadTreeBand(items: Inst[]) {
    if (!items.length) return;
    const trunk = new THREE.CylinderGeometry(0.12, 0.3, 2.6, 6).translate(0, 1.3, 0);
    const branch = new THREE.CylinderGeometry(0.04, 0.1, 1.5, 5).translate(0, 0.75, 0);
    const mat = new THREE.MeshLambertMaterial({ color: 0x4a3f5a, flatShading: true });
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
  private palisade(cx: number, cz: number, radius: number, gates: number[], gateHalf: number, model = 'palisade_pole', scale = 0.75) {
    const items: Inst[] = [];
    const step = 0.95 / radius;
    for (let a = 0; a < Math.PI * 2; a += step) {
      if (gates.some((g) => Math.abs(Math.atan2(Math.sin(a - g), Math.cos(a - g))) < gateHalf)) continue;
      const x = cx + Math.sin(a) * radius;
      const z = cz + Math.cos(a) * radius;
      items.push({ x, z, s: scale * (0.9 + ((a * 7.3) % 0.2)), r: a * 3.7 });
      this.obstacles.push({ x, z, r: 0.45 });
    }
    this.scatter(model, items);
  }

  // ---------- camp ----------
  private buildCamp() {
    const H = this.faction === 'human';
    const cz = 3;
    // palisade around the camp, gate to the north (towards the forest)
    this.palisade(0, cz, 16.5, [Math.PI], 0.27);
    const tower = H ? 'tower_human_small_1' : 'orc_high_stand';
    this.place(tower, -5.4, cz - 15.8, H ? 0.75 : 0.65, 0, 1.4);
    this.place(tower, 5.4, cz - 15.8, H ? 0.75 : 0.65, 0, 1.4);
    // buildings of the hero's race around the plaza
    const B = H
      ? { big: 'human_house_large', mid: 'human_house_mid', small: 'human_house_small', smith: 'smithy_building', barrack: 'barrack_Lv2', tower: 'tower_big' }
      : { big: 'orc_house_Lv2', mid: 'orc_house_Lv1', small: 'orc_cabin', smith: 'orc_smithy_Lv1', barrack: 'orc_barrack_Lv2', tower: 'orc_tower_Lv2' };
    this.place(B.big, -10, cz + 8.5, 0.62, Math.PI * 0.8);
    this.place(B.mid, 10, cz + 9, 0.62, -Math.PI * 0.78);
    this.place(B.small, -11.5, cz - 3.5, H ? 0.62 : 0.85, Math.PI / 2);
    this.place(B.smith, 12, cz - 3, 0.55, -Math.PI / 2);
    this.place(B.barrack, 0, cz + 12.5, 0.5, Math.PI);
    this.place(B.tower, -12.5, cz - 11, 0.45, 0.6);
    this.smithy.set(8.6, 0, cz - 3);
    // yard props
    const f = FACTIONS[this.faction];
    this.place(f.campProps[0], -3.2, cz - 13.8, 0.42, 0, 0.4); // banners at the gate
    this.place(f.campProps[0], 3.2, cz - 13.8, 0.42, 0, 0.4);
    this.place(H ? 'anvil_big' : 'orc_anvil', 8.4, cz - 0.4, 0.5, 0.3, 0.6);
    this.place(H ? 'practice_dummy' : 'orc_practice_dummy', -7.5, cz - 8.5, 0.65, 0.2, 0.5);
    this.place(H ? 'practice_dummy' : 'orc_practice_dummy', -9.8, cz - 7.2, 0.65, -0.4, 0.5);
    this.place(H ? 'target' : 'orc_practice_aim', 8.5, cz - 9.5, 0.9, -0.3, 0.5);
    this.place('elf_well', 4.5, cz + 4.5, 0.36, 0, 1.0);
    this.place(H ? 'wood_pile_big' : 'orc_wood_pile_big', -14, cz + 2, 0.5, 0.4);
    this.place(H ? 'wood_pile_small' : 'orc_wood_pile_small', 13.2, cz + 3.5, 0.65, 1.2);
    this.place(H ? 'lantern_street' : 'orc_head_lantern', -2.6, cz - 7.5, H ? 0.6 : 0.45, 0, 0.3);
    this.place(H ? 'lantern_street' : 'orc_head_lantern', 2.6, cz - 7.5, H ? 0.6 : 0.45, Math.PI, 0.3);
    this.place(H ? 'lantern_street' : 'orc_head_lantern', -6, cz + 5.5, H ? 0.6 : 0.45, 0.8, 0.3);
    this.place(H ? 'flag' : 'orc_flag_red', 0, cz + 8.5, 0.7, 0, 0.3);
    // clutter: crates & barrels stacked by the walls (decor, not breakable)
    const crates: [string, number, number, number][] = [
      ['box_large_2', -6.5, cz + 11, 0.4], ['box_small_2', -5.4, cz + 11.6, 0.9], ['barrel', 6.2, cz + 11.2, 0.3],
      ['box_large_2', 14, cz - 7, 1], ['barrel', 13, cz - 8.3, 0.2], ['box_small_2', -14.2, cz - 8, 0.6],
      ['bucket', 5.6, cz + 3, 0], ['barrel', -13.4, cz + 5.8, 0.7],
    ];
    for (const [n, x, z, rr] of crates) this.place(H ? n : n === 'barrel' ? 'orc_barrel' : n.startsWith('box_large') ? 'orc_box_large_2' : n === 'bucket' ? 'orc_bucket' : 'orc_box_small_1', x, z, 0.8, rr, 0.5);
    if (!H) {
      this.place('orc_drum_big', -3.6, cz + 8.6, 0.45, 0.5, 0.6);
      this.place('orc_altar', 3.8, cz + 8.8, 0.55, 0, 0.8);
      for (const [x, z] of [[-4.4, cz - 16.6], [4.4, cz - 16.6]]) this.place('orc_horned_skull', x, z, 1.2, 0, 0);
    } else {
      this.place('cauldron', -3.8, cz + 8.6, 0.55, 0, 0.5);
      this.place('shield', 11.6, cz - 6.5, 0.8, -Math.PI / 2, 0);
      this.place('spear', 11.6, cz - 7.3, 0.8, -Math.PI / 2, 0);
    }
    this.addCampfire('camp', 'Лагерь', -4.5, -1, 'camp');
    // camp crates (tutorial-ish), just outside the gate
    for (const [x, z, k] of [[-6, -18, 'barrel'], [-5, -19.5, 'box'], [6, -19, 'box'], [7, -17.5, 'barrel']] as const) {
      this.breakables.push({ x, z, kind: k, zone: 'camp', rot: x });
    }
  }

  addCampfire(id: string, name: string, x: number, z: number, zone: ZoneId) {
    const model = zone === 'camp' ? FACTIONS[this.faction].campfire : 'campfire';
    this.place(model, x, z, 0.42, 0, 0.8);
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.35, 1, 6).translate(0, 0.5, 0),
      new THREE.MeshBasicMaterial({ color: 0xffa020, transparent: true, opacity: 0.85 }),
    );
    flame.position.set(x, 0.15, z);
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(HERO.campfireRadius, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffb040, transparent: true, opacity: 0.12, depthWrite: false }),
    );
    glow.position.set(x, 0.03, z);
    this.group.add(flame, glow);
    this.flames.push(flame);
    this.campfires.push({ id, name, x, z, zone });
  }

  // ---------- forest ----------
  private buildForest() {
    const r = rng(23);
    const H = this.faction === 'human';
    const packs: [number, number, string[]][] = [
      [-6, -34, ['bandit_thug', 'bandit_thug']],
      [10, -40, ['bandit_thug', 'bandit_thug', 'bandit_thug']],
      [-14, -48, ['bandit_thug', 'bandit_fighter']],
      [4, -55, ['bandit_thug', 'bandit_thug', 'bandit_fighter']],
      [-15, -62, ['bandit_fighter', 'bandit_thug']],
      [16, -64, ['bandit_thug', 'bandit_thug', 'bandit_thug']],
      [-4, -78, ['bandit_fighter', 'bandit_fighter', 'bandit_thug']],
      [14, -84, ['bandit_thug', 'bandit_fighter', 'bandit_thug']],
      [-14, -90, ['bandit_fighter', 'bandit_thug', 'bandit_thug']],
      [11, -92, ['bandit_fighter', 'bandit_fighter']],
      [18, -30, ['boar', 'boar', 'boar']],
      [-11, -70, ['boar', 'boar', 'boar']],
      [2, -100, ['boar', 'boar', 'boar']],
    ];
    for (const [x, z, mobs] of packs) {
      this.packCenters.push([x, z]);
      mobs.forEach((mob, i) => this.spawns.push({ x: x + Math.cos(i * 2.2) * 1.8, z: z + Math.sin(i * 2.2) * 1.8, mob, zone: 'forest' }));
    }
    // murloc guards on the road just outside the camp gate, two on each side
    for (const z of [-25, -28.5]) {
      for (const side of [-1, 1]) this.spawns.push({ x: pathX(z) + side * 2.2, z, mob: 'murloc', zone: 'forest' });
    }
    this.packCenters.push([pathX(-26.75), -26.75]);

    // Lumber camp (east)
    this.place('woodcutter_building', 27, -44, 0.55, -Math.PI / 2);
    this.place('wood_pile_big', 21.5, -39.5, 0.5, 0.3);
    this.place('elf_log_pile', 21, -49, 0.5, 1.2);
    this.place('saw', 24.5, -52, 0.45, 0.4, 0.8);
    this.place('wood_pile_small', 19.5, -44.5, 0.6, 0.8, 0.6);
    // Abandoned farm (west) with a well
    this.place('human_house_small', -27, -40, 0.5, Math.PI / 2);
    this.place('elf_well', -20.5, -35, 0.36, 0, 1.1);
    this.place('wood_pile_small', -23.5, -45.5, 0.6, 0.2, 0.6);
    this.place('bucket', -19, -36.5, 0.8, 0, 0);
    // Pond rocks & reeds handled by terrain; a few stones around it
    for (const [x, z, s] of [[-26.5, -70, 1.6], [-15.5, -78, 1.3], [-24, -80, 1.1]] as const) this.place('orc_stone_big', x, z, s, x * 3);
    // Old mine (east, in the hillside)
    this.place('mine_enterance', 29.5, -80, 0.5, -Math.PI / 2);
    this.place('minecart', 24, -78.5, 0.55, 0.3, 0.6);
    this.scatter('mine_rail_piece', [0, 1, 2, 3].map((i) => ({ x: 26.5 - i * 0.9, z: -80, s: 0.55, r: Math.PI / 2 })), false);
    this.place('box_small_2', 23.5, -82.5, 0.8, 0.5, 0.5);

    // Bandit fort around the boss: built from the enemy race's kit.
    const fx = 0;
    const fz = -105;
    // gates on both sides: the path to the cemetery runs through the fort
    const north = Math.atan2(pathX(WORLD.barrierZ) - fx, -12) ;
    this.palisade(fx, fz, 12, [0, north], 0.36);
    if (H) {
      this.place('orc_tower_Lv2', -8.5, fz - 7, 0.38, 0.4);
      this.place('orc_tower_Lv2', 8.5, fz - 7, 0.38, -0.4);
      this.place('orc_throne', -6, fz - 8.5, 0.9, 0.5, 1);
      this.place('orc_drum_big', -9.8, fz + 1, 0.45, 0.5, 0.7);
      this.place('orc_tusk_standing', -4.6, fz + 12.4, 0.9, 0.3, 0.5);
      this.place('orc_tusk_standing', 4.6, fz + 12.4, 0.9, -0.3, 0.5);
      this.place('orc_horned_skull', -6, fz - 10, 1.4, 0, 0);
    } else {
      this.place('tower_Lv2', -8.5, fz - 7, 0.38, 0.4);
      this.place('tower_Lv2', 8.5, fz - 7, 0.38, -0.4);
      this.place('throne_Lv1', -6, fz - 9, 0.3, 0.5, 1.4);
      this.place('banner', -4.6, fz + 12.4, 0.45, 0, 0.4);
      this.place('banner', 4.6, fz + 12.4, 0.45, 0, 0.4);
    }
    // camp clutter along the inner wall
    this.place(H ? 'orc_beam_pile' : 'wood_pile_big', -9.5, fz + 4.5, 0.5, 0.6);
    this.place(H ? 'orc_wood_pile_small' : 'wood_pile_small', 9.8, fz - 2, 0.65, 1.1);
    this.place(H ? 'orc_box_large_2' : 'box_large_2', 9.2, fz + 4, 0.8, 0.3, 0.6);
    this.place(H ? 'orc_barrel' : 'barrel', 10.2, fz + 5.3, 0.8, 0.3, 0.5);
    this.place(H ? 'orc_head_lantern' : 'lantern_street', -4, fz - 9, 0.45, 0, 0.3);
    this.place(H ? 'orc_head_lantern' : 'lantern_street', 4, fz - 9, 0.45, 0, 0.3);
    this.bosses.push({ mob: 'bandit_chief', x: fx, z: fz });
    this.packCenters.push([fx, fz]);

    this.addCampfire('forest', 'Опушка', pathX(-68) + 3, -68, 'forest');

    // Stepping stones on the path
    const stones: Inst[] = [];
    for (let z = -24; z > -116; z -= 2.6 + r() * 1.5) stones.push({ x: pathX(z) + (r() - 0.5) * 1.6, z, s: 0.35 + r() * 0.2, r: r() * 6, y: 0.01 });
    this.scatter('elf_rock_small', stones, false);

    // Trees, bushes and boulders inside the forest (kept off the path, packs and clearings)
    const trees: Inst[] = [];
    const tall: Inst[] = [];
    const bushes: Inst[] = [];
    const rocks: Inst[] = [];
    // Groves: clusters of trees with bushes and boulders around them; the clearings between
    // groves are where packs live, so fights stay visible from the top-down camera.
    const blocked = (x: number, z: number, pad: number) =>
      !this.free(x, z, pad, true) || this.nearPack(x, z, 5.5) || (Math.abs(z + 105) < 16 && Math.abs(x) < 16);
    let groves = 0;
    for (let i = 0; i < 400 && groves < 30; i++) {
      const gz = -27 - r() * 84;
      const gx = (r() * 2 - 1) * (WORLD.halfWidth - 2);
      if (blocked(gx, gz, 2)) continue;
      groves++;
      const n = 5 + Math.floor(r() * 5);
      for (let k = 0, tries = 0; k < n && tries < n * 4; tries++) {
        const a = r() * Math.PI * 2;
        const d = 0.8 + r() * 3.8;
        const x = gx + Math.cos(a) * d;
        const z = gz + Math.sin(a) * d;
        if (blocked(x, z, 0.35)) continue;
        k++;
        const t = r();
        if (t < 0.45) {
          trees.push({ x, z, s: 0.55 + r() * 0.35, r: r() * 6, tint: leaf(r) });
          this.obstacles.push({ x, z, r: 0.5 });
        } else if (t < 0.7) {
          tall.push({ x, z, s: 0.5 + r() * 0.3, r: r() * 6, tint: leaf(r) });
          this.obstacles.push({ x, z, r: 0.55 });
        } else if (t < 0.9) {
          const s = 0.18 + r() * 0.14;
          bushes.push({ x, z, s, r: r() * 6, y: 1.0 * s });
          this.obstacles.push({ x, z, r: 2.4 * s });
        } else {
          const s = 0.3 + r() * 0.35;
          rocks.push({ x, z, s, r: r() * 6 });
          this.obstacles.push({ x, z, r: 1.1 * s });
        }
      }
    }
    // a few lone bushes and rocks in the open
    for (let i = 0; i < 40; i++) {
      const z = -26 - r() * 88;
      const x = (r() * 2 - 1) * (WORLD.halfWidth - 1.5);
      if (blocked(x, z, 2)) continue;
      if (r() < 0.6) {
        const s = 0.14 + r() * 0.1;
        bushes.push({ x, z, s, r: r() * 6, y: 1.0 * s });
        this.obstacles.push({ x, z, r: 2.4 * s });
      } else {
        const s = 0.25 + r() * 0.25;
        rocks.push({ x, z, s, r: r() * 6 });
        this.obstacles.push({ x, z, r: 1.1 * s });
      }
    }
    this.scatter('elf_tree', trees);
    this.scatter('elf_foliage_small', tall);
    this.scatter('elf_foliage_mid', bushes);
    this.scatter('orc_stone_big', rocks.map((k) => ({ ...k, s: k.s * 2.6 })));
    // roots and stumps (decor, no collision)
    const roots: Inst[] = [];
    for (let i = 0; i < 30; i++) {
      const z = -26 - r() * 88;
      const x = (r() * 2 - 1) * (WORLD.halfWidth - 1);
      if (this.free(x, z, 1.2, true)) roots.push({ x, z, s: 0.3 + r() * 0.2, r: r() * 6 });
    }
    this.scatter('elf_tree_root_1', roots, false);

    // Breakables: clusters of barrels/boxes/bushes
    const kinds = ['barrel', 'box', 'box_large', 'orc_barrel', 'orc_box', 'bush', 'bush'];
    for (let i = 0; i < 40; i++) {
      const z = -26 - r() * 86;
      const x = pathX(z) + (r() * 2 - 1) * 22;
      if (Math.hypot(x, z + 105) < 10 || !this.free(x, z, 1.2)) continue;
      const n = 1 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) {
        const bx = x + (r() - 0.5) * 2.4;
        const bz = z + (r() - 0.5) * 2.4;
        if (this.free(bx, bz, 0.6)) this.breakables.push({ x: bx, z: bz, kind: kinds[Math.floor(r() * kinds.length)], zone: 'forest', rot: r() * 6 });
      }
      if (this.breakables.length > 60) break;
    }
  }

  // ---------- barrier between the forest and the cemetery ----------
  private buildBarrier() {
    const g = new THREE.Group();
    const x0 = pathX(WORLD.barrierZ);
    this.barrierMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { t: { value: 0 }, a: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `varying vec2 vUv; uniform float t; uniform float a;
        void main(){
          float s = sin(vUv.x*40.0 + t*3.0)*0.5+0.5;
          float r = sin(vUv.y*18.0 - t*4.0 + vUv.x*8.0)*0.5+0.5;
          float edge = smoothstep(0.0,0.15,vUv.y)*(1.0-smoothstep(0.7,1.0,vUv.y));
          vec3 c = mix(vec3(0.55,0.25,1.0), vec3(0.9,0.7,1.0), s*r);
          gl_FragColor = vec4(c, (0.35+0.45*s*r)*edge*a);
        }`,
    });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(9, 4.5), this.barrierMat);
    wall.position.set(x0, 2.2, WORLD.barrierZ);
    g.add(wall);
    this.group.add(g);
    this.barrier = g;
    // Bone gate of the cemetery right behind the barrier
    this.place('undead_tusk_gate', x0, WORLD.barrierZ - 1.2, 1.15, 0, 0);
    this.obstacles.push({ x: x0 - 3.7, z: WORLD.barrierZ - 1.2, r: 0.9 }, { x: x0 + 3.7, z: WORLD.barrierZ - 1.2, r: 0.9 });
    // Wall of trees and boulders across the map except the gate
    const r = rng(5);
    const trees: Inst[] = [];
    const dead: Inst[] = [];
    const boulders: Inst[] = [];
    for (let x = -WORLD.halfWidth - 2; x <= WORLD.halfWidth + 2; x += 1.7) {
      if (Math.abs(x - x0) < 5.5) continue;
      trees.push({ x: x + r() * 0.6, z: WORLD.barrierZ + 0.6 + r(), s: 0.6 + r() * 0.25, r: r() * 6 });
      dead.push({ x: x + 0.8, z: WORLD.barrierZ - 1.8 - r(), s: 1 + r() * 0.4, r: r() * 6 });
      if (r() < 0.5) boulders.push({ x: x + r(), z: WORLD.barrierZ - 0.4, s: 0.45 + r() * 0.3, r: r() * 6 });
      this.obstacles.push({ x, z: WORLD.barrierZ, r: 1.0 });
    }
    this.scatter('elf_tree', trees);
    this.deadTrees(dead);
    this.scatter('orc_stone_big', boulders.map((k) => ({ ...k, s: k.s * 2.4 })));
  }

  // ---------- cemetery ----------
  private buildCemetery() {
    const r = rng(41);
    const packs: [number, number, string[]][] = [
      [-8, -140, ['skeleton_worker', 'skeleton_worker']],
      [12, -146, ['skeleton_worker', 'skeleton_worker', 'ghost']],
      [-14, -156, ['skeleton_warrior', 'skeleton_worker']],
      [6, -162, ['skeleton_worker', 'skeleton_warrior', 'skeleton_worker']],
      [-6, -172, ['ghost', 'ghost']],
      [15, -178, ['skeleton_warrior', 'skeleton_worker', 'skeleton_worker']],
      [-16, -186, ['skeleton_warrior', 'ghost', 'skeleton_worker']],
      [5, -190, ['skeleton_warrior', 'skeleton_warrior']],
      [-18, -170, ['undead_boar', 'undead_boar', 'undead_boar']],
      [1, -180, ['undead_boar', 'undead_boar', 'undead_boar']],
    ];
    for (const [x, z, mobs] of packs) {
      this.packCenters.push([x, z]);
      mobs.forEach((mob, i) => this.spawns.push({ x: x + Math.cos(i * 2.2) * 1.8, z: z + Math.sin(i * 2.2) * 1.8, mob, zone: 'cemetery' }));
    }
    this.addCampfire('cemetery', 'Ворота кладбища', pathX(-128) + 4, -128, 'cemetery');

    // Mausoleums and crypts along the edges
    this.place('undead_house_tower', -26, -141, 0.5, Math.PI / 2);
    this.place('undead_tower_small', 26.5, -137, 0.55, -Math.PI / 2);
    this.place('undead_smithy_house', -27, -168, 0.5, Math.PI / 2);
    this.place('undead_building', 27, -160, 0.5, -Math.PI / 2);
    this.place('undead_tower', -27, -197, 0.55, 0.4);
    this.place('undead_wheel_of_pain', 25, -191, 0.45, -0.5);
    this.place('undead_cauldron', 22, -153, 0.55, 0, 0.8);
    this.place('undead_flag', -21, -149, 0.6, 0, 0.3);
    // Windmill silhouette on the western hill
    this.place('undead_windmill', -44, -163, 0.8, 0.6, 0);
    this.place('undead_tower_Lv2', 46, -150, 0.6, -0.8, 0);

    // Fences along graves, lamp posts along the path
    for (let i = 0; i < 16; i++) {
      const z = -136 - i * 4.4;
      for (const side of [-1, 1]) {
        if (r() < 0.35) continue;
        this.place('undead_fence', pathX(z) + side * 6.5, z, 0.55, Math.PI / 2, 0);
      }
    }
    for (let i = 0; i < 10; i++) {
      const z = -132 - i * 8;
      this.place('undead_lamp_post', pathX(z) + (i % 2 ? 3.4 : -3.4), z, 0.6, 0, 0.3);
    }
    const deco: [string, number, number, number][] = [
      ['undead_ruins_01', -19, -153, 0.45], ['undead_ruins_02', 20, -171, 0.45], ['undead_obelisk', -12, -196, 0.8],
      ['undead_obelisk', 12, -196, 0.8], ['undead_column_1', -21, -180, 0.5], ['undead_column_1', 21, -142, 0.5],
    ];
    for (const [n, x, z, s] of deco) this.place(n, x, z, s, r() * 6);

    // Boss arena: throne, floating stones and a ring of columns
    this.place('undead_throne_Lv1', 0, -221, 0.55, 0);
    this.place('undead_throne', 0, -214.5, 1.1, 0, 0.9);
    for (const sx of [-1, 1]) {
      this.place('undead_floating_stone', sx * 12, -203, 0.6, sx, 1);
      this.place('undead_floating_coffin', sx * 12.5, -214, 0.5, sx * 0.5, 1);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.5) continue; // opening toward the path
      this.place('undead_column_2', Math.sin(a) * 15, -208 + Math.cos(a) * 15, 0.5, a, 'auto');
    }
    this.bosses.push({ mob: 'death', x: 0, z: -208 });
    this.packCenters.push([0, -208]);

    // Graves: rows of breakable tombstones and coffins
    const tombs = ['tomb1', 'tomb2', 'tomb3', 'tomb4', 'tomb1', 'tomb2', 'coffin'];
    for (let row = 0; row < 14; row++) {
      const z = -134 - row * 4.8;
      for (let k = 0; k < 6; k++) {
        if (r() < 0.45) continue;
        const side = k < 3 ? -1 : 1;
        const x = pathX(z) + side * (9 + (k % 3) * 3.2 + r());
        if (Math.hypot(x, z + 208) < 16 || !this.free(x, z, 0.8)) continue;
        this.breakables.push({ x, z: z + r() * 0.6, kind: tombs[Math.floor(r() * tombs.length)], zone: 'cemetery', rot: Math.PI + (r() - 0.5) * 0.4 });
      }
    }
    // Decorative old graves, bones and dead trees
    const old: Inst[] = [];
    const bones: Inst[] = [];
    const deadTrees: Inst[] = [];
    for (let i = 0; i < 160; i++) {
      const z = -124 - r() * 92;
      const x = (r() * 2 - 1) * (WORLD.halfWidth - 1);
      if (!this.free(x, z, 1.4, true) || this.nearPack(x, z, 4) || Math.hypot(x, z + 208) < 16) continue;
      const k = r();
      if (k < 0.35) old.push({ x, z, s: 0.55 + r() * 0.2, r: Math.PI + (r() - 0.5) * 0.6 });
      else if (k < 0.6) bones.push({ x, z, s: 0.3 + r() * 0.2, r: r() * 6 });
      else if (deadTrees.length < 26) {
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

  // ---------- hills outside the playable strip ----------
  private buildWilderness() {
    const r = rng(77);
    const trees: Inst[] = [];
    const tall: Inst[] = [];
    const cemTrees: Inst[] = [];
    const rocks: Inst[] = [];
    const bushes: Inst[] = [];
    const pines: Inst[] = [];
    let far = false;
    const tryAdd = (x: number, z: number) => {
      const zone = zoneAt(z);
      const n = fbm(x * 0.1, z * 0.1);
      const s = 0.55 + r() * 0.45;
      if (zone.id === 'cemetery') {
        if (r() < 0.7) cemTrees.push({ x, z, s: s * 1.4, r: r() * 6 });
        else rocks.push({ x, z, s: s * 0.7, r: r() * 6, tint: 0x9a92b0 });
      } else if (n > 0.55 && r() < 0.5) rocks.push({ x, z, s: s * 0.8, r: r() * 6 });
      else if (far) pines.push({ x, z, s: s * 1.3, r: r() * 6, tint: [0x3f7a32, 0x4f8a3c, 0x5c9a40, 0x37702e][Math.floor(r() * 4)] });
      else if (r() < 0.25) bushes.push({ x, z, s: s * 0.4, r: r() * 6 });
      else if (r() < 0.5) tall.push({ x, z, s: s * 0.9, r: r() * 6, tint: leaf(r) });
      else trees.push({ x, z, s, r: r() * 6, tint: leaf(r) });
    };
    for (let z = WORLD.zMax + 30; z > WORLD.zMin - 30; z -= 2.3) {
      for (const side of [-1, 1]) {
        for (let k = 0; k < 6; k++) {
          far = k >= 2;
          const x = side * (WORLD.halfWidth + 1.6 + k * 3.8 + r() * 2.5);
          tryAdd(x, z + r() * 2);
        }
      }
    }
    for (let x = -WORLD.halfWidth; x <= WORLD.halfWidth; x += 2.3) {
      for (let k = 0; k < 5; k++) {
        far = k >= 1;
        tryAdd(x + r(), WORLD.zMax + 1.8 + k * 3.2 + r() * 2);
        tryAdd(x + r(), WORLD.zMin - 1.8 - k * 3.2 - r() * 2);
      }
    }
    // Hills are mostly out of the shadow box anyway: skip shadow casting there.
    this.scatter('elf_tree', trees, false);
    this.scatter('elf_foliage_small', tall, false);
    this.deadTrees(cemTrees);
    this.pines(pines);
    this.scatter('orc_stone_big', rocks.map((k) => ({ ...k, s: k.s * 2.4 })));
    this.scatter('elf_foliage_mid', bushes.map((b) => ({ ...b, y: heightAt(b.x, b.z) + 1.0 * b.s })));
  }

  /** Low graphics: no ground mist, grass or flowers. */
  setLowDetail(low: boolean) {
    this.mist.group.visible = !low;
    for (const g of this.grass) g.visible = !low;
  }

  openBarrier(instant = false) {
    this.barrierOpen = true;
    if (instant) this.barrier.visible = false;
  }

  /** True if the barrier blocks this position. */
  barrierBlocks(z: number) {
    return !this.barrierOpen && z < WORLD.barrierZ + 0.6;
  }

  update(dt: number, time: number, camTarget: THREE.Vector3) {
    this.time.value = time;
    windTime.value = time;
    this.mist.setCamera(camTarget);
    this.barrierMat.uniforms.t.value = time;
    if (this.barrierOpen && this.barrier.visible) {
      const a = (this.barrierMat.uniforms.a.value -= dt * 0.8);
      if (a <= 0) this.barrier.visible = false;
    }
    for (const [i, f] of this.flames.entries()) {
      const s = 1 + Math.sin(time * 13 + i) * 0.12 + Math.sin(time * 7.3 + i * 2) * 0.08;
      f.scale.set(1 / s, s, 1 / s);
    }
  }

  /** Push a circle out of static obstacles and keep it inside the playable area. */
  collide(p: THREE.Vector3, radius: number) {
    for (const o of this.obstacles) {
      const dx = p.x - o.x;
      const dz = p.z - o.z;
      const rr = o.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        p.x = o.x + (dx / d) * rr;
        p.z = o.z + (dz / d) * rr;
      }
    }
    p.x = THREE.MathUtils.clamp(p.x, -WORLD.halfWidth, WORLD.halfWidth);
    p.z = THREE.MathUtils.clamp(p.z, WORLD.zMin, WORLD.zMax);
    if (this.barrierBlocks(p.z)) p.z = WORLD.barrierZ + 0.6;
  }
}
