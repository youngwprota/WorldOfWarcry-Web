import * as THREE from 'three';
import { Character } from './character';
import { DAMAGE_TYPE_COLOR, FACTIONS, RARITY, WEAPONS } from './config';
import {
  ARMOR, ARMOR_SLOTS, BAG_SIZE, SLOT_NAME, itemIcon, itemLines, itemName, scrapValue, slotOf,
  type ArmorSlot, type Item, type VisualPart,
} from './items';
import { sfx } from './audio';
import type { Game } from './game';
import type { UI } from './ui';

/** Rotatable 3D hero for the character sheet (own small renderer, disposed on close). */
class HeroPreview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 30);
  private ch: Character;
  private clock = new THREE.Clock();
  private raf = 0;
  yaw = 0.4;
  private vel = 0;
  private dragX: number | null = null;

  constructor(private canvas: HTMLCanvasElement, model: string) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.add(new THREE.HemisphereLight(0xfff6ea, 0x3a3348, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(2, 4, 4);
    const rim = new THREE.DirectionalLight(0x9fc4ff, 1.2);
    rim.position.set(-3, 2, -3);
    this.scene.add(key, rim);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(0.9, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }),
    );
    this.scene.add(floor);
    this.ch = new Character(model, null, 1);
    this.scene.add(this.ch.root);
    this.camera.position.set(0, 1.05, 4.4);
    this.camera.lookAt(0, 0.85, 0);

    canvas.addEventListener('pointerdown', (e) => { this.dragX = e.clientX; this.vel = 0; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => {
      if (this.dragX === null) return;
      const dx = e.clientX - this.dragX;
      this.dragX = e.clientX;
      this.yaw += dx * 0.012;
      this.vel = dx * 0.012 * 60;
    });
    const up = () => { this.dragX = null; };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    this.loop();
  }

  setGear(weapon: string | null, outfit: Partial<Record<VisualPart, string>>) {
    this.ch.setWeapon(weapon);
    this.ch.setOutfit(outfit);
  }

  nudge(dir: number) { this.vel = dir * 5; }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.dragX === null) {
      this.yaw += this.vel * dt;
      this.vel *= Math.max(0, 1 - dt * 3);
    }
    this.ch.facing = this.yaw;
    this.ch.update(dt, false);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w && h && (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio()))) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
  }
}

type Source = { at: 'bag'; index: number } | { at: 'armor'; slot: ArmorSlot } | { at: 'weapon'; slot: 0 | 1 };

/** Character sheet (paper doll) and bags. */
export class Inventory {
  private preview: HeroPreview | null = null;
  private view: 'char' | 'bag' | null = null;

  constructor(private ui: UI, private game: Game) {}

  get isOpen() { return this.view !== null; }

  private cell(it: Item | null | undefined, attrs: string, placeholder = '', extra = '') {
    if (!it) return `<button class="cell empty" ${attrs}><span class="ic">${placeholder}</span>${extra}</button>`;
    const r = RARITY[it.rarity];
    const type = it.kind === 'weapon' ? `<span class="dt" style="background:${DAMAGE_TYPE_COLOR[WEAPONS[it.def].type]}"></span>` : '';
    return `<button class="cell" style="border-color:${r.color};box-shadow:inset 0 0 14px ${r.color}55" ${attrs}>
      <span class="ic">${itemIcon(it)}</span>${type}<span class="lv">${it.lvl}</span>${it.sharpen ? `<span class="sh">+${it.sharpen}</span>` : ''}${extra}</button>`;
  }

  private pause() {
    this.game.paused = true;
  }

  close() {
    this.ui.modal.removeEventListener('click', this.onClick);
    this.preview?.dispose();
    this.preview = null;
    this.view = null;
    this.ui.close();
    this.game.paused = false;
    this.game.refreshHud(true);
  }

