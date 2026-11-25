import { exoticMatterPixels } from "../rendering/exoticMatterSprite";

const art = exoticMatterPixels();
const pixels = art.px.flatMap((rgb, i) => rgb < 0 ? [] : [
  `calc(${i % art.w} * var(--exotic-px)) calc(${Math.floor(i / art.w)} * var(--exotic-px)) #${rgb.toString(16).padStart(6, "0")}`,
]).join(",");

export function exoticMatterIcon(scale: 1 | 2 = 1): string {
  return `<span class="exotic-matter-icon" aria-hidden="true" style="--exotic-px:var(--px${scale})"><span style="box-shadow:${pixels}"></span></span>`;
}
