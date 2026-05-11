// Entry point. Boots the world, renderer, UI and runs the main loop.

import { CONFIG } from "./config.js";
import { World } from "./world.js";
import { Renderer } from "./renderer.js";
import { UI } from "./ui.js";
import { computeStats, renderStats } from "./stats.js";

class Game {
  constructor() {
    this.canvas = document.getElementById("canvas");
    this.world = new World();
    this.world.seedLife();
    this.renderer = new Renderer(this.canvas, this.world);
    this.ui = new UI(this);
    this.paused = false;
    this.targetTPS = CONFIG.TICKS_PER_SECOND;
    this.tickAcc = 0;
    this.lastTime = performance.now();
    this.lastEra = "primordial";
    this.toastEl = document.getElementById("toast");
    this.toastTimeout = null;
  }

  setZoom(px) { this.renderer.setZoom(px); }

  reset() {
    this.world = new World();
    this.world.seedLife();
    this.renderer.setWorld(this.world);
    this.renderer.resize();
    this.toast("World reset.");
  }

  step() {
    this.world.step();
  }

  toast(msg) {
    if (!this.toastEl) return;
    this.toastEl.textContent = msg;
    this.toastEl.classList.add("show");
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => this.toastEl.classList.remove("show"), 2200);
  }

  loop() {
    const now = performance.now();
    const dt = Math.min(now - this.lastTime, 250);
    this.lastTime = now;

    if (!this.paused) {
      const tickInterval = 1000 / this.targetTPS;
      this.tickAcc += dt;
      // safety cap to avoid spiral-of-death after a long tab pause
      let budget = 0;
      while (this.tickAcc >= tickInterval && budget < this.targetTPS / 4 + 4) {
        this.world.step();
        this.tickAcc -= tickInterval;
        budget++;
      }
    }

    this.renderer.draw();

    if (this.world.era !== this.lastEra) {
      this.lastEra = this.world.era;
      this.ui.updateEra(this.world.era);
      this.toast(this.world.era === "sentient" ? "The Sentient Era has begun!" : "Era changed.");
    }

    if ((this.world.tick & 7) === 0) {
      const s = computeStats(this.world);
      renderStats(s, document.getElementById("stats"));
    }

    requestAnimationFrame(() => this.loop());
  }

  start() {
    this.ui.updateEra(this.world.era);
    this.loop();
  }
}

const game = new Game();
game.start();
window.__game = game; // for debugging via devtools
