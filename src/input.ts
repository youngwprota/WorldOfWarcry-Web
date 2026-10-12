/**
 * Floating virtual stick (Butcher Hero style): touch/click anywhere on the play area,
 * drag to move; the stick base appears under the finger. WASD/arrows on desktop.
 */
export class Input {
  x = 0; // -1..1, screen right
  y = 0; // -1..1, screen down
  private pointerId: number | null = null;
  private ox = 0;
  private oy = 0;
  private keys = new Set<string>();
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  private radius = 60;
  enabled = true;

  constructor(area: HTMLElement) {
    this.base = document.createElement('div');
    this.base.className = 'stick-base';
    this.knob = document.createElement('div');
    this.knob.className = 'stick-knob';
    this.base.appendChild(this.knob);
    area.appendChild(this.base);

    area.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.pointerId !== null) return;
      if ((e.target as HTMLElement).closest('.ui-block, #modal, button')) return;
      this.pointerId = e.pointerId;
      const r = area.getBoundingClientRect();
      this.ox = e.clientX - r.left;
      this.oy = e.clientY - r.top;
      this.radius = Math.max(56, Math.min(r.width, r.height) * 0.16);
      this.base.style.width = this.base.style.height = `${this.radius * 2}px`;
      this.base.style.left = `${this.ox}px`;
      this.base.style.top = `${this.oy}px`;
      this.base.classList.add('on');
      this.knob.style.transform = 'translate(-50%,-50%)';
      area.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    area.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pointerId) return;
      const r = area.getBoundingClientRect();
      let dx = e.clientX - r.left - this.ox;
      let dy = e.clientY - r.top - this.oy;
      const len = Math.hypot(dx, dy);
      // The base stays where the touch started; the knob is clamped to the rim.
      if (len > this.radius) {
        dx *= this.radius / len;
        dy *= this.radius / len;
      }
      const dead = this.radius * 0.12;
      const l2 = Math.hypot(dx, dy);
      if (l2 < dead) { this.x = this.y = 0; } else {
        const m = Math.min(1, (l2 - dead) / (this.radius * 0.5));
        this.x = (dx / l2) * m;
        this.y = (dy / l2) * m;
      }
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      this.x = this.y = 0;
      this.base.classList.remove('on');
    };
    area.addEventListener('pointerup', end);
    area.addEventListener('pointercancel', end);

    addEventListener('keydown', (e) => this.keys.add(e.code));
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  /** Movement vector in screen space, length 0..1. */
  get vector(): [number, number] {
    if (!this.enabled) return [0, 0];
    let kx = 0;
    let ky = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) kx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) kx += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) ky -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) ky += 1;
    if (kx || ky) {
      const l = Math.hypot(kx, ky);
      return [kx / l, ky / l];
    }
    return [this.x, this.y];
  }

  pressed(code: string) {
    if (this.keys.has(code)) { this.keys.delete(code); return true; }
    return false;
  }

  reset() {
    this.pointerId = null;
    this.x = this.y = 0;
    this.keys.clear();
    this.base.classList.remove('on');
  }
}
