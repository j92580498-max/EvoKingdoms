// Bind sidebar controls to the running simulation.

import { CONFIG, ERAS, TERRAIN } from "./config.js";
import { applyBrush, disaster } from "./god.js";
import { CELL_DEFS } from "./cell.js";
import { SPECIES } from "./animal.js";

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

    const helpOverlay = $("help-overlay");
    const showHelp = () => helpOverlay.classList.remove("hidden");
    const hideHelp = () => helpOverlay.classList.add("hidden");
    $("btn-help").addEventListener("click", showHelp);
    $("btn-help-close").addEventListener("click", hideHelp);
    helpOverlay.addEventListener("click", (e) => {
      if (e.target === helpOverlay) hideHelp();
    });
    window.addEventListener("keydown", (e) => {
      if (e.key === "?" || e.key === "/") showHelp();
      else if (e.key === "Escape") hideHelp();
      else if (e.key === " ") {
        e.preventDefault();
        document.getElementById("btn-pause").click();
      }
    });

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
    if (info.wood)  html += `<div><span class="label">Wood</span> ${info.wood}</div>`;
    if (info.stone) html += `<div><span class="label">Stone ore</span> ${info.stone}</div>`;
    if (info.iron)  html += `<div><span class="label">Iron ore</span> ${info.iron}</div>`;
    if (info.microbe) {
      html += `<div><span class="label">Microflora</span> ${info.microbe === 2 ? "pathogenic" : "benign"}</div>`;
    }
    if (info.kingdom >= 0) {
      const k = w.kingdoms.find((kk) => kk.id === info.kingdom);
      if (k) {
        html += `<div><span class="label">Territory</span> ${k.culture} ${k.name} — ${k.techName()} Age · ${k.religion.icon} ${k.religion.name}</div>`;
        html += `<div><span class="label">Resources</span> wood ${k.resources.wood}, stone ${k.resources.stone}, iron ${k.resources.iron}</div>`;
      }
    }
    if (info.organism) {
      const o = info.organism;
      const composition = Object.entries(o.cells.reduce((m, c) => { m[c.type] = (m[c.type] || 0) + 1; return m; }, {}))
        .map(([t, n]) => `${CELL_DEFS[t]?.name}×${n}`).join(", ");
      html += `<div><span class="label">Organism #${o.id}</span> cells=${o.cells.length} energy=${o.energy.toFixed(1)} age=${o.age}/${o.maxLifespan}</div>`;
      html += `<div class="muted">${composition}</div>`;
    }
    if (info.animal) {
      const a = info.animal;
      const def = SPECIES[a.species];
      html += `<div><span class="label">Animal</span> ${def.name} ${def.carnivore ? "(predator)" : "(prey)"} · age ${a.age}/${a.lifespan}</div>`;
      html += `<div class="gene-row"><span>spd ${a.genes.speed.toFixed(2)}</span><span>str ${a.genes.strength.toFixed(2)}</span><span>vis ${a.genes.vision.toFixed(2)}</span><span>fert ${a.genes.fertility.toFixed(2)}</span></div>`;
    }
    if (info.human) {
      const h = info.human;
      const k = h.kingdom ? `${h.kingdom.culture} ${h.kingdom.name} · ${h.kingdom.techName()} Age · ${h.kingdom.religion.icon}` : "Tribeless";
      html += `<div><span class="label">Human</span> ${h.name} — ${k}</div>`;
      html += `<div class="muted">gen ${h.generation} · hunger ${h.hunger.toFixed(2)} · age ${h.age}/${h.lifespan}</div>`;
      html += `<div class="gene-row"><span>str ${h.genes.strength.toFixed(2)}</span><span>smr ${h.genes.smarts.toFixed(2)}</span><span>fai ${h.genes.faith.toFixed(2)}</span><span>fer ${h.genes.fertility.toFixed(2)}</span><span>agg ${h.genes.agg.toFixed(2)}</span></div>`;
      if (h.kingdom) {
        const c = h.carry || { wood: 0, stone: 0, iron: 0 };
        if (c.wood + c.stone + c.iron > 0) {
          html += `<div class="muted">carrying w${c.wood} s${c.stone} i${c.iron}</div>`;
        }
      }
    }
    if (info.building) {
      html += `<div><span class="label">Building</span> ${info.building.kind} of ${info.building.kingdom.culture} ${info.building.kingdom.name}</div>`;
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
    if (w.hasWood(x, y)) parts.push("wood");
    if (w.hasStone(x, y)) parts.push("stone");
    if (w.hasIron(x, y)) parts.push("iron");
    const o = w.organismAt(x, y);
    if (o) parts.push(`org ${o.cells.length}c`);
    const a = w.animalAtTile(x, y);
    if (a) parts.push(SPECIES[a.species].name.toLowerCase());
    const h = w.humanAt[w.idx(x, y)];
    if (h) parts.push(h.kingdom ? `${h.kingdom.culture} ${h.kingdom.name}` : "human");
    const k = w.kingdomAtTile(x, y);
    if (k >= 0 && !h) {
      const kk = w.kingdoms.find((kg) => kg.id === k);
      if (kk) parts.push(`${kk.culture} ${kk.name}`);
    }
    tag.textContent = parts.join(" · ");
    tag.style.left = e.clientX + "px";
    tag.style.top = e.clientY + "px";
    tag.classList.add("show");
  }

  /** Render the Peoples panel — one row per living kingdom. */
  renderPeoples() {
    const el = document.getElementById("peoples");
    if (!el) return;
    const w = this.game.world;
    const ks = w.kingdoms.filter((k) => k.population > 0)
      .sort((a, b) => b.population - a.population);
    if (ks.length === 0) {
      el.innerHTML = '<span class="muted">No kingdoms yet.</span>';
      return;
    }
    el.innerHTML = ks.slice(0, 20).map((k) => {
      const genes = k.meanGenes(w);
      const warTag = k.warTarget ? `<span class="at-war">⚔ ${k.warTarget.culture} ${k.warTarget.name}</span>` : "";
      const r = k.resources;
      return `
        <div class="people" style="border-left-color:${k.color}">
          <div class="people-head">
            <span class="banner" style="background:${k.color}"></span>
            <span class="name">${k.culture} ${k.name}</span>
            <span class="rel" title="${k.religion.name}">${k.religion.icon}</span>
          </div>
          <div class="people-stats">
            <span>${k.techName()} Age</span>
            <span>pop ${k.population}</span>
            <span>🪵${r.wood}</span>
            <span>🪨${r.stone}</span>
            <span>⛓${r.iron}</span>
            <span>${k.buildings.length}🏠</span>
            ${warTag}
          </div>
          <div class="genes">
            <span title="strength">str ${genes.strength.toFixed(2)}</span>
            <span title="smarts">smr ${genes.smarts.toFixed(2)}</span>
            <span title="faith">fai ${genes.faith.toFixed(2)}</span>
            <span title="aggression">agg ${genes.agg.toFixed(2)}</span>
          </div>
        </div>
      `;
    }).join("");
  }
}
