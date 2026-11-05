import "./styles/main.css";
import { Game } from "./Game";
import { syncPixelScale } from "./ui/pixelArt";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ui = document.getElementById("ui") as HTMLDivElement;
syncPixelScale();
const game = new Game(canvas, ui);
game.start();
