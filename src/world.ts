import * as THREE from 'three';
import { assets } from './assets';
import { blobShadow } from './character';
import { FogOfWar } from './fog';
import { FACTIONS, GLOVES_BANDITS, GLOVES_MURLOCS, MID_SPAWNERS, MINI_SPAWNER, MINI_SPAWNER_OF, MOBS, PROP_SPAWNERS, SPAWNERS, ZONES, type SpawnerDef, type FactionId, type ZoneId } from './config';
import {
  ARENA, BORDER, BORDER_GATE_R, BOSS_GUARDS, BRANCH_PATHS, CAMP_EXIT, CAMP_WALL, FORT, FOREST_MINI, GATE, GATE_GUARDS, ISLAND, LAND_BOSSES, LAND_TRAILS, MAP_BOX, PATH, PATH_W, GATES, RIDGE_POINTS, angleOf, coastDist, gateDist, edgePoint, heightAt, inCamp, inland, outside,
  pathAt, pathDist, progressAt, ridgeAway, ridgeDist, rimCliff, rimTrees, walkable, zoneAt, zoneIdAt, zoneWeights,
} from './island';
import type { Gate } from './island';
import {
  bakeGroundMaps, buildFlowers, buildGrass, buildGround, buildMist, buildOcean, buildPond, windTime, zoneTexture, type Pond,
} from './terrain';
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
 * A fixed spawner of one unit — a mob or a breakable prop (config SPAWNERS / PROP_SPAWNERS).
 * `unit` + `kind`: MOBS id or BREAKABLES kind; `id` keys its saved charge state; `charges`: cooldowns per kill / break;
 * `depth` 0..1: how far along its zone's stretch of the trail a mob sits (DEPTH scaling); `rot`: a prop's facing.
 */
export interface SpawnPoint {
  id: string; unit: 'mob' | 'prop'; kind: string; x: number; z: number; charges: number[]; zone: ZoneId; depth: number; rot: number;
}


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

/** Position in a local frame: `fwd` along angle a (0 = +Z), `side` to its local +X. */
const local = (cx: number, cz: number, a: number, side: number, fwd: number) =>
  ({ x: cx + side * Math.cos(a) + fwd * Math.sin(a), z: cz - side * Math.sin(a) + fwd * Math.cos(a) });
