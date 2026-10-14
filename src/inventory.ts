import * as THREE from 'three';
import { Character } from './character';
import { COMBOS, DAMAGE_TYPE_NAME, FACTIONS, RARITY, WEAPONS } from './config';
import {
  ARMOR, ARMOR_SLOTS, BAG_SIZE, EQUIP_BAR, SLOT_NAME, cellHtml, itemLines, itemName, slotOf,
  type ArmorSlot, type Item, type VisualPart,
} from './items';
import { sfx } from './audio';
import { DAMAGE_TYPE_ICON, fmtK, icon } from './icons';
import { art } from './art';
import type { Game } from './game';
import type { UI } from './ui';
import { pairText } from './offhand';

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

  setGear(weapon: string | null, left: string | null, outfit: Partial<Record<VisualPart, string>>) {
    this.ch.setWeapon(weapon, left);
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
    // dispose() keeps the WebGL context alive until GC; past the browser's limit the oldest one,
    // the game's own, is lost and the world goes blank. Release it now.
    this.renderer.forceContextLoss();
  }
}

type BagFilter = 'all' | 'weapon' | 'armor';
type Source = { at: 'bag'; index: number } | { at: 'armor'; slot: ArmorSlot } | { at: 'weapon'; slot: 0 | 1 };

/** Inventory window: stats, the hero preview, the bag and the equipped slots. */

/** Weapon slot captions: save.weapons[0] is the right hand. */
const HAND_NAME = ['правая', 'левая'];

export class Inventory {
  private preview: HeroPreview | null = null;
  private opened = false;
  private bagFilter: BagFilter = 'all';

  constructor(private ui: UI, private game: Game) {}

  get isOpen() { return this.opened; }

  private cell(it: Item | null | undefined, attrs: string, placeholder = '', extra = '', cls = '') {
    return cellHtml(it, attrs, placeholder, extra, cls);
  }

  close() {
    this.ui.modal.removeEventListener('click', this.onClick);
    this.preview?.dispose();
    this.preview = null;
    this.opened = false;
    this.ui.close();
    this.game.refreshHud(true);
  }

  /** "Характеристики" panel of the inventory window: at the top of the screen, above the hero; "i" opens the full list. */
  private statsPanel() {
    return `<div class="top-stats">
      <div class="sc-title">Характеристики</div>
      <button class="info-btn" id="i-info" title="Все характеристики">i</button>
      <div class="big-stats" id="i-big"></div>
      <div class="chips" id="i-stats"></div>
    </div>`;
  }

  private renderStats() {
    const g = this.game;
    const q = (id: string) => this.ui.modal.querySelector<HTMLElement>(id)!;
    const hit = g.itemDamage(g.weaponItem) * g.handMul() * g.powerMult();
    const big = (ic: string, v: string, label: string) => `<div>${art(ic, 46)}<b>${v}</b><span>${label}</span></div>`;
    q('#i-big').innerHTML = big('sword', fmtK(g.heroDps()), 'DPS') + big('heart', fmtK(g.maxHp), 'HP') +
      big('regen', fmtK(g.regen), 'Реген');
    const combo = COMBOS[g.weaponItem.def];
    const chip = (ic: string, v: string, title: string) => `<div class="chip" title="${title}">${art(ic, 28)}<b>${v}</b></div>`;
    q('#i-stats').innerHTML = chip('hammer', fmtK(Math.round(hit)), 'Урон за удар') + chip('fist', fmtK(g.power), 'Сила (сферы и броня)') +
      chip('shield', `${g.defense} <small>−${Math.round((g.defense / (g.defense + 100)) * 100)}%</small>`, 'Защита') +
      chip('run', `${g.speedStat}`, 'Скорость') + chip('axe', `×${combo.mult}`, `Комбо: ${combo.name}`) +
      chip('hourglass', `${g.weapon.aps}/с`, 'Атак в секунду');
  }

