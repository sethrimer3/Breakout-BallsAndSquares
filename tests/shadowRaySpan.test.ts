import { describe, expect, it } from 'vitest';
import { angleInShadowSpan } from '../src/systems/LightingSystem';

describe('shadow-ray angular rejection', () => {
  it('includes both boundaries and keeps the full-span fallback', () => {
    expect(angleInShadowSpan(-.5,-.5,.5)).toBe(true);
    expect(angleInShadowSpan(.5,-.5,.5)).toBe(true);
    expect(angleInShadowSpan(-.50001,-.5,.5)).toBe(false);
    expect(angleInShadowSpan(.50001,-.5,.5)).toBe(false);
    for(let i=0;i<=200;i++)expect(angleInShadowSpan(-Math.PI+i*Math.PI/100,-Math.PI,Math.PI)).toBe(true);
  });
  it('keeps occluders straddling the negative/positive π seam', () => {
    for(const angle of [-Math.PI,-3,-2.9,2.9,3,Math.PI])expect(angleInShadowSpan(angle,2.9,-2.9)).toBe(true);
    for(const angle of [-2.899,0,2.899])expect(angleInShadowSpan(angle,2.9,-2.9)).toBe(false);
  });
});
