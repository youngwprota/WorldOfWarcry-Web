// "Горнило судьбы" window (docs/features/ludka): the banner with the legendary weapon, the forge reveal and the result.
import { art } from './art';
import { sfx } from './audio';
import { GACHA, RARITY } from './config';
import { bannerItem, pull } from './gacha';
import type { Game } from './game';
import { itemLines, type Item } from './items';
import type { UI } from './ui';

/** Hammer angle (deg): raised before a blow, resting on the anvil at the strike. */
const HAMMER_UP = -45, HAMMER_DOWN = 66;

/** Spark pool (preallocated, no per-frame allocations). Colour index: 0..3 rarity, 4 white-hot. */
const MAX_SPARKS = 420;
const px = new Float32Array(MAX_SPARKS), py = new Float32Array(MAX_SPARKS);
const pvx = new Float32Array(MAX_SPARKS), pvy = new Float32Array(MAX_SPARKS);
const plife = new Float32Array(MAX_SPARKS), pmax = new Float32Array(MAX_SPARKS);
const pcol = new Uint8Array(MAX_SPARKS);
const SPARK_COLORS = [...RARITY.map((r) => r.color), '#fff6d8'];

const plural = (n: number, one: string, few: string, many: string) => {
  const d = n % 10, h = n % 100;
  return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
};

export class GachaView {
  private openNow = false;
  private raf = 0;
  private last = 0;
  /** Forge state: time since the first frame, blows done, rarity shown after each blow, the pulled item. */
  private t = 0;
  private struck = 0;
  private stages = [0, 0, 0];
  private strikeAt = [0, 0, 0];
  private revealAt = 0;
  private item: Item | null = null;
  private where = '';
  private hammer: HTMLElement | null = null;
  private forgeEl: HTMLElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private cw = 0;
  private ch = 0;
  /** Spark origin on the canvas: the ingot centre. */
  private ox = 0;
  private oy = 0;
  private emberAcc = 0;

  constructor(private ui: UI, private game: Game) {}

  get isOpen() { return this.openNow; }

  open() {
    this.game.paused = true;
    this.openNow = true;
    this.ui.open(`<div class="gacha" id="g-root">
      <div class="g-head"><div class="g-title">Горнило судьбы</div><button class="xbtn" id="g-close" title="Закрыть">✕</button></div>
      <div class="g-body" id="g-body"></div>
    </div>`);
    this.ui.on('#g-close', () => this.close());
    this.renderBanner();
  }

  close() {
    this.stop();
    this.openNow = false;
    this.ui.close();
    this.game.paused = false;
    this.game.refreshHud(true);
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string) { return this.ui.modal.querySelector<T>(sel)!; }

  private renderBanner() {
    const it = bannerItem(this.game.itemLevel);
    const left = GACHA.pity - this.game.save.gachaPity;
    const rates = GACHA.rates.map((r, i) => `<span style="color:${RARITY[i].color}">${RARITY[i].name} ${+(r * 100).toFixed(1)}%</span>`).join('');
    this.q('#g-body').innerHTML = `
      <div class="g-banner">
        <div class="g-rays"></div>
        <div class="g-tag">Легендарное</div>
        <div class="g-weapon">${art(it.def, 170)}</div>
        <div class="g-name">${GACHA.banner.name}</div>
        <div class="g-sub">${GACHA.banner.subtitle}</div>
        <div class="g-lines">${itemLines(it).map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>
      </div>
      <div class="g-rates">${rates}</div>
      <div class="g-pity">Легендарка гарантирована через <b>${left}</b> ${plural(left, 'крутку', 'крутки', 'круток')}</div>
      <button class="btn primary g-pull" id="g-pull">Ковать</button>`;
    this.ui.on('#g-pull', () => this.forge());
  }

