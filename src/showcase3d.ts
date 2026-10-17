// Gacha banner showcase (src/gachaview.ts): the banner jewel floating over a turning magic circle, against a shader
// backdrop of rays and stars, with twinkles and motes (src/jewelfx.ts). Own small renderer, like the forge; bloom is
// skipped on low graphics. Tunables in BANNER3D (config).
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { assets } from './assets';
import { BANNER3D as B, RARITY } from './config';
import { ARMOR, showcaseModel, type Item } from './items';
import { JewelFx } from './jewelfx';

const UV_VS = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// Backdrop: deep violet to ember gradient, slow rays from behind the jewel, twinkling stars, vignette.
const BACK_FS = /* glsl */ `
varying vec2 vUv;
uniform float time;
uniform float aspect;
uniform vec3 top;
uniform vec3 bottom;
uniform vec3 ray;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 p = vUv - vec2(0.5, 0.56);
  p.x *= aspect;
  float r = length(p);
  float a = atan(p.y, p.x);
  vec3 col = mix(bottom, top, smoothstep(0.0, 1.0, vUv.y));
  float rays = pow(0.5 + 0.5 * sin(a * 9.0 + time * 0.25), 5.0) + 0.6 * pow(0.5 + 0.5 * sin(a * 14.0 - time * 0.4), 9.0);
  col += ray * rays * smoothstep(0.8, 0.05, r) * 0.3;
  col += ray * smoothstep(0.35, 0.0, r) * 0.25;
  vec2 g = vUv * vec2(aspect, 1.0) * 46.0;
  vec2 cell = floor(g);
  float h = hash(cell);
  float star = step(0.93, h) * smoothstep(0.12, 0.0, length(fract(g) - 0.5 - (vec2(hash(cell + 1.3), hash(cell + 7.1)) - 0.5) * 0.6));
  col += vec3(1.0, 0.92, 0.8) * star * (0.4 + 0.6 * sin(time * (1.0 + h * 3.0) + h * 40.0)) * 0.9;
  col *= 1.0 - smoothstep(0.45, 1.0, length((vUv - 0.5) * vec2(1.0, 1.25))) * 0.65;
  gl_FragColor = vec4(col, 1.0);
}`;

// Magic circle: rings, a band of rune ticks and a star, turning; additive gold.
const CIRCLE_FS = /* glsl */ `
varying vec2 vUv;
uniform float time;
uniform vec3 color;
float ring(float r, float at, float w) { return smoothstep(w, 0.0, abs(r - at)); }
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);
  float ao = a + time * 0.35;
  float ai = a - time * 0.6;
  float k = ring(r, 0.96, 0.02) + ring(r, 0.86, 0.012) + ring(r, 0.62, 0.015) + ring(r, 0.5, 0.01) * 0.7;
  // rune ticks between the outer rings
  float ticks = step(0.5, fract(ao * 24.0 / 6.2832)) * step(0.88, r) * step(r, 0.94) * (0.5 + 0.5 * step(0.8, fract(ao * 6.0 / 6.2832)));
  // a six-point star inside: two triangles
  float star = 0.0;
  for (int i = 0; i < 6; i++) {
    float t = ai + float(i) * 1.0472;
    vec2 d = vec2(cos(t), sin(t));
    star += smoothstep(0.012, 0.0, abs(dot(p, d) - 0.31)) * step(r, 0.62);
  }
  float dots = smoothstep(0.03, 0.0, abs(r - 0.74)) * step(0.85, fract(ao * 12.0 / 6.2832 + 0.5));
  float glow = smoothstep(1.0, 0.2, r) * 0.18;
  float v = k + ticks * 0.8 + star * 0.6 + dots + glow;
  float pulse = 0.75 + 0.25 * sin(time * 2.0);
  gl_FragColor = vec4(color * v * pulse * 1.6, 1.0);
}`;

export class Showcase3D {
  readonly ready: Promise<boolean>;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(B.fov, 1, 0.1, 40);
  private ptScale = { value: 60 };
  private jfx: JewelFx;
  private time = { value: 0 };
  private own: (THREE.BufferGeometry | THREE.Material)[] = [];
  private holder = new THREE.Group();
  private back!: THREE.Mesh;
  private backMat!: THREE.ShaderMaterial;
  private raf = 0;
  private t0 = performance.now();

