import type { Game } from "../Game";

export interface StickVector {
  x: number;
  y: number;
  active: boolean;
}

export interface AimVector extends StickVector {
  angle: number;
}

/**
 * Mobile touch dual-stick control:
 * - Left stick: WASD movement vector
 * - Right stick: 360° aim vector & continuous fire trigger
 */
export class DualStick {
  readonly root: HTMLDivElement;
  private leftBase: HTMLDivElement;
  private leftKnob: HTMLDivElement;
  private rightBase: HTMLDivElement;
  private rightKnob: HTMLDivElement;

  private leftTouchId: number | null = null;
  private rightTouchId: number | null = null;

  private leftCenter = { x: 0, y: 0 };
  private rightCenter = { x: 0, y: 0 };

  readonly move: StickVector = { x: 0, y: 0, active: false };
  readonly aim: AimVector = { x: 0, y: 0, angle: 0, active: false };

  private readonly maxRadius = 42;

  constructor(parent: HTMLElement, private game: Game) {
    this.root = document.createElement("div");
    this.root.className = "dual-sticks hidden";

    this.root.innerHTML = `
      <div class="joystick left-stick" data-stick="left">
        <div class="joystick-base">
          <div class="joystick-knob"></div>
          <span class="joystick-label">MOVE</span>
        </div>
      </div>
      <div class="joystick right-stick" data-stick="right">
        <div class="joystick-base">
          <div class="joystick-knob"></div>
          <span class="joystick-label">AIM/FIRE</span>
        </div>
      </div>
    `;

    this.leftBase = this.root.querySelector(".left-stick .joystick-base") as HTMLDivElement;
    this.leftKnob = this.root.querySelector(".left-stick .joystick-knob") as HTMLDivElement;
    this.rightBase = this.root.querySelector(".right-stick .joystick-base") as HTMLDivElement;
    this.rightKnob = this.root.querySelector(".right-stick .joystick-knob") as HTMLDivElement;

    this.bindEvents();
    parent.append(this.root);
  }

  /**
   * True only when touch is the primary input (phones, tablets). Desktops and
   * touchscreen laptops report a fine, hovering primary pointer and use WASD +
   * mouse instead, so they never see the sticks.
   */
  private isTouchDevice(): boolean {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  }

  private bindEvents(): void {
    const onPointerDown = (e: PointerEvent): void => {
      if (this.game.autoMove) return;
      const target = e.target as HTMLElement;
      const stickEl = target.closest(".joystick") as HTMLElement | null;
      if (!stickEl) return;

      const stickType = stickEl.dataset.stick;
      if (stickType === "left" && this.leftTouchId === null) {
        this.leftTouchId = e.pointerId;
        const rect = this.leftBase.getBoundingClientRect();
        this.leftCenter = {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
        this.handleMove(e.clientX, e.clientY);
        try {
          stickEl.setPointerCapture(e.pointerId);
        } catch {}
      } else if (stickType === "right" && this.rightTouchId === null) {
        this.rightTouchId = e.pointerId;
        const rect = this.rightBase.getBoundingClientRect();
        this.rightCenter = {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
        this.handleAim(e.clientX, e.clientY);
        try {
          stickEl.setPointerCapture(e.pointerId);
        } catch {}
      }
    };

    const onPointerMove = (e: PointerEvent): void => {
      if (e.pointerId === this.leftTouchId) {
        this.handleMove(e.clientX, e.clientY);
      } else if (e.pointerId === this.rightTouchId) {
        this.handleAim(e.clientX, e.clientY);
      }
    };

    const onPointerUp = (e: PointerEvent): void => {
      if (e.pointerId === this.leftTouchId) {
        this.leftTouchId = null;
        this.move.x = 0;
        this.move.y = 0;
        this.move.active = false;
        this.leftKnob.style.transform = `translate(0px, 0px)`;
      } else if (e.pointerId === this.rightTouchId) {
        this.rightTouchId = null;
        this.aim.x = 0;
        this.aim.y = 0;
        this.aim.active = false;
        this.rightKnob.style.transform = `translate(0px, 0px)`;
      }
    };

    this.root.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  }

  private handleMove(clientX: number, clientY: number): void {
    const dx = clientX - this.leftCenter.x;
    const dy = clientY - this.leftCenter.y;
    const dist = Math.hypot(dx, dy);
    const clampedDist = Math.min(dist, this.maxRadius);
    const angle = Math.atan2(dy, dx);

    const kx = Math.cos(angle) * clampedDist;
    const ky = Math.sin(angle) * clampedDist;
    this.leftKnob.style.transform = `translate(${kx}px, ${ky}px)`;

    if (dist > 6) {
      this.move.x = Math.cos(angle);
      this.move.y = Math.sin(angle);
      this.move.active = true;
    } else {
      this.move.x = 0;
      this.move.y = 0;
      this.move.active = false;
    }
  }

  private handleAim(clientX: number, clientY: number): void {
    const dx = clientX - this.rightCenter.x;
    const dy = clientY - this.rightCenter.y;
    const dist = Math.hypot(dx, dy);
    const clampedDist = Math.min(dist, this.maxRadius);
    const angle = Math.atan2(dy, dx);

    const kx = Math.cos(angle) * clampedDist;
    const ky = Math.sin(angle) * clampedDist;
    this.rightKnob.style.transform = `translate(${kx}px, ${ky}px)`;

    if (dist > 6) {
      this.aim.x = Math.cos(angle);
      this.aim.y = Math.sin(angle);
      this.aim.angle = angle;
      this.aim.active = true;
    } else {
      this.aim.x = 0;
      this.aim.y = 0;
      this.aim.active = false;
    }
  }

  update(): void {
    const shouldShow =
      !this.game.autoMove &&
      !this.game.paused &&
      !this.game.runOver &&
      this.isTouchDevice();
    this.root.classList.toggle("hidden", !shouldShow);
  }

  reset(): void {
    this.leftTouchId = null;
    this.rightTouchId = null;
    this.move.x = 0;
    this.move.y = 0;
    this.move.active = false;
    this.aim.x = 0;
    this.aim.y = 0;
    this.aim.active = false;
    this.leftKnob.style.transform = `translate(0px, 0px)`;
    this.rightKnob.style.transform = `translate(0px, 0px)`;
  }
}
