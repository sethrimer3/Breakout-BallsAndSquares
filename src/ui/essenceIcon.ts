import { ESSENCE_FPS, ESSENCE_SIZE, essenceFrame, essencePixels, paintPixels } from "../rendering/blightEssence";

const CLASS = "essence-icon";

/** A living Blight Essence icon for inline HTML, on the same pixel grid as `sprite()`. */
export function essenceIcon(scale: 1 | 2 | 3 | 4 = 2): string {
  return `<canvas class="${CLASS}" width="${ESSENCE_SIZE}" height="${ESSENCE_SIZE}" aria-hidden="true" style="--px:var(--px${scale})"></canvas>`;
}

/** Steps every essence icon on the page together, whatever screen they sit on. */
export function startEssenceIcons(): void {
  const master = document.createElement("canvas");
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let shown = -1;
  let last = 0;
  const tick = (now: number): void => {
    requestAnimationFrame(tick);
    if (now - last < 1000 / ESSENCE_FPS) return;
    last = now;
    const frame = essenceFrame(now, motion.matches);
    const moved = frame !== shown;
    if (moved) {
      shown = frame;
      paintPixels(master, essencePixels(frame / ESSENCE_FPS));
    }
    // A still frame still has to reach icons added since the last step.
    document.querySelectorAll<HTMLCanvasElement>(`canvas.${CLASS}`).forEach((icon) => {
      if (!moved && icon.dataset.painted === "1") return;
      icon.dataset.painted = "1";
      const g = icon.getContext("2d");
      if (!g) return;
      g.clearRect(0, 0, icon.width, icon.height);
      g.drawImage(master, 0, 0);
    });
  };
  requestAnimationFrame(tick);
}
