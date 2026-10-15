// 3D forge for the gacha reveal (docs/features/ludka): the project's anvil and hammer plus Blender props from
// tools/forge_props.py, three hammer blows that raise the rarity colour step by step, then the item rises from the anvil.
// Own small renderer (like the hero preview); bloom is skipped on low graphics.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { assets } from './assets';
import { sfx } from './audio';
import { FORGE3D as F, GACHA, RARITY, type FactionId } from './config';
import { gachaTier } from './gacha';
import { itemModel, type Item } from './items';

let propsPromise: Promise<THREE.Group> | null = null;
function loadProps() {
  propsPromise ??= new GLTFLoader().loadAsync(import.meta.env.BASE_URL + 'assets/models/forge.glb').then((g) => g.scene);
  return propsPromise;
}

/** Colours of the gacha tiers (GACHA.tiers), not of every rarity. */
const RCOL = GACHA.tiers.map((t) => new THREE.Color(RARITY[t].color));
const HOT = new THREE.Color(1, 0.42, 0.12);
const WHITE = new THREE.Color(1, 1, 1);

// ---------- sparks: one Points cloud, preallocated, CPU-simulated ----------
const MAX = 700;
const SPARK_VS = /* glsl */ `
attribute float alpha;
attribute vec3 tint;
varying float vA;
varying vec3 vC;
uniform float scale;
void main() {
  vA = alpha;
  vC = tint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = scale * (0.4 + alpha) / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const SPARK_FS = /* glsl */ `
