// Full-screen world map: opened by tapping the minimap; drag to pan, pinch / wheel / buttons to zoom.
import { sfx } from './audio';
import { drawMarks } from './ui';
import type { Game } from './game';
import { MAP_BOX } from './island';

/** The minimap itself expands into a big pannable / zoomable panel; the game keeps running. */
export class MapView {
  private panel: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cx = 0; // map centre (world x/z)
  private cz = 0;
  private follow = true; // follow the hero until the player drags the map
  private scale = 6; // px per metre (CSS pixels)
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  private info!: ReturnType<Game['mapInfo']>;
  private raf = 0;
  isOpen = false;

  constructor(private game: Game) {
    this.panel = document.createElement('div');
    this.panel.id = 'bigmap';
    this.panel.className = 'ui-block';
    this.panel.innerHTML = '<canvas></canvas>';
    document.getElementById('hud')!.appendChild(this.panel);
    this.canvas = this.panel.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    const c = this.canvas;
    c.addEventListener('pointerdown', this.down);
    c.addEventListener('pointermove', this.move);
    c.addEventListener('pointerup', this.up);
    c.addEventListener('pointercancel', this.up);
    c.addEventListener('wheel', this.wheel, { passive: false });
    addEventListener('keydown', this.key);
  }

  toggle() { if (this.isOpen) this.close(); else this.open(); }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.follow = true;
    this.info = this.game.mapInfo();
    this.scale = 5;
    document.getElementById('minimap')!.style.visibility = 'hidden';
    this.panel.classList.add('show');
    void this.panel.offsetWidth; // commit the collapsed size so the expand transition runs
    const hud = document.getElementById('hud')!;
    const d = Math.min(hud.clientWidth - 20, hud.clientHeight * 0.62);
    this.panel.style.width = this.panel.style.height = `${d}px`;
    this.panel.classList.add('open');
    cancelAnimationFrame(this.raf);
    this.loop();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.panel.classList.remove('open');
    this.panel.style.width = this.panel.style.height = '';
    setTimeout(() => {
      if (this.isOpen) return;
      this.panel.classList.remove('show');
      cancelAnimationFrame(this.raf);
      document.getElementById('minimap')!.style.visibility = '';
    }, 260);
  }

  private key = (e: KeyboardEvent) => { if (this.isOpen && e.code === 'Escape') this.close(); };

  // A short tap without dragging collapses the map; drag pans, pinch / wheel zooms.
  private tapStart: { x: number; y: number; t: number } | null = null;

  private down = (e: PointerEvent) => {
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.tapStart = this.pointers.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
    if (this.pointers.size === 2) this.pinch = this.pinchDist();
  };

  private move = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    if (this.pointers.size === 1) {
      if (this.tapStart && Math.hypot(e.clientX - this.tapStart.x, e.clientY - this.tapStart.y) < 8) return;
      this.follow = false;
      this.cx -= (e.clientX - p.x) / this.scale;
      this.cz -= (e.clientY - p.y) / this.scale;
    }
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.pointers.size === 2) {
      const d = this.pinchDist();
      this.tapStart = null;
      if (this.pinch > 0) this.scale = Math.min(30, Math.max(2.2, this.scale * (d / this.pinch)));
      this.pinch = d;
    }
  };

  private up = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    this.pinch = 0;
    const t = this.tapStart;
    if (t && this.pointers.size === 0 && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 8 && performance.now() - t.t < 350) {
      sfx.click();
      this.close();
    }
    if (this.pointers.size === 0) this.tapStart = null;
  };

  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    this.scale = Math.min(30, Math.max(2.2, this.scale * Math.exp(-e.deltaY * 0.0015)));
  };

  private pinchDist() {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    this.draw();
  };

  private draw() {
    this.info = this.game.mapInfo();
    if (this.follow) { this.cx = this.info.hero.x; this.cz = this.info.hero.z; }
    const c = this.canvas;
    const dpr = Math.min(devicePixelRatio, 2);
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    // keep the camera inside the world
    const half = MAP_BOX.size / 2;
    this.cx = Math.min(MAP_BOX.x + half + 140, Math.max(MAP_BOX.x + half - 140, this.cx));
    this.cz = Math.min(MAP_BOX.z + half + 140, Math.max(MAP_BOX.z + half - 140, this.cz));
    const g = this.ctx;
    const s = this.scale;
    const X = (x: number) => w / 2 + (x - this.cx) * s;
    const Y = (z: number) => h / 2 + (z - this.cz) * s;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.save();
    g.beginPath();
    g.arc(w / 2, h / 2, Math.min(w, h) / 2, 0, Math.PI * 2);
    g.clip();
    // island + ocean (baked), closed barrier
    const world = this.game.world;
    world.drawMap(g, X, Y, s);
    // static obstacles: buildings, trees, rocks
    for (const o of world.obstacles) {
      if (o.r < 0.4) continue;
      g.fillStyle = o.r > 1.5 ? '#3b3530cc' : '#21301d99';
      g.beginPath();
      g.arc(X(o.x), Y(o.z), Math.max(1, o.r * s), 0, 7);
      g.fill();
    }
    for (const p of world.ponds) {
      g.fillStyle = '#3d8fb0';
      g.beginPath();
      g.ellipse(X(p.x), Y(p.z), p.r * s, p.r * 0.8 * s, 0, 0, 7);
      g.fill();
    }
    world.fog.drawOnMap(g, X, Y, s);
    // mobs and breakable props (one unit type); bosses, micro-bosses and elites get their own marks
    g.fillStyle = '#ff4a4a';
    for (const m of this.info.units) g.fillRect(X(m.x) - 2.5, Y(m.z) - 2.5, 5, 5);
    drawMarks(g, this.info.marks, X, Y);
    // no names and no timers: a dead one shows only its respawn ring (drawMarks)
    // hero arrow (no hint of where to go: the player finds the way himself)
    const hx = X(this.info.hero.x);
    const hy = Y(this.info.hero.z);
    g.save();
    g.translate(hx, hy);
    g.rotate(-this.info.hero.facing + Math.PI);
    g.fillStyle = '#fff';
    g.strokeStyle = '#000';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -11); g.lineTo(8, 9); g.lineTo(0, 5); g.lineTo(-8, 9); g.closePath();
    g.fill();
    g.stroke();
    g.restore();
    g.restore(); // circular clip
  }
}
