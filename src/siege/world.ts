// The siege map: forest road -> castle wall with a gate -> courtyard and keep. A strip level on flat ground (y = 0)
// built from the island's own systems: the ground shader and GroundLayers, the grass field, worn-path road, cobbles,
// decor, mist and scenery materials, baked/instanced props, grid collisions.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { assets } from '../assets';
import { applyScenery, patchScenery, scenery, type SceneryLook } from '../atmos';
import { GFX, VIEW, ZONE_LIGHT, ZONES, type FactionId, type ZoneDef } from '../config';
import { buildDecor, type DecorArea } from '../decor';
import type { EnvOut, GameWorld } from '../gameworld';
import { PATH_W } from '../island';
import { bakeStatic } from '../staticbatch';
import {
  GroundLayers, bakeZoneGround, buildCobbles, buildGrassField, buildGround, buildMist, drawRoads, flatZoneTexture, groundColorTexture, windTime, type MapBox,
} from '../terrain';
import { LEAF_TINTS, rng, type Obstacle, type SpawnPoint } from '../world';
import { AREAS, FOREST_HALF_W, FOREST_PACKS, GATE, GATE_SQUAD, KEEP, ROAD, ROAD_HALF_W, START, WELL, YARD } from './layout';
import { SIEGE_GATE_ID } from './types';

const ENV = VIEW.env;
/** Placed models whose largest extent (m) is under this cast no shadow (same rule as the island). */
const NO_SHADOW_UNDER = 0.6;
const GRID_CELL = 8;
const GRID_PAD = 12;
const GATE_OPEN_S = 1.2;

// Minimap picture: x -56..56, z 56..226.
const X0 = -56;
const Z0 = 56;
const W = 112;
const H = 170;
/** The square the ground shader, grass layers and mist cover (the island's MAP_BOX counterpart). */
const BOX: MapBox = { x: -92, z: 44, size: 184 };
const GROUND_PX = GFX.mobile ? 1024 : 2048;
/** Baked minimap: pixels per metre. */
const MAP_PPM = 2;

const WALL_Y = 7;
const FRONT_Z0 = GATE.z - GATE.thick / 2;
const FRONT_Z1 = GATE.z + GATE.thick / 2;
const SIDE_T = 2;
const BACK_Z = KEEP.z1 - 2;
const TILE = 4;
/** The gatehouse over the passage: its underside is the opening's height; the portcullis hides inside it when raised. */
const OPEN_H = 5.8;
const GATEHOUSE_TOP = 12;
const PORT_H = 5.6;
const PORT_LIFT = GATEHOUSE_TOP - 0.1 - PORT_H;

const FOREST = ZONES.find((z) => z.id === 'forest')!;
const SIEGE_ZONE: ZoneDef = { ...FOREST, name: 'Осада замка' };

const FOLIAGE: Record<string, number> = { elf_tree: 0.55, elf_foliage_small: 4, elf_foliage_mid: 6 };
/** A scattered model (World.scatter's Inst). */
interface Inst { x: number; z: number; s: number; r: number; tint?: number; y?: number }
const bandKey = (x: number, z: number) => Math.floor(x / 24) * 1000 + Math.floor(z / 24);
const lookOf = (name: string): SceneryLook => ({ sway: FOLIAGE[name] ?? 0, base: 1 });

const ALL_SEEN: GameWorld['fog'] = {
  dirty: false,
  load: () => true,
  update() {},
  reveal: () => false,
  isExplored: () => true,
  serialize: () => '',
  drawOnMap() {},
  open() {},
  revealAll() {},
  reset() {},
};

