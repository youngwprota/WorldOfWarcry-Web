// Loading screen "live photo" (the push-in and the glows are CSS, skin.css #loading): sparks — embers drift up from
// the bottom and the shield clash in the key art throws gold and violet sparks — and the background's sway (WebGL,
// startArtWave). Both run until #loading is hidden.

interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string }

/** The shield clash in the key art, as a share of the screen (matches .glow.clash). */
const CLASH = { x: 0.53, y: 0.42 };
const EMBER = ['#ffcf4a', '#ffb12e', '#ff8a2a', '#ffe9a0'];
const CLASH_COLORS = ['#fff3b0', '#ffd23f', '#d58bff', '#b46bff', '#ffe9a0'];
const MAX = 70;

export function startLoadingFx(root: HTMLElement) {
  const canvas = root.querySelector<HTMLCanvasElement>('canvas.sparks');
  const g = canvas?.getContext('2d');
  if (!canvas || !g) return;
  const sparks: Spark[] = [];
  const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  let w = 0;
  let h = 0;
  let last = performance.now();
  let emberT = 0;
  let burstT = 0.4;

  const ember = () => sparks.push({
    x: Math.random() * w, y: h * (0.75 + Math.random() * 0.3),
    vx: (Math.random() - 0.5) * 0.04 * w, vy: -(0.05 + Math.random() * 0.08) * h,
    life: 0, max: 2.5 + Math.random() * 2.5, size: 1 + Math.random() * 2, color: pick(EMBER),
  });
  const burst = () => {
    const n = 6 + Math.floor(Math.random() * 6);
    for (let i = 0; i < n && sparks.length < MAX; i++) {
      // a fan up and to the sides of the clash
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3;
      const sp = (0.12 + Math.random() * 0.22) * h;
      sparks.push({
        x: CLASH.x * w + (Math.random() - 0.5) * 0.04 * w, y: CLASH.y * h + (Math.random() - 0.5) * 0.03 * h,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0, max: 0.6 + Math.random() * 0.9, size: 1.2 + Math.random() * 2.2, color: pick(CLASH_COLORS),
      });
    }
  };

  const frame = (now: number) => {
    if (root.classList.contains('hidden')) { g.clearRect(0, 0, canvas.width, canvas.height); return; }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const cw = Math.round(canvas.clientWidth * dpr);
    const ch = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    w = cw;
    h = ch;
    emberT -= dt;
    burstT -= dt;
    if (emberT <= 0 && sparks.length < MAX) { ember(); emberT = 0.08 + Math.random() * 0.1; }
    // the clash flares with the CSS glow pulse (load-clash, 2.6 s)
    if (burstT <= 0) { burst(); burstT = 2.6 * (0.5 + Math.random() * 0.6); }
    g.clearRect(0, 0, w, h);
    g.globalCompositeOperation = 'lighter';
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.life += dt;
      if (s.life >= s.max) { sparks.splice(i, 1); continue; }
      // embers sway, clash sparks slow down and fall a little
      s.vx += (Math.random() - 0.5) * 0.08 * w * dt;
      s.vx *= 1 - dt * 0.8;
      s.vy = s.vy * (1 - dt * 1.2) + 0.03 * h * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      const k = s.life / s.max;
      const flicker = 0.7 + Math.random() * 0.3;
      g.globalAlpha = Math.min(1, k * 6) * (1 - k) * flicker;
      const r = s.size * dpr;
      g.fillStyle = s.color;
      g.shadowColor = s.color;
      g.shadowBlur = r * 4;
      g.beginPath();
      g.arc(s.x, s.y, r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    g.shadowBlur = 0;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/**
 * The art's background sways (WebGL over the CSS picture, inside .art so it pushes in with it): clouds, the twister
 * on the right and the dust bottom-left drift in slow noise; the logo, both heroes and the foreground rocks stay still
 * (soft still zones, picture space 0..1, y down). Without WebGL the CSS picture shows as it is.
 */
const VERT = 'attribute vec2 p; varying vec2 vUv; void main(){ vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
const FRAG = `precision mediump float;
varying vec2 vUv;
uniform sampler2D img;
uniform float t;
uniform vec2 cover;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
float ell(vec2 p, vec2 c, vec2 r){ return 1.0 - smoothstep(0.75, 1.15, length((p - c) / r)); }
float seg(vec2 p, vec2 a, vec2 b, float r){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return 1.0 - smoothstep(r, r * 1.6, length(pa - ba * h)); }
void main(){
  vec2 uv = (vUv - 0.5) * cover + 0.5;
  vec2 p = vec2(uv.x, 1.0 - uv.y);
  float still = ell(p, vec2(0.51, 0.13), vec2(0.62, 0.15));            // logo
  still = max(still, ell(p, vec2(0.29, 0.45), vec2(0.38, 0.28)));      // orc
  still = max(still, seg(p, vec2(0.0, 0.29), vec2(0.76, 0.24), 0.04)); // his axe
  still = max(still, ell(p, vec2(0.72, 0.69), vec2(0.40, 0.35)));      // shield, warrior, hammer
  still = max(still, smoothstep(0.82, 0.88, p.y));                     // foreground rocks
  float move = 1.0 - still;
  // the twister on the right churns faster
  float twist = smoothstep(0.75, 0.92, p.x) * (1.0 - smoothstep(0.55, 0.7, p.y));
  vec2 q = p * vec2(3.0, 4.0);
  vec2 d = vec2(noise(q + vec2(t * 0.08, t * 0.03)), noise(q + vec2(7.3, 2.1) - vec2(t * 0.05, t * 0.07))) - 0.5;
  d += twist * vec2(sin(p.y * 22.0 + t * 1.3), 0.0) * 0.6;
  vec2 off = d * 0.012 * move;
  gl_FragColor = texture2D(img, uv + vec2(off.x, -off.y));
}`;

export function startArtWave(root: HTMLElement, src: string) {
  const art = root.querySelector<HTMLElement>('.art');
  if (!art) return;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
  const gl = canvas.getContext('webgl', { alpha: false });
  if (!gl) return;
  const sh = (type: number, code: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, code); gl.compileShader(s); return s; };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uT = gl.getUniformLocation(prog, 't');
  const uCover = gl.getUniformLocation(prog, 'cover');
  const img = new Image();
  img.onload = () => {
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    art.prepend(canvas);
    const t0 = performance.now();
    const frame = (now: number) => {
      if (root.classList.contains('hidden')) { canvas.remove(); return; }
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      const w = Math.round(canvas.clientWidth * dpr);
      const h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
      // CSS `cover`: the share of the picture on screen along each axis
      const a = w / h;
      const ia = img.naturalWidth / img.naturalHeight;
      gl.uniform2f(uCover, a > ia ? 1 : a / ia, a > ia ? ia / a : 1);
      gl.uniform1f(uT, (now - t0) / 1000);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };
  img.src = src;
}
