// Terrain, ocean, grass, water and ground mist for the island (layout lives in island.ts).
// The walkable island is flat (y = 0) so gameplay code never needs to sample heights; the rim
// (beach / tree bank / cliffs) and the ridge rise or fall outside the walkable area.
// Ground colours are baked into a texture (the narrow trail needs ~10 px per metre), and the same bake
// gives the minimap / world map picture with the ocean around the island. On top of the bake the ground shader
// adds painterly strokes, broad warm/cool patches, baked contact shadows (GroundLayers) and drifting cloud shadows.
import * as THREE from 'three';
import { ATMOS, ATMOS_GLSL, atmosUniforms } from './atmos';
import { pondDist, type Pond } from './water';
import { ZONES, type ZoneId } from './config';
import {
  ARENA, BRANCH_PATHS, FORT, GATE, ISLAND, LAND_TRAILS, OLD_TRAIL, MAP_BOX, NZ, PATH, PATH_W, ZGRID, ZONE_IDS, ZONE_INDEX, angleOf, fbm, heightAt, outside, rimCliff, smooth,
  zoneGrid, zoneWeights,
} from './island';

export { fbm, heightAt };
export { zoneAt } from './island';

/** Deterministic RNG for the procedural textures (same picture every session). */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/**
 * Tileable ground detail (data, not colour): r = grass strokes (short blades in light and dark, mostly along the
 * screen's vertical), g = grain for dirt, sand and rock (speckles, pebbles, soft blotches). 0.5 = no change.
 */
function detailTexture() {
  const S = 512;
  const r = prng(7);
  const layer = (draw: (g: CanvasRenderingContext2D, wrap: (x: number, y: number, pad: number, f: (x: number, y: number) => void) => void) => void) => {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgb(128,128,128)';
    g.fillRect(0, 0, S, S);
    // draws at the wrapped copies too when a mark crosses an edge, so the tile repeats seamlessly
    const wrap = (x: number, y: number, pad: number, f: (x: number, y: number) => void) => {
      for (const ox of [0, x < pad ? S : x > S - pad ? -S : 0].filter((v, i) => i === 0 || v !== 0)) {
        for (const oy of [0, y < pad ? S : y > S - pad ? -S : 0].filter((v, i) => i === 0 || v !== 0)) f(x + ox, y + oy);
      }
    };
    draw(g, wrap);
    return g.getImageData(0, 0, S, S).data;
  };
  const strokes = layer((g, wrap) => {
    g.lineCap = 'round';
    // soft clumps first: darker and lighter tufts of colour under the blades
    for (let i = 0; i < 160; i++) {
      const x = r() * S, y = r() * S, rad = 8 + r() * 22;
      const light = r() < 0.5;
      wrap(x, y, rad, (px, py) => {
        const gr = g.createRadialGradient(px, py, 0, px, py, rad);
        gr.addColorStop(0, light ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.12)');
        gr.addColorStop(1, 'rgba(128,128,128,0)');
        g.fillStyle = gr;
        g.fillRect(px - rad, py - rad, rad * 2, rad * 2);
      });
    }
    for (let i = 0; i < 4200; i++) {
      const x = r() * S, y = r() * S;
      const len = 5 + r() * 12;
      const a = Math.PI / 2 + (r() - 0.5) * 1.1;
      const bend = (r() - 0.5) * len * 0.5;
      const light = r() < 0.55;
      g.strokeStyle = light ? `rgba(255,255,255,${0.18 + r() * 0.3})` : `rgba(0,0,0,${0.16 + r() * 0.26})`;
      g.lineWidth = 1 + r() * 1.8;
      const dx = Math.cos(a) * len, dy = -Math.sin(a) * len;
      wrap(x, y, len + 2, (px, py) => {
        g.beginPath();
        g.moveTo(px, py);
        g.quadraticCurveTo(px + dx * 0.5 + bend, py + dy * 0.5, px + dx, py + dy);
        g.stroke();
      });
    }
  });
  const grain = layer((g, wrap) => {
    for (let i = 0; i < 110; i++) {
      const x = r() * S, y = r() * S, rad = 10 + r() * 30;
      const light = r() < 0.5;
      wrap(x, y, rad, (px, py) => {
        const gr = g.createRadialGradient(px, py, 0, px, py, rad);
        gr.addColorStop(0, light ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)');
        gr.addColorStop(1, 'rgba(128,128,128,0)');
        g.fillStyle = gr;
        g.fillRect(px - rad, py - rad, rad * 2, rad * 2);
      });
    }
    for (let i = 0; i < 3800; i++) {
      const x = r() * S, y = r() * S, s = 0.8 + r() * 2.2;
      g.fillStyle = r() < 0.5 ? `rgba(255,255,255,${0.15 + r() * 0.3})` : `rgba(0,0,0,${0.12 + r() * 0.28})`;
      wrap(x, y, 4, (px, py) => g.fillRect(px, py, s, s * (0.6 + r() * 0.8)));
    }
    // pebbles: a dark rim with a light top
    for (let i = 0; i < 260; i++) {
      const x = r() * S, y = r() * S, w = 2 + r() * 4.5, h = w * (0.55 + r() * 0.35);
      wrap(x, y, 8, (px, py) => {
        g.fillStyle = 'rgba(0,0,0,0.32)';
        g.beginPath(); g.ellipse(px, py + 0.8, w, h, 0, 0, 7); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.28)';
        g.beginPath(); g.ellipse(px - 0.4, py - 0.5, w * 0.75, h * 0.65, 0, 0, 7); g.fill();
      });
    }
  });
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    data[i * 4] = strokes[i * 4];
    data[i * 4 + 1] = grain[i * 4];
    data[i * 4 + 2] = 128;
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

export type { Pond } from './water';

const DIRT = '#cfae80';
const CEM_DIRT = '#a49cc8';

