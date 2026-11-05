/** Raw input state + event hooks. Game logic decides what inputs mean. */
export interface InputHandlers {
  onPrimaryClick?(sx: number, sy: number): void;
  onWheel?(sx: number, sy: number, deltaY: number): void;
  onPan?(dx: number, dy: number): void;
  onKey?(code: string, e: KeyboardEvent): void;
}

export class Input {
  mouseX = 0;
  mouseY = 0;
  mouseInside = false;
  private panning = false;
  private lastX = 0;
  private lastY = 0;
  private downX = 0;
  private downY = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private handlers: InputHandlers,
  ) {
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointerenter", () => (this.mouseInside = true));
    canvas.addEventListener("pointerleave", () => (this.mouseInside = false));
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("keydown", this.onKeyDown);
  }

  private onDown = (e: PointerEvent): void => {
    this.mouseX = e.offsetX;
    this.mouseY = e.offsetY;
    this.downX = e.clientX;
    this.downY = e.clientY;
    if (e.button === 0 || e.button === 1 || e.button === 2) {
      this.panning = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      if (e.button !== 0) e.preventDefault();
    }
  };

  private onMove = (e: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.mouseX = e.clientX - rect.left;
    this.mouseY = e.clientY - rect.top;
    if (this.panning) {
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      if (Math.abs(e.clientX - this.downX) + Math.abs(e.clientY - this.downY) > 4) {
        this.handlers.onPan?.(dx, dy);
      }
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (e.button === 0) {
      const dist = Math.abs(e.clientX - this.downX) + Math.abs(e.clientY - this.downY);
      if (dist <= 4) {
        const rect = this.canvas.getBoundingClientRect();
        this.handlers.onPrimaryClick?.(e.clientX - rect.left, e.clientY - rect.top);
      }
      this.panning = false;
    } else if (e.button === 1 || e.button === 2) {
      this.panning = false;
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
