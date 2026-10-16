// Fog of war: locations (zones) the hero has not been to yet hide under drifting clouds, in the world
// and on the maps. A location opens as a whole the moment the hero steps into it (the forest hub is known from the start); the set of explored
// locations is saved with the hero. The sea is always open, so the coastline reads on the maps.
// Coverage is kept on the zone grid (2 m cells, blurred zone weights), so borders are soft.
import * as THREE from 'three';
import type { ZoneId } from './config';
import { MAP_BOX, NZ, ZGRID, ZONE_IDS, fbm, smooth, zoneGrid, zoneIdAt } from './island';

const N = ZGRID.n;
/** Map overlay resolution (pixels per side): 1 m per pixel. */
const M = MAP_BOX.size;
const ALL_ZONES = ZONE_IDS;
/** Seconds the clouds take to melt off a location opened from afar (open). */
const FADE = 2.2;

export class FogOfWar {
  readonly grid = new Uint8Array(N * N);
  readonly texture: THREE.DataTexture;
  readonly mesh: THREE.Mesh;
  /** Map overlay: painted clouds (shadowed puffs, wispy edges) over the unexplored land. */
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private img: ImageData;
  private dirtyMap = true;
  private puff = new Float32Array(M * M * 2);
  /** Changed since the last serialize(). */
  dirty = false;
  /** Locations the hero has been to. */
  readonly explored = new Set<ZoneId>(['forest']);
  /** open(): the coverage fades from `fadeFrom` to the new one over FADE s (`fadeT` counts up). */
  private fadeFrom: Uint8Array | null = null;
  private fadeTo = new Uint8Array(N * N);
  private fadeT = 0;

