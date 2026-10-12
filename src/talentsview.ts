// Talent tree window: level and points on top (like the "Характеристики" panel), the two skill
// slots and the respec button; below, a bottom sheet with 8 tiers of nodes. Tap a node for its card.
import { art } from './art';
import { sfx } from './audio';
import type { Game } from './game';
import { fmtK } from './icons';
import {
  MAX_LEVEL, SKILL_SLOTS, TIER_POINTS, TREES, canLearn, freePoints, passiveText, rankValues, spentInTier, spentPoints, talent, tierLock,
  xpToNext, type ActiveDef, type TalentDef, type Trigger,
} from './talents';
import type { UI } from './ui';

const TRIGGER: Record<Trigger, string> = {
  lowHp: 'при низком HP', cooldown: 'по перезарядке', everyHit: 'серия атак',
  kill: 'при убийстве', hurt: 'при получении удара', lethal: 'при смертельном ударе',
};

export class TalentsView {
  private openNow = false;
  private selected: string | null = null;

  constructor(private ui: UI, private game: Game) {
    this.onClick = this.onClick.bind(this);
  }

  get isOpen() { return this.openNow; }

  open() {
    this.game.paused = true;
    this.openNow = true;
    this.ui.open(`<div class="top-stats tal-top" id="t-top"></div>
      <div class="sheet tal">
        <div class="sheet-head"><div class="sheet-title">Таланты</div><button class="xbtn" id="t-close" title="Закрыть">✕</button></div>
        <div class="sheet-body" id="t-tree"></div>
      </div>
      <div class="tip-wrap hidden" id="t-tip"><div class="tip"></div></div>`);
    this.ui.on('#t-close', () => this.close());
    this.ui.modal.addEventListener('click', this.onClick);
    this.render();
  }

  close() {
    this.ui.modal.removeEventListener('click', this.onClick);
    this.openNow = false;
    this.selected = null;
    this.ui.close();
    this.game.paused = false;
    this.game.refreshHud(true);
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string) { return this.ui.modal.querySelector<T>(sel)!; }

  private render() {
    this.renderTop();
    this.renderTree();
    if (this.selected) this.renderTip(this.selected); else this.q('#t-tip').classList.add('hidden');
  }

  private renderTop() {
    const s = this.game.save;
    const need = s.level >= MAX_LEVEL ? 0 : xpToNext(s.level);
    const free = freePoints(s);
    const slot = (i: number) => {
      const id = s.skills[i];
      const def = id ? talent(id) : null;
      return `<button class="tslot ${def ? '' : 'empty'}" data-slot="${i}">
        ${def ? art(def.icon, 40) : art('lock', 30, 'dim')}<span>${def ? def.name : `Слот ${i + 1}`}</span></button>`;
    };
    const price = this.game.resetPrice;
    this.q('#t-top').innerHTML = `
      <div class="tal-head">
        <div class="lv-badge big">${s.level}</div>
        <div class="tal-xp"><div class="xpbar"><div class="fill" style="width:${need ? (s.xp / need) * 100 : 100}%"></div>
          <span>${need ? `${fmtK(s.xp)} / ${fmtK(need)} XP` : 'Макс. уровень'}</span></div>
          <div class="tal-pts">Очки: <b class="${free > 0 ? 'has' : ''}">${free}</b> <small>потрачено ${spentPoints(s)}</small></div></div>
      </div>
      <div class="tal-slots">${Array.from({ length: SKILL_SLOTS }, (_, i) => slot(i)).join('')}
        <button class="btn red tal-reset" id="t-reset" ${spentPoints(s) === 0 ? 'disabled' : ''}>Сброс<small>${price ? `${art('coin', 18)} ${fmtK(price)}` : 'бесплатно'}</small></button>
      </div>`;
    this.ui.on('#t-reset', () => this.askReset());
  }

  private renderTree() {
    const s = this.game.save;
    const tree = TREES[this.game.faction];
    this.q('#t-tree').innerHTML = tree.map((tier, i) => {
      const lock = tierLock(s, i);
      const nodes = tier.nodes.map((d) => this.node(d, !lock)).join('');
      // Progress towards opening the next tier: "4/10".
      const next = i < tree.length - 1 ? Math.min(TIER_POINTS, spentInTier(s, i)) : null;
      return `<div class="divider"><span>${lock ? art('lock', 20) : ''} Этап ${i + 1} · ур. ${tier.level}${next !== null && !lock ? ` · <b class="${next >= TIER_POINTS ? 'ok' : ''}">${next}/${TIER_POINTS}</b>` : ''}</span></div>
        ${lock ? `<p class="tier-lock">${lock}</p>` : ''}
        <div class="tal-row ${lock ? 'locked' : ''}">${nodes}</div>`;
    }).join('') + '<p class="hint-line">Нажми на талант: описание, прокачка и выбор умения в слот</p>';
  }