  // ---------- character sheet ----------
  openCharacter() {
    if (this.view === 'char') return;
    this.preview?.dispose();
    this.preview = null;
    this.pause();
    this.view = 'char';
    const f = FACTIONS[this.game.faction];
    this.ui.open(`<div class="inv char">
      <div class="inv-head">
        <div class="portrait" style="border-color:${f.color}">${this.game.faction === 'human' ? '🛡️' : '🪓'}</div>
        <div class="title"><b>Герой</b><small>${f.name} · ${f.passiveName}</small></div>
        <button class="hbtn bag" id="i-bag" title="Сумка">🎒</button>
        <button class="hbtn x" id="i-close" title="Закрыть">✕</button>
      </div>
      <div class="doll">
        <div class="col" id="i-left"></div>
        <div class="paper">
          <canvas id="i-canvas"></canvas>
          <div class="rot"><button id="i-rl">↶</button><button id="i-rr">↷</button></div>
        </div>
        <div class="col" id="i-right"></div>
      </div>
      <div class="wrow" id="i-weapons"></div>
      <div class="stats-box" id="i-stats"></div>
      <div class="owned"><div class="owned-title" id="i-owned-title"></div><div class="strip" id="i-strip"></div></div>
      <div class="tip hidden" id="i-tip"></div>
    </div>`);
    this.preview = new HeroPreview(this.ui.modal.querySelector('#i-canvas')!, f.hero);
    this.ui.on('#i-close', () => this.close());
    this.ui.on('#i-bag', () => this.openBag());
    this.ui.modal.querySelector('#i-rl')!.addEventListener('click', () => this.preview?.nudge(-1));
    this.ui.modal.querySelector('#i-rr')!.addEventListener('click', () => this.preview?.nudge(1));
    this.ui.modal.addEventListener('click', this.onClick);
    this.renderChar();
  }

  private renderChar() {
    const g = this.game;
    const s = g.save;
    const q = (id: string) => this.ui.modal.querySelector<HTMLElement>(id)!;
    const side = (which: 'left' | 'right') => ARMOR_SLOTS.filter((x) => x.side === which)
      .map((x) => this.cell(s.equip[x.id], `data-armor="${x.id}" title="${x.name}"`, x.icon)).join('');
    q('#i-left').innerHTML = side('left');
    q('#i-right').innerHTML = side('right');
    q('#i-weapons').innerHTML = ([0, 1] as const).map((i) => {
      const it = s.weapons[i];
      const tag = `<span class="wtag ${s.active === i ? 'on' : ''}">${s.active === i ? 'в руке' : `слот ${i + 1}`}</span>`;
      return this.cell(it, `data-weapon="${i}"`, '⚔', tag);
    }).join('');
    q('#i-stats').innerHTML = g.statRows().map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    q('#i-owned-title').innerHTML = `Предметы в сумке <b>${s.bag.length}/${BAG_SIZE}</b>`;
    q('#i-strip').innerHTML = s.bag.length
      ? s.bag.map((it, i) => this.cell(it, `data-bag="${i}"`)).join('')
      : '<div class="none">Пусто. Предметы падают с мобов, боссов и из разрушаемых объектов</div>';
    this.preview?.setGear(g.weapon.model[g.faction], g.outfit());
    g.newItems = 0;
  }

  // ---------- bags ----------
  openBag() {
    this.preview?.dispose();
    this.preview = null;
    this.pause();
    this.view = 'bag';
    this.ui.open(`<div class="inv bag">
      <div class="inv-head">
        <div class="portrait">🎒</div>
        <div class="title"><b>Сумка</b><small id="b-sub"></small></div>
        <button class="hbtn" id="b-char" title="Персонаж">👤</button>
        <button class="hbtn x" id="i-close" title="Закрыть">✕</button>
      </div>
      <div class="grid" id="b-grid"></div>
      <p class="hint-line">Нажми на предмет: надеть, сравнить или разобрать на золото</p>
      <div class="tip hidden" id="i-tip"></div>
    </div>`);
    this.ui.on('#i-close', () => this.close());
    this.ui.on('#b-char', () => this.openCharacter());
    this.ui.modal.addEventListener('click', this.onClick);
    this.renderBag();
  }

  private renderBag() {
    const s = this.game.save;
    this.ui.modal.querySelector('#b-sub')!.innerHTML = `${s.bag.length}/${BAG_SIZE} · <span style="color:var(--gold)">${s.gold} 🪙</span>`;
    const cells: string[] = [];
    for (let i = 0; i < BAG_SIZE; i++) cells.push(this.cell(s.bag[i], s.bag[i] ? `data-bag="${i}"` : 'disabled'));
    this.ui.modal.querySelector('#b-grid')!.innerHTML = cells.join('');
    this.game.newItems = 0;
  }

  private rerender() {
    if (this.view === 'char') this.renderChar();
    else if (this.view === 'bag') this.renderBag();
  }

