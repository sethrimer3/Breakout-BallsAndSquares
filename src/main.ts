import "./styles/main.css";
import { Game } from "./Game";
import { startEssenceIcons } from "./ui/essenceIcon";
import { syncPixelScale } from "./ui/pixelArt";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ui = document.getElementById("ui") as HTMLDivElement;
syncPixelScale();
startEssenceIcons();

// iOS Safari ignores `user-scalable=no`; block its pinch/double-tap page zoom so
// two-finger gestures reach the game camera instead of zooming the page.
for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
  document.addEventListener(type, (e) => e.preventDefault());
}

const game = new Game(canvas, ui);
game.start();

// Dev builds expose the game for console poking and screenshot scripts.
if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;