/** How thick grass grows per location (0..1); the shader thins it further with noise. */
const GRASS_OF: Record<ZoneId, number> = { forest: 1, cemetery: 0.7, peaks: 0.06, swamp: 0.95, grove: 0.8, dunes: 0.1, hills: 0.5 };
/** Height range packed into GroundLayers (b channel): metres = HEIGHT_LO + b * HEIGHT_K. */
const HEIGHT_LO = -1;
const HEIGHT_K = 3.2;

/**
 * Bakes the ground colours. `ground` (2048 px) is the ground texture, `map` (1024 px) is the same
 * picture with the ocean painted in, for the minimap and the world map; `grass` (512 px) is where grass grows
 * (r), the ground height (g) and sand ripples (b), see GroundLayers.
 */
export function bakeGroundMaps(ponds: Pond[]) {
  const N = 512;
  const k = MAP_BOX.size / N;
  const base = document.createElement('canvas');
  base.width = base.height = N;
  const bctx = base.getContext('2d')!;
  const img = bctx.createImageData(N, N);
  const sea = bctx.createImageData(N, N);
  const grassCanvas = document.createElement('canvas');
  grassCanvas.width = grassCanvas.height = N;
  const gctx = grassCanvas.getContext('2d')!;
  const grassImg = gctx.createImageData(N, N);
  const shore = new Uint8Array(N * N * 4);
  const zoneCols = ZONES.map((z) => [new THREE.Color(z.ground), new THREE.Color(z.ground2)]);
  const zoneGrass = ZONE_IDS.map((id) => GRASS_OF[id]);
  const meadow = new THREE.Color(0xa6d45a);
  const shade = new THREE.Color(0x2f7a46);
  const cemPatch = new THREE.Color(0x5a5494);
  const arenaStone = new THREE.Color(0x3e3a5c);
  const dirt = new THREE.Color(DIRT);
  const darkDirt = new THREE.Color(0x8e6c48);
  const bed = new THREE.Color(0xc4ae80);
  const silt = new THREE.Color(0x4e4c2c);
  const rock = new THREE.Color(0xa49a88);
  const cemRock = new THREE.Color(0x8a84a8);
  const sand = new THREE.Color(0xeee0b8);
  const wetSand = new THREE.Color(0xc9b07a);
  const deep = new THREE.Color(0x2a86d0);
  const shallow = new THREE.Color(0x63d6ee);
  const c = new THREE.Color();
  const t = new THREE.Color();
  const srgb = { r: 0, g: 0, b: 0 };
  const w = new Array(NZ).fill(0);
  const FOREST = ZONE_INDEX.forest;
  const CEM = ZONE_INDEX.cemetery;
  const DUNES = ZONE_INDEX.dunes;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = MAP_BOX.x + (i + 0.5) * k;
      const z = MAP_BOX.z + (j + 0.5) * k;
      const n1 = fbm(x * 0.08, z * 0.08);
      const n2 = fbm(x * 0.25 + 5, z * 0.25 - 3, 3);
      zoneWeights(x, z, w);
      c.setRGB(0, 0, 0);
      let grass = 0;
      for (let zi = 0; zi < NZ; zi++) {
        if (w[zi] < 0.001) continue;
        t.copy(zoneCols[zi][0]).lerp(zoneCols[zi][1], smooth(0.35, 0.7, n1));
        if (zi === FOREST) t.lerp(meadow, smooth(0.62, 0.8, n2) * 0.4).lerp(shade, smooth(0.42, 0.22, n1) * 0.35);
        else if (zi === CEM) t.lerp(cemPatch, smooth(0.55, 0.8, n2) * 0.5);
        c.r += t.r * w[zi]; c.g += t.g * w[zi]; c.b += t.b * w[zi];
        grass += zoneGrass[zi] * w[zi];
      }
      // thicker in meadows, thinner in the dark hollows
      grass *= 0.55 + 0.45 * smooth(0.3, 0.75, n2 * 0.6 + n1 * 0.4);
      // camp plaza
      const cd = Math.hypot(x - ISLAND.campX, z - ISLAND.campZ + 1) + (n2 - 0.5) * 3;
      c.lerp(dirt, (1 - smooth(6.5, 13, cd)) * 0.8);
      grass *= smooth(8.5, 13, cd);
      // the bandit fort's trampled yard
      if (Math.abs(x - FORT.x) < FORT.r + 3 && Math.abs(z - FORT.z) < FORT.r + 3) {
        const fd = Math.hypot(x - FORT.x, z - FORT.z) + (n2 - 0.5) * 4;
        const yard = 1 - smooth(FORT.r - 5, FORT.r - 0.5, fd);
        c.lerp(t.copy(dirt).lerp(darkDirt, smooth(0.45, 0.75, n1) * 0.6), yard * 0.75);
        grass *= 1 - yard * 0.85;
      }
      // Death's arena: dark flagstone floor
      if (Math.abs(x - ARENA.x) < ARENA.r + 4 && Math.abs(z - ARENA.z) < ARENA.r + 4) {
        const ad = Math.hypot(x - ARENA.x, z - ARENA.z) + (n2 - 0.5) * 3;
        const floor = 1 - smooth(ARENA.r - 2, ARENA.r + 1.5, ad);
        c.lerp(arenaStone, floor * (0.55 + 0.25 * n1));
        grass *= 1 - floor * 0.9;
      }
      // ponds: darker wet shore
      for (const p of ponds) {
        if (Math.abs(x - p.x) > p.r * 1.2 + 3 || Math.abs(z - p.z) > p.r * 1.2 + 3) continue;
        const d = pondDist(p, x, z);
        if (d < 2.5) c.lerp(darkDirt, (1 - smooth(-0.5, 2.5, d)) * 0.8);
        // the bed under the see-through shallows: sand under clear water, dark silt in the swamp
        if (d < 0) c.lerp(p.murky ? silt : bed, smooth(-0.1, -1.4, d) * 0.85);
        grass *= smooth(-0.3, 0.7, d);
      }
      const h = heightAt(x, z);
      const a = angleOf(x, z);
      const out = outside(x, z);
      // rim: sand towards the water, rock on cliffs and the ridge
      let ripple = w[DUNES];
      if (out > -3.5) {
        const sk = smooth(-3.5, 0.8, out + (n2 - 0.5) * 1.5) * (1 - rimCliff(a) * 0.75);
        c.lerp(sand, sk);
        grass *= 1 - smooth(0.05, 0.4, sk);
        ripple = Math.max(ripple, sk);
      }
      if (h > 0.15) {
        const rk = smooth(0.15, 2.5, h) * (0.55 + 0.3 * n1);
        c.lerp(w[CEM] > 0.5 ? cemRock : rock, rk);
        c.offsetHSL(0, 0, -Math.min(0.08, h * 0.008));
        grass *= 1 - smooth(0.15, 0.45, rk);
      }
      if (h < ISLAND.water + 0.1) c.lerp(wetSand, smooth(ISLAND.water + 0.1, ISLAND.water - 1.5, h));
      if (h < -0.12 || h > HEIGHT_LO + HEIGHT_K) grass = 0;
      c.offsetHSL(0, 0, (n2 - 0.5) * 0.06);
      const o = (j * N + i) * 4;
      c.getRGB(srgb, THREE.SRGBColorSpace);
      img.data[o] = srgb.r * 255; img.data[o + 1] = srgb.g * 255; img.data[o + 2] = srgb.b * 255; img.data[o + 3] = 255;
      grassImg.data[o] = Math.min(1, grass) * 255;
      grassImg.data[o + 1] = Math.min(1, Math.max(0, (h - HEIGHT_LO) / HEIGHT_K)) * 255;
      grassImg.data[o + 2] = (h > ISLAND.water ? Math.min(1, ripple) : 0) * 255;
      grassImg.data[o + 3] = 255;
      // ocean for the maps: shallow turquoise → deep blue, white surf at the waterline
      shore[o + 3] = Math.min(1, Math.max(0, (h + 4) / (4 + ISLAND.water))) * 255;
      if (h < ISLAND.water) {
        const depth = ISLAND.water - h;
        t.copy(shallow).lerp(deep, smooth(0.2, 3.5, depth));
        t.lerp(c.setRGB(0.93, 0.98, 1), (1 - smooth(0.05, 0.35, depth)) * 0.8);
        t.getRGB(srgb, THREE.SRGBColorSpace);
        sea.data[o] = srgb.r * 255; sea.data[o + 1] = srgb.g * 255; sea.data[o + 2] = srgb.b * 255; sea.data[o + 3] = 255;
      }
    }
  }
  bctx.putImageData(img, 0, 0);
  gctx.putImageData(grassImg, 0, 0);

  // full-resolution ground texture with the trail drawn on top
  const G = 2048;
  const ground = document.createElement('canvas');
  ground.width = ground.height = G;
  const g = ground.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(base, 0, 0, G, G);
  drawLandTrails(g, G / MAP_BOX.size, PATH_W, true);
  drawTrail(g, G / MAP_BOX.size, PATH_W);
  drawLandTrails(g, G / MAP_BOX.size, PATH_W);

  // map picture: ground + ocean (+ a slightly wider trail so it reads at minimap scale)
  const M = 1024;
  const map = document.createElement('canvas');
  map.width = map.height = M;
  const m = map.getContext('2d')!;
  m.imageSmoothingQuality = 'high';
  m.drawImage(ground, 0, 0, M, M);
  const seaCanvas = document.createElement('canvas');
  seaCanvas.width = seaCanvas.height = N;
  seaCanvas.getContext('2d')!.putImageData(sea, 0, 0);
  m.drawImage(seaCanvas, 0, 0, M, M);
  drawTrail(m, M / MAP_BOX.size, 1.8, true);
  drawLandTrails(m, M / MAP_BOX.size, 1.8);
  const shoreTex = new THREE.DataTexture(shore, N, N, THREE.RGBAFormat);
  shoreTex.magFilter = shoreTex.minFilter = THREE.LinearFilter;
  shoreTex.needsUpdate = true;
  return { ground, map, shoreTex, grass: grassCanvas };
}