  // ---------- item tooltip ----------
  private onClick = (e: Event) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-bag],[data-armor],[data-weapon],[data-act]');
    if (!t) {
      if (!(e.target as HTMLElement).closest('.tip')) this.hideTip();
      return;
    }
    if (t.dataset.act) return;
    if (t.dataset.bag !== undefined) this.showTip({ at: 'bag', index: +t.dataset.bag });
    else if (t.dataset.armor) this.showTip({ at: 'armor', slot: t.dataset.armor as ArmorSlot });
    else if (t.dataset.weapon !== undefined) this.showTip({ at: 'weapon', slot: +t.dataset.weapon as 0 | 1 });
  };

  private itemOf(src: Source): Item | null {
    const s = this.game.save;
    if (src.at === 'bag') return s.bag[src.index] ?? null;
    if (src.at === 'armor') return s.equip[src.slot] ?? null;
    return s.weapons[src.slot];
  }

  private hideTip() {
    this.ui.modal.querySelector('#i-tip')?.classList.add('hidden');
  }

  private showTip(src: Source) {
    const tip = this.ui.modal.querySelector<HTMLElement>('#i-tip');
    if (!tip) return;
    const g = this.game;
    const s = g.save;
    const it = this.itemOf(src);
    sfx.click();
    if (!it) {
      const name = src.at === 'armor' ? SLOT_NAME[src.slot] : 'Оружие';
      tip.innerHTML = `<h3>${name}</h3><p>Слот пуст. Подходящие предметы лежат в сумке.</p>`;
      tip.classList.remove('hidden');
      return;
    }
    const r = RARITY[it.rarity];
    const slot = slotOf(it);
    // Compare a bag item with what is equipped in the same slot.
    let cur: Item | null = null;
    if (src.at === 'bag') cur = slot === 'weapon' ? g.weaponItem : (s.equip[slot] ?? null);
    const mine = itemLines(it);
    const theirs = cur ? Object.fromEntries(itemLines(cur)) : {};
    const rows = mine.map(([k, v]) => {
      const o = theirs[k];
      const nv = parseFloat(v.replace('+', ''));
      const ov = o !== undefined ? parseFloat(String(o).replace('+', '')) : NaN;
      const cls = !cur || Number.isNaN(nv) || Number.isNaN(ov) ? '' : nv > ov ? 'up' : nv < ov ? 'down' : '';
      return `<div><span>${k}</span><b class="${cls}">${v}</b>${cur ? `<i>${o ?? '—'}</i>` : ''}</div>`;
    }).join('');
    const btn = (act: string, label: string, cls = '') => `<button class="btn ${cls}" data-act="${act}">${label}</button>`;
    let actions = '';
    if (src.at === 'bag') {
      if (it.kind === 'weapon') {
        actions = btn('eq0', s.active === 0 ? 'В руку' : 'Слот 1', 'primary') + btn('eq1', s.active === 1 ? 'В руку' : 'Слот 2', 'primary');
      } else actions = btn('equip', 'Надеть', 'primary');
      actions += btn('scrap', `Разобрать +${scrapValue(it)}`);
    } else if (src.at === 'armor') {
      actions = btn('unequip', 'Снять', 'primary');
    } else {
      if (s.active !== src.slot) actions += btn('active', 'Взять в руку', 'primary');
      if (s.weapons[1 - src.slot]) actions += btn('unequip', 'Снять');
    }
    const where = slot === 'weapon' ? `Оружие · ${WEAPONS[it.def].name}` : SLOT_NAME[ARMOR[it.def].slot];
    tip.style.borderColor = r.color;
    tip.innerHTML = `<div class="rar" style="color:${r.color}">${r.name} · ур. ${it.lvl}</div>
      <h3>${itemIcon(it)} ${itemName(it, g.faction)}${it.sharpen ? ` +${it.sharpen}` : ''}</h3>
      <div class="where">${where}${cur ? ` · сравнение с надетым` : ''}</div>
      <div class="tip-stats">${rows}</div>
      <div class="row">${actions}</div>`;
    tip.classList.remove('hidden');
    tip.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.act(b.dataset.act!, src);
    }));
  }

  private act(action: string, src: Source) {
    const g = this.game;
    let ok = true;
    if (src.at === 'bag') {
      if (action === 'equip') g.equipFromBag(src.index);
      else if (action === 'eq0' || action === 'eq1') g.equipFromBag(src.index, action === 'eq0' ? 0 : 1);
      else if (action === 'scrap') g.scrapFromBag(src.index);
    } else if (src.at === 'armor') {
      ok = g.unequipArmor(src.slot);
    } else if (action === 'active') {
      g.setActiveWeapon(src.slot);
    } else if (action === 'unequip') {
      ok = g.unequipWeapon(src.slot);
    }
    if (!ok) this.ui.toast('Сумка полна');
    this.hideTip();
    this.rerender();
  }
}
