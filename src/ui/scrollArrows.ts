import { sprite, UI_COLORS, type SpriteName } from "./pixelArt";

export interface ScrollArrowsHandle {
  wrap: HTMLDivElement;
  update: () => void;
  destroy: () => void;
}

type Direction = "up" | "down" | "left" | "right";

const ARROW_CONFIG: Record<Direction, { sprite: SpriteName; label: string }> = {
  up: { sprite: "arrowUp", label: "Scroll up" },
  down: { sprite: "arrowDown", label: "Scroll down" },
  left: { sprite: "arrowLeft", label: "Scroll left" },
  right: { sprite: "arrowRight", label: "Scroll right" },
};

/**
 * Hides the native scrollbar on `container` and overlays pixel-art arrows
 * facing each direction the player can still scroll until they reach the end.
 */
export function attachScrollArrows(
  container: HTMLElement,
  opts: { wrapClass?: string } = {}
): ScrollArrowsHandle {
  const wrap = document.createElement("div");
  wrap.className = opts.wrapClass ? `scroll-wrap ${opts.wrapClass}` : "scroll-wrap";

  const parent = container.parentElement;
  if (parent) {
    parent.insertBefore(wrap, container);
  }
  wrap.appendChild(container);
  container.classList.add("scroll-target");

  const makeBtn = (dir: Direction): HTMLButtonElement => {
    const cfg = ARROW_CONFIG[dir];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `scroll-arrow scroll-arrow-${dir} hidden`;
    btn.setAttribute("aria-label", cfg.label);
    btn.tabIndex = -1;
    btn.innerHTML = sprite(cfg.sprite, { color: UI_COLORS.soldier, scale: 2 });
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const stepY = Math.max(80, Math.round(container.clientHeight * 0.6));
      const stepX = Math.max(80, Math.round(container.clientWidth * 0.6));
      if (dir === "up") container.scrollBy({ top: -stepY, behavior: "smooth" });
      else if (dir === "down") container.scrollBy({ top: stepY, behavior: "smooth" });
      else if (dir === "left") container.scrollBy({ left: -stepX, behavior: "smooth" });
      else container.scrollBy({ left: stepX, behavior: "smooth" });
    });
    wrap.appendChild(btn);
    return btn;
  };

  const upBtn = makeBtn("up");
  const downBtn = makeBtn("down");
  const leftBtn = makeBtn("left");
  const rightBtn = makeBtn("right");

  let raf = 0;

  const update = (): void => {
    const isHidden = container.classList.contains("hidden");
    wrap.classList.toggle("hidden", isHidden);
    if (isHidden) return;

    const style = getComputedStyle(container);
    const canV = style.overflowY === "auto" || style.overflowY === "scroll";
    const canH = style.overflowX === "auto" || style.overflowX === "scroll";

    const maxScrollTop = container.scrollHeight - container.clientHeight;
    const maxScrollLeft = container.scrollWidth - container.clientWidth;

    const showUp = canV && maxScrollTop > 1 && container.scrollTop > 1;
    const showDown = canV && maxScrollTop > 1 && container.scrollTop < maxScrollTop - 1;
    const showLeft = canH && maxScrollLeft > 1 && container.scrollLeft > 1;
    const showRight = canH && maxScrollLeft > 1 && container.scrollLeft < maxScrollLeft - 1;

    upBtn.classList.toggle("hidden", !showUp);
    downBtn.classList.toggle("hidden", !showDown);
    leftBtn.classList.toggle("hidden", !showLeft);
    rightBtn.classList.toggle("hidden", !showRight);
  };

  const scheduleUpdate = (): void => {
    wrap.classList.toggle("hidden", container.classList.contains("hidden"));
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      update();
    });
  };

  container.addEventListener("scroll", update, { passive: true });
  const resizeObserver = new ResizeObserver(scheduleUpdate);
  resizeObserver.observe(container);

  const mutationObserver = new MutationObserver(scheduleUpdate);
  mutationObserver.observe(container, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style"],
  });

  scheduleUpdate();

  return {
    wrap,
    update,
    destroy: () => {
      if (raf) cancelAnimationFrame(raf);
      container.removeEventListener("scroll", update);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    },
  };
}
