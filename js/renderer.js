// Canvas rendering for the world. Single pass terrain + entity overlay.

import { TERRAIN, TERRAIN_COLOR, CONFIG } from "./config.js";
import { CELL_DEFS } from "./cell.js";
import { SPECIES } from "./animal.js";

export class Renderer {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.world = world;
    this.cellPx = CONFIG.CELL_PX;
    this.showTerritory = true;
    this.showFood = true;
    this.hoverX = -1;
    this.hoverY = -1;
    this.resize();
  }

  setWorld(world) { this.world = world; }
  setZoom(px) { this.cellPx = px; this.resize(); }

  resize() {
    const w = this.world.W * this.cellPx;
    const h = this.world.H * this.cellPx;
    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
  }

  draw() {
    const { ctx, world } = this;
    const px = this.cellPx;

    // 1. terrain
    for (let y = 0; y < world.H; y++) {
      for (let x = 0; x < world.W; x++) {
        const t = world.terrain[y * world.W + x];
        ctx.fillStyle = TERRAIN_COLOR[t];
        ctx.fillRect(x * px, y * px, px, px);
      }
    }

    // 2. resources — drawn under entities but over terrain
    // 2a. trees
    for (let y = 0; y < world.H; y++) {
      for (let x = 0; x < world.W; x++) {
        const i = y * world.W + x;
        const wd = world.wood[i];
        if (wd > 0) {
          // trunk
          const cx = x * px;
          const cy = y * px;
          ctx.fillStyle = "#3a2918";
          ctx.fillRect(cx + (px >> 1) - 1, cy + (px >> 1), 2, Math.max(1, px - (px >> 1) - 1));
          // canopy — bigger if more wood on the tile
          const cap = Math.max(2, (px - 1) - (wd <= 2 ? 1 : 0));
          ctx.fillStyle = wd >= 3 ? "#1f6a32" : "#2f8a47";
          ctx.fillRect(cx + 1, cy, cap, cap);
        }
      }
    }

    // 2b. stone & iron ore — small flecks over mountain/snow/dirt
    for (let y = 0; y < world.H; y++) {
      for (let x = 0; x < world.W; x++) {
        const i = y * world.W + x;
        const cx = x * px;
        const cy = y * px;
        const so = world.stoneOre[i];
        const io = world.ironOre[i];
        if (so > 0) {
          ctx.fillStyle = "#cfcfcf";
          ctx.fillRect(cx + 1, cy + (px >> 1), 2, 1);
          if (so >= 2) ctx.fillRect(cx + (px >> 1) + 1, cy + 1, 1, 1);
        }
        if (io > 0) {
          ctx.fillStyle = "#a86a3a";
          ctx.fillRect(cx + (px >> 1), cy + (px >> 1) + 1, 2, 1);
        }
      }
    }

    // 2c. microbes — tiny green/red specks on grass
    for (let y = 0; y < world.H; y++) {
      for (let x = 0; x < world.W; x++) {
        const i = y * world.W + x;
        const m = world.microbe[i];
        if (m === 0) continue;
        ctx.fillStyle = m === 2 ? "#b53e3e" : "#c9e87a";
        ctx.fillRect(x * px + 1, y * px + 1, 1, 1);
      }
    }

    // 3. food
    if (this.showFood) {
      ctx.fillStyle = "#e8dd66";
      for (let y = 0; y < world.H; y++) {
        for (let x = 0; x < world.W; x++) {
          if (world.food[y * world.W + x] > 0) {
            const cx = x * px + (px >> 1);
            const cy = y * px + (px >> 1);
            const r = Math.max(1, (px / 4) | 0);
            ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
          }
        }
      }
    }

    // 4. territory (only sentient era)
    if (this.showTerritory && world.era === "sentient") {
      for (let y = 0; y < world.H; y++) {
        for (let x = 0; x < world.W; x++) {
          const k = world.kingdomTerritory[y * world.W + x];
          if (k < 0) continue;
          const kingdom = world.kingdoms.find((kg) => kg.id === k);
          if (!kingdom) continue;
          ctx.fillStyle = hexToRGBA(kingdom.color, 0.18);
          ctx.fillRect(x * px, y * px, px, px);
        }
      }
    }

    // 5. organisms
    for (const o of world.organisms) {
      if (!o.alive) continue;
      for (const c of o.cells) {
        ctx.fillStyle = CELL_DEFS[c.type].color;
        ctx.fillRect((o.x + c.dx) * px, (o.y + c.dy) * px, px, px);
      }
    }

    // 6. animals
    for (const a of world.animals) {
      if (!a.alive) continue;
      const def = SPECIES[a.species];
      ctx.fillStyle = def.color;
      const r = Math.max(2, ((px - 1) * 0.7) | 0);
      const cx = a.x * px + (px >> 1) - (r >> 1);
      const cy = a.y * px + (px >> 1) - (r >> 1);
      ctx.fillRect(cx, cy, r, r);
      // small black dot for carnivores so they read as 'fangs'
      if (def.carnivore) {
        ctx.fillStyle = "#1a1a1a";
        ctx.fillRect(cx + r - 1, cy, 1, 1);
      }
    }

    // 7. humans
    for (const h of world.humans) {
      if (!h.alive) continue;
      ctx.fillStyle = h.kingdom ? h.kingdom.color : "#e9e0c0";
      const r = Math.max(1, (px / 2) | 0);
      const cx = h.x * px + (px >> 1) - (r >> 1);
      const cy = h.y * px + (px >> 1) - (r >> 1);
      ctx.fillRect(cx, cy, r, r);
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(cx + r, cy + r, 1, 1);
    }

    // 8. buildings
    for (const b of world.buildings) {
      const cx = b.x * px;
      const cy = b.y * px;
      ctx.fillStyle = "#222";
      ctx.fillRect(cx, cy, px, px);
      ctx.fillStyle = b.kingdom?.color || "#888";
      if (b.kind === "shrine") {
        ctx.fillRect(cx + 1, cy + 1, px - 2, px - 2);
        ctx.fillStyle = b.kingdom?.bannerColor || "#fff";
        ctx.fillRect(cx + (px >> 1) - 1, cy + 1, 2, 2);
      } else if (b.kind === "village") {
        ctx.fillRect(cx + 1, cy + 1, px - 2, px - 2);
      } else if (b.kind === "town") {
        ctx.fillRect(cx, cy, px, px);
        ctx.fillStyle = "#000";
        ctx.fillRect(cx + (px >> 1) - 1, cy, 2, 2);
      } else if (b.kind === "castle") {
        ctx.fillRect(cx, cy, px, px);
        ctx.fillStyle = "#000";
        ctx.fillRect(cx, cy, 2, 2);
        ctx.fillRect(cx + px - 2, cy, 2, 2);
        ctx.fillRect(cx + (px >> 1) - 1, cy + (px >> 1) - 1, 2, 2);
      }
    }

    // 9. hover marker
    if (this.hoverX >= 0 && this.hoverY >= 0) {
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 1;
      ctx.strokeRect(this.hoverX * px + 0.5, this.hoverY * px + 0.5, px - 1, px - 1);
    }
  }

  setHover(x, y) {
    this.hoverX = x;
    this.hoverY = y;
  }

  pixelToTile(px, py) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((px - rect.left) / rect.width) * this.world.W;
    const y = ((py - rect.top) / rect.height) * this.world.H;
    return [Math.floor(x), Math.floor(y)];
  }
}

function hexToRGBA(c, a) {
  if (c.startsWith("hsl")) {
    return c.replace("hsl(", "hsla(").replace(")", `, ${a})`);
  }
  return c;
}