  private node(d: TalentDef, open: boolean) {
    const s = this.game.save;
    const rank = s.talents[d.id] ?? 0;
    const can = !canLearn(s, d.id);
    const slotted = d.kind === 'active' && s.skills.includes(d.id);
    return `<button class="tnode ${d.kind} ${rank ? 'learned' : ''} ${rank >= d.max ? 'maxed' : ''} ${can ? 'can' : ''} ${open ? '' : 'locked'} ${slotted ? 'slotted' : ''}" data-node="${d.id}">
      <div class="ic">${art(d.icon, 40, rank || can ? '' : 'dim')}</div>
      <span class="rk">${rank}/${d.max}</span>${can ? '<i class="up">+</i>' : ''}
      <span class="nm">${d.name}</span></button>`;
  }

  private describe(d: TalentDef, rank: number) {
    if (d.kind === 'passive') return passiveText(d, rank);
    return d.text(rankValues(d, rank));
  }

  private renderTip(id: string) {
    const d = talent(id)!;
    const s = this.game.save;
    const rank = s.talents[id] ?? 0;
    const err = canLearn(s, id);
    const active = d.kind === 'active' ? (d as ActiveDef) : null;
    const cur = rank ? `<div class="tt-line"><span>Сейчас (ранг ${rank})</span><p>${this.describe(d, rank)}</p></div>` : '';
    const next = rank < d.max ? `<div class="tt-line next"><span>${rank ? 'Следующий ранг' : 'Ранг 1'}</span><p>${this.describe(d, rank + 1)}</p></div>` : '';
    const slots = active && rank ? Array.from({ length: SKILL_SLOTS }, (_, i) => s.skills[i] === id
      ? `<button class="btn" data-unslot="${i}">Снять из слота ${i + 1}</button>`
      : `<button class="btn blue" data-equip="${i}">В слот ${i + 1}</button>`).join('') : '';
    const tip = this.q('#t-tip');
    tip.classList.remove('hidden');
    tip.querySelector('.tip')!.innerHTML = `
      <div class="card-head"><div class="tnode big ${d.kind} ${rank ? 'learned' : ''}"><div class="ic">${art(d.icon, 60)}</div></div>
        <div class="card-title"><h3>${d.name}</h3></div>
        <button class="xbtn" data-act="close">✕</button></div>
      <div class="pills tt-pills"><span>${active ? `Умение · ${TRIGGER[active.trigger]}` : 'Пассивный'}</span><span>Ранг ${rank}/${d.max}</span></div>
      ${cur}${next}
      ${active ? '<p class="tt-note">Срабатывает само, если умение стоит в одном из двух слотов.</p>' : ''}
      <div class="row">${slots}
        <button class="btn primary" data-learn="${id}" ${err ? 'disabled' : ''}>${err ?? 'Вкачать +1'}</button></div>`;
  }

  private askReset() {
    const price = this.game.resetPrice;
    const s = this.game.save;
    if (s.gold < price) { this.ui.toast(`Нужно ${price} золота для сброса`); return; }
    this.ui.modal.removeEventListener('click', this.onClick);
    this.ui.confirm('Сбросить таланты?', `Все ${spentPoints(s)} очков вернутся, умения снимутся из слотов. ` +
      (price ? `Цена: ${price} золота. Каждый следующий сброс дороже с уровнем.` : 'Первый сброс бесплатный.'), () => {
      this.game.resetTalents();
      this.open();
    }, () => this.open());
  }

  private onClick(e: Event) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-node],[data-learn],[data-equip],[data-unslot],[data-slot],[data-act],.tip-wrap');
    if (!el) return;
    const s = this.game.save;
    if (el.dataset.node) {
      sfx.click();
      this.selected = el.dataset.node;
      this.renderTip(this.selected);
    } else if (el.dataset.learn) {
      const err = this.game.learnTalent(el.dataset.learn);
      if (err) this.ui.toast(err);
      this.render();
    } else if (el.dataset.equip !== undefined && this.selected) {
      this.game.equipSkill(this.selected, +el.dataset.equip);
      this.render();
    } else if (el.dataset.unslot !== undefined) {
      this.game.equipSkill(null, +el.dataset.unslot);
      this.render();
    } else if (el.dataset.slot !== undefined) {
      // Tapping a slot opens the card of the skill in it.
      const id = s.skills[+el.dataset.slot];
      if (id) { sfx.click(); this.selected = id; this.renderTip(id); }
      else this.ui.toast('Вкачай умение (круглые таланты) и поставь его в слот');
    } else if (el.dataset.act === 'close' || el.classList.contains('tip-wrap') && e.target === el) {
      sfx.click();
      this.selected = null;
      this.q('#t-tip').classList.add('hidden');
    }
  }
}