/**
 * The trail: a darker worn rim, a soft wide underlay, a solid core and ragged speckles along the edges. Each layer is
 * stroked for every trail at once (one path per colour), so at a junction one trail's rim never lands on the other's
 * core and overlapping translucent strokes never double up.
 */
function drawTrail(g: CanvasRenderingContext2D, ppm: number, width: number, flat = false) {
  const X = (x: number) => (x - MAP_BOX.x) * ppm;
  const Z = (z: number) => (z - MAP_BOX.z) * ppm;
  const gateI = Math.round(GATE.s / (PATH.length / (PATH.x.length - 1)));
  const parts: [typeof PATH, number, number, string][] = [
    [PATH, 0, gateI, DIRT], [PATH, gateI, PATH.x.length - 1, CEM_DIRT],
    ...BRANCH_PATHS.map((c): [typeof PATH, number, number, string] => [c, 0, c.x.length - 1, DIRT]),
  ];
  g.lineCap = g.lineJoin = 'round';
  const layer = (wm: number, alpha: number, style?: string) => {
    for (const col of style ? [style] : [DIRT, CEM_DIRT]) {
      g.globalAlpha = alpha;
      g.strokeStyle = col;
      g.lineWidth = wm * ppm;
      g.beginPath();
      for (const [c, a, b, pc] of parts) {
        if (!style && pc !== col) continue;
        for (let i = a; i <= b; i++) (i === a ? g.moveTo : g.lineTo).call(g, X(c.x[i]), Z(c.z[i]));
      }
      g.stroke();
    }
  };
  if (!flat) {
    layer(width * 1.7, 0.18, '#5a4630'); // a darker worn rim so the trail sits in the grass
    layer(width * 1.35, 0.25);
  }
  layer(width, flat ? 0.85 : 0.95);
  if (flat) { g.globalAlpha = 1; return; }
  for (const [c, a, b, col] of parts) {
    g.fillStyle = col;
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = a; i <= b; i += 2) {
      const tx = c.x[Math.min(b, i + 1)] - c.x[i];
      const tz = c.z[Math.min(b, i + 1)] - c.z[i];
      const l = Math.hypot(tx, tz) || 1;
      for (const side of [-1, 1]) {
        const off = side * (width * 0.5 + (rnd() - 0.5) * 0.25);
        g.globalAlpha = 0.6 + rnd() * 0.3;
        g.beginPath();
        g.arc(X(c.x[i] - (tz / l) * off), Z(c.z[i] + (tx / l) * off), (0.08 + rnd() * 0.14) * ppm, 0, 7);
        g.fill();
      }
    }
  }
  g.globalAlpha = 1;
}

