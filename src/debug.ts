// Debug panel. Floating, does not pause the game, so fights can be watched live. Open: ` (Backquote) or ⚙ → «Дебаг-меню».
import { sfx } from './audio';
import type { Game } from './game';

type Action = [label: string, run: (g: Game) => void, cls?: string];

const SECTIONS: [string, Action[]][] = [
  ['Бой', [
    ['HP 10%', (g) => g.debugSetHp(0.1)],
    ['HP 40%', (g) => g.debugSetHp(0.4)],
    ['HP 100%', (g) => g.debugSetHp(1)],
    ['Бессмертие', (g) => { g.god = !g.god; }, 'god'],
    ['Убить рядом', (g) => g.debugKillNearby(), 'wide'],
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
      `Скейл: герой ×${d.heroScale.toFixed(2)}  враги ×${d.mobScale.toFixed(2)}  FOV ${d.fov}°`,
    ].join('\n');
  }
}
