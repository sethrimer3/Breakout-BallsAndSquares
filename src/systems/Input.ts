/** Raw input state + event hooks. Game logic decides what inputs mean. */
export interface InputHandlers {
  onPrimaryClick?(sx: number, sy: number): void;
  onSecondaryClick?(sx: number, sy: number): void;
  onAimStart?(sx: number, sy: number): void;
  onAimMove?(sx: number, sy: number): void;
  onAimRelease?(startSx: number, startSy: number, endSx: number, endSy: number): void;
  onAimClick?(sx: number, sy: number): void;
  onAimCancel?(): void;
  canPlace?(): boolean;
  canShootManual?(): boolean;
  onManualShootStart?(sx: number, sy: number): void;
  onManualShootEnd?(): void;
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
  isMouseDown = false;
  readonly keysDown = new Set<string>();
  private aiming = false;
  private aimStartX = 0;
  private aimStartY = 0;
  private aimCurX = 0;
  private aimCurY = 0;
  private aimDragging = false;
  private panning = false;
  private manualShooting = false;
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
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  isKeyDown(code: string): boolean {
    return this.keysDown.has(code);
  }

  /** Current WASD/arrow key movement vector, normalized. */
  getMovementVector(): { x: number; y: number } {
    let dx = 0;
    let dy = 0;
    if (this.isKeyDown("KeyD") || this.isKeyDown("ArrowRight")) dx += 1;
    if (this.isKeyDown("KeyA") || this.isKeyDown("ArrowLeft")) dx -= 1;
    if (this.isKeyDown("KeyS") || this.isKeyDown("ArrowDown")) dy += 1;
    if (this.isKeyDown("KeyW") || this.isKeyDown("ArrowUp")) dy -= 1;
    const len = Math.hypot(dx, dy);
    if (len > 1e-4) {
      return { x: dx / len, y: dy / len };
    }
    return { x: 0, y: 0 };
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
        if (this.aiming) {
          this.aiming = false;
          this.handlers.onAimCancel?.();
        }
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
    if (e.button === 0) {
      if (this.handlers.canShootManual?.()) {
        this.aiming = false;
        this.panning = false;
        this.manualShooting = true;
        this.isMouseDown = true;
        this.handlers.onManualShootStart?.(this.mouseX, this.mouseY);
      } else if (!e.shiftKey && this.handlers.canPlace?.()) {
        this.aiming = true;
        this.aimStartX = this.mouseX;
        this.aimStartY = this.mouseY;
        this.aimCurX = this.mouseX;
        this.aimCurY = this.mouseY;
        this.aimDragging = false;
        this.panning = false;
        this.handlers.onAimStart?.(this.mouseX, this.mouseY);
      } else {
        this.aiming = false;
        this.panning = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
      }
    } else if (e.button === 1 || e.button === 2) {
      this.aiming = false;
      this.panning = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      e.preventDefault();
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
    if (this.aiming) {
      this.aimCurX = this.mouseX;
      this.aimCurY = this.mouseY;
      const slop = this.downType === "mouse" ? CLICK_SLOP_MOUSE : CLICK_SLOP_TOUCH;
      if (Math.abs(this.aimCurX - this.aimStartX) + Math.abs(this.aimCurY - this.aimStartY) > slop) {
        this.aimDragging = true;
      }
      this.handlers.onAimMove?.(this.aimCurX, this.aimCurY);
    } else if (this.panning) {
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

    if (this.manualShooting) {
      this.manualShooting = false;
      this.isMouseDown = false;
      this.handlers.onManualShootEnd?.();
    } else if (this.aiming) {
      this.aiming = false;
      const endX = this.mouseX;
      const endY = this.mouseY;
      const slop = this.downType === "mouse" ? CLICK_SLOP_MOUSE : CLICK_SLOP_TOUCH;
      const moved = Math.abs(endX - this.aimStartX) + Math.abs(endY - this.aimStartY) > slop;
      if (this.aimDragging || moved) {
        this.handlers.onAimRelease?.(this.aimStartX, this.aimStartY, endX, endY);
      } else {
        this.handlers.onAimClick?.(this.aimStartX, this.aimStartY);
      }
    } else if (e.button === 0) {
      if (this.panning && !this.movedPastSlop(e.clientX, e.clientY)) {
        const rect = this.canvas.getBoundingClientRect();
        this.handlers.onPrimaryClick?.(e.clientX - rect.left, e.clientY - rect.top);
      }
      this.panning = false;
    } else if (e.button === 1 || e.button === 2) {
      if (e.button === 2 && this.panning && !this.movedPastSlop(e.clientX, e.clientY)) {
        const rect = this.canvas.getBoundingClientRect();
        this.handlers.onSecondaryClick?.(e.clientX - rect.left, e.clientY - rect.top);
      }
      this.panning = false;
    }
  };

  /** The browser took the gesture over (system swipe, call, etc.): drop it without a tap. */
  private onCancel = (e: PointerEvent): void => {
    this.touches.delete(e.pointerId);
    if (this.manualShooting) {
      this.manualShooting = false;
      this.isMouseDown = false;
      this.handlers.onManualShootEnd?.();
    }
    if (this.aiming) {
      this.aiming = false;
      this.handlers.onAimCancel?.();
    }
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
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (target?.closest("input, select, textarea, [contenteditable=true]")) {
      if (e.code === "Escape") this.handlers.onKey?.(e.code, e);
      return;
    }
    // Menus use native focus/activation; gameplay keeps Tab camera cycling.
    if ((e.code === "Enter" || e.code === "Space") && target?.closest("button")) return;
    if (e.code === "Tab" && document.querySelector(".main-overlay:not(.hidden)")) return;
    if (e.code === "Tab" || e.code === "Space") e.preventDefault();
    this.keysDown.add(e.code);
    this.handlers.onKey?.(e.code, e);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keysDown.delete(e.code);
  };

  private onBlur = (): void => {
    this.keysDown.clear();
    this.isMouseDown = false;
    if (this.manualShooting) {
      this.manualShooting = false;
      this.handlers.onManualShootEnd?.();
    }
  };
}
