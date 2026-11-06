interface SporeParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alpha: number;
  maxLife: number;
  life: number;
  size: number;
}

interface Generator {
  id: number;
  cx: number;
  cy: number;
  name: string;
  pulseOffset: number;
  subAcc: number;
}

const CELL_VOID = 0;
const CELL_WALL = 1;
const CELL_FLOOR = 2;
const CELL_GUIDELINE = 3;
const CELL_DOOR_LED = 4;

export class MainMenuBackground {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private animId: number | null = null;
  private lastTime = 0;
  private running = false;

  // Grid dimensions
  private readonly gw = 68;
  private readonly gh = 38;
  private readonly cellSize = 8;
  private readonly subScale = 2; // 2x2 subcells per cell
  private readonly sw: number;
  private readonly sh: number;

  // Grid layers (typed arrays for speed)
  private cellType: Uint8Array;
  private subBlight: Uint8Array; // 0 = empty, 1 = tip, 2 = young, 3 = mature, 4 = core
  private subDist: Float32Array; // distance to origin generator
  private subGenId: Uint8Array; // 1, 2, 3

  private generators: Generator[] = [
    { id: 1, cx: 7, cy: 19, name: "ALPHA CONTAINMENT", pulseOffset: 0, subAcc: 0 },
    { id: 2, cx: 56, cy: 8, name: "BETA ACCESS HUB", pulseOffset: 1.4, subAcc: 0 },
    { id: 3, cx: 34, cy: 29, name: "GAMMA VAULT", pulseOffset: 2.8, subAcc: 0 },
  ];

  private spores: SporeParticle[] = [];
  private totalFloorSubcells = 0;
  private filledFloorSubcells = 0;

  // Sterilization sweep cycle
  private purgeActive = false;
  private purgeProgress = 0; // 0..1
  private purgeAlpha = 0;
  private simTime = 0;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "main-bg-canvas";
    this.ctx = this.canvas.getContext("2d", { alpha: false })!;

    this.sw = this.gw * this.subScale;
    this.sh = this.gh * this.subScale;

    this.cellType = new Uint8Array(this.gw * this.gh);
    this.subBlight = new Uint8Array(this.sw * this.sh);
    this.subDist = new Float32Array(this.sw * this.sh);
    this.subGenId = new Uint8Array(this.sw * this.sh);

    this.buildHallways();
    this.seedGenerators();

    this.canvas.width = this.gw * this.cellSize;
    this.canvas.height = this.gh * this.cellSize;

