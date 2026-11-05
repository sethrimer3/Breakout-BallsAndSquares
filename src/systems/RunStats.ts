/** Per-run statistics. */
export class RunStats {
  time = 0;
  pixelsDestroyed = 0;
  currency = 0;
  /** Max depth (cells beyond the room edge) of any destroyed pixel. */
  maxDepth = 0;
  soldiersDeployed = 0;
  shotsFired = 0;

  reset(): void {
    this.time = 0;
    this.pixelsDestroyed = 0;
    this.currency = 0;
    this.maxDepth = 0;
    this.soldiersDeployed = 0;
    this.shotsFired = 0;
  }
}