/** Catmull-Rom through a waypoint line (bezier form), added to the current canvas path. */
function traceLine(g: CanvasRenderingContext2D, line: [number, number][], X: (x: number) => number, Z: (z: number) => number) {
  g.moveTo(X(line[0][0]), Z(line[0][1]));
  for (let i = 0; i < line.length - 1; i++) {
    const p0 = line[Math.max(0, i - 1)];
    const p1 = line[i];
    const p2 = line[i + 1];
    const p3 = line[Math.min(line.length - 1, i + 2)];
    g.bezierCurveTo(
      X(p1[0] + (p2[0] - p0[0]) / 6), Z(p1[1] + (p2[1] - p0[1]) / 6),
      X(p2[0] - (p3[0] - p1[0]) / 6), Z(p2[1] - (p3[1] - p1[1]) / 6),
      X(p2[0]), Z(p2[1]),
    );
  }
}

/**
 * Worn paths through the other locations: a soft underlay and a core, like the trail without the speckles; each
 * layer is one path over all of them, so their junctions blend. `rimOnly`: just their darker worn rim (drawn before
 * every trail's core, so no rim lands on a core where they meet).
 */
function drawLandTrails(g: CanvasRenderingContext2D, ppm: number, width: number, rimOnly = false) {
  const X = (x: number) => (x - MAP_BOX.x) * ppm;
  const Z = (z: number) => (z - MAP_BOX.z) * ppm;
  g.lineCap = g.lineJoin = 'round';
  const layers: [number, number, string][] = rimOnly ? [[width * 1.7, 0.18, '#5a4630']] : [[width * 1.35, 0.25, DIRT], [width, 0.85, DIRT]];
  for (const [wm, alpha, col] of layers) {
    g.globalAlpha = alpha;
    g.strokeStyle = col;
    g.lineWidth = wm * ppm;
    g.beginPath();
    for (const line of LAND_TRAILS) traceLine(g, line, X, Z);
    g.stroke();
  }
  if (rimOnly) { g.globalAlpha = 1; return; }
  // the abandoned path fades out piece by piece past the Snow Pass gate
  g.strokeStyle = CEM_DIRT;
  g.lineCap = 'butt';
  g.lineWidth = width * ppm;
  const n = OLD_TRAIL.x.length - 1;
  for (let i = 0; i < n; i++) {
    g.globalAlpha = 0.55 * (1 - smooth(0.4, 1, i / n));
    g.beginPath();
    g.moveTo(X(OLD_TRAIL.x[i]), Z(OLD_TRAIL.z[i]));
    g.lineTo(X(OLD_TRAIL.x[i + 1]), Z(OLD_TRAIL.z[i + 1]));
    g.stroke();
  }
  g.globalAlpha = 1;
}

/**
 * Ground layers looked up by world position (1024² over MAP_BOX): r = grass density, g = contact shadow
 * (1 = open, darker under trees, rocks and buildings), b = ground height for the grass blades, a = sand ripples.
 * World paints the obstacles in (occlude / clear) while it builds the level, then commit() uploads it.
 */
export class GroundLayers {
  static readonly SIZE = 1024;
  readonly texture: THREE.DataTexture;
  private grass: CanvasRenderingContext2D;
  private ao: CanvasRenderingContext2D;
  private ppm = GroundLayers.SIZE / MAP_BOX.size;

  constructor(grassBase: HTMLCanvasElement) {
    const S = GroundLayers.SIZE;
    const mk = () => {
      const c = document.createElement('canvas');
      c.width = c.height = S;
      return c.getContext('2d', { willReadFrequently: true })!;
    };
    this.grass = mk();
    this.grass.imageSmoothingQuality = 'high';
    this.grass.drawImage(grassBase, 0, 0, S, S);
    this.ao = mk();
    this.ao.fillStyle = '#fff';
    this.ao.fillRect(0, 0, S, S);
    // no grass on the trails: multiply red away, keep the height in green
    const g = this.grass;
    const X = (x: number) => (x - MAP_BOX.x) * this.ppm;
    const Z = (z: number) => (z - MAP_BOX.z) * this.ppm;
    g.globalCompositeOperation = 'multiply';
    g.lineCap = g.lineJoin = 'round';
    g.strokeStyle = 'rgb(0,255,255)';
    for (const [wm, alpha] of [[PATH_W * 2.1, 0.45], [PATH_W * 1.45, 1]]) {
      g.globalAlpha = alpha;
      g.lineWidth = wm * this.ppm;
      g.beginPath();
      for (const c of [PATH, ...BRANCH_PATHS]) for (let i = 0; i < c.x.length; i++) (i === 0 ? g.moveTo : g.lineTo).call(g, X(c.x[i]), Z(c.z[i]));
      for (const line of LAND_TRAILS) traceLine(g, line, X, Z);
      g.stroke();
    }
    g.globalAlpha = 1;
    this.texture = new THREE.DataTexture(new Uint8Array(S * S * 4), S, S, THREE.RGBAFormat);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.generateMipmaps = true;
  }

