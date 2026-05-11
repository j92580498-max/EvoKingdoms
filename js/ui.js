// Bind sidebar controls to the running simulation.

import { CONFIG, ERAS, TERRAIN } from "./config.js";
import { applyBrush, disaster } from "./god.js";
import { CELL_DEFS } from "./cell.js";

const TERRAIN_NAMES = {
  [TERRAIN.GRASS]: "Grass",
  [TERRAIN.WATER]: "Water",
  [TERRAIN.SAND]: "Sand",
  [TERRAIN.MOUNTAIN]: "Mountain",
  [TERRAIN.SNOW]: "Snow",
  [TERRAIN.LAVA]: "Lava",
  [TERRAIN.DIRT]: "Dirt",
};

export class UI {
  constructor(game) {
    this.game = game;
    this.tool = "inspect";
    this.brush = 3;
    this.bind();
  }

  bind() {
    const $ = (id) => document.getElementById(id);

    $("btn-pause").addEventListener("click", () => {
      this.game.paused = !this.game.paused;
      $("btn-pause").textContent = this.game.paused ? "▶ Play" : "⏸ Pause";
    });
    $("btn-step").addEventListener("click", () => this.game.step());
    $("btn-reset").addEventListener("click", () => this.game.reset());

    const speed = $("speed");
    speed.addEventListener("input", () => {
      this.game.targetTPS = +speed.value;
      $("speed-val").textContent = `${speed.value} ticks/s`;
    });

    const zoom = $("zoom");
    zoom.addEventListener("input", () => {
      this.game.setZoom(+zoom.value);
      $("zoom-val").textContent = `${zoom.value}×`;
    });

    const brush = $("brush");
    brush.addEventListener("input", () => {
      this.brush = +brush.value;
      $("brush-val").textContent = brush.value;
    });

    $("btn-era-advance").addEventListener("click", () => this.game.world.enterSentientEra());

    for (const btn of document.querySelectorAll(".tool")) {
      btn.addEventListener("click", () => {
        this.tool = btn.dataset.tool;
        document.querySelectorAll(".tool").forEach((b) => b.classList.toggle("active", b === btn));
      });
    }

    for (const btn of document.querySelectorAll("[data-disaster]")) {
      btn.addEventListener("click", () => {
        disaster(this.game.world, btn.dataset.disaster);
        this.game.toast(`Disaster: ${btn.dataset.disaster}`);
      });
    }

    // canvas interactions
    const canvas = document.getElementById("canvas");
    let painting = false;

    const apply = (e) => {
      const [tx, ty] = this.game.renderer.pixelToTile(e.clientX, e.clientY);
      if (this.tool === "inspect") {
        this.inspect(tx, ty);
      } else {
        applyBrush(this.game.world, tx, ty, this.tool, this.brush);
      }
    };

    canvas.addEventListener("mousedown", (e) => {
      painting = true;
      apply(e);
    });
    canvas.addEventListener("mousemove", (e) => {
      const [tx, ty] = this.game.renderer.pixelToTile(e.clientX, e.clientY);
      this.game.renderer.setHover(tx, ty);
      this.updateHoverTag(e, tx, ty);
      if (painting) apply(e);
    });
    window.addEventListener("mouseup", () => { painting = false; });
    canvas.addEventListener("mouseleave", () => {
      this.game.renderer.setHover(-1, -1);
      document.getElementById("hover").classList.remove("show");
    });
  }

  updateEra(era) {
    document.getElementById("era-name").textContent = ERAS[era.toUpperCase()].name;
    document.getElementById("era-desc").textContent = ERAS[era.toUpperCase()].desc;
  }

  inspect(x, y) {
    const w = this.game.world;
    const info = w.describe(x, y);
    const el = document.getElementById("inspect");
    if (!info) {
      el.innerHTML = "<span class='muted'>Out of bounds.</span>";
      return;
    }
    let html = `<div><span class="label">Tile</span> (${info.x},${info.y}) — ${TERRAIN_NAMES[info.terrain]}</div>`;
    if (info.food) html += `<div><span class="label">Food</span> ${info.food}</div>`;
    if (info.kingdom >= 0) {
      const k = w.kingdoms.find((kk) => kk.id === info.kingdom);
      if (k) html += `<div><span class="label">Territory</span> ${k.name} (${k.techName()} Age)</div>`;
    }
    if (info.organism) {
      const o = info.organism;
      const composition = Object.entries(o.cells.reduce((m, c) => { m[c.type] = (m[c.type] || 0) + 1; return m; }, {}))
        .map(([t, n]) => `${CELL_DEFS[t]?.name}×${n}`).join(", ");
      html += `<div><span class="label">Organism #${o.id}</span> cells=${o.cells.length} energy=${o.energy.toFixed(1)} age=${o.age}/${o.maxLifespan}</div>`;
      html += `<div class="muted">${composition}</div>`;
    }
    if (info.human) {
      const h = info.human;
      const k = h.kingdom ? `${h.kingdom.name} · ${h.kingdom.techName()} Age` : "Tribeless";
      html += `<div><span class="label">Human</span> ${h.name} — ${k}</div>`;
      html += `<div class="muted">hunger=${h.hunger.toFixed(2)} age=${h.age}/${h.lifespan}</div>`;
    }
    if (info.building) {
      html += `<div><span class="label">Building</span> ${info.building.kind} of ${info.building.kingdom.name}</div>`;
    }
    el.innerHTML = html;
  }

  updateHoverTag(e, x, y) {
    const tag = document.getElementById("hover");
    const w = this.game.world;
    if (!w.inBounds(x, y)) {
      tag.classList.remove("show");
      return;
    }
    const t = w.terrainAt(x, y);
    const parts = [TERRAIN_NAMES[t]];
    if (w.hasFood(x, y)) parts.push("food");
    const o = w.organismAt(x, y);
    if (o) parts.push(`org ${o.cells.length}c`);
    const h = w.humanAt[w.idx(x, y)];
    if (h) parts.push(h.kingdom ? h.kingdom.name : "human");
    const k = w.kingdomAtTile(x, y);
    if (k >= 0 && !h) {
      const kk = w.kingdoms.find((kg) => kg.id === k);
      if (kk) parts.push(`${kk.name}`);
    }
    tag.textContent = parts.join(" · ");
    tag.style.left = e.clientX + "px";
    tag.style.top = e.clientY + "px";
    tag.classList.add("show");
  }
}
