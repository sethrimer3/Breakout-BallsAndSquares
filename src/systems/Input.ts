/** Raw input state + event hooks. Game logic decides what inputs mean. */
export interface InputHandlers {
  onPrimaryClick?(sx: number, sy: number): void;
  onWheel?(sx: number, sy: number, deltaY: number): void;
  /** Continuous zoom about a canvas point (two-finger pinch). */
  onPinch?(sx: number, sy: number, factor: number): void;
  onPan?(dx: number, dy: number): void;
  onKey?(code: string, e: KeyboardEvent): void;
}

/** Movement (Manhattan px) below which a press still counts as a click/tap. */
const CLICK_SLOP_MOUSE = 4;
/** Fingers wobble more than a mouse, so taps get a little more room. */
const CLICK_SLOP_TOUCH = 12;

interface TrackedPointer {
  x: number;
  y: number;
}

export class Input {
  mouseX = 0;
  mouseY = 0;
  /** True while the aim preview should follow the pointer (hovering mouse, or a finger held still). */
  mouseInside = false;
  private panning = false;
  private lastX = 0;
  private lastY = 0;
  private downX = 0;
  private downY = 0;
  private downType = "mouse";
  /** Active touch/pen contacts on the canvas, for pinch zoom. */
  private touches = new Map<number, TrackedPointer>();
  private pinchDist = 0;
  private pinchMidX = 0;
  private pinchMidY = 0;
  /** Set once a second finger lands; no tap fires until every finger lifts. */
  private multiTouch = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private handlers: InputHandlers,
  ) {
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onCancel);
    canvas.addEventListener("pointerenter", (e) => {
      if (e.pointerType === "mouse") this.mouseInside = true;
    });
    canvas.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "mouse") this.mouseInside = false;
    });
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("keydown", this.onKeyDown);
  }

  private isTouchLike(e: PointerEvent): boolean {
    return e.pointerType === "touch" || e.pointerType === "pen";
  }

  private onDown = (e: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.mouseX = e.clientX - rect.left;
    this.mouseY = e.clientY - rect.top;

    if (this.isTouchLike(e)) {
      e.preventDefault();
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size >= 2) {
        // Second finger: switch from pan/tap to pinch.
        this.multiTouch = true;
        this.panning = false;
        this.mouseInside = false;
        this.startPinch();
        return;
      }
      this.mouseInside = true;
    }

    this.downType = e.pointerType;
    this.downX = e.clientX;
    this.downY = e.clientY;
    if (e.button === 0 || e.button === 1 || e.button === 2) {
      this.panning = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      if (e.button !== 0) e.preventDefault();
    }
  };

  private startPinch(): void {
    const [a, b] = [...this.touches.values()];
    this.pinchDist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    this.pinchMidX = (a.x + b.x) / 2;
    this.pinchMidY = (a.y + b.y) / 2;
  }

  private onMove = (e: PointerEvent): void => {
    const tracked = this.touches.get(e.pointerId);
    if (tracked) {
      tracked.x = e.clientX;
      tracked.y = e.clientY;
      if (this.touches.size >= 2) {
        this.updatePinch();
        return;
      }
    } else if (this.isTouchLike(e)) {
      // A finger moving that didn't start on the canvas (e.g. over the HUD).
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    this.mouseX = e.clientX - rect.left;
    this.mouseY = e.clientY - rect.top;
    if (this.panning) {
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      if (this.movedPastSlop(e.clientX, e.clientY)) {
        // A dragging finger is panning, not aiming.
        if (tracked) this.mouseInside = false;
        this.handlers.onPan?.(dx, dy);
      }
    }
  };

  private updatePinch(): void {
    const [a, b] = [...this.touches.values()];
    const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const rect = this.canvas.getBoundingClientRect();
    this.handlers.onPan?.(midX - this.pinchMidX, midY - this.pinchMidY);
    this.handlers.onPinch?.(midX - rect.left, midY - rect.top, dist / this.pinchDist);
    this.pinchDist = dist;
    this.pinchMidX = midX;
    this.pinchMidY = midY;
  }

  private movedPastSlop(x: number, y: number): boolean {
    const slop = this.downType === "mouse" ? CLICK_SLOP_MOUSE : CLICK_SLOP_TOUCH;
    return Math.abs(x - this.downX) + Math.abs(y - this.downY) > slop;
  }

  private onUp = (e: PointerEvent): void => {
    if (this.touches.has(e.pointerId)) {
      this.touches.delete(e.pointerId);
      if (this.multiTouch) {
        if (this.touches.size === 0) {
          this.multiTouch = false;
          this.panning = false;
        } else if (this.touches.size === 1) {
          // One finger left after a pinch: keep panning with it, but no tap.
          const [rest] = [...this.touches.values()];
          this.panning = true;
          this.lastX = rest.x;
          this.lastY = rest.y;
        } else {
          this.startPinch();
        }
        this.mouseInside = false;
        return;
      }
      this.mouseInside = false;
    } else if (this.isTouchLike(e)) {
      return;
    }

    if (e.button === 0) {
      if (this.panning && !this.movedPastSlop(e.clientX, e.clientY)) {
        const rect = this.canvas.getBoundingClientRect();
        this.handlers.onPrimaryClick?.(e.clientX - rect.left, e.clientY - rect.top);
      }
      this.panning = false;
    } else if (e.button === 1 || e.button === 2) {
      this.panning = false;
    }
  };

  /** The browser took the gesture over (system swipe, call, etc.): drop it without a tap. */
  private onCancel = (e: PointerEvent): void => {
    this.touches.delete(e.pointerId);
    if (this.touches.size === 0) {
      this.multiTouch = false;
      this.panning = false;
      this.mouseInside = false;
    } else if (this.touches.size >= 2) {
      this.startPinch();
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.handlers.onWheel?.(e.offsetX, e.offsetY, e.deltaY);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === "Tab" || e.code === "Space") e.preventDefault();
    this.handlers.onKey?.(e.code, e);
  };
}