  /** Full list of the hero's stats ("i" on the stats panel). */
  private showInfo() {
    const wrap = this.ui.modal.querySelector<HTMLElement>('#i-sw')!;
    const g = this.game;
    const f = FACTIONS[g.faction];
    const w = g.weapon;
    const hit = g.itemDamage(g.weaponItem) * g.handMul() * g.powerMult();
    const combo = COMBOS[g.weaponItem.def];
    const gear = g.gear();
    const t = Math.round(g.save.playTime ?? 0);
    const played = t >= 3600 ? `${Math.floor(t / 3600)} ч ${Math.floor((t % 3600) / 60)} мин` : `${Math.floor(t / 60)} мин`;
    const row = (ic: string, name: string, value: string, note = '') =>
      `<div class="sw-row">${art(ic, 40)}<div class="sw-name">${name}${note ? `<small>${note}</small>` : ''}</div><b>${value}</b></div>`;
    const rows = [
      row('sword', 'Урон в секунду', fmtK(g.heroDps()), `${g.dual ? 'обе руки' : w.name}, с учётом силы`),
      row('hammer', 'Урон за удар', fmtK(Math.round(hit))),
      row('hourglass', 'Атак в секунду', String(w.aps)),
      row(DAMAGE_TYPE_ICON[w.type], 'Тип урона', DAMAGE_TYPE_NAME[w.type]),
      row('flag', 'Зона удара', w.shape === 'circle' ? 'круг' : `дуга ${w.arc}°`, `дальность ${w.range} м`),
      row('star', 'Комбо-добивание', `×${combo.mult}`, `${combo.name}${combo.stun ? `, оглушение ${combo.stun} с` : ''}`),
      row('fist', 'Сила', fmtK(g.power), `+${fmtK(g.power)}% к урону`),
      row('heart', 'Здоровье', fmtK(g.maxHp), gear.hp ? `+${fmtK(gear.hp)} от брони` : ''),
      g.shieldMax ? row('shield', 'Святой щит', fmtK(g.shieldMax), '15% здоровья, восстанавливается') : '',
      row('regen', 'Регенерация', `${g.regen}/с`, 'здоровья в секунду'),
      row('shield', 'Защита', String(g.defense), `−${Math.round((g.defense / (g.defense + 100)) * 100)}% входящего урона`),
      row('run', 'Скорость', String(g.speedStat), `${g.speed.toFixed(1)} м/с`),
      g.faction === 'orc' ? row('drop', 'Жажда крови', `+${Math.round(g.bloodlust * 100)}%`, 'урона сейчас, до +30% при низком здоровье') : '',
      row('flame', f.passiveName, f.name, f.passiveText),
      row('skull', 'Убито врагов', fmtK(g.save.kills)),
      row('hourglass', 'Время в игре', played),
    ].join('');
    wrap.innerHTML = `<div class="stats-win">
      <div class="sw-head"><h2>Характеристики</h2><small>${f.name} · ${w.name}</small><button class="xbtn" id="i-sw-x">✕</button></div>
      <div class="sw-list">${rows}</div>
    </div>`;
    wrap.classList.remove('hidden');
    wrap.querySelector('#i-sw-x')!.addEventListener('click', () => { sfx.click(); wrap.classList.add('hidden'); });
  }

