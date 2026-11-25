/** Shared language for the survey map and live deployment overlay. */
export type DeploymentState = "available" | "guarded" | "unsecured" | "unknown";
export const DEPLOYMENT_COLORS = { available: "#79dfd2", blocked: "#edb565", unknown: "#8694a6" } as const;

/** Knowledge takes precedence so a restriction cannot reveal an unseen sector. */
export function deploymentState(known: boolean, guarded: boolean, permitted: boolean): DeploymentState {
  if (!known) return "unknown";
  if (guarded) return "guarded";
  return permitted ? "available" : "unsecured";
}

export const DEPLOYMENT_LABELS: Record<DeploymentState, string> = {
  available: "DEPLOYMENT AVAILABLE", guarded: "WARDEN LOCK", unsecured: "SECTOR NOT SECURED", unknown: "UNSURVEYED",
};

/** Small outlined symbols remain legible without relying on color. */
export function deploymentIcon(state: DeploymentState): string {
  const shape = state === "available" ? '<path d="M2 6l3 3 5-6"/>'
    : state === "unknown" ? '<path d="M4 4a2 2 0 014 0c0 2-2 2-2 4M6 10v.2"/>'
    : '<path d="M4 5V3a2 2 0 014 0v2M3 5h6v6H3zM6 7v2"/>';
  return `<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter">${shape}</svg>`;
}

export function deploymentLegend(showCleared = true): string {
  return `<span class="deploy-key deploy-available">${deploymentIcon("available")} Available</span>
    ${showCleared ? '<span class="deploy-key deploy-available"><i class="deploy-cleared-chip" aria-hidden="true"></i> Cleared</span>' : ""}
    <span class="deploy-key deploy-unknown">${deploymentIcon("unknown")} Unsurveyed</span>`;
}
