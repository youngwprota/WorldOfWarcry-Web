// Debug panel. Floating, does not pause the game, so fights can be watched live. Open: ` (Backquote) or ⚙ → «Дебаг-меню».
import { sfx } from './audio';
import type { Game } from './game';

const pct = (x: number) => `${Math.round(x * 100)}%`;

type Action =[label: string, run: (g: Game) => void, cls?: string];

const SECTIONS: [string, Action[]][] = [
  ['Бой', [
    ['HP 10%', (g) => g.debugSetHp(0.1)],
    ['HP 40%', (g) => g.debugSetHp(0.4)],
    ['HP 100%', (g) => g.debugSetHp(1)],
    ['Бессмертие', (g) => { g.god = !g.god; }, 'god'],
    ['Убить рядом', (g) => g.debugKillNearby(), 'wide'],
  ]],
  ['Оружие в руку', [
    ['Меч', (g) => g.debugGiveWeapon('sword')],
    ['Топор', (g) => g.debugGiveWeapon('axe')],
    ['Молот', (g) => g.debugGiveWeapon('hammer')],
    ['Кинжалы', (g) => g.debugGiveWeapon('dagger')],
    ['Жнец', (g) => g.debugGiveWeapon('reaper')],
    ['Нагамаки', (g) => g.debugGiveWeapon('nagamaki')],
    ['Коса', (g) => g.debugGiveWeapon('scythe')],
    ['Сковорода', (g) => g.debugGiveWeapon('pan')],
    ['Клинок', (g) => g.debugGiveWeapon('hidden_blade')],
  ]],
  ['Оружие в левую', [
    ['Меч', (g) => g.debugGiveWeapon('sword', 1)],
    ['Щит', (g) => g.debugGiveWeapon('shield', 1)],
    ['Кинжалы', (g) => g.debugGiveWeapon('dagger', 1)],
    ['Пусто', (g) => g.debugClearLeft(), 'wide'],
  ]],
  ['Статы (+очки)', [
    ['+10 урон', (g) => g.debugAddStat('power', 10)],
    ['+50 HP', (g) => g.debugAddStat('hp', 50)],
    ['+5 реген', (g) => g.debugAddStat('regen', 5)],
    ['+25 скор.', (g) => g.debugAddStat('speed', 25)],
    ['+25 защ.', (g) => g.debugAddStat('defense', 25)],
    ['+25 уклон', (g) => g.debugAddStat('dodge', 25)],
    ['+25 крит', (g) => g.debugAddStat('crit', 25)],
    ['+25 к.урон', (g) => g.debugAddStat('critDmg', 25)],
    ['+10% урон', (g) => g.debugAddStat('power', 10, true)],
    ['+10% HP', (g) => g.debugAddStat('hp', 10, true)],
    ['+10% реген', (g) => g.debugAddStat('regen', 10, true)],
    ['Сбросить дебаг-статы', (g) => g.debugClearStats(), 'wide'],
  ]],
  ['Горнило', [
    ['+5 круток', (g) => g.debugAddPulls(5), 'wide'],
  ]],
  ['Спавнеры', [
    ['Уничтожить всех', (g) => g.debugKillAll(), 'wide'],
    ['Сбросить таймеры', (g) => g.debugResetTimers(), 'wide'],
    ['Восстановить всех', (g) => g.debugRestoreAll(), 'wide'],
  ]],
  ['Скейл героя', [
    ['−0.1', (g) => g.debugSetHeroScale(g.heroScale - 0.1)],
    ['×1', (g) => g.debugSetHeroScale(1)],
    ['+0.1', (g) => g.debugSetHeroScale(g.heroScale + 0.1)],
  ]],
  ['Скейл врагов', [
    ['−0.1', (g) => g.debugSetMobScale(g.mobScale - 0.1)],
    ['×1', (g) => g.debugSetMobScale(1)],
    ['+0.1', (g) => g.debugSetMobScale(g.mobScale + 0.1)],
  ]],
  ['FOV камеры', [
    ['−5', (g) => g.debugSetFov(g.camera.fov - 5)],
    ['54', (g) => g.debugSetFov(54)],
    ['+5', (g) => g.debugSetFov(g.camera.fov + 5)],
  ]],
  ['Ворота', [
    ['Открыть все ворота', (g) => g.debugOpenGates(), 'wide'],
  ]],
  ['Туман войны', [
    ['Убрать туман войны', (g) => g.debugFog(true), 'wide'],
    ['Вернуть туман', (g) => g.debugFog(false), 'wide'],
  ]],
  ['Мир', [
    ['Посёлок', (g) => g.debugTeleport('camp')],
    ['Лес', (g) => g.debugTeleport('forest')],
    ['Босс 1', (g) => g.debugTeleport('boss1')],
    ['Кладбище', (g) => g.debugTeleport('cemetery')],
    ['Босс 2', (g) => g.debugTeleport('boss2')],
  ]],
];

export class DebugPanel {
  private el = document.createElement('div');
  private info: HTMLElement;
  private timer = 0;

  constructor(app: HTMLElement, private game: Game) {
    this.el.id = 'debug';
    this.el.className = 'ui-block hidden';
    this.el.innerHTML = `<div class="dbg-head"><b>🛠 Дебаг</b><span><button data-min title="Свернуть">–</button> <button data-close>✕</button></span></div><pre class="dbg-info"></pre>` +
      SECTIONS.map(([title, actions], si) => `<div class="dbg-sec"><span>${title}</span><div class="dbg-btns">` +
        actions.map(([label, , cls], ai) => `<button class="${cls ?? ''}" data-a="${si}:${ai}">${label}</button>`).join('') +
        '</div></div>').join('');
    app.appendChild(this.el);
    this.info = this.el.querySelector('.dbg-info')!;
    // Keep taps on the panel away from the joystick and the world.
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!b) return;
      sfx.click();
      if (b.dataset.close !== undefined) { this.toggle(false); return; }
      if (b.dataset.min !== undefined) { this.el.classList.toggle('min'); b.textContent = this.el.classList.contains('min') ? '+' : '–'; return; }
      const [si, ai] = b.dataset.a!.split(':').map(Number);
      SECTIONS[si][1][ai][1](this.game);
      this.render();
    });
    addEventListener('keydown', (e) => { if (e.code === 'Backquote') this.toggle(); });
  }

  get isOpen() { return !this.el.classList.contains('hidden'); }

  toggle(on = !this.isOpen) {
    this.el.classList.toggle('hidden', !on);
    clearInterval(this.timer);
    if (on) {
      this.render();
      this.timer = window.setInterval(() => this.render(), 250);
    }
  }

  private render() {
    const d = this.game.debugInfo();
    this.el.querySelector('.god')?.classList.toggle('on', d.god);
    this.info.textContent = [
      `HP ${d.hp}/${d.maxHp}${d.god ? '  [бессмертие]' : ''}`,
      `Крит ${pct(d.crit)} ×${d.critMul.toFixed(2)}  уклон ${pct(d.dodge)}  ${d.speed.toFixed(2)} м/с`,
      `Скейл: герой ×${d.heroScale.toFixed(2)}  враги ×${d.mobScale.toFixed(2)}  FOV ${d.fov}°`,
    ].join('\n');
  }
}
