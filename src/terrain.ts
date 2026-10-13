// Terrain, ocean, vegetation, water and ground mist for the island (layout lives in island.ts).
// The walkable island is flat (y = 0) so gameplay code never needs to sample heights; the rim
// (beach / tree bank / cliffs) and the ridge rise or fall outside the walkable area.
// Ground colours are baked into a texture (the narrow trail needs ~10 px per metre), and the same bake
// gives the minimap / world map picture with the ocean around the island.
import * as THREE from 'three';
import { ZONES } from './config';
import {
  GATE, GATES, ISLAND, MAP_BOX, NZ, PATH, PATH_W, ZGRID, ZONE_INDEX, angleOf, fbm, heightAt, inCamp, pathDist, rimCliff, smooth, walkR, walkable, zoneGrid,
  zoneIdAt, zoneWeights,
} from './island';

export { fbm, heightAt };
export { zoneAt } from './island';

/** Tileable grain texture multiplied over the baked ground colours. */
function detailTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d8d8d8';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const v = 190 + Math.floor(Math.random() * 65);
    g.fillStyle = `rgb(${v},${v},${v})`;
    const s = 1 + Math.random() * 3;
    g.fillRect(Math.random() * 256, Math.random() * 256, s, s * (0.5 + Math.random()));
  }
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(255,255,255,${0.15 + Math.random() * 0.2})`;
    g.beginPath();
    g.arc(Math.random() * 256, Math.random() * 256, 4 + Math.random() * 14, 0, 7);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export interface Pond { x: number; z: number; r: number; }

const DIRT = '#cfae80';
const CEM_DIRT = '#a49cc8';

/**
 * Bakes the ground colours. `ground` (2048 px) is the ground texture, `map` (1024 px) is the same
 * picture with the ocean painted in, for the minimap and the world map.
 */
export function bakeGroundMaps(ponds: Pond[]) {
  const N = 512;
  const k = MAP_BOX.size / N;
  const base = document.createElement('canvas');
  base.width = base.height = N;
  const bctx = base.getContext('2d')!;
  const img = bctx.createImageData(N, N);
  const sea = bctx.createImageData(N, N);
  const shore = new Uint8Array(N * N * 4);
  const zoneCols = ZONES.map((z) => [new THREE.Color(z.ground), new THREE.Color(z.ground2)]);
  const meadow = new THREE.Color(0xa8e85a);
  const cemPatch = new THREE.Color(0x5a5494);
  const dirt = new THREE.Color(DIRT);
  const darkDirt = new THREE.Color(0x8e6c48);
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
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = MAP_BOX.x + (i + 0.5) * k;
      const z = MAP_BOX.z + (j + 0.5) * k;
      const n1 = fbm(x * 0.08, z * 0.08);
      const n2 = fbm(x * 0.25 + 5, z * 0.25 - 3, 3);
      zoneWeights(x, z, w);
      c.setRGB(0, 0, 0);
      for (let zi = 0; zi < NZ; zi++) {
        if (w[zi] < 0.001) continue;
        t.copy(zoneCols[zi][0]).lerp(zoneCols[zi][1], smooth(0.35, 0.7, n1));
        if (zi === FOREST) t.lerp(meadow, smooth(0.62, 0.8, n2) * 0.35);
        else if (zi === CEM) t.lerp(cemPatch, smooth(0.55, 0.8, n2) * 0.5);
        c.r += t.r * w[zi]; c.g += t.g * w[zi]; c.b += t.b * w[zi];
      }
      // camp plaza
      const cd = Math.hypot(x - ISLAND.campX, z - ISLAND.campZ + 1) + (n2 - 0.5) * 3;
      c.lerp(dirt, (1 - smooth(8, 15, cd)) * 0.8);
      // ponds: darker wet shore
      for (const p of ponds) {
        const d = Math.hypot(x - p.x, z - p.z) - p.r;
        if (d < 2.5) c.lerp(darkDirt, (1 - smooth(-0.5, 2.5, d)) * 0.8);
      }
      const h = heightAt(x, z);
      const a = angleOf(x, z);
      const r = Math.hypot(x - ISLAND.cx, z - ISLAND.cz);
      const out = r - walkR(a);
      // rim: sand towards the water, rock on cliffs and the ridge
      if (out > -3.5) c.lerp(sand, smooth(-3.5, 0.8, out + (n2 - 0.5) * 1.5) * (1 - rimCliff(a) * 0.75));
      if (h > 0.15) {
        c.lerp(w[CEM] > 0.5 ? cemRock : rock, smooth(0.15, 2.5, h) * (0.55 + 0.3 * n1));
        c.offsetHSL(0, 0, -Math.min(0.08, h * 0.008));
      }
      if (h < ISLAND.water + 0.1) c.lerp(wetSand, smooth(ISLAND.water + 0.1, ISLAND.water - 1.5, h));
      c.offsetHSL(0, 0, (n2 - 0.5) * 0.06);
      const o = (j * N + i) * 4;
      c.getRGB(srgb, THREE.SRGBColorSpace);
      img.data[o] = srgb.r * 255; img.data[o + 1] = srgb.g * 255; img.data[o + 2] = srgb.b * 255; img.data[o + 3] = 255;
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

  // full-resolution ground texture with the trail drawn on top
  const G = 2048;
  const ground = document.createElement('canvas');
  ground.width = ground.height = G;
  const g = ground.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(base, 0, 0, G, G);
  drawTrail(g, G / MAP_BOX.size, PATH_W);
  drawGatePaths(g, G / MAP_BOX.size, PATH_W * 1.5);

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
  drawGatePaths(m, M / MAP_BOX.size, 2.2, true);
  const shoreTex = new THREE.DataTexture(shore, N, N, THREE.RGBAFormat);
  shoreTex.magFilter = shoreTex.minFilter = THREE.LinearFilter;
  shoreTex.needsUpdate = true;
  return { ground, map, shoreTex };
}

/** The trail: soft wide underlay, solid core and ragged speckles along the edges. */
function drawTrail(g: CanvasRenderingContext2D, ppm: number, width: number, flat = false) {
  const X = (x: number) => (x - MAP_BOX.x) * ppm;
  const Z = (z: number) => (z - MAP_BOX.z) * ppm;
  const gateI = Math.round(GATE.s / (PATH.length / (PATH.x.length - 1)));
  const parts: [number, number, string][] = [[0, gateI, DIRT], [gateI, PATH.x.length - 1, CEM_DIRT]];
  g.lineCap = g.lineJoin = 'round';
  for (const [a, b, col] of parts) {
    const stroke = (wm: number, alpha: number) => {
      g.globalAlpha = alpha;
      g.strokeStyle = col;
      g.lineWidth = wm * ppm;
      g.beginPath();
      for (let i = a; i <= b; i++) (i === a ? g.moveTo : g.lineTo).call(g, X(PATH.x[i]), Z(PATH.z[i]));
      g.stroke();
    };
    if (!flat) stroke(width * 1.35, 0.25);
    stroke(width, flat ? 0.85 : 0.95);
    if (flat) continue;
    g.fillStyle = col;
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = a; i <= b; i += 2) {
      const tx = PATH.x[Math.min(b, i + 1)] - PATH.x[i];
      const tz = PATH.z[Math.min(b, i + 1)] - PATH.z[i];
      const l = Math.hypot(tx, tz) || 1;
      for (const side of [-1, 1]) {
        const off = side * (width * 0.5 + (rnd() - 0.5) * 0.25);
        g.globalAlpha = 0.6 + rnd() * 0.3;
        g.beginPath();
        g.arc(X(PATH.x[i] - (tz / l) * off), Z(PATH.z[i] + (tx / l) * off), (0.08 + rnd() * 0.14) * ppm, 0, 7);
        g.fill();
      }
    }
  }
  g.globalAlpha = 1;
}

/** A short worn path through each passage between locations (the cemetery one is on the trail). */
function drawGatePaths(g: CanvasRenderingContext2D, ppm: number, width: number, flat = false) {
  const X = (x: number) => (x - MAP_BOX.x) * ppm;
  const Z = (z: number) => (z - MAP_BOX.z) * ppm;
  g.lineCap = 'round';
  g.strokeStyle = DIRT;
  for (const G of GATES) {
    if (G.id === 'forest-cemetery') continue;
    const line = (len: number, wm: number, alpha: number) => {
      g.globalAlpha = alpha;
      g.lineWidth = wm * ppm;
      g.beginPath();
      g.moveTo(X(G.x - G.tx * len), Z(G.z - G.tz * len));
      g.lineTo(X(G.x + G.tx * len), Z(G.z + G.tz * len));
      g.stroke();
    };
    if (flat) { line(8, width, 0.8); continue; }
    // fades out at both ends: wide faint strokes under a narrower, shorter core
    line(9, width * 1.6, 0.18);
    line(8, width * 1.2, 0.3);
    line(6.5, width, 0.85);
  }
  g.globalAlpha = 1;
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

export function buildGround(groundCanvas: HTMLCanvasElement): THREE.Mesh {
  const seg = 150;
  const geo = new THREE.PlaneGeometry(MAP_BOX.size, MAP_BOX.size, seg, seg).rotateX(-Math.PI / 2);
  geo.translate(MAP_BOX.x + MAP_BOX.size / 2, 0, MAP_BOX.z + MAP_BOX.size / 2);
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, heightAt(x, z));
    uv.setXY(i, x / 5, z / 5);
  }
  geo.computeVertexNormals();
  const colorMap = new THREE.CanvasTexture(groundCanvas);
  colorMap.colorSpace = THREE.SRGBColorSpace;
  colorMap.flipY = false; // canvas row 0 is MAP_BOX.z (north), like the world-space lookup
  colorMap.anisotropy = 8;
  const mat = new THREE.MeshLambertMaterial({ map: detailTexture() });
  // Baked colours are looked up by world position on top of the tiled grain.
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uColorMap = { value: colorMap };
    sh.uniforms.uMapBox = { value: mapBox() };
    sh.vertexShader = 'uniform vec4 uMapBox;\nvarying vec2 vIslandUv;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n vIslandUv = ((modelMatrix * vec4(transformed, 1.0)).xz - uMapBox.xy) / uMapBox.zw;',
    );
    sh.fragmentShader = 'uniform sampler2D uColorMap;\nvarying vec2 vIslandUv;\n' + sh.fragmentShader.replace(
      '#include <map_fragment>',
      '#include <map_fragment>\n diffuseColor.rgb *= texture2D(uColorMap, vIslandUv).rgb;',
    );
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

/** The sea around the island: turquoise shallows, surf at the shoreline, deep blue further out. */
/** `shoreTex.a`: 1 on land … 0 in deep water (baked in bakeGroundMaps). */
export function buildOcean(time: { value: number }, shoreTex: THREE.Texture) {
  const mat = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uZone: { value: null }, uBox: { value: mapBox() },
      uDeep: { value: new THREE.Color(0x1f7fd0) }, uShallow: { value: new THREE.Color(0x52d8ee) },
    }]),
    vertexShader: `varying vec3 vW;
      #include <fog_pars_vertex>
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `varying vec3 vW; uniform float uTime; uniform sampler2D uZone; uniform vec4 uBox; uniform vec3 uDeep; uniform vec3 uShallow;
      #include <fog_pars_fragment>
      void main(){
        vec2 uv = (vW.xz - uBox.xy) / uBox.zw;
        float inside = step(0.0, uv.x) * step(0.0, uv.y) * step(uv.x, 1.0) * step(uv.y, 1.0);
        float sh = texture2D(uZone, clamp(uv, 0.0, 1.0)).a * inside;
        vec3 col = mix(uDeep, uShallow, pow(sh, 1.4));
        float w1 = sin(vW.x * 0.9 + uTime * 1.1) * sin(vW.z * 1.1 - uTime * 0.9);
        float w2 = sin((vW.x - vW.z) * 1.7 + uTime * 1.6);
        col += smoothstep(0.8, 1.0, w1 * 0.6 + w2 * 0.4) * 0.22;
        float surf = smoothstep(0.86, 0.97, sh + 0.035 * sin(uTime * 2.2 + vW.x * 0.7 + vW.z * 0.5));
        col = mix(col, vec3(0.95, 0.99, 1.0), surf * 0.75);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  mat.uniforms.uTime = time;
  mat.uniforms.uZone.value = shoreTex;
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(420, 72).rotateX(-Math.PI / 2), mat);
  mesh.position.set(ISLAND.cx, ISLAND.water, ISLAND.cz);
  mesh.renderOrder = -1;
  return mesh;
}

/** Shared "wind" uniform for grass sway. */
export const windTime = { value: 0 };

function swayMaterial(mat: THREE.MeshLambertMaterial) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windTime;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
       float sway = sin(uTime * 1.8 + wp.x * 0.35 + wp.z * 0.25) * 0.5 + sin(uTime * 3.1 + wp.x) * 0.2;
       transformed.x += sway * 0.12 * position.y;
       transformed.z += sway * 0.06 * position.y;`,
    );
  };
  return mat;
}