  private stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.hammer = this.forgeEl = null;
    this.ctx = null;
    plife.fill(0);
  }

  /** Pull right away (the item is granted even if the window is closed mid-animation), then play the forge. */
  private forge() {
    const s = this.game.save;
    const res = pull(s.gachaPity, this.game.itemLevel);
    s.gachaPity = res.pity;
    this.item = res.item;
    this.where = this.game.lootItem(res.item);
    const r = res.item.rarity;
    // Rarity climbs blow by blow and never goes down; legendary only shows on the last blow.
    const s1 = r >= 1 && Math.random() < 0.5 ? 1 : 0;
    const s2 = Math.max(s1, r >= 2 ? (Math.random() < 0.6 ? 2 : 1) : r);
    this.stages = [s1, s2, r];
    const g = GACHA.strikeGap;
    // Suspense: a rare-or-better result waits a little longer before the last blow.
    this.strikeAt = [0.5, 0.5 + g, 0.5 + g * 2 + (r >= 2 ? g * 0.6 : 0)];
    this.revealAt = this.strikeAt[2] + GACHA.revealHold + (r >= 3 ? 0.5 : 0);
    this.t = 0;
    this.struck = 0;

    this.q('#g-body').innerHTML = `
      <div class="g-forge" id="g-forge">
        <div class="g-glow"></div>
        <canvas class="g-sparks" id="g-sparks"></canvas>
        <div class="g-stage">
          <div class="g-hammer" id="g-hammer">${art('hammer', 150)}</div>
          <div class="g-anvil"><div class="g-ingot"></div>${art('anvil', 230)}</div>
        </div>
        <div class="g-hint">Тап — пропустить</div>
      </div>`;
    this.forgeEl = this.q('#g-forge');
    this.hammer = this.q('#g-hammer');
    this.setStage(0);
    this.initCanvas();
    this.forgeEl.addEventListener('click', () => this.skip());
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.update(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private skip() {
    if (this.struck >= 3) { this.t = this.revealAt; return; }
    // Jump straight to the last blow: it still plays its burst, then the result.
    this.struck = 2;
    this.t = this.strikeAt[2] - 0.12;
  }

  private update(dt: number) {
    this.t += dt;
    const t = this.t;
    if (this.struck < 3 && t >= this.strikeAt[this.struck]) this.strike(this.struck++);
    if (t >= this.revealAt) { this.reveal(); return; }
    // Hammer: swings down over the last 0.16 s before a blow, then lifts back over 0.45 s.
    let a = HAMMER_UP;
    if (this.struck < 3) {
      const k = 1 - (this.strikeAt[this.struck] - t) / 0.16;
      if (k > 0) a = HAMMER_UP + (HAMMER_DOWN - HAMMER_UP) * k * k;
    }
    if (this.struck > 0) {
      const since = t - this.strikeAt[this.struck - 1];
      if (since < 0.45) a = Math.max(a, HAMMER_DOWN + (HAMMER_UP - HAMMER_DOWN) * Math.min(1, since / 0.45) ** 0.6);
    }
    if (this.struck >= 3) a = HAMMER_UP;
    this.hammer!.style.transform = `rotate(${a}deg)`;
    // Embers drift up from the forge all the time.
    this.emberAcc += dt * 14;
    while (this.emberAcc >= 1) {
      this.emberAcc--;
      this.spawn(1, Number(this.forgeEl!.dataset.stage), 0.3, 1.6, 70, -90, 0.7);
    }
    this.drawSparks(dt);
  }

  private initCanvas() {
    const c = this.q<HTMLCanvasElement>('#g-sparks');
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.cw = c.clientWidth;
    this.ch = c.clientHeight;
    c.width = Math.round(this.cw * dpr);
    c.height = Math.round(this.ch * dpr);
    this.ctx = c.getContext('2d')!;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // getBoundingClientRect is in screen pixels; the UI may be scaled (--ui), so convert to canvas CSS pixels.
    const cr = c.getBoundingClientRect();
    const ir = this.q('.g-ingot').getBoundingClientRect();
    const k = this.cw / cr.width;
    this.ox = (ir.left + ir.width / 2 - cr.left) * k;
    this.oy = (ir.top + ir.height / 2 - cr.top) * k;
  }

  /** `n` sparks of colour `col` (+ a share of white-hot ones) flying around angle `dir` (deg, -90 = up). */
  private spawn(n: number, col: number, whiteShare: number, life: number, speed: number, dir = -90, spreadY = 0.15) {
    for (let j = 0, i = 0; j < n && i < MAX_SPARKS; i++) {
      if (plife[i] > 0) continue;
      j++;
      const a = ((dir + (Math.random() - 0.5) * 160) * Math.PI) / 180;
      const v = speed * (0.4 + Math.random() * 0.9);
      px[i] = this.ox + (Math.random() - 0.5) * 90;
      py[i] = this.oy + (Math.random() - 0.5) * 30 * spreadY;
      pvx[i] = Math.cos(a) * v;
      pvy[i] = Math.sin(a) * v;
      pmax[i] = plife[i] = life * (0.6 + Math.random() * 0.8);
      pcol[i] = Math.random() < whiteShare ? 4 : col;
    }
  }

  private drawSparks(dt: number) {
    const g = this.ctx;
    if (!g) return;
    g.clearRect(0, 0, this.cw, this.ch);
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (plife[i] <= 0) continue;
      plife[i] -= dt;
      // long-lived sparks (embers, the legendary shower) float, short ones fall
      pvy[i] += pmax[i] > 1 ? -20 * dt : 520 * dt;
      pvx[i] *= 1 - 0.8 * dt;
      px[i] += pvx[i] * dt;
      py[i] += pvy[i] * dt;
      const f = Math.max(0, plife[i] / pmax[i]);
      g.globalAlpha = f;
      g.strokeStyle = SPARK_COLORS[pcol[i]];
      g.lineWidth = 1.5 + 2.5 * f;
      g.beginPath();
      g.moveTo(px[i], py[i]);
      g.lineTo(px[i] - pvx[i] * 0.035, py[i] - pvy[i] * 0.035);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }

  /** Colour of the ingot and the glow = rarity stage. */
  private setStage(stage: number) {
    const c = RARITY[stage].color;
    this.forgeEl!.style.setProperty('--rc', c);
    this.forgeEl!.dataset.stage = String(stage);
  }

  private strike(i: number) {
    const stage = this.stages[i];
    this.setStage(stage);
    sfx.anvil(stage);
    // Bigger, faster, brighter fan of sparks for each rarity stage; the last blow throws the most.
    const n = 40 + stage * 45 + (i === 2 ? 40 : 0);
    this.spawn(n, stage, 0.25, 0.7 + stage * 0.2, 380 + stage * 110);
    if (i === 2 && stage >= 2) this.spawn(60 + (stage - 2) * 80, stage, 0.4, 1.4, 260, -90, 1);
    const shake = 4 + stage * 3 + (i === 2 ? 4 : 0);
    this.forgeEl!.querySelector('.g-stage')!.animate(
      [{ transform: `translate(${shake}px, ${shake * 0.6}px)` }, { transform: `translate(-${shake}px, -${shake * 0.4}px)` }, { transform: 'none' }],
      { duration: 220, easing: 'ease-out' },
    );
  }

  private reveal() {
    this.stop();
    sfx.reveal(this.item!.rarity);
    this.ui.toast(this.where);
    this.renderBanner();
  }
}
