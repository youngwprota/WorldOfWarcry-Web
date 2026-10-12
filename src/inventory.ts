import * as THREE from 'three';
import { Character } from './character';
import { COMBOS, DAMAGE_TYPE_NAME, FACTIONS, RARITY, WEAPONS } from './config';
import {
  ARMOR, ARMOR_SLOTS, BAG_SIZE, SLOT_NAME, cellHtml, itemLines, itemName, scrapValue, slotOf,
  type ArmorSlot, type Item, type VisualPart,
} from './items';
import { sfx } from './audio';
import { DAMAGE_TYPE_ICON, fmtK, icon } from './icons';
import { art } from './art';
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

type BagFilter = 'all' | 'weapon' | 'armor';
type Source = { at: 'bag'; index: number } | { at: 'armor'; slot: ArmorSlot } | { at: 'weapon'; slot: 0 | 1 };

/** Character sheet (paper doll) and bags. */
export class Inventory {
  private preview: HeroPreview | null = null;
  private view: 'char' | 'bag' | null = null;
  private bagFilter: BagFilter = 'all';

  onTalents: () => void = () => {};
  constructor(private ui: UI, private game: Game) {}

  get isOpen() { return this.view !== null; }

  private cell(it: Item | null | undefined, attrs: string, placeholder = '', extra = '', cls = '') {
    return cellHtml(it, attrs, placeholder, extra, cls);
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

  /** "Характеристики" panel at the top of the screen, above the sheet (as in Butcher Hero). */
  private statsPanel() {
    const f = FACTIONS[this.game.faction];
    return `<div class="top-stats">
      <div class="sc-title">Характеристики <small>${f.name} · ${f.passiveName}</small></div>
      <div class="big-stats" id="i-big"></div>
      <div class="chips" id="i-stats"></div>
    </div>`;
  }

  private renderStats() {
    const g = this.game;
    const q = (id: string) => this.ui.modal.querySelector<HTMLElement>(id)!;
    const hit = g.itemDamage(g.weaponItem) * g.powerMult();
    const big = (ic: string, v: string, label: string) => `<div>${art(ic, 46)}<b>${v}</b><span>${label}</span></div>`;
    q('#i-big').innerHTML = big('sword', fmtK(hit * g.weapon.aps), 'DPS') + big('heart', fmtK(g.maxHp), 'HP') +
      big('regen', fmtK((g.regen / 100) * g.maxHp), 'Реген');
    const combo = COMBOS[g.weaponItem.def];
    const chip = (ic: string, v: string, title: string) => `<div class="chip" title="${title}">${art(ic, 28)}<b>${v}</b></div>`;
    q('#i-stats').innerHTML = chip('hammer', fmtK(Math.round(hit)), 'Урон за удар') + chip('sword', fmtK(g.power), 'Сила (сферы и броня)') +
      chip('shield', `${g.defense} <small>−${Math.round((g.defense / (g.defense + 100)) * 100)}%</small>`, 'Защита') +
      chip('boot', `${Math.round(g.speed * 10) / 10}`, 'Бег, м/с') + chip('axe', `×${combo.mult}`, `Комбо: ${combo.name}`) +
      chip('gear', `${g.weapon.aps}/с`, 'Атак в секунду');
  }

  // ---------- character sheet ----------
  openCharacter() {
    if (this.view === 'char') return;
    this.preview?.dispose();
    this.preview = null;
    this.pause();
    this.view = 'char';
    const f = FACTIONS[this.game.faction];
    this.ui.open(`${this.statsPanel()}<div class="sheet inv char">
      <div class="sheet-head"><div class="sheet-title">Герой</div><button class="xbtn" id="i-close" title="Закрыть">✕</button></div>
      <div class="sheet-body">
        <div class="doll">
          <div class="col" id="i-left"></div>
          <div class="paper">
            <canvas id="i-canvas"></canvas>
            <div class="rot"><button id="i-rl">↶</button><button id="i-rr">↷</button></div>
          </div>
          <div class="col" id="i-right"></div>
        </div>
        <div class="wrow" id="i-weapons"></div>
        <div class="divider"><span id="i-owned-title"></span></div>
        <div class="strip" id="i-strip"></div>
        <div class="row bag-row"><button class="btn primary bag-btn" id="i-bag">${art('bag', 30)} Сумка</button>
          <button class="btn purple bag-btn" id="i-tal">${art('star', 30)} Таланты</button></div>
      </div>
    </div>`);
    this.preview = new HeroPreview(this.ui.modal.querySelector('#i-canvas')!, f.hero);
    this.ui.on('#i-close', () => this.close());
    this.ui.on('#i-bag', () => this.openBag());
    this.ui.on('#i-tal', () => this.onTalents());
    this.ui.modal.querySelector('#i-rl')!.addEventListener('click', () => this.preview?.nudge(-1));
    this.ui.modal.querySelector('#i-rr')!.addEventListener('click', () => this.preview?.nudge(1));
    this.ui.modal.insertAdjacentHTML('beforeend', '<div class="tip-wrap hidden" id="i-tip"><div class="tip"></div></div>');
    this.ui.modal.addEventListener('click', this.onClick);
    this.renderChar();
    this.renderStats();
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
      return this.cell(it, `data-weapon="${i}"`, 'sword', tag, s.active === i ? 'active' : '');
    }).join('');
    q('#i-owned-title').innerHTML = `В сумке ${s.bag.length}/${BAG_SIZE}`;
    q('#i-strip').innerHTML = s.bag.length
      ? s.bag.map((it, i) => this.cell(it, `data-bag="${i}"`)).join('')
      : '<div class="none">Пусто. Предметы падают с мобов, боссов и из разрушаемых объектов</div>';
    this.preview?.setGear(g.weapon.model[g.faction], g.outfit());
    g.newItems = 0;
  }

  // ---------- bags: Butcher-style bottom sheet ----------
  openBag() {
    this.preview?.dispose();
    this.preview = null;
    this.pause();
    this.view = 'bag';
    const tab = (f: BagFilter, ic: string) => `<button class="tab ${this.bagFilter === f ? 'on' : ''}" data-filter="${f}">${art(ic, 34)}</button>`;
    this.ui.open(`${this.statsPanel()}<div class="sheet inv bag">
      <div class="sheet-head"><div class="sheet-title">Инвентарь</div><button class="xbtn" id="i-close" title="Закрыть">✕</button></div>
      <div class="sheet-body">
        <div class="tabs">${tab('all', 'bag')}${tab('weapon', 'sword')}${tab('armor', 'chest')}
          <span class="cap" id="b-sub"></span>
          <button class="tab hero" id="b-char" title="Персонаж">${art('hero', 36)}</button></div>
        <div id="b-grid"></div>
        <p class="hint-line">Нажми на предмет: надеть, сравнить или разобрать на золото</p>
      </div>
      <div class="equipped"><div class="eq-title">Экипировано</div><div class="eq-row" id="b-eq"></div></div>
    </div>`);
    this.ui.on('#i-close', () => this.close());
    this.ui.on('#b-char', () => this.openCharacter());
    this.ui.modal.querySelectorAll<HTMLElement>('[data-filter]').forEach((b) => b.addEventListener('click', () => {
      sfx.click();
      this.bagFilter = b.dataset.filter as BagFilter;
      this.ui.modal.querySelectorAll('[data-filter]').forEach((x) => x.classList.toggle('on', x === b));
      this.renderBag();
    }));
    this.ui.modal.insertAdjacentHTML('beforeend', '<div class="tip-wrap hidden" id="i-tip"><div class="tip"></div></div>');
    this.ui.modal.addEventListener('click', this.onClick);
    this.renderBag();
    this.renderStats();
  }

  private renderBag() {
    const s = this.game.save;
    const q = (id: string) => this.ui.modal.querySelector<HTMLElement>(id)!;
    q('#b-sub').innerHTML = `<span>${s.bag.length}/${BAG_SIZE}</span><span>${art('coin', 20)}<b>${fmtK(s.gold)}</b></span>`;
    const section = (kind: 'weapon' | 'armor', title: string) => {
      const cells = s.bag.map((it, i) => (it.kind === kind ? this.cell(it, `data-bag="${i}"`) : '')).join('');
      return cells ? `<div class="divider"><span>${title}</span></div><div class="grid">${cells}</div>` : '';
    };
    const f = this.bagFilter;
    const html = (f !== 'armor' ? section('weapon', 'Оружие') : '') + (f !== 'weapon' ? section('armor', 'Броня') : '');
    q('#b-grid').innerHTML = html || '<div class="none">Пусто. Предметы падают с мобов, боссов и из разрушаемых объектов</div>';
    q('#b-eq').innerHTML = ([0, 1] as const).map((i) => this.cell(s.weapons[i], `data-weapon="${i}"`, 'sword', '', s.active === i ? 'active' : '')).join('') +
      '<div class="sep"></div>' + ARMOR_SLOTS.map((x) => this.cell(s.equip[x.id], `data-armor="${x.id}" title="${x.name}"`, x.icon)).join('');
    this.game.newItems = 0;
  }

  private rerender() {
    this.renderStats();
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
    const wrap = this.ui.modal.querySelector<HTMLElement>('#i-tip');
    if (!wrap) return;
    const tip = wrap.querySelector<HTMLElement>('.tip')!;
    const g = this.game;
    const s = g.save;
    const it = this.itemOf(src);
    sfx.click();
    const x = '<button class="xbtn" data-act="close">✕</button>';
    wrap.classList.remove('hidden');
    if (!it) {
      const name = src.at === 'armor' ? SLOT_NAME[src.slot] : 'Оружие';
      const ph = src.at === 'armor' ? ARMOR_SLOTS.find((a) => a.id === src.slot)!.icon : 'sword';
      tip.innerHTML = `<div class="card-head">${cellHtml(null, 'disabled', ph, '', 'big')}<div class="card-title"><h3>${name}</h3></div>${x}</div>
        <div class="ability well"><p>Слот пуст. Подходящие предметы лежат в сумке.</p></div>`;
      this.bindTip(tip, src);
      return;
    }
    const r = RARITY[it.rarity];
    const slot = slotOf(it);
    // Compare a bag item with what is equipped in the same slot.
    let cur: Item | null = null;
    if (src.at === 'bag') cur = slot === 'weapon' ? g.weaponItem : (s.equip[slot] ?? null);
    const theirs = cur ? Object.fromEntries(itemLines(cur)) : {};
    const cmp = (k: string, v: string) => {
      const o = theirs[k];
      const nv = parseFloat(v.replace('+', ''));
      const ov = o !== undefined ? parseFloat(String(o).replace('+', '')) : NaN;
      const cls = Number.isNaN(nv) || Number.isNaN(ov) ? '' : nv > ov ? 'up' : nv < ov ? 'down' : '';
      return cur && o !== undefined && o !== v ? `<i>${o}</i><em>›</em><b class="${cls}">${v}</b>` : `<b>${v}</b>`;
    };
    const [main, ...rest] = itemLines(it).filter(([k]) => k !== 'Тип');
    const mainIcon = it.kind === 'weapon' ? art(it.def, 30) : art('shield', 30);
    const sub = rest.map(([k, v]) => `<div><span>${k}</span>${cmp(k, v)}</div>`).join('');
    let ability: string;
    if (it.kind === 'weapon') {
      const c = COMBOS[it.def];
      ability = `<div class="ab-title">Добивание: ${c.name}</div><p>Третий удар комбо подряд бьёт ${c.shape === 'circle' ? '<b>по кругу</b>' : `<b>дугой ${c.arc}°</b>`} с уроном <b>×${c.mult}</b>${c.stun ? ` и оглушает на <b>${c.stun} с</b>` : ''}.</p>`;
    } else {
      ability = `<div class="ab-title">Комплект</div><p>${it.rarity > 0 || rest.length ? 'Бонус к стату действует, пока предмет надет.' : 'У обычных предметов нет бонуса. Ищи <b>редкие</b> и выше.'}</p>`;
    }
    const btn = (act: string, label: string, cls = '') => `<button class="btn ${cls}" data-act="${act}">${label}</button>`;
    let actions = '';
    if (src.at === 'bag') {
      actions = btn('scrap', `Разобрать<br><small>+${scrapValue(it)} золота</small>`);
      if (it.kind === 'weapon') {
        actions += btn('eq0', s.active === 0 ? 'В руку' : 'Слот 1', 'primary') + btn('eq1', s.active === 1 ? 'В руку' : 'Слот 2', 'primary');
      } else actions += btn('equip', 'Экипировать', 'primary');
    } else if (src.at === 'armor') {
      actions = btn('unequip', 'Снять', 'red');
    } else {
      if (s.weapons[1 - src.slot]) actions += btn('unequip', 'Снять', 'red');
      if (s.active !== src.slot) actions += btn('active', 'В руку', 'primary');
    }
    const type = slot === 'weapon' ? `${icon(DAMAGE_TYPE_ICON[WEAPONS[it.def].type], '#fff', 14)} ${DAMAGE_TYPE_NAME[WEAPONS[it.def].type]}` : SLOT_NAME[ARMOR[it.def].slot];
    tip.innerHTML = `<div class="card-head">${cellHtml(it, 'disabled', '', '', 'big')}
        <div class="card-title"><h3>${itemName(it, g.faction)}${it.sharpen ? ` +${it.sharpen}` : ''}</h3>
          <div class="pills"><span class="rar" style="color:${r.color}">${r.name}</span><span class="typ">${type}</span></div></div>${x}</div>
      <div class="card-main well"><span>${main[0]}</span><span class="v">${mainIcon}${cmp(main[0], main[1])}</span></div>
      <div class="card-sub">${sub}<div><span>Уровень</span><b>${it.lvl}</b></div></div>
      ${cur ? '<div class="cmp-note">сравнение с надетым</div>' : ''}
      <div class="ability well">${ability}</div>
      <div class="row">${actions}</div>`;
    this.bindTip(tip, src);
  }

  private bindTip(tip: HTMLElement, src: Source) {
    tip.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) => b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (b.dataset.act === 'close') { sfx.click(); this.hideTip(); return; }
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