  // ---------- inventory window: stats on top, then the hero with the equipped slots, the bag sheet at the bottom ----------
  open() {
    if (this.opened) return;
    this.opened = true;
    const f = FACTIONS[this.game.faction];
    const tab = (bf: BagFilter, ic: string) => `<button class="tab ${this.bagFilter === bf ? 'on' : ''}" data-filter="${bf}">${art(ic, 34)}</button>`;
    this.ui.open(`${this.statsPanel()}
    <div class="inv-equipped"><div class="eq-title">Экипировано</div>
      <div class="eq-doll">
        <div class="eq-side" id="i-eq-l"></div>
        <div class="eq-stage"><canvas id="i-canvas"></canvas><div class="eq-rot"><button id="i-rl">↶</button><button id="i-rr">↷</button></div></div>
        <div class="eq-w" id="i-eq-w"></div>
        <div class="eq-side" id="i-eq-r"></div>
      </div>
    </div>
    <div class="sheet inv">
      <div class="sheet-head"><div class="sheet-title">Инвентарь</div><button class="xbtn" id="i-close" title="Закрыть">✕</button></div>
      <div class="tabs">${tab('all', 'bag')}${tab('weapon', 'sword')}${tab('armor', 'chest')}<span class="cap" id="b-sub"></span></div>
      <div class="sheet-body"><div id="b-grid"></div></div>
      <p class="hint-line">Нажми на предмет: надеть, сравнить или выбросить</p>
    </div>`);
    this.preview = new HeroPreview(this.ui.modal.querySelector('#i-canvas')!, f.hero);
    this.ui.on('#i-close', () => this.close());
    this.ui.on('#i-info', () => this.showInfo());
    this.ui.modal.querySelector('#i-rl')!.addEventListener('click', () => this.preview?.nudge(-1));
    this.ui.modal.querySelector('#i-rr')!.addEventListener('click', () => this.preview?.nudge(1));
    this.ui.modal.querySelectorAll<HTMLElement>('[data-filter]').forEach((b) => b.addEventListener('click', () => {
      sfx.click();
      this.bagFilter = b.dataset.filter as BagFilter;
      this.ui.modal.querySelectorAll('[data-filter]').forEach((x) => x.classList.toggle('on', x === b));
      this.renderBag();
    }));
    this.ui.modal.insertAdjacentHTML('beforeend', '<div class="tip-wrap hidden" id="i-tip"><div class="tip"></div></div><div class="tip-wrap hidden" id="i-sw"></div>');
    const sw = this.ui.modal.querySelector<HTMLElement>('#i-sw')!;
    sw.addEventListener('click', (e) => { if (e.target === sw) sw.classList.add('hidden'); });
    this.ui.modal.addEventListener('click', this.onClick);
    this.rerender();
  }

  /** "Экипировано", laid out like the Warcraft character frame: armour in columns on both sides of the hero, weapons under him. */
  private renderChar() {
    const g = this.game;
    const s = g.save;
    const armor = (ids: ArmorSlot[]) => ids.map((id) => {
      const x = ARMOR_SLOTS.find((a) => a.id === id)!;
      return this.cell(s.equip[id], `data-armor="${id}" title="${x.name}"`, x.icon);
    }).join('');
    const weapons = ([0, 1] as const).map((i) => {
      const tag = `<span class="wtag ${s.weapons[i] ? 'on' : ''}">${HAND_NAME[i]}</span>`;
      return this.cell(s.weapons[i], `data-weapon="${i}"`, 'sword', tag, s.weapons[i] ? 'active' : '');
    }).join('');
    const q = (id: string) => this.ui.modal.querySelector<HTMLElement>(id)!;
    q('#i-eq-l').innerHTML = armor(EQUIP_BAR.left);
    q('#i-eq-w').innerHTML = weapons;
    q('#i-eq-r').innerHTML = armor(EQUIP_BAR.right);
    this.preview?.setGear(...g.handModels(), g.outfit());
    g.newItems = 0;
  }

  private renderBag() {
    const s = this.game.save;
    const q = (id: string) => this.ui.modal.querySelector<HTMLElement>(id)!;
    q('#b-sub').innerHTML = `<span>${s.bag.length}/${BAG_SIZE}</span>`;
    const section = (kind: 'weapon' | 'armor', title: string) => {
      const cells = s.bag.map((it, i) => (it.kind === kind ? this.cell(it, `data-bag="${i}"`) : '')).join('');
      return cells ? `<div class="divider"><span>${title}</span></div><div class="grid">${cells}</div>` : '';
    };
    const f = this.bagFilter;
    const html = (f !== 'armor' ? section('weapon', 'Оружие') : '') + (f !== 'weapon' ? section('armor', 'Броня') : '');
    q('#b-grid').innerHTML = html || '<div class="none">Пусто. Предметы падают с мобов, боссов и из разрушаемых объектов</div>';
    this.game.newItems = 0;
  }

