/**
 * Drag-to-scroll for every scrollable UI area, with a finger or the mouse: the page disables native touch
 * scrolling (`touch-action: none` on body, for the joystick), so lists scroll by dragging their content.
 * A drag past THRESHOLD px swallows the click that would follow, so dragging over an item does not open it.
 */
const THRESHOLD = 6;

export class DragScroll {
  private el: HTMLElement | null = null;
  private id = -1;
  private x = 0;
  private y = 0;
  private dragging = false;

  constructor(root: HTMLElement) {
    root.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    root.addEventListener('click', this.onClick, true);
  }

  /** Nearest ancestor that can actually scroll; canvases (3D preview, map) keep their own drag. */
  private scroller(t: HTMLElement | null) {
    for (let e = t; e && e !== document.body; e = e.parentElement) {
      if (e instanceof HTMLCanvasElement || e.tagName === 'INPUT') return null;
      const s = getComputedStyle(e);
      const sx = (s.overflowX === 'auto' || s.overflowX === 'scroll') && e.scrollWidth > e.clientWidth;
      const sy = (s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight;
      if (sx || sy) return e;
    }
    return null;
  }

  private onDown = (e: PointerEvent) => {
    this.dragging = false;
    if (e.button !== 0) return;
    this.el = this.scroller(e.target as HTMLElement);
    if (!this.el) return;
    this.id = e.pointerId;
    this.x = e.clientX;
    this.y = e.clientY;
  };

  private onMove = (e: PointerEvent) => {
    if (!this.el || e.pointerId !== this.id) return;
    const dx = e.clientX - this.x;
    const dy = e.clientY - this.y;
    if (!this.dragging && Math.hypot(dx, dy) < THRESHOLD) return;
    this.dragging = true;
    this.el.scrollLeft -= dx;
    this.el.scrollTop -= dy;
    this.x = e.clientX;
    this.y = e.clientY;
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerId !== this.id) return;
    this.el = null;
    this.id = -1;
  };

  private onClick = (e: MouseEvent) => {
    if (!this.dragging) return;
    this.dragging = false;
    e.stopPropagation();
    e.preventDefault();
  };
}