const randomOnIsland = () => {
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.random()) * 118;
  return { x: ISLAND.cx + Math.sin(a) * r, z: ISLAND.cz + Math.cos(a) * r };
};
const onPlaza = (x: number, z: number, r: number) => inCamp(x, z, r - ISLAND.campR);

/** Grass tufts: three crossed blades per instance, coloured per zone. */
export function buildGrass(free: (x: number, z: number) => boolean, ponds: Pond[]) {
  const blade = new THREE.BufferGeometry();
  const verts: number[] = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI;
    const dx = Math.cos(a) * 0.12;
    const dz = Math.sin(a) * 0.12;
    const lean = (k - 1) * 0.08;
    verts.push(-dx, 0, -dz, dx, 0, dz, lean, 0.45 + k * 0.08, lean * 0.5);
  }
  blade.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  blade.computeVertexNormals();
  const mat = swayMaterial(new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
  const count = 3500;
  const mesh = new THREE.InstancedMesh(blade, mat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  let n = 0;
  for (let i = 0; i < count * 4 && n < count; i++) {
    const { x, z } = randomOnIsland();
    // thicker in meadows, none on the trail/plaza, ponds, beaches and rocks
    if (fbm(x * 0.08, z * 0.08) < 0.38 && Math.random() < 0.7) continue;
    if (!walkable(x, z, 0.8) || heightAt(x, z) !== 0) continue;
    if (pathDist(x, z) < PATH_W * 0.5 + 0.4) continue;
    const zone = zoneIdAt(x, z);
    if (onPlaza(x, z, 12)) continue;
    if (ponds.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 0.3)) continue;
    if (!free(x, z)) continue;
    const s = 0.7 + Math.random() * 0.9;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI);
    m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s * (0.8 + Math.random() * 0.6), s));
    mesh.setMatrixAt(n, m);
    if (zone === 'cemetery') col.setHSL(0.72 + Math.random() * 0.05, 0.15, 0.32 + Math.random() * 0.1);
    else if (zone === 'forest') col.setHSL(0.24 + Math.random() * 0.06, 0.55, 0.32 + Math.random() * 0.14);
    else col.set(ZONES[ZONE_INDEX[zone]].ground).offsetHSL(0, 0, -0.12 + Math.random() * 0.1);
    mesh.setColorAt(n, col);
    n++;
  }
  mesh.count = n;
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  return mesh;
}

