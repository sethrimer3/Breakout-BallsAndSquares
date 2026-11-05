import type { Game } from "../Game";
import type { LightQuality } from "../systems/LightingSystem";

/**
 * Developer / playtest instrumentation panel (toggled with backtick `).
 * Displays live telemetry and provides quick balancing/stress controls in DEV or `?debug`.
 */
export class DebugOverlay {
  readonly root: HTMLDivElement;
  private textEl: HTMLPreElement;

  constructor(parent: HTMLElement, private game: Game) {
    this.root = document.createElement("div");
    this.root.className = "debug-panel hidden";
    this.root.innerHTML = `
      <pre class="debug-text"></pre>
      <div class="debug-controls">
        <button data-act="ts1">1×</button>
        <button data-act="ts4">4×</button>
        <button data-act="bank">+1k GOLD</button>
        <button data-act="qual">Light Q</button>
        <button data-act="chunks">Chunks</button>
        <button data-act="copy">Copy Log</button>
      </div>
    `;
    this.textEl = this.root.querySelector(".debug-text") as HTMLPreElement;

    this.root.querySelector('[data-act="ts1"]')!.addEventListener("click", () => (game.timeScale = 1));
    this.root.querySelector('[data-act="ts4"]')!.addEventListener("click", () => (game.timeScale = 4));
    this.root.querySelector('[data-act="bank"]')!.addEventListener("click", () => {
      game.save.data.bank += 1000;
      game.save.data.lifetimePixels = Math.max(game.save.data.lifetimePixels, 150);
      game.save.save();
      game.hud.update(game, performance.now(), true);
    });
    this.root.querySelector('[data-act="qual"]')!.addEventListener("click", () => {
      const order: LightQuality[] = ["high", "medium", "low"];
      const idx = order.indexOf(game.lighting.quality);
      game.lighting.quality = order[(idx + 1) % order.length];
    });
    this.root.querySelector('[data-act="chunks"]')!.addEventListener("click", () => {
      game.showChunkBorders = !game.showChunkBorders;
    });
    this.root.querySelector('[data-act="copy"]')!.addEventListener("click", () => {
      const log = game.exportTelemetryJson();
      navigator.clipboard?.writeText(log).catch(() => {});
    });

    parent.append(this.root);
  }

  update(): void {
    const g = this.game;
    if (!g.debug) {
      this.root.classList.add("hidden");
      return;
    }
    this.root.classList.remove("hidden");
    const d = g.debugInfo;
    const lt = g.lighting;
    const near = g.growth.nearSoldierPercent(g.runStats.time);
    this.textEl.textContent =
      `FPS ${d.fps.toFixed(0)}  frame ${d.frameMs.toFixed(1)}ms  sim ${d.simMs.toFixed(2)}ms  light ${d.lightMs.toFixed(2)}ms (${lt.quality})  speed ${g.timeScale}×\n` +
      `lights ${lt.lastShadowLights}/${g.flashes.length}  rays ${lt.lastRaysCast}  ` +
      `frontier ${g.growth.frontier.size}  near-soldier ${near.toFixed(0)}%\n` +
      `bullets ${g.combat.bullets.activeCount}  particles ${g.particles.count}  casings ${g.casings.count}  loot ${g.loot.count}\n` +
      `chunks rebuilt ${g.terrain.rebuiltLastFrame}  pending ${g.terrain.chunks.pending}  ` +
      `reloc ${g.physics.stats.relocations}  stuck ${g.physics.stats.stuckEvents}`;
  }
}