    // Click canvas to trigger a spore pulse / interactive wave
    this.canvas.addEventListener("click", (e) => {
      this.handleClick(e);
    });
  }

  private buildHallways(): void {
    this.cellType.fill(CELL_VOID);

    // Carve corridor rect helper
    const carve = (x0: number, y0: number, x1: number, y1: number, hasGuide = false) => {
      const midY = Math.floor((y0 + y1) / 2);
      const midX = Math.floor((x0 + x1) / 2);
      const isHoriz = x1 - x0 >= y1 - y0;

      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (x >= 0 && x < this.gw && y >= 0 && y < this.gh) {
            const isGuide = hasGuide && (isHoriz ? y === midY : x === midX);
            this.cellType[y * this.gw + x] = isGuide ? CELL_GUIDELINE : CELL_FLOOR;
          }
        }
      }
    };

    // 1. Long horizontal central corridor
    carve(4, 17, 63, 21, true);

    // 2. Upper horizontal corridor
    carve(8, 7, 59, 9, true);

    // 3. Lower horizontal corridor
    carve(8, 28, 59, 30, true);

    // 4. Vertical corridor branches
    carve(11, 7, 13, 30, true);
    carve(27, 7, 29, 21, true);
    carve(41, 17, 43, 30, true);
    carve(55, 7, 57, 30, true);

    // 5. Generator alcoves / containment chambers
    carve(5, 16, 10, 22, false); // West hub (Gen 1)
    carve(53, 6, 59, 11, false); // North-East vault (Gen 2)
    carve(31, 26, 37, 32, false); // South-Central airlock (Gen 3)

    // Build surrounding wall bulkheads around all floor cells
    for (let y = 0; y < this.gh; y++) {
      for (let x = 0; x < this.gw; x++) {
        const i = y * this.gw + x;
        if (this.cellType[i] === CELL_FLOOR || this.cellType[i] === CELL_GUIDELINE) {
          // Check neighbors
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx >= 0 && nx < this.gw && ny >= 0 && ny < this.gh) {
                const ni = ny * this.gw + nx;
                if (this.cellType[ni] === CELL_VOID) {
                  this.cellType[ni] = CELL_WALL;
                }
              }
            }
          }
        }
      }
    }

    // Place LED status dots along wall frames at hallway junctions
    const ledSpots = [
      { x: 10, y: 7 },
      { x: 14, y: 7 },
      { x: 10, y: 17 },
      { x: 14, y: 17 },
      { x: 26, y: 17 },
      { x: 30, y: 17 },
      { x: 40, y: 21 },
      { x: 44, y: 21 },
      { x: 54, y: 7 },
      { x: 58, y: 7 },
      { x: 54, y: 17 },
      { x: 58, y: 17 },
      { x: 10, y: 30 },
      { x: 14, y: 30 },
      { x: 54, y: 30 },
      { x: 58, y: 30 },
    ];
    for (const p of ledSpots) {
      if (this.cellType[p.y * this.gw + p.x] === CELL_WALL) {
        this.cellType[p.y * this.gw + p.x] = CELL_DOOR_LED;
      }
    }

    // Count open floor subcells
    this.totalFloorSubcells = 0;
    for (let sy = 0; sy < this.sh; sy++) {
      for (let sx = 0; sx < this.sw; sx++) {
        const cx = Math.floor(sx / this.subScale);
        const cy = Math.floor(sy / this.subScale);
        const ct = this.cellType[cy * this.gw + cx];
        if (ct === CELL_FLOOR || ct === CELL_GUIDELINE) {
          this.totalFloorSubcells++;
        }
      }
    }
  }

  private seedGenerators(): void {
    this.subBlight.fill(0);
    this.subDist.fill(999);
    this.subGenId.fill(0);
    this.filledFloorSubcells = 0;

    for (const gen of this.generators) {
      const gsx = gen.cx * this.subScale + Math.floor(this.subScale / 2);
      const gsy = gen.cy * this.subScale + Math.floor(this.subScale / 2);
      const rad = 3;

      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          const d = Math.hypot(dx, dy);
          if (d <= rad) {
            const sx = gsx + dx;
            const sy = gsy + dy;
            if (this.isSubInBounds(sx, sy)) {
              const si = sy * this.sw + sx;
              this.subBlight[si] = d < 1.5 ? 4 : 3;
              this.subDist[si] = d;
              this.subGenId[si] = gen.id;
              this.filledFloorSubcells++;
            }
          }
        }
      }
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    const frame = (t: number) => {
      if (!this.running) return;
      const dt = Math.min((t - this.lastTime) / 1000, 0.1);
      this.lastTime = t;
      this.update(dt);
      this.render();
      this.animId = requestAnimationFrame(frame);
    };
    this.animId = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    if (this.animId !== null) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
  }

  purge(): void {
    if (this.purgeActive) return;
    this.purgeActive = true;
    this.purgeProgress = 0;
  }

  private handleClick(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;

    // Spawn interactive spore burst
    for (let i = 0; i < 18; i++) {
      const angle = (Math.PI * 2 * i) / 18 + Math.random() * 0.3;
      const spd = 20 + Math.random() * 45;
      this.spores.push({
        x: px,
        y: py,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        alpha: 1,
        maxLife: 0.8 + Math.random() * 0.7,
        life: 0,
        size: Math.random() > 0.5 ? 2 : 1,
      });
    }
  }

  private update(dt: number): void {
    this.simTime += dt;

    // Handle sterilization purge sequence
    if (this.purgeActive) {
      this.purgeProgress += dt * 0.9;
      this.purgeAlpha = Math.sin(Math.min(this.purgeProgress, 1) * Math.PI);

      if (this.purgeProgress >= 1.0) {
        this.purgeActive = false;
        this.seedGenerators();
      }
      return;
    }

    // Auto-trigger containment sweep when ~82% of empty hallways are filled
    const coverage = this.totalFloorSubcells > 0 ? this.filledFloorSubcells / this.totalFloorSubcells : 0;
    if (coverage >= 0.82) {
      this.purge();
      return;
    }

    // Tick Blight Generators growth
    // Each generator banks subcells per second and expands into adjacent hallway subcells
    const subRate = 42; // subcells grown per generator per second
    for (const gen of this.generators) {
      gen.subAcc += subRate * dt;
      const toGrow = Math.floor(gen.subAcc);
      if (toGrow > 0) {
        gen.subAcc -= toGrow;
        this.growBlightForGenerator(gen, toGrow);
      }

      // Spore production
      if (Math.random() < dt * 6) {
        const angle = Math.random() * Math.PI * 2;
        const spd = 8 + Math.random() * 16;
        const gx = (gen.cx + 0.5) * this.cellSize;
        const gy = (gen.cy + 0.5) * this.cellSize;
        this.spores.push({
          x: gx + Math.cos(angle) * 8,
          y: gy + Math.sin(angle) * 8,
          vx: Math.cos(angle) * spd,
          vy: Math.sin(angle) * spd * 0.5,
          alpha: 0.9,
          maxLife: 2.5 + Math.random() * 2,
          life: 0,
          size: Math.random() > 0.6 ? 2 : 1,
        });
      }
    }

    // Update spore particles
    for (let i = this.spores.length - 1; i >= 0; i--) {
      const p = this.spores[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.spores.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += Math.sin(this.simTime * 2 + i) * 1.5 * dt;
      p.alpha = 1 - p.life / p.maxLife;
    }
  }

  private growBlightForGenerator(gen: Generator, count: number): void {
    // Frontier candidate list
    const candidates: number[] = [];

    // Search existing perimeter of this generator's blight
    // Sample with pseudo-random stride to crawl organic tendrils
    const stride = 1 + Math.floor(Math.random() * 3);
    const totalSubs = this.sw * this.sh;

    for (let si = 0; si < totalSubs; si += stride) {
      if (this.subGenId[si] === gen.id && this.subBlight[si] > 0) {
        const sx = si % this.sw;
        const sy = Math.floor(si / this.sw);

        // Check 4 cardinal neighbors
        const nbs = [
          { x: sx + 1, y: sy },
          { x: sx - 1, y: sy },
          { x: sx, y: sy + 1 },
          { x: sx, y: sy - 1 },
        ];

        for (const nb of nbs) {
          if (this.isSubInBounds(nb.x, nb.y)) {
            const nsi = nb.y * this.sw + nb.x;
            if (this.subBlight[nsi] === 0) {
              const cx = Math.floor(nb.x / this.subScale);
              const cy = Math.floor(nb.y / this.subScale);
              const ct = this.cellType[cy * this.gw + cx];
              if (ct === CELL_FLOOR || ct === CELL_GUIDELINE) {
                candidates.push(nsi);
              }
            }
          }
        }
      }
    }

    if (candidates.length === 0) return;

    // Pick candidates with branching tendril bias
    const actualGrow = Math.min(count, candidates.length);
    for (let i = 0; i < actualGrow; i++) {
      const pickIdx = Math.floor(Math.random() * candidates.length);
      const chosen = candidates[pickIdx];
      candidates[pickIdx] = candidates[candidates.length - 1];
      candidates.pop();

      if (this.subBlight[chosen] === 0) {
        const sx = chosen % this.sw;
        const sy = Math.floor(chosen / this.sw);
        const gsx = gen.cx * this.subScale + Math.floor(this.subScale / 2);
        const gsy = gen.cy * this.subScale + Math.floor(this.subScale / 2);
        const dist = Math.hypot(sx - gsx, sy - gsy);

        this.subBlight[chosen] = 1; // tip
        this.subDist[chosen] = dist;
        this.subGenId[chosen] = gen.id;
        this.filledFloorSubcells++;

        // Consolidate interior cells to mature over time
        for (const dy of [-1, 1]) {
          for (const dx of [-1, 1]) {
            const nx = sx + dx;
            const ny = sy + dy;
            if (this.isSubInBounds(nx, ny)) {
              const ni = ny * this.sw + nx;
              if (this.subBlight[ni] === 1 && Math.random() < 0.4) {
                this.subBlight[ni] = 2; // young body
              } else if (this.subBlight[ni] === 2 && Math.random() < 0.25) {
                this.subBlight[ni] = 3; // mature
              }
            }
          }
        }
      }
    }
  }

  private isSubInBounds(sx: number, sy: number): boolean {
    return sx >= 0 && sx < this.sw && sy >= 0 && sy < this.sh;
  }

  render(): void {
    const ctx = this.ctx;
    const cs = this.cellSize;
    const subPx = cs / this.subScale;
    const t = this.simTime;

    // 1. Clear background void
    ctx.fillStyle = "#05070d";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // 2. Draw hallway floors and bulkheads
    for (let cy = 0; cy < this.gh; cy++) {
      for (let cx = 0; cx < this.gw; cx++) {
        const ct = this.cellType[cy * this.gw + cx];
        if (ct === CELL_VOID) continue;

        const px = cx * cs;
        const py = cy * cs;

        if (ct === CELL_WALL) {
          // Wall bulkhead tile
          ctx.fillStyle = "#101a28";
          ctx.fillRect(px, py, cs, cs);
          ctx.fillStyle = "#1c2a3e";
          ctx.fillRect(px + 1, py + 1, cs - 2, cs - 2);
          ctx.fillStyle = "#273b54";
          ctx.fillRect(px + 1, py + 1, cs - 2, 1);
        } else if (ct === CELL_FLOOR || ct === CELL_GUIDELINE) {
          // Sterile steel hallway floor
          const isCheck = (cx + cy) % 2 === 0;
          ctx.fillStyle = isCheck ? "#0b1522" : "#0f1c2d";
          ctx.fillRect(px, py, cs, cs);

          // Floor seam lines
          ctx.fillStyle = "#142438";
          ctx.fillRect(px + cs - 1, py, 1, cs);
          ctx.fillRect(px, py + cs - 1, cs, 1);

          // Center guideline
          if (ct === CELL_GUIDELINE) {
            ctx.fillStyle = "#194d63";
            ctx.fillRect(px + 3, py + 3, 2, 2);
          }
        } else if (ct === CELL_DOOR_LED) {
          // Wall bulkhead with pulsing door LED
          ctx.fillStyle = "#101a28";
          ctx.fillRect(px, py, cs, cs);
          const ledPulse = Math.sin(t * 2.5 + cx + cy) * 0.3 + 0.7;
          ctx.fillStyle = `rgba(92, 242, 199, ${ledPulse.toFixed(2)})`;
          ctx.fillRect(px + 3, py + 3, 2, 2);
        }
      }
    }

    // 3. Render creeping Blight subcells
    // Using color palette stops from COLORS.pinkBlight:
    // [175, 24, 96] (deep magenta), [215, 38, 122] (vivid pink), [245, 68, 152] (hot pink), [255, 118, 188] (highlight)
    const baseColors = [
      "",
      "rgb(255, 118, 188)", // 1: tip highlight
      "rgb(245, 68, 152)", // 2: young hot pink
      "rgb(215, 38, 122)", // 3: vivid mature pink
      "rgb(175, 24, 96)", // 4: deep core magenta
    ];

    for (let sy = 0; sy < this.sh; sy++) {
      for (let sx = 0; sx < this.sw; sx++) {
        const si = sy * this.sw + sx;
        const b = this.subBlight[si];
        if (b === 0) continue;

        const spx = sx * subPx;
        const spy = sy * subPx;

        // Vein pulse wave traveling along the blight tendrils
        const dist = this.subDist[si];
        const veinWave = Math.sin(t * 4.5 - dist * 0.45);

        if (veinWave > 0.75 && b >= 2) {
          ctx.fillStyle = "#ffb0db"; // glowing vein highlight
        } else {
          ctx.fillStyle = baseColors[b];
        }

        ctx.fillRect(spx, spy, subPx, subPx);

        // Core / dense texture details
        if (b >= 3) {
          ctx.fillStyle = "rgba(100, 10, 50, 0.35)";
          ctx.fillRect(spx + 1, spy + 1, subPx - 2, subPx - 2);
        }
      }
    }

    // 4. Render Blight Generators (Pulsing Blight Cores)
    for (const gen of this.generators) {
      const gpx = (gen.cx + 0.5) * cs;
      const gpy = (gen.cy + 0.5) * cs;

      // Double-thump cardiac heartbeat pulse
      const hp = Math.sin(t * 3.6 + gen.pulseOffset);
      const cardiac = Math.pow(Math.max(0, hp), 3) * 0.45 + (Math.sin(t * 3.6 + gen.pulseOffset + 0.5) > 0.8 ? 0.25 : 0);
      const coreRad = 6 + cardiac * 4;

      // Soft ambient bloom glow
      const grad = ctx.createRadialGradient(gpx, gpy, 2, gpx, gpy, coreRad * 2.8);
      grad.addColorStop(0, "rgba(255, 75, 139, 0.4)");
      grad.addColorStop(0.5, "rgba(185, 28, 98, 0.18)");
      grad.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(gpx, gpy, coreRad * 2.8, 0, Math.PI * 2);
      ctx.fill();

      // Outer jagged organic shell
      ctx.fillStyle = "#8b184e";
      ctx.beginPath();
      ctx.arc(gpx, gpy, coreRad + 3, 0, Math.PI * 2);
      ctx.fill();

      // Mid shell
      ctx.fillStyle = "#ba1860";
      ctx.beginPath();
      ctx.arc(gpx, gpy, coreRad + 1, 0, Math.PI * 2);
      ctx.fill();

      // Pulsing heart core
      ctx.fillStyle = "#ff48a4";
      ctx.beginPath();
      ctx.arc(gpx, gpy, coreRad, 0, Math.PI * 2);
      ctx.fill();

      // Inner brilliant nucleus
      ctx.fillStyle = "#ff9ec9";
      ctx.beginPath();
      ctx.arc(gpx, gpy, coreRad * 0.55, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(gpx - 1, gpy - 1, coreRad * 0.25, 0, Math.PI * 2);
      ctx.fill();
    }

    // 5. Render Spore Particles
    for (const p of this.spores) {
      ctx.fillStyle = `rgba(255, 120, 190, ${p.alpha.toFixed(2)})`;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }

    // 6. Render Decontamination Sterilization Sweep (if purging)
    if (this.purgeActive) {
      const sweepX = this.purgeProgress * this.canvas.width;

      // Sweep laser line
      const beamGrad = ctx.createLinearGradient(sweepX - 24, 0, sweepX + 8, 0);
      beamGrad.addColorStop(0, "rgba(56, 214, 255, 0)");
      beamGrad.addColorStop(0.7, `rgba(56, 214, 255, ${(0.8 * this.purgeAlpha).toFixed(2)})`);
      beamGrad.addColorStop(0.9, `rgba(255, 255, 255, ${(0.95 * this.purgeAlpha).toFixed(2)})`);
      beamGrad.addColorStop(1, "rgba(56, 214, 255, 0)");

      ctx.fillStyle = beamGrad;
      ctx.fillRect(sweepX - 24, 0, 32, this.canvas.height);

      // Cleaned side flash
      ctx.fillStyle = `rgba(56, 214, 255, ${(0.15 * this.purgeAlpha).toFixed(2)})`;
      ctx.fillRect(0, 0, sweepX, this.canvas.height);
    }

    // 7. Subtle scanlines & ambient vignette
    ctx.fillStyle = "rgba(5, 7, 13, 0.25)";
    for (let y = 0; y < this.canvas.height; y += 4) {
      ctx.fillRect(0, y, this.canvas.width, 1);
    }
  }
}