  private rerender() {
    if (!this.opened) return;
    this.renderStats();
    this.renderChar();
    this.renderBag();
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
      const w = WEAPONS[it.def];
      if (w.stack) ability = `<div class="ab-title">Порезы</div><p>Каждый удар по врагу добавляет <b>+${Math.round(w.stack.add * 100)}%</b> урона по нему, до <b>+${Math.round(w.stack.add * w.stack.max * 100)}%</b>. Через <b>${w.stack.decay} с</b> без ударов бонус сгорает.</p>` + ability;
      if (w.pull) ability = `<div class="ab-title">Жатва душ</div><p>Взмах стягивает врагов в радиусе <b>${w.pull.radius} м</b> перед героем (боссов — нет). Каждый задетый враг сверх первого даёт <b>+${Math.round(w.pull.perEnemy * 100)}%</b> урона, до <b>×${w.pull.max}</b>.</p>` + ability;
      if (w.cycle) ability = `<div class="ab-title">Цикл</div><p>Без остановки: взмах справа, взмах слева (широко, слабее) и узкий сильный <b>укол</b>. Цикл не сбрасывается.</p>` + ability;
      if (w.orbit) ability = `<div class="ab-title">Бросок</div><p>Коса летит вокруг героя <b>${w.orbit.time} с</b> и режет всех на пути, потом возвращается в руку.</p>` + ability;
      if (w.ring) ability = `<div class="ab-title">Бонк</div><p>Бьёт по головам в круге перед героем. Оглушает с шансом <b>${Math.round((w.stun ?? 0) * 100)}%</b>, в <b>${Math.round(w.ring.chance * 100)}%</b> случаев — звонкий удар <b>×${w.ring.mult}</b>.</p>` + ability;
      if (w.assassin) ability = `<div class="ab-title">Убийца</div><p>Рывок к ближайшему врагу и удар только по нему. Всегда оглушает на <b>${w.assassin.stun} с</b>, обычных врагов ниже <b>${Math.round(w.assassin.execute * 100)}%</b> HP казнит.</p>` + ability;
      if (w.guard) ability = `<div class="ab-title">Защита</div><p>−${Math.round(w.guard.reduce * 100)}% входящего урона. Удар по герою с шансом <b>${Math.round(w.guard.counter.normal * 100)}–${Math.round(w.guard.counter.boss * 100)}%</b> (чем сильнее враг, тем выше) вызывает контратаку оружием в другой руке. Рядом с оружием сам не бьёт.</p>` + ability;
      const pt = pairText(it.def);
      if (pt) ability += `<div class="ab-title">С мечом в другой руке</div><p>${pt}</p>`;
    } else {
      ability = `<div class="ab-title">Комплект</div><p>${it.rarity > 0 || rest.length ? 'Бонус к стату действует, пока предмет надет.' : 'У обычных предметов нет бонуса. Ищи <b>необычные</b> и выше.'}</p>`;
    }
    const btn = (act: string, label: string, cls = '') => `<button class="btn ${cls}" data-act="${act}">${label}</button>`;
    let actions = '';
    if (src.at === 'bag') {
      actions = btn('discard', 'Выбросить');
      if (it.kind === 'weapon') {
        actions += btn('eq0', 'В правую', 'primary') + btn('eq1', 'В левую', 'primary');
      } else actions += btn('equip', 'Экипировать', 'primary');
    } else if (src.at === 'armor') {
      actions = btn('unequip', 'Снять', 'red');
    } else {
      if (s.weapons[1 - src.slot]) actions += btn('unequip', 'Снять', 'red');
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
      else if (action === 'discard') g.discardFromBag(src.index);
    } else if (src.at === 'armor') {
      ok = g.unequipArmor(src.slot);
    } else if (action === 'unequip') {
      ok = g.unequipWeapon(src.slot);
    }
    if (!ok) this.ui.toast('Сумка полна');
    this.hideTip();
    this.rerender();
  }
}
