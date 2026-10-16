// Post-processing for the game view. The frame is rendered into a multisampled HDR target, then one composite pass
// adds a soft glow round what is brighter than white (fire, magic, runes, water glints), a split-tone grade (cool
// shade, warm light), a soft highlight shoulder and a light vignette. The glow comes from one blurred
// quarter-resolution copy, so it is four cheap passes in all. The picture itself is never blurred or hazed over.
// Off on low graphics (main.ts renders straight to the screen then).
import * as THREE from 'three';

const QUAD_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

export const POST = {
  glow: 1.2,
  /** Darkening at the corners 0..1. */
  vignette: 0.2,
};

export class Post {
  private main: THREE.WebGLRenderTarget;
  private qa: THREE.WebGLRenderTarget;
  private qb: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private down: THREE.ShaderMaterial;
  private blur: THREE.ShaderMaterial;
  private comp: THREE.ShaderMaterial;
  private size = new THREE.Vector2();

  constructor(private renderer: THREE.WebGLRenderer) {
    const opts = { type: THREE.HalfFloatType, depthBuffer: false };
    this.main = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.qa = new THREE.WebGLRenderTarget(1, 1, opts);
    this.qb = new THREE.WebGLRenderTarget(1, 1, opts);
    for (const t of [this.qa, this.qb]) t.texture.minFilter = t.texture.magFilter = THREE.LinearFilter;
    // bright pass + downsample: 4 bilinear taps a texel apart (each output pixel covers a 4×4 block of the frame),
    // each keeping only what is brighter than white, in its own hue
    this.down = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: QUAD_VS,
      fragmentShader: `uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
        vec3 hot(vec2 uv) { vec3 c = texture2D(tSrc, uv).rgb; return c * smoothstep(0.95, 1.5, dot(c, vec3(0.2126, 0.7152, 0.0722))); }
        void main(){
          vec3 c = hot(vUv + uTexel * vec2(-1.0, -1.0)) + hot(vUv + uTexel * vec2(1.0, -1.0))
                 + hot(vUv + uTexel * vec2(-1.0, 1.0)) + hot(vUv + uTexel * vec2(1.0, 1.0));
          gl_FragColor = vec4(c * 0.25, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    // 9-tap gaussian in 5 bilinear fetches, along uDir
    this.blur = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
      vertexShader: QUAD_VS,
      fragmentShader: `uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
        void main(){
          vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270;
          c += (texture2D(tSrc, vUv + uDir * 1.3846154).rgb + texture2D(tSrc, vUv - uDir * 1.3846154).rgb) * 0.3162162;
          c += (texture2D(tSrc, vUv + uDir * 3.2307692).rgb + texture2D(tSrc, vUv - uDir * 3.2307692).rgb) * 0.0702703;
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.comp = new THREE.ShaderMaterial({
      uniforms: {
        tMain: { value: null }, tBlur: { value: null }, uGlow: { value: POST.glow }, uVig: { value: POST.vignette },
      },
      vertexShader: QUAD_VS,
      fragmentShader: /* glsl */ `uniform sampler2D tMain; uniform sampler2D tBlur; uniform float uGlow; uniform float uVig; varying vec2 vUv;
        const vec3 LUM = vec3(0.2126, 0.7152, 0.0722);
        vec3 shoulder(vec3 c) {
          // linear up to 0.8, then eases into 1.0 instead of clipping flat
          vec3 t = max(c - 0.8, 0.0);
          return min(c, 0.8) + 0.2 * (1.0 - exp(-t / 0.2));
        }
        void main(){
          vec3 c = texture2D(tMain, vUv).rgb;
          vec3 b = texture2D(tBlur, vUv).rgb;
          // glow: the blurred copy holds only what was brighter than white, so lit ground and snow never bloom
          c += b * uGlow;
          // split tone: cool in the shade, warm in the light
          float l = dot(c, LUM);
          // (linear luminance: lit grass is only ~0.25, so the cool tint stays in the real shadows)
          c *= mix(vec3(0.9, 0.96, 1.12), vec3(1.0), smoothstep(0.0, 0.09, l));
          c *= mix(vec3(1.0), vec3(1.06, 1.02, 0.93), smoothstep(0.22, 0.8, l));
          c = shoulder(c);
          // light vignette: only the corners darken a little
          vec2 v = (vUv - 0.5) * vec2(1.15, 1.0);
          c *= 1.0 - uVig * smoothstep(0.4, 0.8, length(v));
          gl_FragColor = linearToOutputTexel(vec4(c, 1.0));
          // dither against banding in the dark gradients
          gl_FragColor.rgb += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
        }`,
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.comp);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /** Matches the targets to the renderer's drawing buffer (call after renderer.setSize / setPixelRatio). */
  resize() {
    const s = this.renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, s.x);
    const h = Math.max(1, s.y);
    this.main.setSize(w, h);
    const qw = Math.max(1, Math.round(w / 4));
    const qh = Math.max(1, Math.round(h / 4));
    this.qa.setSize(qw, qh);
    this.qb.setSize(qw, qh);
  }

  private pass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.cam);
  }

  render(scene: THREE.Scene, camera: THREE.Camera) {
    const r = this.renderer;
    const s = r.getDrawingBufferSize(this.size);
    if (s.x !== this.main.width || s.y !== this.main.height) this.resize();
    r.setRenderTarget(this.main);
    r.render(scene, camera);
    this.down.uniforms.tSrc.value = this.main.texture;
    this.down.uniforms.uTexel.value.set(1 / this.main.width, 1 / this.main.height);
    this.pass(this.down, this.qa);
    const tx = 1.6 / this.qa.width;
    const ty = 1.6 / this.qa.height;
    this.blur.uniforms.tSrc.value = this.qa.texture;
    this.blur.uniforms.uDir.value.set(tx, 0);
    this.pass(this.blur, this.qb);
    this.blur.uniforms.tSrc.value = this.qb.texture;
    this.blur.uniforms.uDir.value.set(0, ty);
    this.pass(this.blur, this.qa);
    const u = this.comp.uniforms;
    u.tMain.value = this.main.texture;
    u.tBlur.value = this.qa.texture;
    this.pass(this.comp, null);
  }

  dispose() {
    for (const t of [this.main, this.qa, this.qb]) t.dispose();
    for (const m of [this.down, this.blur, this.comp]) m.dispose();
  }
}