varying float vA;
varying vec3 vC;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float k = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(vC * (1.0 + k * 1.2), k * vA);
}`;

// Radial rays behind the revealed item, rarity coloured.
const RAYS_FS = /* glsl */ `
varying vec2 vUv;
uniform vec3 color;
uniform float time;
uniform float opacity;
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  float a = atan(p.y, p.x);
  float rays = pow(0.5 + 0.5 * sin(a * 12.0 + time * 0.8), 6.0) + 0.5 * pow(0.5 + 0.5 * sin(a * 7.0 - time * 1.3), 8.0);
  float fall = smoothstep(1.0, 0.1, r);
  float core = smoothstep(0.3, 0.0, r);
  gl_FragColor = vec4(color * (rays * fall * 0.8 + core * 0.6), (rays * fall * 0.45 + core * 0.35) * opacity);
}`;
const BEAM_FS = /* glsl */ `
varying vec2 vUv;
uniform vec3 color;
uniform float opacity;
void main() {
  float edge = pow(sin(vUv.x * 3.14159), 2.0);
  float fade = smoothstep(1.0, 0.0, vUv.y) * smoothstep(0.0, 0.05, vUv.y);
  gl_FragColor = vec4(color * 1.2, edge * fade * opacity * 0.45);
}`;
const UV_VS = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const v1 = new THREE.Vector3();
const c1 = new THREE.Color();
const easeOutBack = (t: number) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;

export class Forge3D {
  readonly ready: Promise<void>;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(F.fov, 1, 0.1, 60);
  private camBase = new THREE.Vector3();
  private lookAt = new THREE.Vector3();
  private own: (THREE.BufferGeometry | THREE.Material)[] = [];
  private raf = 0;
  private last = 0;
  private built = false;
  private paused = false;

  private pivot = new THREE.Group();
  private ingot!: THREE.Mesh;
  private ingotMat!: THREE.MeshLambertMaterial;
  private emberMat!: THREE.MeshBasicMaterial;
  private top = 0;
  private hitPos = new THREE.Vector3();
  private strikeLight = new THREE.PointLight(0xffffff, 0, 6, 1.6);
  private coalLight = new THREE.PointLight(0xff7a2a, F.coalLight, 9, 1.4);
  private itemLight = new THREE.PointLight(0xffffff, 0, 8, 1.4);
  private ring!: THREE.Mesh;
  private ringMat!: THREE.MeshBasicMaterial;
  private rays!: THREE.Mesh;
  private raysMat!: THREE.ShaderMaterial;
  private beam!: THREE.Mesh;
  private beamMat!: THREE.ShaderMaterial;

  private pts!: THREE.Points;
  private pPos = new Float32Array(MAX * 3);
  private pVel = new Float32Array(MAX * 3);
  private pTint = new Float32Array(MAX * 3);
  private pAlpha = new Float32Array(MAX);
  private pLife = new Float32Array(MAX);
  private pMax = new Float32Array(MAX);
  private pFloat = new Uint8Array(MAX);
  private cursor = 0;

  // timeline
  private t = 0;
  private playing = false;
  private struck = 0;
  private stages: number[] = [];
  private strikeAt: number[] = [];
  private lastBlow = 0;
  private revealAt = 0;
  private revealed = false;
  private rarity = 0;
  private shake = 0;
  private emberAcc = 0;
  private holder = new THREE.Group();
  private onReveal: () => void = () => {};

  constructor(private canvas: HTMLCanvasElement, lowGfx: boolean, private faction: FactionId) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowGfx, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, lowGfx ? 1 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color(F.bg);
    this.scene.fog = new THREE.FogExp2(F.bg, 0.07);
    if (!lowGfx) {
      this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), F.bloom.strength, F.bloom.radius, F.bloom.threshold);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.ready = loadProps().then((props) => this.build(props));
    if (import.meta.env.DEV) (window as unknown as { __forge: Forge3D }).__forge = this;
  }

  private mine<T extends THREE.BufferGeometry | THREE.Material>(x: T) { this.own.push(x); return x; }

  private build(props: THREE.Group) {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0x8c7a9e, 0x1c0f0a, 1.1));
    const key = new THREE.DirectionalLight(0xffd7a8, 1.6);
    key.position.set(-2, 4, 3);
    const rim = new THREE.DirectionalLight(0x7aa2ff, 1.4);
    rim.position.set(2.5, 2.5, -3);
    s.add(key, rim, this.strikeLight, this.coalLight, this.itemLight);

    // Blender props: swap the exported materials for cheap ones by name.
    const lam = new Map<string, THREE.Material>();
    const swap = (name: string, color: THREE.ColorRepresentation) => {
      let m = lam.get(name);
      if (!m) { m = this.mine(new THREE.MeshLambertMaterial({ color, flatShading: true })); lam.set(name, m); }
      return m;
    };
    this.ingotMat = this.mine(new THREE.MeshLambertMaterial({ color: 0x3a2a24, emissive: HOT, emissiveIntensity: 1.2, flatShading: true }));
    this.emberMat = this.mine(new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.38, 0.1).multiplyScalar(2.2) }));
    const P = props.clone();
    P.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const name = (m.material as THREE.Material).name;
      m.material = name === 'Hot' ? this.ingotMat : name === 'Ember' ? this.emberMat
        : swap(name, name === 'Coal' ? 0x1c1614 : name === 'StoneDark' ? 0x4a4450 : 0x6e6a74);
    });
    const floor = P.getObjectByName('floor')!;
    const hearth = new THREE.Group();
    for (const n of ['hearth', 'coals', 'embers']) hearth.add(P.getObjectByName(n)!);
    this.ingot = P.getObjectByName('ingot') as THREE.Mesh;
    s.add(floor);
    hearth.position.set(F.hearth[0], 0, F.hearth[2]);
    hearth.scale.set(...F.hearthScale);
    s.add(hearth);
    this.coalLight.position.set(F.hearth[0], 1.1, F.hearth[2]);

    // Anvil from the game art, scaled to the scene; the ingot sits on its top face.
    const anvil = assets.clone('anvil_big');
    anvil.scale.multiplyScalar(F.anvilScale);
    anvil.rotation.y = F.anvilYaw;
    s.add(anvil);
    anvil.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(anvil);
    this.top = box.max.y;
    this.ingot.position.set(F.ingot[0], this.top + F.ingot[1], F.ingot[2]);
    this.ingot.rotation.set(0, F.ingotYaw, 0);
    s.add(this.ingot);
    this.hitPos.set(F.ingot[0], this.top + 0.08, F.ingot[2]);
    this.strikeLight.position.set(this.hitPos.x, this.top + 0.9, this.hitPos.z + 0.7);

    for (const [name, x, z, k, yaw] of F.decor) {
      if (!assets.has(name)) continue;
      const d = assets.clone(name);
      d.scale.multiplyScalar(k);
      d.position.set(x, 0, z);
      d.rotation.y = yaw;
      s.add(d);
    }

    // Hammer on a shoulder pivot: local +Y of the model (head end) points along +X at angle 0.
    const hammer = assets.clone('hammer_human_paladin');
    hammer.scale.multiplyScalar(F.hammerScale);
    // handle (model +Y) along +X, head axis (model +Z) pointing down at the ingot
    hammer.rotation.order = 'ZYX';
    hammer.rotation.set(0, Math.PI / 2, -Math.PI / 2);
    this.pivot.add(hammer);
    this.pivot.position.set(F.pivot[0], this.top + F.pivot[1], F.pivot[2]);
    s.add(this.pivot);

    // Shockwave ring, rays and the legendary beam.
    this.ringMat = this.mine(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.ring = new THREE.Mesh(this.mine(new THREE.RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2)), this.ringMat);
    this.ring.position.copy(this.hitPos);
    this.ring.visible = false;
    s.add(this.ring);
    this.raysMat = this.mine(new THREE.ShaderMaterial({
      vertexShader: UV_VS, fragmentShader: RAYS_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { color: { value: new THREE.Color() }, time: { value: 0 }, opacity: { value: 0 } },
    }));
    this.rays = new THREE.Mesh(this.mine(new THREE.PlaneGeometry(3, 3)), this.raysMat);
    this.rays.visible = false;
    s.add(this.rays);
    this.beamMat = this.mine(new THREE.ShaderMaterial({
      vertexShader: UV_VS, fragmentShader: BEAM_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { color: { value: new THREE.Color() }, opacity: { value: 0 } },
    }));
    // Camera-facing quad (soft edges from the shader), turned around Y every frame.
    this.beam = new THREE.Mesh(this.mine(new THREE.PlaneGeometry(1.1, 9).translate(0, 4.5, 0)), this.beamMat);
    this.beam.position.set(this.hitPos.x, this.top, this.hitPos.z);
    this.beam.visible = false;
    s.add(this.beam);
    s.add(this.holder);

    // Sparks
    const g = this.mine(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('tint', new THREE.BufferAttribute(this.pTint, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.pAlpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.pts = new THREE.Points(g, this.mine(new THREE.ShaderMaterial({
      vertexShader: SPARK_VS, fragmentShader: SPARK_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { scale: { value: 60 } },
    })));
    this.pts.frustumCulled = false;
    s.add(this.pts);

    this.camera.position.set(...F.camera);
    this.camBase.copy(this.camera.position);
    this.lookAt.set(F.lookAt[0], this.top + F.lookAt[1], F.lookAt[2]);
    this.reset();
    this.built = true;
    if (!this.paused) this.resume();
  }

  /** Stop rendering while the banner covers the scene. */
  pause() {
    this.paused = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  resume() {
    this.paused = false;
    if (!this.built || this.raf) return;
    this.last = performance.now();
    this.loop();
  }

  /** Idle state: hammer raised, plain hot ingot, no item. */
  private reset() {
    this.playing = false;
    this.revealed = false;
    this.struck = 0;
    this.t = 0;
    this.setStage(0);
    this.pivot.rotation.z = F.hammerUp;
    this.ingot.visible = true;
    this.pivot.visible = true;
    this.ring.visible = this.rays.visible = this.beam.visible = false;
    this.itemLight.intensity = 0;
    this.holder.clear();
  }

  /** Plays the reveal of an already pulled item; `onReveal` fires when the item is up (show the card). */
  play(item: Item, onReveal: () => void) {
    this.reset();
    const r = gachaTier(item.rarity);
    this.rarity = r;
    // Rarity climbs blow by blow and never goes down; before the last blow it stops below legendary,
    // the last blow always lands on the real rarity.
    const n = GACHA.strikes, last = n - 1, cap = Math.min(r, 2);
    const gap = GACHA.strikeGap;
    this.stages.length = this.strikeAt.length = 0;
    let s = 0;
    for (let i = 0; i < last; i++) {
      if (s < cap && Math.random() < ((i + 1) / last) * 0.7) s++;
      this.stages.push(s);
      this.strikeAt.push(0.6 + gap * i);
    }
    this.stages.push(r);
    // Suspense: a rare-or-better result waits longer before the last blow.
    this.strikeAt.push(0.6 + gap * last + (r >= 2 ? gap * 0.7 : 0));
    this.lastBlow = last;
    this.revealAt = this.strikeAt[last] + 0.35;
    this.onReveal = onReveal;
    this.buildItem(item);
    this.playing = true;
  }

  /** Jump to the last blow (it still plays its burst). */
  skip() {
    if (!this.playing || this.struck > this.lastBlow) return;
    // the colour reached so far jumps to the one before the last blow
    this.setStage(this.stages[this.lastBlow - 1]);
    this.struck = this.lastBlow;
    this.t = this.strikeAt[this.lastBlow] - 0.15;
  }

  get busy() { return this.playing && !this.revealed; }

  private buildItem(item: Item) {
    let m: THREE.Object3D;
    if (item.kind === 'weapon' && assets.has(itemModel(item, this.faction))) {
      m = assets.clone(itemModel(item, this.faction));
      const b = new THREE.Box3().setFromObject(m);
      const h = b.max.y - b.min.y || 1;
      m.scale.multiplyScalar(F.itemSize / h);
      m.position.y = -((b.min.y + b.max.y) / 2) * (F.itemSize / h);
    } else {
      // Armour has no standalone model: a loot crystal like the ones dropped in the world.
      const mat = this.mine(new THREE.MeshLambertMaterial({ color: RCOL[this.rarity], emissive: RCOL[this.rarity], emissiveIntensity: 0.3, flatShading: true }));
      m = new THREE.Mesh(this.mine(new THREE.OctahedronGeometry(0.32, 0)), mat);
      m.scale.set(1, 1.6, 1);
    }
    const tilt = new THREE.Group();
    tilt.rotation.z = 0.35;
    tilt.add(m);
    this.holder.add(tilt);
    this.holder.position.set(this.hitPos.x, this.top, this.hitPos.z);
    this.holder.visible = false;
  }

  private setStage(stage: number) {
    this.ingotMat.emissive.copy(stage === 0 ? HOT : RCOL[stage]);
    this.ingotMat.emissiveIntensity = 1.2 + stage * 0.4;
    this.strikeLight.color.copy(stage === 0 ? HOT : RCOL[stage]);
    this.ringMat.color.copy(RCOL[stage]).multiplyScalar(2);
  }

  private strike(i: number) {
    const stage = this.stages[i];
    const last = i === this.lastBlow;
    this.setStage(stage);
    sfx.anvil(stage);
    this.strikeLight.intensity = 3 + stage * 1.2 + (last ? 2 : 0);
    this.shake = 0.06 + stage * 0.03 + (last ? 0.05 : 0);
    this.ring.visible = true;
    this.ring.scale.setScalar(0.15);
    this.ringMat.opacity = 1;
    const col = stage === 0 ? HOT : RCOL[stage];
    this.burst(50 + stage * 50 + (last ? 60 : 0), col, 3 + stage * 0.8, 0.6 + stage * 0.15);
  }

  private reveal() {
    this.revealed = true;
    const r = this.rarity;
    const col = RCOL[r];
    sfx.reveal(r);
    this.ingot.visible = false;
    this.pivot.visible = false;
    this.holder.visible = true;
    this.itemLight.color.copy(col);
    this.rays.visible = r > 0;
    this.raysMat.uniforms.color.value.copy(col);
    this.beam.visible = r >= 3;
    this.beamMat.uniforms.color.value.copy(col);
    this.strikeLight.intensity = 8;
    this.shake = r >= 3 ? 0.18 : 0.08;
    this.burst(120 + r * 80, col, 2.6, 1.2, true);
    if (r >= 3) this.burst(160, WHITE, 4.5, 0.9);
    this.onReveal();
  }

  // ---------- particles ----------
  private emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, col: THREE.Color, life: number, float: boolean) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX;
    this.pPos[i * 3] = x; this.pPos[i * 3 + 1] = y; this.pPos[i * 3 + 2] = z;
    this.pVel[i * 3] = vx; this.pVel[i * 3 + 1] = vy; this.pVel[i * 3 + 2] = vz;
    this.pTint[i * 3] = col.r; this.pTint[i * 3 + 1] = col.g; this.pTint[i * 3 + 2] = col.b;
    this.pLife[i] = this.pMax[i] = life;
    this.pFloat[i] = float ? 1 : 0;
  }

  private burst(n: number, col: THREE.Color, speed: number, life: number, float = false) {
    const p = this.hitPos;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const up = 0.3 + Math.random() * 0.9;
      const v = speed * (0.35 + Math.random() * 0.8);
      c1.copy(Math.random() < 0.25 ? WHITE : col);
      this.emit(p.x, p.y, p.z, Math.cos(a) * v, up * v, Math.sin(a) * v * 0.7, c1, life * (0.6 + Math.random() * 0.8), float);
    }
  }

  private updateParticles(dt: number) {
    const P = this.pPos, V = this.pVel;
    for (let i = 0; i < MAX; i++) {
      if (this.pLife[i] <= 0) { this.pAlpha[i] = 0; continue; }
      this.pLife[i] -= dt;
      const j = i * 3;
      if (this.pFloat[i]) { V[j + 1] += 0.6 * dt; V[j] *= 1 - dt; V[j + 2] *= 1 - dt; } else V[j + 1] -= 9 * dt;
      P[j] += V[j] * dt; P[j + 1] += V[j + 1] * dt; P[j + 2] += V[j + 2] * dt;
      // sparks bounce off the floor
      if (P[j + 1] < 0.02 && V[j + 1] < 0) { P[j + 1] = 0.02; V[j + 1] *= -0.35; V[j] *= 0.6; V[j + 2] *= 0.6; }
      this.pAlpha[i] = Math.max(0, this.pLife[i] / this.pMax[i]);
    }
    const g = this.pts.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.tint.needsUpdate = true;
    g.attributes.alpha.needsUpdate = true;
  }

  // ---------- frame ----------
  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.update(dt, now / 1000);
    this.render();
  };

  private update(dt: number, time: number) {
    if (this.playing) {
      this.t += dt;
      if (this.struck <= this.lastBlow && this.t >= this.strikeAt[this.struck]) this.strike(this.struck++);
      if (!this.revealed && this.t >= this.revealAt) this.reveal();
    }
    const t = this.t;

    // Hammer: raised, slams down over the last 0.14 s before a blow, then lifts back.
    let a = F.hammerUp;
    if (this.playing && !this.revealed) {
      if (this.struck <= this.lastBlow) {
        const k = 1 - (this.strikeAt[this.struck] - t) / 0.14;
        if (k > 0) a = F.hammerUp + (F.hammerDown - F.hammerUp) * k * k;
        // wind-up: lifts a bit higher just before the swing
        else { const w = 1 - (this.strikeAt[this.struck] - t) / 0.5; if (w > 0) a += 0.25 * Math.sin(w * Math.PI * 0.5); }
      }
      if (this.struck > 0) {
        const since = t - this.strikeAt[this.struck - 1];
        if (since < 0.4) a = Math.min(a, F.hammerDown + (F.hammerUp - F.hammerDown) * Math.min(1, since / 0.4) ** 0.6);
      }
    }
    this.pivot.rotation.z = a;

    // Lights and pulses
    this.strikeLight.intensity *= Math.exp(-dt * 7);
    this.coalLight.intensity = F.coalLight * (1 + Math.sin(time * 9) * 0.12 + Math.sin(time * 23) * 0.08);
    const pulse = 0.5 + 0.5 * Math.sin(time * 6);
    this.emberMat.color.setRGB(1, 0.38, 0.1).multiplyScalar(1.8 + pulse * 0.8);
    if (this.ring.visible) {
      this.ring.scale.multiplyScalar(1 + dt * 7);
      this.ringMat.opacity -= dt * 2.5;
      if (this.ringMat.opacity <= 0) this.ring.visible = false;
    }
    // Before a rare-or-better last blow the ingot throbs in the colour reached so far.
    if (this.playing && this.struck === this.lastBlow && this.rarity >= 2) this.ingotMat.emissiveIntensity = 1.8 + Math.sin(time * 18) * 0.8;

    // Embers from the hearth all the time; a heavier stream once the item is out.
    this.emberAcc += dt * (this.revealed ? 30 : 12);
    while (this.emberAcc >= 1) {
      this.emberAcc--;
      const c = this.revealed ? RCOL[this.rarity] : HOT;
      this.emit(F.hearth[0] + (Math.random() - 0.5) * 1.2, 0.5, F.hearth[2] + (Math.random() - 0.5) * 1.2,
        (Math.random() - 0.5) * 0.3, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 0.3, c, 2 + Math.random() * 1.5, true);
    }
    this.updateParticles(dt);

    // Item rise and spin
    if (this.revealed) {
      const k = Math.min(1, (t - this.revealAt) / 0.9);
      this.holder.position.y = this.top + 0.15 + F.itemRise * easeOutBack(k);
      this.holder.scale.setScalar(0.3 + 0.7 * Math.min(1, k * 1.6));
      this.holder.rotation.y += dt * 1.6;
      this.itemLight.position.set(this.holder.position.x, this.holder.position.y + 0.3, this.holder.position.z + 1);
      this.itemLight.intensity = 4 * Math.min(1, k * 2);
      this.rays.position.set(this.holder.position.x, this.holder.position.y, this.holder.position.z - 0.6);
      this.rays.quaternion.copy(this.camera.quaternion);
      this.raysMat.uniforms.time.value = time;
      this.raysMat.uniforms.opacity.value = Math.min(1, k * 1.5);
      this.beamMat.uniforms.opacity.value = Math.min(1, k * 2) * (0.8 + 0.2 * Math.sin(time * 4));
      this.beam.scale.x = 0.6 + 0.4 * Math.min(1, k * 3);
      this.beam.rotation.y = Math.atan2(this.camera.position.x - this.beam.position.x, this.camera.position.z - this.beam.position.z);
    }

    // Camera: slow push-in during the blows, rises to the item after the reveal, plus decaying shake.
    this.shake *= Math.exp(-dt * 6);
    const push = this.revealed ? 1 : Math.min(1, t / (this.strikeAt[this.lastBlow] + 0.4));
    this.camera.position.set(
      this.camBase.x + (Math.random() - 0.5) * this.shake,
      this.camBase.y + (this.revealed ? 0.35 : 0) + (Math.random() - 0.5) * this.shake,
      this.camBase.z - push * F.push + (Math.random() - 0.5) * this.shake,
    );
    v1.copy(this.lookAt);
    if (this.revealed) v1.y += F.itemRise * 0.6;
    this.camera.lookAt(v1);
  }

  private render() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    const pr = this.renderer.getPixelRatio();
    if (this.canvas.width !== Math.round(w * pr) || this.canvas.height !== Math.round(h * pr)) {
      this.renderer.setSize(w, h, false);
      this.composer?.setSize(w, h);
      this.bloom?.setSize(w / 2, h / 2);
      this.camera.aspect = w / h;
      // Portrait screens: widen the vertical FOV so the anvil and hammer fit across.
      this.camera.fov = Math.max(F.fov, (2 * Math.atan(Math.tan((F.fov * Math.PI) / 360) * (F.minAspect / this.camera.aspect)) * 180) / Math.PI);
      this.camera.updateProjectionMatrix();
      (this.pts.material as THREE.ShaderMaterial).uniforms.scale.value = h * pr * 0.05;
    }
    if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    for (const x of this.own) x.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss(); // free the context now, see HeroPreview.dispose()
  }
}
