import * as THREE from 'three';
import { Character } from './character';
import { Input } from './input';
import { CAMP_EXIT } from './island';
import type { FactionId } from './config';
import type { DialogueLine, UI } from './ui';

/** Where the player's camp is left: a point on the gate line and the unit direction of walking out. */
export interface CampExit { x: number; z: number; dirX: number; dirZ: number }


const TALK_R = 3.6;
const SHOW_R = 12;
const TAP_PX = 56;
const RADIUS = 0.6;

interface NpcDef { name: string; model: [string, string | null]; portrait: string; cry: string; lines: string[] }

/** Texts and look per faction: a human captain and an orc grunt. */
const DEFS: Record<FactionId, NpcDef> = {
  human: {
    name: 'Капитан стражи', model: ['soldier', 'sword_soldier'], portrait: 'shield', cry: 'За Альянс!',
    lines: [
      'Стой, воин! Свет с тобой. Я капитан этого форпоста, и клянусь честью: давно не видел, чтобы кто-то так твёрдо держал клинок.',
      'Слухи о тебе дошли до самой цитадели. Ты прошёл через леса, полные разбойников, и не дрогнул. Вот что значит настоящий герой!',
      'Каждый солдат в лагере говорит о твоей доблести. Пока такие, как ты, стоят на этой земле, Нагорье не падёт.',
      'Иди с гордо поднятой головой. Альянс помнит тех, кто проливает кровь за его знамёна.',
    ],
  },
  orc: {
    name: 'Бывалый грунт', model: ['orc_warrior', 'sword_orc_warrior'], portrait: 'axe', cry: 'За Орду!',
    lines: [
      'Гр-р! Стой, брат. Я Бывалый грунт, и я видел сотни битв. Но такого воина, как ты, давно не встречал.',
      'Ты рубил врагов, как дровосек рубит лес! Весь лагерь воет о твоих победах у костров. Сила в твоих руках, брат.',
      'Слабые прячутся за стенами, а ты идёшь вперёд. Вот это настоящий боец Орды, клянусь кровью предков!',
      'Ступай и разбей их черепа. Пусть враги дрожат, когда слышат твоё имя.',
    ],
  },
};

/** Friendly NPC of the player's faction inside the camp, left of the exit under the banner; talk with E or by tapping it. */
export class CampNpc {
  readonly pos = new THREE.Vector3();
  private ch: Character;
  private def: NpcDef;
  private el: HTMLDivElement;
  private btn: HTMLButtonElement;
  private talking = false;
  private near = false;
  private v = new THREE.Vector3();
  private cam!: THREE.Camera;

  constructor(
    scene: THREE.Scene, labels: HTMLElement, private ui: UI, private input: Input,
    faction: FactionId, exit: CampExit = CAMP_EXIT,
  ) {
    this.def = DEFS[faction];
    // inside the camp under the left gate banner (left of the walking direction: (dirZ, -dirX))
    this.pos.set(exit.x - exit.dirX * 3.8 + exit.dirZ * 3.6, 0, exit.z - exit.dirZ * 3.8 - exit.dirX * 3.6);
    this.ch = new Character(this.def.model[0], this.def.model[1], 1.15 * 1.5);
    this.ch.position.copy(this.pos);
    this.ch.facing = Math.atan2(exit.dirX, exit.dirZ);
    scene.add(this.ch.root);

    this.el = document.createElement('div');
    this.el.className = 'npcui';
    this.el.innerHTML = `<div class="npcname">${this.def.name}</div><button class="btn primary npcbtn">E · Поговорить</button>`;
    this.btn = this.el.querySelector('button')!;
    this.btn.addEventListener('click', (e) => { e.stopPropagation(); this.talk(); });
    labels.appendChild(this.el);
    (labels.parentElement ?? labels).addEventListener('click', this.onTap);
  }

  /** Obstacle for World.obstacles (src/world.ts). */
  get obstacle() { return { x: this.pos.x, z: this.pos.z, r: RADIUS }; }

  /** Call every frame after the camera is placed. */
  update(dt: number, hero: THREE.Vector3, camera: THREE.Camera, w: number, h: number) {
    const dx = hero.x - this.pos.x;
    const dz = hero.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    this.cam = camera;
    this.near = d < TALK_R;
    if (this.near) {
      // turn towards the hero (shortest way)
      const turn = Math.atan2(Math.sin(Math.atan2(dx, dz) - this.ch.facing), Math.cos(Math.atan2(dx, dz) - this.ch.facing));
      this.ch.facing += turn * Math.min(1, dt * 6);
    }
    this.ch.update(dt, false);
    if (this.input.pressed('KeyE') && this.near) this.talk();

    this.el.classList.toggle('show', d < SHOW_R);
    this.btn.style.display = this.near && !this.talking ? '' : 'none';
    if (d >= SHOW_R) return;
    this.v.copy(this.pos).setY(2.5).project(camera);
    this.el.style.transform = `translate(${(this.v.x * 0.5 + 0.5) * w}px, ${(-this.v.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
  }

  private talk() {
    if (this.talking || this.ui.modalOpen) return;
    this.talking = true;
    const who = this.def.name;
    const portrait = this.def.portrait;
    const lines: DialogueLine[] = this.def.lines.map((text) => ({ who, portrait, text }));
    lines[lines.length - 1].choices = [{
      text: 'Мне пора в путь.',
      then: [{ who, portrait, text: this.def.cry }],
    }];
    this.ui.dialogue(lines, this.endTalk);
  }

  private endTalk = () => { this.talking = false; };

  // tap on the NPC itself: screen distance to its chest
  private onTap = (e: MouseEvent) => {
    if (!this.near || this.talking || (e.target as HTMLElement).closest('.ui-block, #modal, button')) return;
    const area = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this.v.copy(this.pos).setY(1.1).project(this.cam);
    const sx = (this.v.x * 0.5 + 0.5) * area.width;
    const sy = (-this.v.y * 0.5 + 0.5) * area.height;
    if (Math.hypot(e.clientX - area.left - sx, e.clientY - area.top - sy) < TAP_PX) this.talk();
  };
}