const M4 = new THREE.Matrix4();
const QT = new THREE.Quaternion();
const V3 = new THREE.Vector3();
const V3S = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Axis-aligned box with UVs in metres / TILE (a brick texture keeps its scale) and an optional vertex colour. */
function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color?: number) {
  const w = x1 - x0;
  const h = y1 - y0;
  const d = z1 - z0;
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // face order: +x -x (z,y), +y -y (x,z), +z -z (x,y), four vertices each
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let k = 0; k < uv.count; k++) uv.setXY(k, (uv.getX(k) * dims[k >> 2][0]) / TILE, (uv.getY(k) * dims[k >> 2][1]) / TILE);
  g.translate(x0 + w / 2, y0 + h / 2, z0 + d / 2);
  if (color !== undefined) {
    const c = new THREE.Color(color);
    const arr: number[] = [];
    for (let k = 0; k < g.attributes.position.count; k++) arr.push(c.r, c.g, c.b);
    g.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
  }
  return g;
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function stoneTexture() {
  const c = canvas(256, 256);
  const g = c.getContext('2d')!;
  const r = rng(31);
  g.fillStyle = '#9b917e';
  g.fillRect(0, 0, 256, 256);
  const rows = 8;
  const rh = 256 / rows;
  for (let j = 0; j < rows; j++) {
    const bw = 64;
    const off = j % 2 ? bw / 2 : 0;
    for (let i = -1; i < 4; i++) {
      const l = 0.62 + r() * 0.2;
      g.fillStyle = `hsl(${36 + r() * 8}, ${10 + r() * 8}%, ${l * 100}%)`;
      g.fillRect(i * bw + off + 1, j * rh + 1, bw - 2, rh - 2);
    }
  }
  g.strokeStyle = 'rgba(40,34,26,0.5)';
  g.lineWidth = 2;
  for (let j = 0; j <= rows; j++) { g.beginPath(); g.moveTo(0, j * rh); g.lineTo(256, j * rh); g.stroke(); }
  for (let j = 0; j < rows; j++) {
    const off = j % 2 ? 32 : 0;
    for (let i = -1; i < 5; i++) { g.beginPath(); g.moveTo(i * 64 + off, j * rh); g.lineTo(i * 64 + off, (j + 1) * rh); g.stroke(); }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Distance of the road centre line at depth z. */
function roadX(z: number) {
  for (let i = 0; i < ROAD.length - 1; i++) {
    const [ax, az] = ROAD[i];
    const [bx, bz] = ROAD[i + 1];
    if (z <= az && z >= bz) return ax + ((bx - ax) * (az - z)) / (az - bz);
  }
  return ROAD[ROAD.length - 1][0];
}

/** Where the island's decor (buildDecor) may grow here: the forest around the road, the woods beside the castle; never the yard or walls. */
const DECOR_AREA: DecorArea = {
  box: BOX,
  zoneAt: () => 'forest',
  walkable(x, z, pad) {
    const ax = Math.abs(x);
    if (ax > 44 - pad || z > 224 - pad || z < BOX.z + 8) return false;
    if (z > FRONT_Z1 + 0.6 + pad) return true;
    if (z > FRONT_Z0 - 0.6 - pad) return ax > GATE.wallHalfLen + 2 + pad;
    return ax > YARD.x1 + SIDE_T + 0.6 + pad;
  },
  trailDist: (x, z) => (z > FRONT_Z1 && z < ROAD[0][1] + 4 ? Math.abs(x - roadX(z)) - ROAD_HALF_W + PATH_W * 0.5 : 99),
  inCamp: () => false,
  height: () => 0,
  density: 1,
};

/** The nearest point of the walkable rectangle to p, written back when p is outside it; returns the squared move. */
function clampRect(p: THREE.Vector3, x0: number, x1: number, z0: number, z1: number, out: { x: number; z: number }) {
  out.x = Math.min(x1, Math.max(x0, p.x));
  out.z = Math.min(z1, Math.max(z0, p.z));
  return (out.x - p.x) ** 2 + (out.z - p.z) ** 2;
}

function pushOut(p: THREE.Vector3, o: Obstacle, radius: number) {
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

const CLAMP = { x: 0, z: 0 };

export class SiegeWorld implements GameWorld {
  readonly group = new THREE.Group();
  readonly obstacles: Obstacle[] = [];
  readonly spawns: readonly SpawnPoint[] = [];
  readonly bosses: readonly { mob: string; x: number; z: number }[] = [];
  readonly areas = AREAS.map((a) => ({ ...a }));
  readonly fires: THREE.Object3D[] = [];
  readonly fortExit = { x: START.x, z: START.z - 10, tx: 0, tz: -1 };
  readonly fog = ALL_SEEN;

  /** Everything this world created and must free (never asset sources or shared scenery materials). */
  private own: { dispose(): void }[] = [];
  private props: THREE.Object3D[] = [];
  private sizes = new Map<string, THREE.Vector3>();
  private minYs = new Map<string, number>();
  private grid = new Map<number, Obstacle[]>();
  private gateObs: Obstacle[] = [];
  private portcullis!: THREE.Mesh;
  private trimMat!: THREE.Material;
  private flames!: THREE.InstancedMesh;
  /** Contact shadows and grass holes under everything placed (painted while building, then uploaded). */
  private layers!: GroundLayers;
  private colorMap!: THREE.Texture;
  private grassField!: ReturnType<typeof buildGrassField>;
  private mist!: ReturnType<typeof buildMist>;
  private time = { value: 0 };
  /** Grass, decor and the rest of the knee-high clutter (hidden on low graphics). */
  private grass: THREE.Object3D[] = [];
  /** The courtyard's voronoi cobbles (hidden on low graphics: one big fragment-heavy decal). */
  private paving: THREE.Object3D[] = [];
  /** Trunk spots (mushrooms and ferns grow round them). */
  private treeSpots: [number, number][] = [];
  /** Meshes made here (ground decals, grass, decor, mist): their geometry and materials are freed with the world. */
  private disposables: THREE.Object3D[] = [];
  private tint = rng(7102);
  private scatterCache = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material | THREE.Material[] }[]>();
  private flamePos: THREE.Vector3[] = [];
  /** 0 closed .. 1 open; < 0 = idle closed. */
  private gateT = -1;
  private gateOpen = false;
  private groundCanvas!: HTMLCanvasElement;
  private mapCanvas = canvas(Math.round(W * MAP_PPM), Math.round(H * MAP_PPM));

  constructor(_faction: FactionId) {
    this.group.name = 'siege-world';
    const r = rng(7101);
    const stone = patchScenery(new THREE.MeshLambertMaterial({ map: stoneTexture() }), { base: 1 });
    const trimMat = this.trimMat = patchScenery(new THREE.MeshLambertMaterial({ vertexColors: true }), { base: 1 });
    const roofMat = patchScenery(new THREE.MeshLambertMaterial({ color: 0x8a5a44, flatShading: true }), { base: 0.6 });
    this.own.push(stone, trimMat, roofMat, stone.map!);

    this.buildGround();
    this.buildWalls(stone, trimMat, roofMat);
    this.buildDressing(r);
    this.buildBraziers();
    this.buildCover();
    this.bakeMap();

    bakeStatic(this.group, this.props, [this.portcullis]);
    this.buildGrid();
  }

  // ---------- build ----------

  private sizeOf(name: string) {
    let s = this.sizes.get(name);
    if (!s) {
      const m = assets.clone(name);
      m.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(m);
      s = b.getSize(new THREE.Vector3());
      this.sizes.set(name, s);
      this.minYs.set(name, b.min.y < -0.3 ? b.min.y : 0);
    }
    return s;
  }

  /** Cloned model on the ground (the island's place(): level size, shadow cut-off, scenery look); `solid` = collider radius. */
  private put(name: string, x: number, z: number, scale: number, rot: number, solid = 0, y?: number) {
    if (!assets.has(name)) { console.warn('siege: model not loaded:', name); return; }
    scale *= ENV;
    const sz = this.sizeOf(name);
    const m = assets.clone(name);
    m.scale.multiplyScalar(scale);
    m.position.set(x, y ?? Math.max(0, -this.minYs.get(name)!) * scale, z);
    m.rotation.y = rot;
    const shadow = Math.max(sz.x, sz.y, sz.z) * scale >= NO_SHADOW_UNDER;
    m.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) { mesh.castShadow = shadow; mesh.receiveShadow = true; }
    });
    applyScenery(m, lookOf(name));
    this.group.add(m);
    this.props.push(m);
    this.groundUnder(name, x, z, sz.x * scale, sz.y * scale, sz.z * scale);
    if (solid > 0) this.obstacles.push({ x, z, r: solid * ENV });
  }

  /** Contact shadow under a model (footprint sx × sz, height sy, already scaled) and no grass inside it; trees keep grass round the trunk (World.groundUnder). */
  private groundUnder(name: string, x: number, z: number, sx: number, sy: number, sz: number) {
    if (sy < 0.25) return;
    const fr = Math.max(sx, sz) * 0.5;
    const k = Math.min(0.6, 0.18 + sy * 0.07);
    this.layers.occlude(x, z, fr + 0.6, k * 0.65);
    this.layers.occlude(x, z, Math.max(0.45, fr * 0.45), k);
    const foliage = name in FOLIAGE;
    this.layers.clear(x, z, foliage ? Math.min(0.5, fr * 0.25) : fr * 0.8);
    if (foliage && sy > 2) this.treeSpots.push([x, z]);
  }

  /** Instanced copies of a model in 24 m bands (World.scatter): a tint per instance, contact shade and grass holes under each. */
  private scatter(name: string, items: Inst[], shadow = true) {
    if (!items.length) return;
    if (!assets.has(name)) { console.warn('siege: model not loaded:', name); return; }
    const sz = this.sizeOf(name);
    const lit: Inst[] = [];
    const flat: Inst[] = [];
    for (const t of items) {
      this.groundUnder(name, t.x, t.z, sz.x * t.s * ENV, sz.y * t.s * ENV, sz.z * t.s * ENV);
      if (shadow && Math.max(sz.x, sz.y, sz.z) * t.s * ENV >= NO_SHADOW_UNDER) lit.push(t); else flat.push(t);
    }
    for (const [list, casts] of [[lit, true], [flat, false]] as const) {
      const bands = new Map<number, Inst[]>();
      for (const t of list) {
        const key = bandKey(t.x, t.z);
        const b = bands.get(key);
        if (b) b.push(t); else bands.set(key, [t]);
      }
      for (const band of bands.values()) this.scatterBand(name, band, casts);
    }
  }

  private scatterBand(name: string, items: Inst[], shadow: boolean) {
    const col = new THREE.Color();
    for (const part of this.partsOf(name)) {
      const im = new THREE.InstancedMesh(part.geo, part.mat, items.length);
      for (let i = 0; i < items.length; i++) {
        const t = items[i];
        im.setMatrixAt(i, M4.compose(V3.set(t.x, t.y ?? 0, t.z), QT.setFromAxisAngle(UP, t.r), V3S.setScalar(t.s * ENV)));
        im.setColorAt(i, col.set(t.tint ?? 0xffffff));
      }
      im.castShadow = shadow;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      this.group.add(im);
    }
  }

  /** A model's meshes baked into model space, same-material parts merged, with the scenery look applied (shared by every band). */
  private partsOf(name: string) {
    let parts = this.scatterCache.get(name);
    if (parts) return parts;
    parts = [];
    const src = assets.clone(name);
    src.updateMatrixWorld(true);
    const same = new Map<string, THREE.Mesh[]>();
    src.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = Array.isArray(mesh.material) ? mesh.material.map((x) => x.id).join(',') : mesh.material.id;
      const key = `${mat}|${Object.keys(mesh.geometry.attributes).sort().join()}|${mesh.geometry.index ? 1 : 0}`;
      const list = same.get(key);
      if (list) list.push(mesh); else same.set(key, [mesh]);
    });
    const patch = (x: THREE.Material) => scenery(x, lookOf(name));
    for (const list of same.values()) {
      const geos = list.map((mesh) => mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
      const merged = geos.length > 1 && !Array.isArray(list[0].material) ? mergeGeometries(geos) : null;
      const out = merged ? [merged] : geos;
      for (let i = 0; i < out.length; i++) {
        const mat = list[merged ? 0 : i].material;
        parts.push({ geo: out[i], mat: Array.isArray(mat) ? mat.map(patch) : patch(mat) });
        this.own.push(out[i]);
      }
      if (merged) for (const g of geos) g.dispose();
    }
    this.scatterCache.set(name, parts);
    return parts;
  }

  private buildGround() {
    const { ground, grass } = bakeZoneGround(BOX, 'forest', GROUND_PX);
    this.groundCanvas = ground;
    const ppm = ground.width / BOX.size;
    const g = ground.getContext('2d')!;
    const fill = (c: CanvasRenderingContext2D, k: number, x0: number, x1: number, z0: number, z1: number) =>
      c.fillRect((x0 - BOX.x) * k, (z0 - BOX.z) * k, (x1 - x0) * k, (z1 - z0) * k);
    const yard = { x0: YARD.x0, x1: YARD.x1, z0: KEEP.z1, z1: FRONT_Z0 };
    const passage = { x0: -GATE.halfW, x1: GATE.halfW, z0: FRONT_Z0 - 2, z1: FRONT_Z1 };
    // the road runs on to the gate passage
    const line: [number, number][] = ROAD.map(([x, z]) => [x, Math.max(z, GATE.z)]);

    // dirt apron along the outer wall faces, the worn road (the island's trail layers), packed earth under the paving
    g.fillStyle = 'rgba(96,80,52,0.45)';
    fill(g, ppm, -GATE.wallHalfLen, GATE.wallHalfLen, FRONT_Z1, FRONT_Z1 + 1.6);
    fill(g, ppm, -YARD.x1 - SIDE_T - 1.4, -YARD.x1 - SIDE_T, BACK_Z, FRONT_Z0);
    fill(g, ppm, YARD.x1 + SIDE_T, YARD.x1 + SIDE_T + 1.4, BACK_Z, FRONT_Z0);
    drawRoads(g, [line], (x) => (x - BOX.x) * ppm, (z) => (z - BOX.z) * ppm, ppm, ROAD_HALF_W * 2, true);
    drawRoads(g, [line], (x) => (x - BOX.x) * ppm, (z) => (z - BOX.z) * ppm, ppm, ROAD_HALF_W * 2);
    g.fillStyle = '#8f8068';
    fill(g, ppm, yard.x0 - 0.6, yard.x1 + 0.6, yard.z0, yard.z1);
    fill(g, ppm, passage.x0, passage.x1, passage.z0, passage.z1);

    // no grass on the road, in the yard, in the passage or on the aprons (GroundLayers reads this canvas)
    const gc = grass.getContext('2d')!;
    const gp = grass.width / BOX.size;
    gc.globalCompositeOperation = 'multiply';
    gc.fillStyle = gc.strokeStyle = 'rgb(0,255,255)';
    gc.lineCap = gc.lineJoin = 'round';
    for (const [w, a] of [[ROAD_HALF_W * 3.2, 0.45], [ROAD_HALF_W * 2.4, 1]]) {
      gc.globalAlpha = a;
      gc.lineWidth = w * gp;
      gc.beginPath();
      line.forEach(([x, z], i) => (i ? gc.lineTo((x - BOX.x) * gp, (z - BOX.z) * gp) : gc.moveTo((x - BOX.x) * gp, (z - BOX.z) * gp)));
      gc.stroke();
    }
    gc.globalAlpha = 1;
    fill(gc, gp, yard.x0 - 0.6, yard.x1 + 0.6, yard.z0, yard.z1);
    fill(gc, gp, passage.x0, passage.x1, passage.z0, passage.z1);
    fill(gc, gp, -GATE.wallHalfLen, GATE.wallHalfLen, FRONT_Z1, FRONT_Z1 + 1.6);
    fill(gc, gp, -YARD.x1 - SIDE_T - 1.4, -YARD.x1 - SIDE_T, BACK_Z, FRONT_Z0);
    fill(gc, gp, YARD.x1 + SIDE_T, YARD.x1 + SIDE_T + 1.4, BACK_Z, FRONT_Z0);

    this.colorMap = groundColorTexture(ground);
    this.layers = new GroundLayers(grass, BOX, false);
    const mesh = buildGround(this.colorMap, this.layers, BOX, true);
    this.group.add(mesh);
    this.own.push(this.colorMap, mesh.geometry, mesh.material as THREE.Material);

    // the courtyard and the passage are cobbled like the camp (the short lane keeps the shader's road term valid)
    this.paving.push(
      buildCobbles({ x: 0, z: WELL.z, r: 0 }, { x: 0, z: KEEP.door.z }, yard),
      buildCobbles({ x: 0, z: GATE.z, r: 0 }, { x: 0, z: FRONT_Z1 + 4 }, passage),
    );
    for (const p of this.paving) {
      this.group.add(p);
      this.disposables.push(p);
    }
  }

  private buildWalls(stone: THREE.Material, trimMat: THREE.Material, roofMat: THREE.Material) {
    const x1 = YARD.x1;
    const walls = [
      // front wall either side of the passage, side walls, back wall either side of the keep
      box(GATE.halfW, GATE.wallHalfLen, 0, WALL_Y, FRONT_Z0, FRONT_Z1),
      box(-GATE.wallHalfLen, -GATE.halfW, 0, WALL_Y, FRONT_Z0, FRONT_Z1),
      box(x1, x1 + SIDE_T, 0, WALL_Y, BACK_Z, FRONT_Z0),
      box(-x1 - SIDE_T, -x1, 0, WALL_Y, BACK_Z, FRONT_Z0),
      box(14, x1 + SIDE_T, 0, WALL_Y, BACK_Z, KEEP.z1),
      box(-x1 - SIDE_T, -14, 0, WALL_Y, BACK_Z, KEEP.z1),
      // gatehouse over the passage
      box(-5.5, 5.5, OPEN_H, GATEHOUSE_TOP, FRONT_Z0, FRONT_Z1),
      // keep: body and the upper block
      box(-14, 14, 0, 11, KEEP.z0, KEEP.z1),
      box(-8, 8, 11, 15.5, KEEP.z0 + 1.5, KEEP.z1 - 1.5),
    ];
    const wallGeo = mergeGeometries(walls);
    walls.forEach((b) => b.dispose());
    const wall = new THREE.Mesh(wallGeo, stone);
    wall.castShadow = wall.receiveShadow = true;
    this.group.add(wall);
    this.own.push(wallGeo);

    // merlons: one instanced mesh for every crenellation
    const merlonGeo = box(-0.5, 0.5, 0, 0.9, -0.35, 0.35);
    const spots: [number, number, number, number][] = [];
    const along = (xa: number, za: number, xb: number, zb: number, y: number) => {
      const len = Math.hypot(xb - xa, zb - za);
      const n = Math.floor(len / 2);
      const rot = Math.abs(xb - xa) > Math.abs(zb - za) ? 0 : Math.PI / 2;
      for (let i = 0; i <= n; i++) spots.push([xa + ((xb - xa) * i) / Math.max(1, n), y, za + ((zb - za) * i) / Math.max(1, n), rot]);
    };
    for (const s of [-1, 1]) {
      const a = 8.5 * s;
      const b = (GATE.wallHalfLen - 2.5) * s;
      along(a, FRONT_Z0 + 0.35, b, FRONT_Z0 + 0.35, WALL_Y);
      along(a, FRONT_Z1 - 0.35, b, FRONT_Z1 - 0.35, WALL_Y);
      const sx = (x1 + 0.35) * s;
      const sx2 = (x1 + SIDE_T - 0.35) * s;
      along(sx, BACK_Z + 2.5, sx, FRONT_Z0 - 1, WALL_Y);
      along(sx2, BACK_Z + 2.5, sx2, FRONT_Z0 - 1, WALL_Y);
      along(15 * s, BACK_Z + 0.35, (x1 + 1) * s, BACK_Z + 0.35, WALL_Y);
      along(15 * s, KEEP.z1 - 0.35, (x1 + 1) * s, KEEP.z1 - 0.35, WALL_Y);
      along(13.65 * s, KEEP.z0 + 2.5, 13.65 * s, KEEP.z1 - 2.5, 11);
      along(7.65 * s, KEEP.z0 + 3, 7.65 * s, KEEP.z1 - 3, 15.5);
    }
    along(-12, KEEP.z1 - 0.35, 12, KEEP.z1 - 0.35, 11);
    along(-12, KEEP.z0 + 0.35, 12, KEEP.z0 + 0.35, 11);
    along(-6, KEEP.z1 - 1.85, 6, KEEP.z1 - 1.85, 15.5);
    along(-6, KEEP.z0 + 1.85, 6, KEEP.z0 + 1.85, 15.5);
    const merlons = new THREE.InstancedMesh(merlonGeo, stone, spots.length);
    for (let i = 0; i < spots.length; i++) {
      const [x, y, z, rot] = spots[i];
      merlons.setMatrixAt(i, M4.compose(V3.set(x, y, z), QT.setFromAxisAngle(UP, rot), V3S.set(1, 1, 1)));
    }
    merlons.castShadow = merlons.receiveShadow = true;
    merlons.computeBoundingSphere();
    this.group.add(merlons);
    this.own.push(merlonGeo);

    // towers: unit shaft (radius 2.5-2.7, 10 m) and cone roof, instanced with a height scale
    const shaftGeo = new THREE.CylinderGeometry(2.5, 2.7, 10, 14, 1).translate(0, 5, 0);
    const suv = shaftGeo.attributes.uv;
    for (let k = 0; k < suv.count; k++) suv.setXY(k, suv.getX(k) * 4, suv.getY(k) * 2.5);
    const roofGeo = new THREE.ConeGeometry(3.2, 4.4, 14).translate(0, 2.2, 0);
    const towers: [number, number, number][] = [
      [5.5, GATE.z, 1.2], [-5.5, GATE.z, 1.2],
      [GATE.wallHalfLen, GATE.z, 1.05], [-GATE.wallHalfLen, GATE.z, 1.05],
      [x1 + 1, BACK_Z + 1, 0.95], [-x1 - 1, BACK_Z + 1, 0.95],
      [14, KEEP.z1, 1.4], [-14, KEEP.z1, 1.4], [14, KEEP.z0, 1.4], [-14, KEEP.z0, 1.4],
    ];
    const shafts = new THREE.InstancedMesh(shaftGeo, stone, towers.length);
    const roofs = new THREE.InstancedMesh(roofGeo, roofMat, towers.length);
    for (let i = 0; i < towers.length; i++) {
      const [x, z, sy] = towers[i];
      shafts.setMatrixAt(i, M4.compose(V3.set(x, 0, z), QT.identity(), V3S.set(1, sy, 1)));
      roofs.setMatrixAt(i, M4.compose(V3.set(x, 10 * sy, z), QT.identity(), V3S.set(1, 1, 1)));
      this.obstacles.push({ x, z, r: 2.6 });
    }
    for (const m of [shafts, roofs]) { m.castShadow = m.receiveShadow = true; m.computeBoundingSphere(); this.group.add(m); }
    this.own.push(shaftGeo, roofGeo);

    // trim: keep door and slits, banners, gate frame (one vertex-coloured mesh)
    const D = 0x2a2018;
    const RED = 0x8a2630;
    const trim: THREE.BufferGeometry[] = [
      box(-1.7, 1.7, 0, 4.4, KEEP.z1, KEEP.z1 + 0.25, D),
      box(-2.2, -1.7, 0, 4.9, KEEP.z1, KEEP.z1 + 0.4, 0x6a5a48),
      box(1.7, 2.2, 0, 4.9, KEEP.z1, KEEP.z1 + 0.4, 0x6a5a48),
      box(-2.2, 2.2, 4.4, 4.9, KEEP.z1, KEEP.z1 + 0.4, 0x6a5a48),
      box(-1.0, 1.0, 5.3, 8.3, KEEP.z1, KEEP.z1 + 0.15, RED),
      box(-5.6, -4.2, 4.5, 9.5, KEEP.z1, KEEP.z1 + 0.15, RED),
      box(4.2, 5.6, 4.5, 9.5, KEEP.z1, KEEP.z1 + 0.15, RED),
      box(-1.9, -0.5, 7, 11, FRONT_Z1, FRONT_Z1 + 0.15, RED),
      box(0.5, 1.9, 7, 11, FRONT_Z1, FRONT_Z1 + 0.15, RED),
      // the frame stands proud of the wall ends and the gatehouse underside on every side: shared faces z-fight
      box(-GATE.halfW - 0.3, -GATE.halfW + 0.06, 0, OPEN_H + 0.04, FRONT_Z0 - 0.06, FRONT_Z1 + 0.2, 0x5a4a38),
      box(GATE.halfW - 0.06, GATE.halfW + 0.3, 0, OPEN_H + 0.04, FRONT_Z0 - 0.06, FRONT_Z1 + 0.2, 0x5a4a38),
      box(-GATE.halfW - 0.3, GATE.halfW + 0.3, OPEN_H - 0.36, OPEN_H + 0.04, FRONT_Z0 - 0.06, FRONT_Z1 + 0.2, 0x5a4a38),
    ];
    for (const sx of [-8, -4, 4, 8]) trim.push(box(sx - 0.3, sx + 0.3, 5.2, 7, KEEP.z1, KEEP.z1 + 0.1, D));
    for (const s of [-1, 1]) trim.push(box(s * 11 - 0.3, s * 11 + 0.3, 4.2, 6, KEEP.z1, KEEP.z1 + 0.1, D));
    this.addTrim(trim, trimMat);

    // portcullis: iron bars across the passage, raised into the gatehouse by openGate
    const bars: THREE.BufferGeometry[] = [];
    for (let x = -2.75; x <= 2.76; x += 0.5) bars.push(box(x - 0.07, x + 0.07, 0, PORT_H, -0.07, 0.07, 0x34343a));
    for (const y of [0.9, 2.2, 3.5, 4.8]) bars.push(box(-2.9, 2.9, y - 0.07, y + 0.07, -0.1, 0.1, 0x34343a));
    const portGeo = mergeGeometries(bars);
    bars.forEach((b) => b.dispose());
    this.portcullis = new THREE.Mesh(portGeo, trimMat);
    this.portcullis.position.set(0, 0, GATE.z);
    this.portcullis.castShadow = true;
    this.group.add(this.portcullis);
    this.own.push(portGeo);

    // contact shade on the ground along the wall bases
    const shade = (xa: number, za: number, xb: number, zb: number) => {
      const n = Math.max(1, Math.ceil(Math.hypot(xb - xa, zb - za) / 3));
      for (let i = 0; i <= n; i++) this.layers.occlude(xa + ((xb - xa) * i) / n, za + ((zb - za) * i) / n, 2.2, 0.4);
    };
    for (const s of [-1, 1]) {
      shade(s * x1, BACK_Z, s * x1, FRONT_Z0);
      shade(s * (x1 + SIDE_T), BACK_Z, s * (x1 + SIDE_T), FRONT_Z0);
    }
    shade(-x1, FRONT_Z0, -GATE.halfW, FRONT_Z0);
    shade(GATE.halfW, FRONT_Z0, x1, FRONT_Z0);
    shade(-GATE.wallHalfLen, FRONT_Z1, -GATE.halfW, FRONT_Z1);
    shade(GATE.halfW, FRONT_Z1, GATE.wallHalfLen, FRONT_Z1);

    // closed gate: a row of circles across the passage, removed once the portcullis is up
    for (const x of [-2.4, -0.8, 0.8, 2.4]) this.gateObs.push({ x, z: GATE.z, r: 1.3 });
  }

  private addTrim(parts: THREE.BufferGeometry[], mat: THREE.Material) {
    const geo = mergeGeometries(parts);
    parts.forEach((p) => p.dispose());
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);
    this.own.push(geo);
  }

  private buildBraziers() {
    const at: [number, number][] = [[-4.5, 127], [4.5, 127], [-4, 84.5], [4, 84.5], [-14, 112], [14, 112]];
    const parts: THREE.BufferGeometry[] = [];
    for (const [x, z] of at) {
      parts.push(box(x - 0.08, x + 0.08, 0, 0.9, z - 0.08, z + 0.08, 0x2c2a28), box(x - 0.38, x + 0.38, 0.9, 1.15, z - 0.38, z + 0.38, 0x3a3836));
      const f = new THREE.Object3D();
      f.position.set(x, 1.15, z);
      this.fires.push(f);
      this.flamePos.push(f.position);
      this.obstacles.push({ x, z, r: 0.45 });
    }
    this.addTrim(parts, this.trimMat);
    const geo = new THREE.ConeGeometry(0.22, 0.75, 6).translate(0, 0.37, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffa43a });
    this.flames = new THREE.InstancedMesh(geo, mat, at.length);
    this.flames.frustumCulled = false;
    this.group.add(this.flames);
    this.own.push(geo, mat);
    this.flicker(0);
  }

  private buildDressing(r: () => number) {
    // spots mobs stand on at the start: no scenery with a collider there
    const avoid: [number, number][] = [...FOREST_PACKS, ...GATE_SQUAD].map((p) => [p.at.x, p.at.z]);
    avoid.push([9, 146], [-9, 146]);
    const clear = (x: number, z: number, d: number) => !avoid.some(([ax, az]) => Math.hypot(ax - x, az - z) < d);
    const trees: [number, number][] = [];
    const far = (x: number, z: number, d: number) => !trees.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < d);
    const leafTint = () => LEAF_TINTS[Math.floor(this.tint() * LEAF_TINTS.length)];
    const wood: Inst[] = [];
    const tall: Inst[] = [];
    const bushes: Inst[] = [];
    const rocks: Inst[] = [];
    const stones: Inst[] = [];
    const roots: Inst[] = [];
    const tree = (x: number, z: number, solid: boolean) => {
      trees.push([x, z]);
      wood.push({ x, z, s: 0.55 + r() * 0.35, r: r() * 6, tint: leafTint() });
      if (solid) this.obstacles.push({ x, z, r: 0.5 * ENV });
    };

    // tree walls of the road corridor, then the sparser woods round the castle
    for (let i = 0, n = 0; i < 700 && n < 120; i++) {
      const side = r() < 0.5 ? -1 : 1;
      const x = side * (12.5 + r() * 18);
      const z = FRONT_Z1 + 2 + r() * 90;
      if (far(x, z, 3.4)) { tree(x, z, false); n++; }
    }
    for (let i = 0, n = 0; i < 400 && n < 36; i++) {
      const x = (r() < 0.5 ? -1 : 1) * (30 + r() * 24);
      const z = 130 + r() * 94;
      if (far(x, z, 4)) { tree(x, z, false); n++; }
    }
    for (let i = 0, n = 0; i < 500 && n < 46; i++) {
      const x = (r() < 0.5 ? -1 : 1) * (YARD.x1 + SIDE_T + 3 + r() * 24);
      const z = 58 + r() * 70;
      if (far(x, z, 4)) { tree(x, z, false); n++; }
    }
    for (let i = 0, n = 0; i < 200 && n < 12; i++) {
      const x = (r() - 0.5) * 70;
      const z = 57 + r() * 9;
      if (far(x, z, 4)) { tree(x, z, false); n++; }
    }
    // a few trees and rocks stand in the corridor itself and block the way
    for (let i = 0, n = 0; i < 300 && n < 16; i++) {
      const side = r() < 0.5 ? -1 : 1;
      const z = 140 + r() * 70;
      const x = side * (7 + r() * 3.5);
      if (Math.abs(x - roadX(z)) > 4.5 && far(x, z, 5) && clear(x, z, 6)) { tree(x, z, true); n++; }
    }
    for (let i = 0, n = 0; i < 300 && n < 12; i++) {
      const side = r() < 0.5 ? -1 : 1;
      const z = 140 + r() * 70;
      const x = side * (5.5 + r() * 5);
      if (Math.abs(x - roadX(z)) > 3.6 && far(x, z, 4) && clear(x, z, 5)) {
        trees.push([x, z]);
        rocks.push({ x, z, s: 1.1 + r() * 0.7, r: r() * 6 });
        this.obstacles.push({ x, z, r: 1.1 * ENV });
        n++;
      }
    }
    // low scrub and loose stones (no colliders)
    for (let i = 0; i < 40; i++) {
      const x = (r() < 0.5 ? -1 : 1) * (9 + r() * 14);
      tall.push({ x, z: 134 + r() * 82, s: 0.5 + r() * 0.3, r: r() * 6, tint: leafTint() });
    }
    for (let i = 0; i < 70; i++) {
      const x = (r() < 0.5 ? -1 : 1) * (8 + r() * 12);
      const s = 0.16 + r() * 0.12;
      bushes.push({ x, z: 134 + r() * 82, s, r: r() * 6, y: s * ENV });
    }
    for (let i = 0; i < 24; i++) {
      const x = (r() < 0.5 ? -1 : 1) * (6 + r() * 16);
      stones.push({ x, z: 134 + r() * 82, s: 0.8 + r() * 0.8, r: r() * 6 });
    }
    // the island forest's mix in the woods beside the road: taller bushes, boulders, roots (no colliders, own rng)
    const rs = rng(7103);
    const woods = () => ({ x: (rs() < 0.5 ? -1 : 1) * (12.5 + rs() * 18), z: FRONT_Z1 + 2 + rs() * 90 });
    for (let i = 0, n = 0; i < 300 && n < 30; i++) {
      const p = woods();
      if (far(p.x, p.z, 3)) { trees.push([p.x, p.z]); tall.push({ ...p, s: 0.5 + rs() * 0.3, r: rs() * 6, tint: leafTint() }); n++; }
    }
    for (let i = 0, n = 0; i < 300 && n < 12; i++) {
      const p = woods();
      if (far(p.x, p.z, 3)) { trees.push([p.x, p.z]); rocks.push({ ...p, s: (0.3 + rs() * 0.3) * 2.6, r: rs() * 6 }); n++; }
    }
    for (let i = 0, n = 0; i < 300 && n < 14; i++) {
      const p = woods();
      if (far(p.x, p.z, 3)) { trees.push([p.x, p.z]); roots.push({ ...p, s: 0.3 + rs() * 0.2, r: rs() * 6 }); n++; }
    }
    this.scatter('elf_tree', wood);
    this.scatter('elf_foliage_small', tall);
    this.scatter('elf_foliage_mid', bushes);
    this.scatter('orc_stone_big', rocks);
    this.scatter('orc_stone_small', stones);
    this.scatter('elf_tree_root_1', roots, false);

    // courtyard: well and corner clutter
    if (assets.has('elf_well')) {
      const sz = this.sizeOf('elf_well');
      this.put('elf_well', WELL.x, WELL.z, (WELL.r * 2) / Math.max(sz.x, sz.z) / ENV, 0, WELL.r / ENV);
    }
    this.put('box_large_2', -21.6, 120.5, 0.8, 0.3, 0.6);
    this.put('box_small_2', -20.3, 121.8, 0.8, 1.1, 0.4);
    this.put('bucket', -20.8, 118.8, 0.8, 0);
    this.put('wood_pile_big', 21.2, 120, 0.5, Math.PI, 1);
    this.put('wood_pile_small', 20.2, 122.6, 0.65, 1.2, 0.7);
    this.put('elf_log_pile', -21.3, 96, 0.5, 1.6, 0.9);
    this.put('box_large_2', 21.6, 95, 0.8, 0.5, 0.6);
    this.put('box_large_2', 21.2, 97.3, 0.8, -0.3, 0.6);
    this.put('box_small_2', 20.0, 96.2, 0.8, 0.9, 0.4);
    this.put('box_large_2', -11.5, 83.5, 0.8, 0.2, 0.6);
    this.put('box_large_2', 11.8, 83.5, 0.8, -0.4, 0.6);
  }

  /** Grass field, decor and mist: the island's own builders over this map's box. */
  private buildCover() {
    this.layers.commit();
    this.grassField = buildGrassField(this.colorMap, this.layers, 9000, BOX);
    const decor = buildDecor((x, z, pad) => this.free(x, z, pad), this.treeSpots, 13, DECOR_AREA);
    const zoneTex = flatZoneTexture('forest');
    this.mist = buildMist(this.time, zoneTex, BOX);
    this.grass.push(this.grassField.mesh, ...decor);
    this.group.add(this.grassField.mesh, ...decor, this.mist.group);
    this.disposables.push(this.grassField.mesh, ...decor, this.mist.group);
    this.own.push(zoneTex);
  }

  /** Room for decor: clear of every collider and trunk. */
  private free(x: number, z: number, pad: number) {
    for (let i = 0; i < this.obstacles.length; i++) {
      const o = this.obstacles[i];
      if ((o.x - x) ** 2 + (o.z - z) ** 2 < (o.r + pad) ** 2) return false;
    }
    for (let i = 0; i < this.treeSpots.length; i++) {
      const t = this.treeSpots[i];
      if ((t[0] - x) ** 2 + (t[1] - z) ** 2 < (0.6 + pad) ** 2) return false;
    }
    return true;
  }

  private bakeMap() {
    const g = this.mapCanvas.getContext('2d')!;
    const k = this.groundCanvas.width / BOX.size;
    g.drawImage(this.groundCanvas, (X0 - BOX.x) * k, (Z0 - BOX.z) * k, W * k, H * k, 0, 0, this.mapCanvas.width, this.mapCanvas.height);
    const m = (x: number) => (x - X0) * MAP_PPM;
    const n = (z: number) => (z - Z0) * MAP_PPM;
    g.fillStyle = '#5d564a';
    const rect = (x0: number, x1: number, z0: number, z1: number) => g.fillRect(m(x0), n(z0), (x1 - x0) * MAP_PPM, (z1 - z0) * MAP_PPM);
    rect(GATE.halfW, GATE.wallHalfLen, FRONT_Z0, FRONT_Z1);
    rect(-GATE.wallHalfLen, -GATE.halfW, FRONT_Z0, FRONT_Z1);
    for (const s of [-1, 1]) {
      rect(Math.min(s * YARD.x1, s * (YARD.x1 + SIDE_T)), Math.max(s * YARD.x1, s * (YARD.x1 + SIDE_T)), BACK_Z, FRONT_Z0);
      rect(Math.min(s * 14, s * (YARD.x1 + SIDE_T)), Math.max(s * 14, s * (YARD.x1 + SIDE_T)), BACK_Z, KEEP.z1);
    }
    g.fillStyle = '#7a7160';
    rect(-14, 14, KEEP.z0, KEEP.z1);
    g.fillStyle = '#6d6556';
    for (const o of this.obstacles) if (o.r > 2) { g.beginPath(); g.arc(m(o.x), n(o.z), o.r * MAP_PPM, 0, Math.PI * 2); g.fill(); }
  }

  private buildGrid() {
    for (const o of this.obstacles) {
      const e = o.r + GRID_PAD;
      const x1 = Math.floor((o.x + e) / GRID_CELL);
      const z1 = Math.floor((o.z + e) / GRID_CELL);
      for (let ix = Math.floor((o.x - e) / GRID_CELL); ix <= x1; ix++) {
        for (let iz = Math.floor((o.z - e) / GRID_CELL); iz <= z1; iz++) {
          const key = ix * 4096 + iz;
          const list = this.grid.get(key);
          if (list) list.push(o); else this.grid.set(key, [o]);
        }
      }
    }
  }

  // ---------- GameWorld ----------

  zoneAt(_x: number, _z: number): ZoneDef { return SIEGE_ZONE; }

  envAt(_x: number, _z: number, out: EnvOut) {
    out.sky.set(FOREST.sky);
    out.fog.set(FOREST.fog);
    out.hemiSky.set(FOREST.hemi[0]);
    out.hemiGround.set(FOREST.hemi[1]);
    out.density = FOREST.fogDensity;
    out.light = ZONE_LIGHT.forest ?? 1;
  }

  /** Obstacle circles (grid), the closed gate, then the walkable strip: forest corridor + gate passage + courtyard. */
  collide(p: THREE.Vector3, radius: number) {
    const cell = this.grid.get(Math.floor(p.x / GRID_CELL) * 4096 + Math.floor(p.z / GRID_CELL));
    if (cell) for (let i = 0; i < cell.length; i++) pushOut(p, cell[i], radius);
    if (!this.gateOpen) for (let i = 0; i < this.gateObs.length; i++) pushOut(p, this.gateObs[i], radius);

    const rr = radius;
    const fx = FOREST_HALF_W - rr;
    const gx = GATE.halfW - rr;
    const yx = YARD.x1 - rr;
    const startZ = ROAD[0][1] + 4;
    let bx = p.x;
    let bz = p.z;
    let best = clampRect(p, -fx, fx, FRONT_Z1 + rr, startZ - rr, CLAMP);
    if (best > 0) {
      bx = CLAMP.x; bz = CLAMP.z;
      const dg = clampRect(p, -gx, gx, FRONT_Z0 - 1, FRONT_Z1 + 1, CLAMP);
      if (dg < best) { best = dg; bx = CLAMP.x; bz = CLAMP.z; }
      const dy = clampRect(p, -yx, yx, KEEP.z1 + rr, FRONT_Z0 - rr, CLAMP);
      if (dy < best) { best = dy; bx = CLAMP.x; bz = CLAMP.z; }
      p.x = bx;
      p.z = bz;
    }
  }

  update(dt: number, time: number, camTarget: THREE.Vector3) {
    this.time.value = time;
    windTime.value = time;
    this.mist.setCamera(camTarget);
    this.grassField.follow(camTarget);
    if (this.gateT >= 0 && this.gateT < 1) {
      this.gateT = Math.min(1, this.gateT + dt / GATE_OPEN_S);
      const k = this.gateT;
      this.portcullis.position.y = PORT_LIFT * k * k * (3 - 2 * k);
      if (k >= 0.5) this.gateOpen = true;
    }
    this.flicker(time);
  }

  private flicker(time: number) {
    for (let i = 0; i < this.flamePos.length; i++) {
      const s = 1 + Math.sin(time * 13 + i) * 0.12 + Math.sin(time * 7.3 + i * 2) * 0.08;
      this.flames.setMatrixAt(i, M4.compose(this.flamePos[i], QT.identity(), V3S.set(1 / s, s, 1 / s)));
    }
    this.flames.instanceMatrix.needsUpdate = true;
  }

  /** Low graphics: no ground mist, grass or ground clutter (as the island); the courtyard drops its cobble decal for the baked paving colour. */
  setLowDetail(low: boolean) {
    this.mist.group.visible = !low;
    for (const g of this.grass) g.visible = !low;
    for (const p of this.paving) p.visible = !low;
  }

  openGate(id: string, instant = false) {
    if (id !== SIEGE_GATE_ID || this.gateT >= 0) return;
    if (instant) {
      this.gateT = 1;
      this.gateOpen = true;
      this.portcullis.position.y = PORT_LIFT;
    } else {
      this.gateT = 0;
    }
  }

  openAllGates(instant = false) { this.openGate(SIEGE_GATE_ID, instant); }

  gateTarget(_id: string) { return AREAS[1].name; }

  drawMap(g: CanvasRenderingContext2D, X: (x: number) => number, Y: (z: number) => number, ppm: number, _worldMap = false) {
    g.fillStyle = '#16241a';
    g.fillRect(-1e4, -1e4, 2e4, 2e4);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.mapCanvas, X(X0), Y(Z0), W * ppm, H * ppm);
    if (!this.gateOpen) {
      g.strokeStyle = '#b06bff';
      g.lineWidth = Math.max(4, 1.2 * ppm);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(X(-GATE.halfW), Y(GATE.z));
      g.lineTo(X(GATE.halfW), Y(GATE.z));
      g.stroke();
    }
  }

  /** Frees what this world made; instanced meshes of baked props only drop their instance buffers (the geometry and materials are shared assets). */
  dispose() {
    this.group.traverse((o) => {
      const im = o as THREE.InstancedMesh;
      if (im.isInstancedMesh) im.dispose();
    });
    for (const root of this.disposables) {
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        if (Array.isArray(mesh.material)) for (const m of mesh.material) m.dispose(); else mesh.material.dispose();
      });
    }
    this.disposables.length = 0;
    this.layers.dispose();
    for (const d of this.own) d.dispose();
    this.own.length = 0;
    this.groundCanvas.width = this.groundCanvas.height = 0;
    this.mapCanvas.width = this.mapCanvas.height = 0;
    this.group.removeFromParent();
  }
}