  /** A soft contact shadow round (x, z): `r` metres out, `k` = darkness at the centre (0..1). */
  occlude(x: number, z: number, r: number, k: number) {
    const px = (x - MAP_BOX.x) * this.ppm;
    const pz = (z - MAP_BOX.z) * this.ppm;
    const pr = Math.max(1.5, r * this.ppm);
    const g = this.ao;
    const gr = g.createRadialGradient(px, pz, 0, px, pz, pr);
    gr.addColorStop(0, `rgba(0,0,0,${k})`);
    gr.addColorStop(0.45, `rgba(0,0,0,${k * 0.55})`);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(px - pr, pz - pr, pr * 2, pr * 2);
  }

  /** No grass within `r` metres of (x, z) (a building, a rock), fading out over the last third. */
  clear(x: number, z: number, r: number) {
    const px = (x - MAP_BOX.x) * this.ppm;
    const pz = (z - MAP_BOX.z) * this.ppm;
    const pr = Math.max(1, r * this.ppm);
    const g = this.grass;
    const gr = g.createRadialGradient(px, pz, 0, px, pz, pr);
    gr.addColorStop(0, 'rgb(0,255,255)');
    gr.addColorStop(0.65, 'rgb(0,255,255)');
    gr.addColorStop(1, 'rgba(0,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(px - pr, pz - pr, pr * 2, pr * 2);
  }

  /** Packs both canvases into the texture. */
  commit() {
    const S = GroundLayers.SIZE;
    const gd = this.grass.getImageData(0, 0, S, S).data;
    const ad = this.ao.getImageData(0, 0, S, S).data;
    const out = this.texture.image.data as Uint8Array;
    for (let i = 0; i < S * S; i++) {
      out[i * 4] = gd[i * 4];
      out[i * 4 + 1] = ad[i * 4];
      out[i * 4 + 2] = gd[i * 4 + 1];
      out[i * 4 + 3] = gd[i * 4 + 2];
    }
    this.texture.needsUpdate = true;
  }
}

/** Ground mist per cell: rgb = mist colour, a = density (blended across zone borders, none over the sea). */
export function zoneTexture() {
  const { n } = ZGRID;
  const data = new Uint8Array(n * n * 4);
  const cols = ZONES.map((z) => new THREE.Color(z.mistColor));
  const c = new THREE.Color();
  for (let i = 0; i < n * n; i++) {
    let sum = 0;
    let dens = 0;
    c.setRGB(0, 0, 0);
    for (let z = 0; z < NZ; z++) {
      const k = zoneGrid.w[i * NZ + z];
      sum += k;
      dens += k * ZONES[z].mist;
      c.r += cols[z].r * k; c.g += cols[z].g * k; c.b += cols[z].b * k;
    }
    sum ||= 1;
    data[i * 4] = (c.r / sum) * 255; data[i * 4 + 1] = (c.g / sum) * 255; data[i * 4 + 2] = (c.b / sum) * 255;
    data[i * 4 + 3] = (dens / sum) * smooth(0.6, 1, zoneGrid.land[i]) * 255;
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

const mapBox = () => new THREE.Vector4(MAP_BOX.x, MAP_BOX.z, MAP_BOX.size, MAP_BOX.size);

/** Broad painterly variation shared by the ground and the grass on it: cool darker hollows, warm sunlit patches. */
const GROUND_TINT = /* glsl */ `
vec3 groundTint(vec2 xz) {
  float p = texture2D(uAtmosNoise, xz * 0.0095).r * 0.62 + texture2D(uAtmosNoise, xz * 0.034 + 0.5).g * 0.38;
  return mix(vec3(0.72, 0.82, 0.9), vec3(1.12, 1.08, 0.88), smoothstep(0.26, 0.74, p));
}`;

/** The baked ground colour map as a texture (shared by the ground and the grass). */
export function groundColorTexture(groundCanvas: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(groundCanvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false; // canvas row 0 is MAP_BOX.z (north), like the world-space lookup
  t.anisotropy = 8;
  return t;
}

export function buildGround(colorMap: THREE.Texture, layers: GroundLayers): THREE.Mesh {
  const seg = 150;
  const geo = new THREE.PlaneGeometry(MAP_BOX.size, MAP_BOX.size, seg, seg).rotateX(-Math.PI / 2);
  geo.translate(MAP_BOX.x + MAP_BOX.size / 2, 0, MAP_BOX.z + MAP_BOX.size / 2);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const detail = detailTexture();
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  // Baked colours are looked up by world position, then painted over: strokes, patches, contact shadows, clouds.
  mat.onBeforeCompile = (sh) => {
    atmosUniforms(sh);
    sh.uniforms.uColorMap = { value: colorMap };
    sh.uniforms.uLayers = { value: layers.texture };
    sh.uniforms.uDetail = { value: detail };
    sh.uniforms.uMapBox = { value: mapBox() };
    sh.vertexShader = 'uniform vec4 uMapBox;\nvarying vec2 vIslandUv;\nvarying vec3 vGw;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n vec4 gw4 = modelMatrix * vec4(transformed, 1.0); vGw = gw4.xyz; vIslandUv = (gw4.xz - uMapBox.xy) / uMapBox.zw;',
    );
    sh.fragmentShader = ATMOS_GLSL + GROUND_TINT + '\nuniform sampler2D uColorMap; uniform sampler2D uLayers; uniform sampler2D uDetail;\nvarying vec2 vIslandUv;\nvarying vec3 vGw;\n' + sh.fragmentShader.replace(
      '#include <map_fragment>',
      /* glsl */ `
      vec3 gBase = texture2D(uColorMap, vIslandUv).rgb;
      vec4 gLay = texture2D(uLayers, vIslandUv);
      // two differently rotated looks of the detail tile, blended by noise, so its repeat never shows
      vec2 dUv = vGw.xz / 7.0;
      vec2 d1 = texture2D(uDetail, dUv).rg;
      vec2 d2 = texture2D(uDetail, vec2(dUv.y, -dUv.x) * 0.81 + 0.37).rg;
      vec2 d = mix(d1, d2, smoothstep(0.3, 0.7, texture2D(uAtmosNoise, vGw.xz * 0.021).a));
      float grassy = smoothstep(0.05, 0.5, gLay.r);
      float det = mix(d.g, d.r, grassy) - 0.5;
      vec3 gCol = gBase * groundTint(vGw.xz) * (1.0 + det * mix(0.55, 0.8, grassy));
      gCol *= mix(0.42, 1.0, gLay.g);
      // wind ripples on the dunes and the beaches
      if (gLay.a > 0.02) {
        vec2 q = vGw.xz + (texture2D(uAtmosNoise, vGw.xz * 0.03).rg - 0.5) * 7.0;
        float s = sin(dot(q, vec2(0.83, 0.55)) * 4.6);
        gCol *= 1.0 + (smoothstep(-0.3, 0.95, s) - 0.45) * 0.16 * gLay.a;
      }
      diffuseColor.rgb *= gCol;`,
    ).replace(
      '#include <lights_fragment_end>',
      '#include <lights_fragment_end>\n reflectedLight.directDiffuse *= cloudShadow(vGw.xz);',
    );
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

/** Shared "wind" clock: the grass, the foliage and the cloud shadows all move on it. */
export const windTime = ATMOS.time;

/** Grass field size round the hero (m): it covers the view from below the hero's feet to the top of the screen. */
const GRASS_TILE = new THREE.Vector2(32, 42);
/** The field sits this far "up the screen" (−z) from the hero, where most of the view is. */
const GRASS_AHEAD = 6;

/**
 * Dense grass that follows the hero: a fixed set of tufts whose positions wrap round the field centre in the vertex
 * shader, so the cost never depends on the size of the island. Each tuft looks up GroundLayers (is there grass here,
 * how high is the ground, how shaded) and takes its colour from the baked ground under it, so it always matches
 * the zone it stands in. Blades sway in the wind and bend away from the hero.
 */
export function buildGrassField(colorMap: THREE.Texture, layers: GroundLayers, count = 9000) {
  const r = prng(99);
  // one tuft: seven blades of mixed height scattered round a small centre, leaning one way more than the others;
  // normals point up so blades shade like the ground
  const pos: number[] = [];
  const tip: number[] = [];
  const B = 7;
  for (let k = 0; k < B; k++) {
    const a = (k / B) * Math.PI * 2 + r() * 0.9;
    const r0 = 0.03 + r() * 0.12;
    const bx = Math.cos(a) * r0;
    const bz = Math.sin(a) * r0;
    const hw = 0.04 + r() * 0.025;
    const face = r() * Math.PI;
    const px = Math.cos(face) * hw;
    const pz = Math.sin(face) * hw;
    const lean = 0.05 + r() * 0.12;
    const h = (k < 2 ? 0.4 : 0.22) + r() * 0.22;
    pos.push(bx - px, 0, bz - pz, bx + px, 0, bz + pz, bx + Math.cos(a) * lean + 0.06, h, bz + Math.sin(a) * lean);
    tip.push(0, 0, 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.setAttribute('aTip', new THREE.Float32BufferAttribute(tip, 1));
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const uCenter = { value: new THREE.Vector2() };
  const uHero = { value: new THREE.Vector3(0, -99, 0) };
  mat.onBeforeCompile = (sh) => {
    atmosUniforms(sh);
    Object.assign(sh.uniforms, {
      uCenter, uHero, uTile: { value: GRASS_TILE }, uLayers: { value: layers.texture }, uColorMap: { value: colorMap },
      uBox: { value: mapBox() }, uHLo: { value: HEIGHT_LO }, uHK: { value: HEIGHT_K },
    });
    sh.vertexShader = ATMOS_GLSL + GROUND_TINT + /* glsl */ `
      uniform vec2 uCenter; uniform vec2 uTile; uniform vec3 uHero; uniform sampler2D uLayers; uniform sampler2D uColorMap;
      uniform vec4 uBox; uniform float uHLo; uniform float uHK;
      attribute float aTip;
      varying vec3 vGrassCol; varying vec3 vGw;
    ` + sh.vertexShader.replace(
      '#include <begin_vertex>',
      /* glsl */ `#include <begin_vertex>
      vec2 gOff = instanceMatrix[3].xz;
      float gRnd = instanceMatrix[3].y;
      vec2 gP = gOff + uTile * floor((uCenter - gOff) / uTile + 0.5);
      vec2 gUv = (gP - uBox.xy) / uBox.zw;
      vec4 gLay = texture2D(uLayers, gUv);
      vec2 gE = abs(gP - uCenter) / (uTile * 0.5);
      float gK = smoothstep(gRnd, gRnd + 0.15, gLay.r) * (1.0 - smoothstep(0.8, 1.0, max(gE.x, gE.y)));
      vec3 gL = mat3(instanceMatrix) * position * gK;
      float ph = gP.x * 0.31 + gP.y * 0.27;
      float gs = sin(uAtmosTime * 2.1 + ph) * 0.6 + sin(uAtmosTime * 3.7 + ph * 1.7) * 0.3 + 0.35;
      gL.xz += vec2(0.1, 0.05) * gs * aTip * gK;
      // the hero walks through: blades bend away and flatten
      vec2 hd = gP - uHero.xz;
      float hl = length(hd);
      float push = (1.0 - smoothstep(0.2, 1.15, hl)) * aTip * gK;
      gL.xz += hd / max(hl, 0.001) * push * 0.24;
      gL.y *= 1.0 - push * 0.55;
      vec3 gW = vec3(gP.x, uHLo + gLay.b * uHK, gP.y) + gL;
      vec3 gGround = texture2D(uColorMap, gUv).rgb * groundTint(gP) * mix(0.5, 1.0, gLay.g);
      vGrassCol = gGround * mix(0.86, 1.5, aTip) + vec3(0.045, 0.05, 0.0) * aTip;
      vGw = gW;`,
    ).replace(
      '#include <project_vertex>',
      'vec4 mvPosition = viewMatrix * vec4(gW, 1.0);\n gl_Position = projectionMatrix * mvPosition;',
    ).replace(
      '#include <worldpos_vertex>',
      'vec4 worldPosition = vec4(gW, 1.0);',
    );
    sh.fragmentShader = ATMOS_GLSL + '\nvarying vec3 vGrassCol; varying vec3 vGw;\n' + sh.fragmentShader.replace(
      '#include <color_fragment>',
      '#include <color_fragment>\n diffuseColor.rgb *= vGrassCol;',
    ).replace(
      // both faces of a blade shade like the ground under it
      '#include <normal_fragment_begin>',
      '#include <normal_fragment_begin>\n normal = normalize(vNormal);',
    ).replace(
      '#include <lights_fragment_end>',
      '#include <lights_fragment_end>\n reflectedLight.directDiffuse *= cloudShadow(vGw.xz);',
    );
  };
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    // translation: x, z inside the field; y carries the tuft's random density threshold
    p.set(r() * GRASS_TILE.x, r(), r() * GRASS_TILE.y);
    q.setFromAxisAngle(up, r() * Math.PI * 2);
    const k = 0.75 + r() * 0.65;
    s.set(k, k * (0.75 + r() * 0.6), k);
    mesh.setMatrixAt(i, m.compose(p, q, s));
  }
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  return {
    mesh,
    /** Field centre and blade bending follow the hero. */
    follow(hero: THREE.Vector3) {
      uCenter.value.set(hero.x, hero.z - GRASS_AHEAD);
      uHero.value.copy(hero);
    },
  };
}

/**
 * Cobbled square in the middle of the camp and a cobbled road from it out of the gate: a flat decal over the ground
 * whose stones are voronoi cells, worked out per pixel — bevelled (lit on the sun side, shaded at the mortar),
 * each its own tint, a few missing, whole stones dropping out along the ragged edge.
 * `c`: centre and radius of the square, `to`: the end of the road (the gate).
 */
export function buildCobbles(c: { x: number; z: number; r: number }, to: { x: number; z: number }) {
  const minX = Math.min(c.x - c.r, to.x) - 2;
  const maxX = Math.max(c.x + c.r, to.x) + 2;
  const minZ = Math.min(c.z - c.r, to.z) - 2;
  const maxZ = Math.max(c.z + c.r, to.z) + 2;
  const geo = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ).rotateX(-Math.PI / 2).translate((minX + maxX) / 2, 0.015, (minZ + maxZ) / 2);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -2 });
  mat.onBeforeCompile = (sh) => {
    atmosUniforms(sh);
    Object.assign(sh.uniforms, {
      uC: { value: new THREE.Vector3(c.x, c.z, c.r) }, uTo: { value: new THREE.Vector2(to.x, to.z) },
    });
    sh.vertexShader = 'varying vec3 vCw;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n vCw = (modelMatrix * vec4(transformed, 1.0)).xyz;',
    );
    sh.fragmentShader = ATMOS_GLSL + /* glsl */ `
      uniform vec3 uC; uniform vec2 uTo; varying vec3 vCw;
      vec2 cHash2(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
      float cHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.743); }
      // nearest stone: x = distance to its centre, y = distance to the mortar (F2 - F1), zw = the stone's cell
      vec4 cVoronoi(vec2 x, out vec2 toC) {
        vec2 n = floor(x), f = fract(x);
        float d1 = 8.0, d2 = 8.0; vec2 cell = n; toC = vec2(0.0);
        for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
          vec2 g = vec2(float(i), float(j));
          vec2 r = g + cHash2(n + g) * 0.75 + 0.125 - f;
          float d = dot(r, r);
          if (d < d1) { d2 = d1; d1 = d; cell = n + g; toC = r; } else if (d < d2) d2 = d;
        }
        return vec4(sqrt(d1), sqrt(d2) - sqrt(d1), cell);
      }
      float cRoad(vec2 p) {
        vec2 a = uC.xy, b = uTo; vec2 ab = b - a;
        float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
        return length(p - a - ab * t);
      }
    ` + sh.fragmentShader.replace(
      '#include <map_fragment>',
      /* glsl */ `
      const float CELL = 0.44;
      vec2 toC;
      vec4 v = cVoronoi(vCw.xz / CELL, toC);
      vec2 centre = (v.zw + 0.5) * CELL;
      float h = cHash(v.zw);
      // the stone belongs to the paving if its centre is on the square or the road (ragged by noise)
      float wob = (texture2D(uAtmosNoise, centre * 0.11).g - 0.5) * 2.2;
      float inSq = uC.z + wob - length(centre - uC.xy);
      float inRoad = 0.95 + wob * 0.35 - cRoad(centre);
      float keep = max(inSq, inRoad);
      if (keep < 0.0 || h < 0.035 || (keep < 1.2 && h < 0.3)) discard;
      float mortar = smoothstep(0.025, 0.07, v.y);
      if (mortar < 0.02) discard;
      // bevel: lit toward the sun (front left), shaded on the far side and at the mortar
      vec2 n = -toC / max(v.x, 0.001);
      float bevel = dot(n, normalize(vec2(-0.7, 0.55))) * (1.0 - smoothstep(0.06, 0.3, v.y));
      // linear albedo: grey stones a touch darker than the dirt round them, the odd warm or mossy one
      vec3 stone = mix(vec3(0.24, 0.23, 0.21), vec3(0.4, 0.37, 0.32), h);
      stone = mix(stone, vec3(0.36, 0.3, 0.22), step(0.8, h) * 0.7);
      stone = mix(stone, vec3(0.2, 0.27, 0.14), step(h, 0.12) * 0.6);
      stone *= 0.78 + 0.32 * smoothstep(0.02, 0.28, v.y) + bevel * 0.22;
      stone *= 0.9 + 0.2 * texture2D(uAtmosNoise, vCw.xz * 0.9).b;
      diffuseColor.rgb *= stone;
      diffuseColor.a = mortar;`,
    ).replace(
      '#include <lights_fragment_end>',
      '#include <lights_fragment_end>\n reflectedLight.directDiffuse *= cloudShadow(vCw.xz);',
    );
  };
  mat.transparent = true;
  mat.depthWrite = false;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.renderOrder = -2; // before the blob shadows (−1), so they lie on the stones
  return mesh;
}

/**
 * The ritual circle on the floor of Death's arena: rings, spokes and a band of runes, faintly glowing and slowly
 * breathing (additive, so the post glow catches it). Static decor: the boss's attacks keep their own red telegraphs.
 */
export function buildRitual(x: number, z: number, r: number, time: { value: number }) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: time, uR: { value: r }, uColor: { value: new THREE.Color(0x86d8f0) } },
    vertexShader: 'varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `varying vec2 vP; uniform float uTime; uniform float uR; uniform vec3 uColor;
      float line(float d, float w) { return 1.0 - smoothstep(w * 0.5, w * 0.5 + 0.05, abs(d)); }
      float h1(float n) { return fract(sin(n * 91.7) * 43758.5453); }
      void main(){
        float d = length(vP);
        float a = atan(vP.y, vP.x);
        float t = d / uR;
        float g = 0.0;
        // rings: the outer double ring, the rune band between them, the inner circle
        g += line(d - uR * 0.97, 0.16) + line(d - uR * 0.86, 0.09) * 0.8 + line(d - uR * 0.42, 0.12) + line(d - uR * 0.36, 0.06) * 0.7;
        // a slowly turning six-point star between the inner and the outer rings
        float aa = a + uTime * 0.03;
        for (int k = 0; k < 3; k++) {
          float ang = aa + float(k) * 2.0943951;
          vec2 dir = vec2(cos(ang), sin(ang));
          float dl = abs(dot(vP, vec2(-dir.y, dir.x)) - uR * 0.43);
          float dl2 = abs(dot(vP, vec2(dir.y, -dir.x)) - uR * 0.43);
          float band = step(uR * 0.36, d) * step(d, uR * 0.86);
          g += (line(dl, 0.07) + line(dl2, 0.07)) * band * 0.7;
        }
        // runes: 28 cells round the band, each a few strokes picked by hash
        float N = 28.0;
        float cell = floor((a / 6.2831853 + 0.5) * N);
        float ca = (cell + 0.5) / N * 6.2831853 - 3.1415927;
        vec2 cd = vec2(cos(ca), sin(ca));
        vec2 lp = vec2(dot(vP, vec2(-cd.y, cd.x)), dot(vP, cd) - uR * 0.915) / (uR * 0.045);
        float rn = 0.0;
        if (abs(lp.x) < 1.0 && abs(lp.y) < 1.0) {
          if (h1(cell) > 0.3) rn += line(lp.x, 0.28);
          if (h1(cell + 7.0) > 0.5) rn += line(lp.y - 0.45, 0.28) * step(abs(lp.x), 0.7);
          if (h1(cell + 13.0) > 0.6) rn += line(lp.x + lp.y * 0.8, 0.28);
          if (h1(cell + 19.0) > 0.65) rn += line(length(lp + vec2(0.0, 0.35)) - 0.4, 0.25);
        }
        g += min(rn, 1.0) * 0.9;
        g = min(g, 1.4);
        float breathe = 0.65 + 0.35 * sin(uTime * 1.2 - t * 3.0);
        float a2 = g * breathe * (1.0 - smoothstep(0.95, 1.05, t)) * 0.75;
        gl_FragColor = vec4(uColor * a2, a2);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(r * 2.2, r * 2.2).rotateX(-Math.PI / 2), mat);
  mesh.position.set(x, 0.03, z);
  mesh.renderOrder = -1;
  return mesh;
}