/** Position in the frame of the camp exit: `side` to the left as seen walking out, `fwd` outward. */
const campGate = (side: number, fwd: number) => local(CAMP_EXIT.x, CAMP_EXIT.z, Math.atan2(CAMP_EXIT.dirX, CAMP_EXIT.dirZ), side, fwd);
/** The gloves elite (bandit_veteran): between the pond and the trail out of the settlement. */
const GLOVES_AT: [number, number] = [20, -77];
/** Angle (0 = +Z) of the trail where it leaves a circle of radius r around a point, going backward or forward. */
function trailExit(cx: number, cz: number, r: number, forward: boolean) {
  const sc = progressAt(cx, cz);
  for (let s = sc; forward ? s < PATH.length : s > 0; s += forward ? 0.5 : -0.5) {
    const p = pathAt(s);
    if (Math.hypot(p.x - cx, p.z - cz) >= r) return Math.atan2(p.x - cx, p.z - cz);
  }
  return forward ? Math.PI : 0;
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
  private grass: THREE.Object3D[] = [];
  private sizeCache = new Map<string, THREE.Vector3>();
  private packCenters: [number, number][] = [];

  constructor(public faction: FactionId) {
    const maps = bakeGroundMaps(this.ponds);
    this.mapCanvas = maps.map;
    this.group.add(buildGround(maps.ground));
    const zoneTex = zoneTexture();
    this.group.add(buildOcean(this.time, maps.shoreTex));
    for (const p of this.ponds) {
      this.group.add(buildPond(p, this.time));
      this.obstacles.push({ x: p.x, z: p.z, r: p.r * 0.85 });
    }
    this.buildCamp();
    this.buildForest();
    this.buildBarrier();
    this.buildCemetery();
    this.buildOuterLands();
    this.buildRim();
    const free = (x: number, z: number) => this.free(x, z, 0.2);
    this.grass = [buildGrass(free, this.ponds), buildFlowers(free)];
    this.group.add(...this.grass);
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

  /** Like place(), but first slides the spot towards the island centre until it is walkable with `pad` room. */
  private placeInside(name: string, x: number, z: number, scale: number, rot: number, pad = 3, collide: number | 'auto' = 'auto') {
    for (let i = 0; i < 40 && !walkable(x, z, pad); i++) {
      const d = Math.hypot(ISLAND.cx - x, ISLAND.cz - z) || 1;
      x += (ISLAND.cx - x) / d;
      z += (ISLAND.cz - z) / d;
    }
    return this.place(name, x, z, scale, rot, collide);
  }

  /**
   * Instanced copies of a model (trees, rocks, poles). Items are split into 24 m tiles so each tile
   * has its own bounding sphere and off-screen tiles are frustum-culled.
   */
  private scatter(name: string, items: Inst[], shadow = true) {
    for (const band of bands(items)) this.scatterBand(name, band, shadow);
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

  /** Cheap low-poly pines for the rim (~30 triangles each vs ~2000 for the elf trees). */
  private pines(items: Inst[]) {
    const trunk = new THREE.CylinderGeometry(0.15, 0.25, 1.4, 5).translate(0, 0.7, 0);
    const c1 = new THREE.ConeGeometry(1.4, 2.6, 7).translate(0, 2.4, 0);
    const c2 = new THREE.ConeGeometry(1.0, 2.0, 7).translate(0, 3.6, 0);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2f, flatShading: true });
    const leafMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
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
    for (const band of bands(items)) this.deadTreeBand(band, color);
  }

  private deadTreeBand(items: Inst[], color: number) {
    if (!items.length) return;
    const trunk = new THREE.CylinderGeometry(0.12, 0.3, 2.6, 6).translate(0, 1.3, 0);
    const branch = new THREE.CylinderGeometry(0.04, 0.1, 1.5, 5).translate(0, 0.75, 0);
    const mat = new THREE.MeshLambertMaterial({ color, flatShading: true });
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
      && !this.packCenters.some(([x, z]) => Math.hypot(x - q.x, z - q.z) < 9);
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
    // breakable supply crates inside the camp, left and right of the spawn, clear of the walk to the exit
    const spots = [[6.5, -6], [8, -4.6], [6.6, 1.4], [7.9, 0.6], [-6, -4], [-7, -2.2], [-6.8, 2.6], [-6.2, 1.6]];
    PROP_SPAWNERS.camp.slice(0, spots.length).forEach((d, i) => {
      this.addProp('camp', i, d, spots[i][0], cz + spots[i][1], 'forest', i * 1.3);
    });
  }

  /** A spawner from the config; without `charges` it has one endless charge with the unit's own respawn time. */
  private addSpawn(id: string, d: SpawnerDef, x: number, z: number, zone: ZoneId, depth: number, rot: number) {
    const respawn = d.unit === 'mob' ? MOBS[d.id].respawn : BREAKABLES[d.id].respawn;
    this.spawns.push({ id, unit: d.unit, kind: d.id, x, z, charges: d.charges ?? [respawn], zone, depth, rot });
  }
  /** A breakable prop spawner from config PROP_SPAWNERS[group][i]. */
  private addProp(group: string, i: number, d: SpawnerDef, x: number, z: number, zone: ZoneId, rot: number) {
    this.addSpawn(`prop:${group}:${i}`, d, x, z, zone, 0, rot);
  }

  /** The camp's fire: model and a flickering flame, no gameplay. */
  private campfireDecor(x: number, z: number) {
    this.place(FACTIONS[this.faction].campfire, x, z, 0.42, 0, 0.8);
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.35, 1, 6).translate(0, 0.5, 0),
      new THREE.MeshBasicMaterial({ color: 0xffa020, transparent: true, opacity: 0.85 }),
    );
    flame.position.set(x, 0.15, z);
    this.group.add(flame);
    this.flames.push(flame);
  }

  /** Big houses at the user's map marks, each turned to face the nearest trail (long side along it). */
  private hubHouses() {
    const kit: [string, number, number][] = [
      ['house_Lv1', -10.2, -94.8], ['human_house_mid', 24.1, -90.3], ['house_Lv2', -37.8, -77.2], ['house_Lv1', -20, -61.3],
      ['human_house_mid', 15.5, -56.8], ['human_house_large', -20, -44.4], ['house_Lv2', 23.6, -18.4], ['house_Lv1', 15.5, -8.5],
    ];
    const curves = [PATH, ...BRANCH_PATHS];
    for (const [name, x0, z0] of kit) {
      let best = Infinity;
      let nx = x0;
      let nz = z0;
      for (const c of curves) {
        for (let i = 0; i < c.x.length; i += 2) {
          const d = (c.x[i] - x0) ** 2 + (c.z[i] - z0) ** 2;
          if (d < best) { best = d; nx = c.x[i]; nz = c.z[i]; }
        }
      }
      const d = Math.sqrt(best) || 1;
      // keep 5 m off the trail, clear of the camp wall, then step off the coast / ridge border until there is room
      let x = d < 5 ? nx + ((x0 - nx) / d) * 5 : x0;
      let z = d < 5 ? nz + ((z0 - nz) / d) * 5 : z0;
      const c = Math.hypot(x - ISLAND.campX, z - ISLAND.campZ) || 1;
      if (c < ISLAND.campR + 4) {
        x = ISLAND.campX + ((x - ISLAND.campX) / c) * (ISLAND.campR + 4);
        z = ISLAND.campZ + ((z - ISLAND.campZ) / c) * (ISLAND.campR + 4);
      }
      for (let k = 0; k < 20 && !walkable(x, z, 3); k++) {
        const n = outside(x, z) > -3 ? inland(x, z) : ridgeAway(x, z);
        x += n.x * 0.5;
        z += n.z * 0.5;
      }
      this.place(name, x, z, 0.5, Math.atan2(nx - x, nz - z));
      this.packCenters.push([x, z]);
    }
  }

  /** Three single murlocs beside the trail next to the gloves elite, two bandit pairs in the trees by it. */
  private glovesGuards() {
    const s0 = progressAt(24, -84);
    GLOVES_MURLOCS.forEach((d, i) => {
      const p = pathAt(s0 + (i - 1) * 9);
      // the side of the trail facing the elite
      const side = Math.sign((GLOVES_AT[0] - p.x) * p.tz - (GLOVES_AT[1] - p.z) * p.tx) || 1;
      const x = p.x + p.tz * side * (PATH_W + 2);
      const z = p.z - p.tx * side * (PATH_W + 2);
      this.packCenters.push([x, z]);
      this.addSpawn(`forest:gloves:m${i}`, d, x, z, 'forest', 0.3, 0);
    });
    const packs = [[14, -74], [27, -76]];
    GLOVES_BANDITS.forEach((d, i) => {
      const [px, pz] = packs[i >> 1];
      const x = px + (i & 1 ? 1.6 : -1.6);
      this.taken.push([x, pz]);
      this.addSpawn(`forest:gloves:b${i}`, d, x, pz, 'forest', 0.3, 0);
    });
    for (const p of packs) this.packCenters.push([p[0], p[1]]);
  }

  /** Wood north of the straight line from the settlement to the fort (hard to push through), bandits either side ([along, side] m). */
  private campToFort(r: () => number) {
    const ax = ISLAND.campX;
    const az = ISLAND.campZ;
    const len = Math.hypot(FORT.x - ax, FORT.z - az);
    const dx = (FORT.x - ax) / len;
    const dz = (FORT.z - az) / len;
    const at = ([u, v]: number[]) => ({ x: ax + u * dx - v * dz, z: az + u * dz + v * dx });
    const ok = (x: number, z: number) => this.free(x, z, 1.2) && pathDist(x, z) > PATH_W + 1
      && !inCamp(x, z, 1) && Math.hypot(x - FORT.x, z - FORT.z) > FORT.r + 1.5;
    const trees: Inst[] = [];
    for (const uv of [
      [14.5, -2], [16.5, -4.5], [17.5, -1.5], [19.5, -6], [20, -3], [22, -1.2], [22.5, -5], [24.5, -7.5], [25, -3],
      [27, -5.5], [28, -9], [29.5, -3.5], [30.5, -7], [32, -10],
    ]) {
      const { x, z } = at(uv);
      if (!ok(x, z)) continue;
      trees.push({ x, z, s: 0.6 + r() * 0.3, r: r() * 6, tint: leaf(r) });
      this.obstacles.push({ x, z, r: 0.5 });
    }
    this.scatter('elf_tree', trees);
    [[18, 1], [24, 1.5], [27.5, 0], [20.7, 6.9], [17.5, 4.5]].forEach((uv, i) => {
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
    let gi = 0;
    for (const [id, spots] of [['boss_guard', BOSS_GUARDS], ['gate_guard', GATE_GUARDS]] as const) {
      for (const p of spots) {
        this.packCenters.push([p.x, p.z]);
        this.taken.push([p.x, p.z]);
        this.addSpawn(`forest:guard:${gi++}`, { unit: 'mob', id }, p.x, p.z, 'forest', 0, 0);
      }
    }
    // Pinned: the mini-boss, the armour and gloves elites, «Громила» by the hills door; the rest spread along the trail up to the fort.
    this.mobsAlong([[s0, sFort - 28]], SPAWNERS.forest ?? [], 'forest', r, { bandit_warlord: FOREST_MINI, bandit_lumberjack: [-28, -82], bandit_veteran: GLOVES_AT, bandit_brute: [-44, -60] });
    this.campToFort(r);
    this.glovesGuards();

    // Lumber camp in the north-east of the forest
    const L = { x: 28, z: -68 };
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
    // Bandit fort around the boss, built from the enemy race's kit. The trail runs through two gates.
    const fx = FORT.x;
    const fz = FORT.z;
    const aIn = trailExit(fx, fz, FORT.r, false);
    const aOut = trailExit(fx, fz, FORT.r, true);
    this.palisade(fx, fz, FORT.r, [aIn, aOut], 0.36);
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
    // the second tower is a real one: a turret prop that can be destroyed (BREAKABLES.fort_tower_*), south of the boss, clear of the ridge border
    const tp = { x: fx - 1, z: fz + 6 };
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
    this.scatter('elf_tree', trees);
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
    this.mobsAlong([[s0, s1]], SPAWNERS.cemetery ?? [], 'cemetery', r);

    // Mausoleums, crypts and ruins, by angle (deg) and radius in the cemetery sector (slid inside the shore if needed)
    const pol = (deg: number, d: number) => ({ x: ISLAND.cx + Math.sin((deg * Math.PI) / 180) * d, z: ISLAND.cz + Math.cos((deg * Math.PI) / 180) * d });
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
    ins('undead_ruins_02', 70, 100, 0.45, r() * 6);
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

  // ---------- outer locations: mobs along their paths, a main boss, «Свирепый вожак» mini-bosses, Snow Pass trees ----------
  private buildOuterLands() {
    const r = rng(61);
    const PATH_OF: Partial<Record<ZoneId, number>> = { hills: 0, grove: 1, swamp: 2, dunes: 3, peaks: 4 };
    const BOSS_OF: Partial<Record<ZoneId, string>> = { peaks: 'elf_queen', hills: 'orc_shaman', grove: 'elf_priestess', swamp: 'murloc_king', dunes: 'sand_boar' };
    for (const zone of ['peaks', 'hills', 'grove'] as const) {
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
    }
    // Snow Pass: grey frosted trees, pines, bare trees, stumps, rocks and log piles
    const GREYS = [0xb4b8bd, 0xc6c9cc, 0xa3a8ae, 0xd3d5d7];
    const trees: Inst[] = [];
    const pines: Inst[] = [];
    const bare: Inst[] = [];
    const stumps: Inst[] = [];
    const rocks: Inst[] = [];
    const bigRocks: Inst[] = [];
    const logs: Inst[] = [];
    const inPass = () => ({ x: MAP_BOX.x + r() * MAP_BOX.size, z: MAP_BOX.z + r() * MAP_BOX.size });
    const okTree = (x: number, z: number) => zoneIdAt(x, z) === 'peaks' && this.free(x, z, 1.2) && !this.nearPack(x, z, 5) && gateDist(x, z) > 7
      && !LAND_TRAILS[4].some(([px, pz]) => Math.hypot(px - x, pz - z) < 4);
    for (const { x, z } of this.spread(70, 6, inPass, okTree)) {
      const k = r();
      const tint = GREYS[Math.floor(r() * GREYS.length)];
      if (k < 0.35) trees.push({ x, z, s: 0.55 + r() * 0.35, r: r() * 6, tint });
      else if (k < 0.75) pines.push({ x, z, s: 0.9 + r() * 0.4, r: r() * 6, tint });
      else bare.push({ x, z, s: 0.8 + r() * 0.4, r: r() * 6 });
      this.obstacles.push({ x, z, r: 0.5 });
    }
    for (const { x, z } of this.spread(45, 4, inPass, okTree)) {
      const k = r();
      const it = { x, z, s: 0, r: r() * 6, tint: GREYS[Math.floor(r() * GREYS.length)] };
      if (k < 0.3) stumps.push({ ...it, s: 0.3 + r() * 0.2 });
      else if (k < 0.75) rocks.push({ ...it, s: 0.6 + r() * 0.5 });
      else if (k < 0.92) { bigRocks.push({ ...it, s: 0.5 + r() * 0.3 }); this.obstacles.push({ x, z, r: 1 }); }
      else { logs.push({ ...it, s: 0.5 }); this.obstacles.push({ x, z, r: 0.8 }); }
    }
    this.scatter('elf_tree', trees);
    this.pines(pines);
    this.deadTrees(bare, 0x6e6a66);
    this.scatter('elf_tree_root_1', stumps, false);
    this.scatter('elf_rock_small', rocks, false);
    this.scatter('elf_rock_big', bigRocks);
    this.scatter('elf_log_pile', logs);
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

  /** Low graphics: no ground mist, grass or flowers. */
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
    const b = BORDER - ridgeDist(p.x, p.z);
    if (b > 0 && gateDist(p.x, p.z) > BORDER_GATE_R) {
      const n = ridgeAway(p.x, p.z);
      p.x += n.x * b;
      p.z += n.z * b;
    }
  }
}
