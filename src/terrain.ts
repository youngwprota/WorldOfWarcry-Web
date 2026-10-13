// Terrain, vegetation, water and ground mist. The playable strip is flat (y = 0);
// hills rise outside it so gameplay code never needs to sample heights.
import * as THREE from 'three';
import { WORLD, ZONES, type ZoneDef } from './config';

// ---------- noise ----------
function hash(x: number, z: number) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, z: number) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi);
  const b = hash(xi + 1, zi);
  const c = hash(xi, zi + 1);
  const d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x: number, z: number, oct = 4) {
  let s = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, z * f); f *= 2.03; a *= 0.5; }
  return s;
}

export const pathX = (z: number) => (z > -20 ? 0 : Math.sin((z + 20) * 0.045) * 9);

export function zoneAt(z: number): ZoneDef {
  return ZONES.find((zd) => z <= zd.z[0] && z > zd.z[1]) ?? (z > 0 ? ZONES[0] : ZONES[ZONES.length - 1]);
}

/** Ground height: 0 in the playable strip, rolling hills outside it. */
export function heightAt(x: number, z: number) {
  const ex = Math.max(0, Math.abs(x) - (WORLD.halfWidth + 1));
  const ez = Math.max(0, z - (WORLD.zMax + 1), WORLD.zMin - 1 - z);
  const e = Math.hypot(ex, ez);
  if (e <= 0) return 0;
  const n = fbm(x * 0.045 + 10, z * 0.045);
  const ramp = Math.min(1, e / 12);
  return ramp * ramp * (3 + n * 9) + e * 0.12;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Tileable grain texture multiplied over vertex colours. */
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

export function buildGround(ponds: Pond[]): THREE.Mesh {
  const w = 170;
  const z0 = WORLD.zMax + 45;
  const z1 = WORLD.zMin - 45;
  const segX = 110;
  const segZ = Math.round((z0 - z1) / 1.4);
  const geo = new THREE.PlaneGeometry(w, z0 - z1, segX, segZ).rotateX(-Math.PI / 2);
  geo.translate(0, 0, (z0 + z1) / 2);
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const t = new THREE.Color();
  const dirt = new THREE.Color(0xcfae80);
  const darkDirt = new THREE.Color(0x8e6c48);
  const rock = new THREE.Color(0xa49a88);
  const meadow = new THREE.Color(0xa8e85a);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    uv.setXY(i, x / 5, z / 5);
    const zone = zoneAt(z);
    const n1 = fbm(x * 0.08, z * 0.08);
    const n2 = fbm(x * 0.25 + 5, z * 0.25 - 3, 3);
    c.set(zone.ground).lerp(t.set(zone.ground2), smooth(0.35, 0.7, n1));
    // soft zone borders
    for (const zd of ZONES) {
      if (zd === zone) continue;
      const d = Math.abs(z - zd.z[1]);
      if (d < 7) c.lerp(t.set(zd.ground), (1 - d / 7) * 0.5);
    }
    if (zone.id !== 'cemetery') c.lerp(meadow, smooth(0.62, 0.8, n2) * 0.35);
    else c.lerp(t.set(0x5a5494), smooth(0.55, 0.8, n2) * 0.5);
    // dirt path with ragged edges
    const pd = Math.abs(x - pathX(z)) + (n2 - 0.5) * 1.6;
    const pathW = zone.id === 'cemetery' ? 2.3 : 1.9;
    if (z < -12) {
      const k = 1 - smooth(pathW - 0.4, pathW + 1.2, pd);
      c.lerp(zone.id === 'cemetery' ? t.set(0xa49cc8) : dirt, k * 0.85);
    }
    // camp plaza
    if (zone.id === 'camp') {
      const cd = Math.hypot(x, z - 2) + (n2 - 0.5) * 3;
      c.lerp(dirt, (1 - smooth(8, 15, cd)) * 0.8);
    }
    // ponds: darker wet shore
    for (const p of ponds) {
      const d = Math.hypot(x - p.x, z - p.z) - p.r;
      if (d < 2.5) c.lerp(darkDirt, (1 - smooth(-0.5, 2.5, d)) * 0.8);
    }
    // hills: greener tops, rocky slopes
    if (h > 0.2) {
      c.lerp(rock, smooth(3, 9, h) * 0.45 * (0.6 + n1));
      c.offsetHSL(0, 0, -Math.min(0.08, h * 0.006));
    }
    c.offsetHSL(0, 0, (n2 - 0.5) * 0.06);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, map: detailTexture() }));
  mesh.receiveShadow = true;
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
  const count = 7000;
  const mesh = new THREE.InstancedMesh(blade, mat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  let n = 0;
  for (let i = 0; i < count * 3 && n < count; i++) {
    const x = (Math.random() * 2 - 1) * (WORLD.halfWidth + 6);
    const z = WORLD.zMax + 4 - Math.random() * (WORLD.zMax - WORLD.zMin + 8);
    const zone = zoneAt(z);
    // thicker in meadows, sparse on paths/plaza and around ponds
    if (fbm(x * 0.08, z * 0.08) < 0.38 && Math.random() < 0.7) continue;
    if (Math.abs(x - pathX(z)) < 2.4 && z < -12) continue;
    if (zone.id === 'camp' && Math.hypot(x, z - 2) < 12) continue;
    if (ponds.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 0.3)) continue;
    if (!free(x, z)) continue;
    const s = 0.7 + Math.random() * 0.9;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI);
    m.compose(new THREE.Vector3(x, heightAt(x, z), z), q, new THREE.Vector3(s, s * (0.8 + Math.random() * 0.6), s));
    mesh.setMatrixAt(n, m);
    if (zone.id === 'cemetery') col.setHSL(0.72 + Math.random() * 0.05, 0.15, 0.32 + Math.random() * 0.1);
    else col.setHSL(0.24 + Math.random() * 0.06, 0.55, 0.32 + Math.random() * 0.14);
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
  const count = 900;
  const mesh = new THREE.InstancedMesh(merged, mat, count);
  const palette = [0xffe14a, 0xffffff, 0xff7aa8, 0xb48bff, 0xff9a3c];
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  let n = 0;
  for (let i = 0; i < count * 4 && n < count; i++) {
    const x = (Math.random() * 2 - 1) * (WORLD.halfWidth - 1);
    const z = 20 - Math.random() * 136;
    if (fbm(x * 0.08 + 3, z * 0.08) < 0.52) continue;
    if (Math.abs(x - pathX(z)) < 2.5 && z < -12) continue;
    if (Math.hypot(x, z - 2) < 11 || !free(x, z)) continue;
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
 * Ground mist: two large layers with drifting fbm noise. Density follows the zone
 * (none in camp, light in the forest, thick in the cemetery).
 */
export function buildMist(time: { value: number }) {
  const zones = ZONES.map((z) => new THREE.Vector4(z.z[0], z.z[1], z.mist, 0));
  const colors = ZONES.map((z) => new THREE.Color(z.mistColor));
  const group = new THREE.Group();
  const make = (y: number, scale: number, alpha: number, speed: number) => {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: time, uScale: { value: scale }, uAlpha: { value: alpha }, uSpeed: { value: speed },
        uZones: { value: zones }, uColors: { value: colors }, uCam: { value: new THREE.Vector3() },
      },
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `varying vec3 vW; uniform float uTime; uniform float uScale; uniform float uAlpha; uniform float uSpeed;
        uniform vec4 uZones[3]; uniform vec3 uColors[3]; uniform vec3 uCam;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
          return mix(mix(h(i), h(i+vec2(1,0)), u.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), u.x), u.y); }
        float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * n(p); p *= 2.07; a *= 0.5; } return s; }
        void main(){
          float dens = 0.0; vec3 col = vec3(0.0); float wsum = 0.0;
          for (int i = 0; i < 3; i++){
            float inside = smoothstep(uZones[i].y - 6.0, uZones[i].y + 6.0, vW.z) * (1.0 - smoothstep(uZones[i].x - 6.0, uZones[i].x + 6.0, vW.z));
            dens += inside * uZones[i].z; col += uColors[i] * inside; wsum += inside;
          }
          col /= max(wsum, 0.001);
          vec2 p = vW.xz * uScale + vec2(uTime * uSpeed, uTime * uSpeed * 0.6);
          float f = fbm(p + fbm(p * 0.5 + uTime * 0.02) * 1.5);
          float a = smoothstep(0.35, 0.85, f) * dens * uAlpha;
          // thin out right around the hero so the action stays readable
          float d = length(vW.xz - uCam.xz);
          a *= mix(0.35, 1.0, smoothstep(2.0, 7.0, d));
          gl_FragColor = vec4(col, a);
        }`,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(170, WORLD.zMax - WORLD.zMin + 90).rotateX(-Math.PI / 2), mat);
    m.position.set(0, y, (WORLD.zMax + WORLD.zMin) / 2);
    m.renderOrder = 5;
    group.add(m);
    return mat;
  };
  const mats = [make(0.3, 0.07, 0.7, 0.25), make(1.1, 0.045, 0.4, -0.18), make(2.2, 0.03, 0.22, 0.12)];
  return { group, setCamera: (p: THREE.Vector3) => mats.forEach((m) => m.uniforms.uCam.value.copy(p)) };
}