/**
 * Ground mist: large layers with drifting fbm noise. Density follows the zone weights
 * (almost none in camp, light in the forest, thick in the cemetery) and fades out over the sea.
 */
export function buildMist(time: { value: number }, zoneTex: THREE.Texture) {
  const group = new THREE.Group();
  const make = (y: number, scale: number, alpha: number, speed: number) => {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: time, uScale: { value: scale }, uAlpha: { value: alpha }, uSpeed: { value: speed },
        uZone: { value: zoneTex }, uBox: { value: mapBox() },
        uCam: { value: new THREE.Vector3() },
      },
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `varying vec3 vW; uniform float uTime; uniform float uScale; uniform float uAlpha; uniform float uSpeed;
        uniform sampler2D uZone; uniform vec4 uBox; uniform vec3 uCam;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
          return mix(mix(h(i), h(i+vec2(1,0)), u.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), u.x), u.y); }
        float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * n(p); p *= 2.07; a *= 0.5; } return s; }
        void main(){
          vec4 zw = texture2D(uZone, (vW.xz - uBox.xy) / uBox.zw);
          float dens = zw.a;
          vec3 col = zw.rgb;
          vec2 p = vW.xz * uScale + vec2(uTime * uSpeed, uTime * uSpeed * 0.6);
          float f = fbm(p + fbm(p * 0.5 + uTime * 0.02) * 1.5);
          float a = smoothstep(0.35, 0.85, f) * dens * uAlpha;
          // thin out right around the hero so the action stays readable
          float d = length(vW.xz - uCam.xz);
          a *= mix(0.35, 1.0, smoothstep(2.0, 7.0, d));
          gl_FragColor = vec4(col, a);
        }`,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(MAP_BOX.size, MAP_BOX.size).rotateX(-Math.PI / 2), mat);
    m.position.set(MAP_BOX.x + MAP_BOX.size / 2, y, MAP_BOX.z + MAP_BOX.size / 2);
    m.renderOrder = 5;
    group.add(m);
    return mat;
  };
  const mats = [make(0.3, 0.07, 0.7, 0.25), make(1.1, 0.045, 0.4, -0.18), make(2.2, 0.03, 0.22, 0.12)];
  return { group, setCamera: (p: THREE.Vector3) => mats.forEach((m) => m.uniforms.uCam.value.copy(p)) };
}