/** Little flowers in meadows (camp + forest). */
export function buildFlowers(free: (x: number, z: number) => boolean) {
  const geo = new THREE.IcosahedronGeometry(0.09, 0).translate(0, 0.32, 0);
  const stem = new THREE.CylinderGeometry(0.012, 0.012, 0.3, 3).translate(0, 0.15, 0);
  const merged = mergeTwo(geo, stem);
  const mat = swayMaterial(new THREE.MeshLambertMaterial({ color: 0xffffff }));
  const count = 500;
  const mesh = new THREE.InstancedMesh(merged, mat, count);
  const palette = [0xffe14a, 0xffffff, 0xff7aa8, 0xb48bff, 0xff9a3c];
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  let n = 0;
  for (let i = 0; i < count * 6 && n < count; i++) {
    const { x, z } = randomOnIsland();
    if (fbm(x * 0.08 + 3, z * 0.08) < 0.52) continue;
    if (!walkable(x, z, 1) || heightAt(x, z) !== 0 || zoneIdAt(x, z) !== 'forest') continue;
    if (pathDist(x, z) < PATH_W * 0.5 + 0.5) continue;
    if (onPlaza(x, z, 11) || !free(x, z)) continue;
    const s = 0.8 + Math.random() * 0.6;
    m.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
    mesh.setMatrixAt(n, m);
    mesh.setColorAt(n, col.set(palette[Math.floor(Math.random() * palette.length)]));
    n++;
  }
  mesh.count = n;
  mesh.frustumCulled = false;
  return mesh;
}