  constructor(time: { value: number }) {
    this.canvas.width = this.canvas.height = M;
    this.ctx = this.canvas.getContext('2d')!;
    this.img = this.ctx.createImageData(M, M);
    // cloud noise, fixed per pixel: [density, light]
    for (let j = 0; j < M; j++) {
      for (let i = 0; i < M; i++) {
        const x = MAP_BOX.x + i + 0.5;
        const z = MAP_BOX.z + j + 0.5;
        this.puff[(j * M + i) * 2] = fbm(x * 0.045, z * 0.045, 5);
        this.puff[(j * M + i) * 2 + 1] = fbm(x * 0.09 + 31, z * 0.09 - 17, 4);
      }
    }
    this.texture = new THREE.DataTexture(this.grid, N, N, THREE.RedFormat);
    this.texture.magFilter = this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.unpackAlignment = 1; // rows are N bytes, not a multiple of 4
    this.reset();
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uFog: { value: this.texture }, uTime: time,
        uBox: { value: new THREE.Vector4(MAP_BOX.x, MAP_BOX.z, MAP_BOX.size, MAP_BOX.size) },
      },
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `varying vec3 vW; uniform sampler2D uFog; uniform vec4 uBox; uniform float uTime;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
          return mix(mix(h(i), h(i+vec2(1,0)), u.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), u.x), u.y); }
        float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * n(p); p *= 2.03; a *= 0.5; } return s; }
        void main(){
          // The cloud layer floats above the level, but is looked up where the view ray meets the ground,
          // so the clear hole sits exactly over the explored ground.
          vec3 d = vW - cameraPosition;
          vec2 g = vW.xz + d.xz * (-vW.y / d.y);
          float seen = texture2D(uFog, (g - uBox.xy) / uBox.zw).r;
          float c = fbm(g * 0.07 + vec2(uTime * 0.015, uTime * 0.01));
          float a = smoothstep(0.3, 0.75, 1.0 - seen + (c - 0.5) * 0.45);
          vec3 col = mix(vec3(0.74, 0.78, 0.88), vec3(0.98, 0.99, 1.0), smoothstep(0.3, 0.75, c));
          gl_FragColor = vec4(col, a * 0.97);
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(MAP_BOX.size, MAP_BOX.size).rotateX(-Math.PI / 2), mat);
    this.mesh.position.set(MAP_BOX.x + MAP_BOX.size / 2, 7, MAP_BOX.z + MAP_BOX.size / 2);
    this.mesh.renderOrder = 10;
  }

  /** Rebuilds the coverage grid from the explored set: 255 = open (explored land or sea), 0 = clouds. */
  private rebuild(out = this.grid) {
    const w = zoneGrid.w;
    const open = ALL_ZONES.map((z) => (this.explored.has(z) ? 1 : 0));
    for (let k = 0; k < N * N; k++) {
      let sum = 0;
      let land = 0;
      for (let c = 0; c < NZ; c++) { sum += w[k * NZ + c]; land += w[k * NZ + c] * open[c]; }
      land /= sum || 1;
      const sea = Math.min(1, Math.max(0, (0.9 - zoneGrid.land[k]) / 0.3));
      out[k] = 255 * Math.max(land, sea);
    }
    if (out !== this.grid) return;
    this.fadeFrom = null;
    this.texture.needsUpdate = true;
    this.dirtyMap = true;
  }

  /** Only the forest (the hub) is known (or the given locations). */
  reset(keep: ZoneId[] = ['forest']) {
    this.explored.clear();
    for (const z of keep) this.explored.add(z);
    this.dirty = true;
    this.rebuild();
  }

  revealAll() {
    for (const z of ALL_ZONES) this.explored.add(z);
    this.dirty = true;
    this.rebuild();
  }

  /** Called every frame with the hero position: opens the location the hero is standing in. */
  reveal(x: number, z: number) {
    const id = zoneIdAt(x, z);
    if (this.explored.has(id)) return false;
    this.explored.add(id);
    this.dirty = true;
    this.rebuild();
    return true;
  }

  /** Opens locations from afar (a boss opened the way): their clouds melt away over FADE s (update). */
  open(zones: ZoneId[]) {
    const fresh = zones.filter((z) => !this.explored.has(z));
    if (!fresh.length) return;
    for (const z of fresh) this.explored.add(z);
    this.dirty = true;
    this.fadeFrom = this.grid.slice();
    this.rebuild(this.fadeTo);
    this.fadeT = 0;
  }

  update(dt: number) {
    const from = this.fadeFrom;
    if (!from) return;
    this.fadeT += dt;
    const k = Math.min(1, this.fadeT / FADE);
    const e = k * k * (3 - 2 * k);
    for (let i = 0; i < N * N; i++) this.grid[i] = from[i] + (this.fadeTo[i] - from[i]) * e;
    this.texture.needsUpdate = true;
    this.dirtyMap = true;
    if (k >= 1) this.fadeFrom = null;
  }

  /** Is this spot in an explored location (labels and map markers are hidden otherwise)? */
  isExplored(x: number, z: number) {
    return this.explored.has(zoneIdAt(x, z));
  }

  /** Clouds over the maps; call after the static layers and before the markers. */
  drawOnMap(g: CanvasRenderingContext2D, X: (x: number) => number, Y: (z: number) => number, ppm: number) {
    if (this.dirtyMap) {
      const d = this.img.data;
      const s = N / M;
      for (let j = 0; j < M; j++) {
        // bilinear coverage from the zone grid
        const fz = Math.min(N - 1.001, Math.max(0, (j + 0.5) * s - 0.5));
        const j0 = Math.floor(fz);
        const v = fz - j0;
        for (let i = 0; i < M; i++) {
          const fx = Math.min(N - 1.001, Math.max(0, (i + 0.5) * s - 0.5));
          const i0 = Math.floor(fx);
          const u = fx - i0;
          const g = this.grid;
          const a = j0 * N + i0;
          const seen = ((g[a] * (1 - u) + g[a + 1] * u) * (1 - v) + (g[a + N] * (1 - u) + g[a + N + 1] * u) * v) / 255;
          const k = j * M + i;
          const dens = this.puff[k * 2];
          const light = smooth(0.25, 0.75, this.puff[k * 2 + 1] * 0.6 + dens * 0.5);
          // wispy border: the noise eats into the edge of the cloud cover
          const alpha = smooth(0.25, 0.7, 1 - seen + (dens - 0.47) * 0.9) * (0.82 + 0.18 * light);
          d[k * 4] = 150 + 102 * light;
          d[k * 4 + 1] = 160 + 94 * light;
          d[k * 4 + 2] = 190 + 64 * light;
          d[k * 4 + 3] = 255 * alpha;
        }
      }
      this.ctx.putImageData(this.img, 0, 0);
      this.dirtyMap = false;
    }
    g.imageSmoothingEnabled = true;
    g.drawImage(this.canvas, X(MAP_BOX.x), Y(MAP_BOX.z), MAP_BOX.size * ppm, MAP_BOX.size * ppm);
  }

  /** Save string: explored location ids. */
  serialize() {
    this.dirty = false;
    return [...this.explored].join(',');
  }

  load(data: string | undefined) {
    const ids = (data ?? '').split(',').filter((z): z is ZoneId => (ALL_ZONES as string[]).includes(z));
    if (!ids.length) return false;
    this.reset(ids);
    this.dirty = false;
    return true;
  }
}