  /** Resolves false when `item` has no showcase model (not a jewel / gloves, or it failed to load): show its icon instead. */
  constructor(private canvas: HTMLCanvasElement, lowGfx: boolean, item: Item) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowGfx, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, lowGfx ? 1 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    if (!lowGfx) {
      this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), B.bloom.strength, B.bloom.radius, B.bloom.threshold);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.jfx = new JewelFx(this.renderer, this.ptScale);
    const name = showcaseModel(item);
    this.ready = name ? assets.jewel(name).then(() => { this.build(item, name); return true; }, () => false) : Promise.resolve(false);
  }

  private mine<T extends THREE.BufferGeometry | THREE.Material>(x: T) { this.own.push(x); return x; }

  private build(item: Item, name: string) {
    const s = this.scene;
    const col = new THREE.Color(RARITY[item.rarity].color);
    s.add(new THREE.HemisphereLight(0x9c86c0, 0x2a0f0a, 1.2));
    const key = new THREE.DirectionalLight(0xffe0b8, 1.6);
    key.position.set(-2, 3, 3);
    const rim = new THREE.DirectionalLight(0x9ab4ff, 1.3);
    rim.position.set(2.5, 2, -3);
    const glow = new THREE.PointLight(col, B.light, 6, 1.5);
    glow.position.set(0, 0.4, 1.2);
    s.add(key, rim, glow);

    // backdrop: a plane far behind, sized to fill the view (see resize)
    this.backMat = this.mine(new THREE.ShaderMaterial({
      vertexShader: UV_VS, fragmentShader: BACK_FS, depthWrite: false,
      uniforms: { time: this.time, aspect: { value: 1 }, top: { value: new THREE.Color(B.top) }, bottom: { value: new THREE.Color(B.bottom) },
        ray: { value: new THREE.Color(B.ray) } },
    }));
    this.back = new THREE.Mesh(this.mine(new THREE.PlaneGeometry(1, 1)), this.backMat);
    this.back.position.z = -8;
    this.back.renderOrder = -10;
    s.add(this.back);

    const circle = new THREE.Mesh(this.mine(new THREE.PlaneGeometry(B.circle, B.circle).rotateX(-Math.PI / 2)), this.mine(new THREE.ShaderMaterial({
      vertexShader: UV_VS, fragmentShader: CIRCLE_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { time: this.time, color: { value: new THREE.Color(B.rune).multiplyScalar(0.6) } },
    })));
    circle.position.y = B.circleY;
    s.add(circle);

    // the jewel, fitted by its largest side
    const m = assets.clone(name);
    this.jfx.dress(m);
    const wrap = new THREE.Group();
    wrap.add(m);
    wrap.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(wrap);
    const side = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) || 1;
    this.jfx.sparkle(wrap, side * 0.012, B.glints);
    const k = B.size / side;
    wrap.scale.setScalar(k);
    const c = b.getCenter(new THREE.Vector3());
    wrap.position.set(-c.x * k, -c.y * k, -c.z * k);
    const tilt = new THREE.Group();
    tilt.add(wrap);
    if (ARMOR[item.def].slot === 'ring') tilt.rotation.x = B.lean;
    tilt.rotation.z = 0.12;
    this.jfx.motes(tilt, B.motes, col, B.size);
    this.holder.add(tilt);
    s.add(this.holder);

    this.camera.position.set(0, B.cameraY, B.cameraZ);
    this.camera.lookAt(0, B.lookY, 0);
    this.loop();
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const t = (performance.now() - this.t0) / 1000;
    this.time.value = t;
    this.jfx.time.value = t;
    this.holder.rotation.y = Math.sin(t * B.swaySpeed) * B.swing;
    this.holder.position.y = Math.sin(t * 1.3) * 0.06;
    this.render();
  };

  private render() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    const pr = this.renderer.getPixelRatio();
    if (this.canvas.width !== Math.round(w * pr) || this.canvas.height !== Math.round(h * pr)) {
      this.renderer.setSize(w, h, false);
      this.composer?.setSize(w, h);
      this.bloom?.setSize(w / 2, h / 2);
      this.camera.aspect = w / h;
      // narrow cards widen the vertical FOV so the jewel always fits across
      this.camera.fov = Math.max(B.fov, (2 * Math.atan(Math.tan((B.fov * Math.PI) / 360) * (B.minAspect / this.camera.aspect)) * 180) / Math.PI);
      this.camera.updateProjectionMatrix();
      this.ptScale.value = h * pr * 0.05;
      // the backdrop fills the view at its depth
      const d = this.camera.position.z - this.back.position.z;
      const vh = 2 * d * Math.tan((this.camera.fov * Math.PI) / 360) * 1.15;
      this.back.scale.set(vh * this.camera.aspect, vh, 1);
      this.back.position.y = this.camera.position.y;
      this.back.lookAt(this.camera.position);
      this.backMat.uniforms.aspect.value = this.camera.aspect;
    }
    if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    for (const x of this.own) x.dispose();
    this.jfx.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