function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry) {
  const pa = a.toNonIndexed().getAttribute('position');
  const pb = b.toNonIndexed().getAttribute('position');
  const out = new Float32Array(pa.count * 3 + pb.count * 3);
  out.set(pa.array as Float32Array, 0);
  out.set(pb.array as Float32Array, pa.count * 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  g.computeVertexNormals();
  return g;
}

/** Stylised water: depth tint, moving ripples and a bright rim. */
export function buildPond(p: Pond, time: { value: number }) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: { uTime: time, uDeep: { value: new THREE.Color(0x1a86c8) }, uShallow: { value: new THREE.Color(0x5ae0f0) } },
    vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `varying vec2 vUv; varying vec3 vW; uniform float uTime; uniform vec3 uDeep; uniform vec3 uShallow;
      void main(){
        float r = length(vUv - 0.5) * 2.0;
        vec3 col = mix(uDeep, uShallow, smoothstep(0.35, 1.0, r));
        float w1 = sin(vW.x * 1.7 + uTime * 1.3) * sin(vW.z * 1.9 - uTime * 1.1);
        float w2 = sin((vW.x + vW.z) * 3.1 + uTime * 2.0);
        float spark = smoothstep(0.75, 1.0, w1 * 0.6 + w2 * 0.4);
        col += spark * 0.35;
        float rim = smoothstep(0.86, 0.97, r);
        col = mix(col, vec3(0.92, 0.97, 1.0), rim * 0.7);
        gl_FragColor = vec4(col, 0.92 * (1.0 - smoothstep(0.98, 1.0, r)));
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(p.r, 48).rotateX(-Math.PI / 2), mat);
  mesh.position.set(p.x, 0.04, p.z);
  mesh.scale.set(1, 1, 0.8);
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
