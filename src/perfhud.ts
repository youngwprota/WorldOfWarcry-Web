import * as THREE from 'three';

type TimerExt = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };

const KEY = 'warcry-perfhud';
const JANK_MS = 50;
const REFRESH = 0.5;
const GRAPH_W = 120;
const GRAPH_H = 30;
const GRAPH_MAX_MS = 66.7;

const grade = (v: number, warn: number, bad: number) => (v > bad ? 'bad' : v > warn ? 'warn' : '');

export class PerfHud {
  private el = document.createElement('div');
  private stats = document.createElement('div');
  private graph = document.createElement('canvas');
  private ctx = this.graph.getContext('2d')!;
  private history = new Float32Array(GRAPH_W);
  private head = 0;
  private gl: WebGL2RenderingContext;
  private ext: TimerExt | null;
  private pending: WebGLQuery[] = [];
  private query: WebGLQuery | null = null;
  private t0 = 0;
  private last = 0;
  // sums over the current REFRESH window
  private frames = 0;
  private frameMs = 0;
  private cpuMs = 0;
  private gpuMs = 0;
  private gpuN = 0;
  private calls = 0;
  private winStart = 0;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.el.id = 'perfhud';
    this.el.className = 'hidden';
    this.stats.className = 'perf-stats';
    this.graph.width = GRAPH_W;
    this.graph.height = GRAPH_H;
    this.el.append(this.stats, this.graph);
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
  }

  get on() { return !this.el.classList.contains('hidden'); }

  /** Shown unless the player turned it off (remembered between sessions). */
  get saved() { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } }

  toggle(on = !this.on) {
    if (!this.el.isConnected) document.getElementById('equipbar')?.appendChild(this.el);
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* private mode */ }
    this.el.classList.toggle('hidden', !on);
    // post-processing renders several passes per frame: count draw calls for the whole frame
    this.renderer.info.autoReset = !on;
    this.last = this.winStart = 0;
    this.history.fill(0);
  }

  begin() {
    if (!this.on) return;
    this.t0 = performance.now();
    this.renderer.info.reset();
    if (this.ext) this.readQueries(this.ext);
    if (this.ext && !this.query) {
      this.query = this.gl.createQuery();
      if (this.query) this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.query);
    }
  }

  end() {
    if (!this.on) return;
    const now = performance.now();
    if (this.ext && this.query) {
      this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      this.pending.push(this.query);
      this.query = null;
    }
    this.calls += this.renderer.info.render.calls;
    this.cpuMs += now - this.t0;
    if (this.last) {
      const dt = now - this.last;
      this.frameMs += dt;
      this.frames++;
      this.history[this.head] = dt;
      this.head = (this.head + 1) % GRAPH_W;
      this.drawGraph();
    } else this.winStart = now;
    this.last = now;
    if (this.frames && now - this.winStart >= REFRESH * 1000) this.flush(now);
  }

  /** One bar per frame, oldest on the left; guide lines at the 60 and 30 FPS budgets. */
  private drawGraph() {
    const c = this.ctx;
    const y = (ms: number) => GRAPH_H - (Math.min(ms, GRAPH_MAX_MS) / GRAPH_MAX_MS) * GRAPH_H;
    c.clearRect(0, 0, GRAPH_W, GRAPH_H);
    c.fillStyle = '#0006';
    c.fillRect(0, 0, GRAPH_W, GRAPH_H);
    for (let i = 0; i < GRAPH_W; i++) {
      const ms = this.history[(this.head + i) % GRAPH_W];
      if (!ms) continue;
      c.fillStyle = ms > JANK_MS ? '#ff4a4a' : ms > 33.4 ? '#ffd23f' : '#ffffffb0';
      c.fillRect(i, y(ms), 1, GRAPH_H - y(ms));
    }
    c.fillStyle = '#ffffff55';
    c.fillRect(0, Math.round(y(16.7)), GRAPH_W, 1);
    c.fillRect(0, Math.round(y(33.4)), GRAPH_W, 1);
  }

  private readQueries(ext: TimerExt) {
    const gl = this.gl;
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    while (this.pending.length && gl.getQueryParameter(this.pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = this.pending.shift()!;
      if (!disjoint) { this.gpuMs += gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; this.gpuN++; }
      gl.deleteQuery(q);
    }
  }

  private flush(now: number) {
    const ft = this.frameMs / this.frames;
    const cpu = this.cpuMs / this.frames;
    const fps = 1000 / ft;
    const cpuLoad = Math.min(100, (cpu / ft) * 100);
    const gpuLoad = this.gpuN ? Math.min(100, (this.gpuMs / this.gpuN / ft) * 100) : NaN;
    const gpu = this.gpuN ? `${gpuLoad.toFixed(0)}% (${(this.gpuMs / this.gpuN).toFixed(1)} ms)` : 'n/a';
    const calls = Math.round(this.calls / this.frames);
    this.stats.innerHTML =
      `<span>FPS</span><b class="${grade(-fps, -25, -15)}">${fps.toFixed(0)}</b>` +
      `<span>Frame Time</span><b class="${grade(ft, 16.7, 33.4)}">${ft.toFixed(1)} ms</b>` +
      `<span>CPU Load</span><b class="${grade(cpuLoad, 60, 85)}">${cpuLoad.toFixed(0)}% (${cpu.toFixed(1)} ms)</b>` +
      `<span>GPU Load</span><b class="${grade(gpuLoad, 75, 90)}">${gpu}</b>` +
      `<span>Draw Calls</span><b class="${grade(calls, 150, 300)}">${calls}</b>`;
    this.frames = this.frameMs = this.cpuMs = this.gpuMs = this.gpuN = this.calls = 0;
    this.winStart = now;
  }
}
