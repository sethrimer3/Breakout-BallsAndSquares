import { describe, expect, it } from "vitest";
import { deploymentState, deploymentIcon, DEPLOYMENT_LABELS } from "../src/ui/deploymentStatus";

describe("deployment map status", () => {
  it("conceals restrictions until the sector is known", () => {
    for (const guarded of [true,false]) for (const allowed of [true,false]) expect(deploymentState(false,guarded,allowed)).toBe("unknown");
  });
  it("keeps Warden restrictions even when conquest is bypassed", () => {
    expect(deploymentState(true,true,true)).toBe("guarded");
    expect(deploymentState(true,true,false)).toBe("guarded");
  });
  it("distinguishes a permitted live zone from an unsecured sector selection", () => {
    expect(deploymentState(true,false,true)).toBe("available");
    expect(deploymentState(true,false,false)).toBe("unsecured");
  });
  it("provides text and different symbols as well as color", () => {
    expect(deploymentIcon("available")).not.toBe(deploymentIcon("guarded"));
    expect(deploymentIcon("unknown")).not.toBe(deploymentIcon("guarded"));
    expect(DEPLOYMENT_LABELS.guarded).toBe("WARDEN LOCK");
    expect(DEPLOYMENT_LABELS.unknown).toBe("UNSURVEYED");
  });
});
