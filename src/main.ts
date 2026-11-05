import "./styles/main.css";
import { Game } from "./Game";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const ui = document.getElementById("ui") as HTMLDivElement;
const game = new Game(canvas, ui);
game.start();
