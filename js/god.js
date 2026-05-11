// God tools: brushes and disasters. All delegate to World mutations.

import { CONFIG, TERRAIN } from "./config.js";
import { chance, randInt, pick, NEIGHBORS_8 } from "./utils.js";

export function applyBrush(world, x, y, tool, radius) {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (!world.inBounds(nx, ny)) continue;
      switch (tool) {
        case "grass":   world.paintTerrain(nx, ny, TERRAIN.GRASS); break;
        case "water":   world.paintTerrain(nx, ny, TERRAIN.WATER); break;
        case "sand":    world.paintTerrain(nx, ny, TERRAIN.SAND); break;
        case "mountain":world.paintTerrain(nx, ny, TERRAIN.MOUNTAIN); break;
        case "lava":    world.paintTerrain(nx, ny, TERRAIN.LAVA); break;
        case "food":    world.paintFood(nx, ny); break;
        case "kill":    world.killAt(nx, ny); break;
        case "organism":
          if (chance(0.2)) world.spawnRandomOrganism(nx, ny);
          break;
        case "human":
          if (chance(0.15)) world.spawnHumanAt(nx, ny);
          break;
      }
    }
  }
}

export function disaster(world, kind) {
  switch (kind) {
    case "meteor":     return meteor(world);
    case "earthquake": return earthquake(world);
    case "plague":     return plague(world);
    case "flood":      return flood(world);
    case "rapture":    return rapture(world);
  }
}

function meteor(world) {
  const [x, y] = world.pickRandomPosition();
  const R = CONFIG.METEOR_RADIUS;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > R * R) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (!world.inBounds(nx, ny)) continue;
      world.killAt(nx, ny);
      if (d2 < (R - 1) * (R - 1)) world.paintTerrain(nx, ny, TERRAIN.LAVA);
      else if (d2 < R * R) world.paintTerrain(nx, ny, TERRAIN.DIRT);
    }
  }
  world.eventLog.push({ tick: world.tick, type: "disaster", msg: `A meteor struck at (${x},${y}).` });
}

function earthquake(world) {
  // shake: convert random tiles to dirt/mountain, kill some occupants
  for (let i = 0; i < CONFIG.EARTHQUAKE_TILES; i++) {
    const [x, y] = world.pickRandomPosition();
    const t = world.terrainAt(x, y);
    if (t === TERRAIN.GRASS || t === TERRAIN.SAND) {
      world.paintTerrain(x, y, chance(0.3) ? TERRAIN.MOUNTAIN : TERRAIN.DIRT);
    }
    if (chance(0.25)) world.killAt(x, y);
  }
  world.eventLog.push({ tick: world.tick, type: "disaster", msg: "An earthquake rocked the world." });
}

function plague(world) {
  for (const h of world.humans) {
    if (h.alive && chance(CONFIG.PLAGUE_KILL_CHANCE)) h.die(world);
  }
  for (const o of world.organisms) {
    if (o.alive && chance(CONFIG.PLAGUE_KILL_CHANCE * 0.4)) o.die(world);
  }
  world.eventLog.push({ tick: world.tick, type: "disaster", msg: "A plague swept across the land." });
}

function flood(world) {
  const [x, y] = world.pickRandomPosition();
  const R = CONFIG.FLOOD_RADIUS;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy > R * R) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (!world.inBounds(nx, ny)) continue;
      const t = world.terrainAt(nx, ny);
      if (t === TERRAIN.GRASS || t === TERRAIN.SAND || t === TERRAIN.DIRT) {
        world.paintTerrain(nx, ny, TERRAIN.WATER);
      }
    }
  }
  world.eventLog.push({ tick: world.tick, type: "disaster", msg: `A great flood drowned (${x},${y}).` });
}

function rapture(world) {
  // every human ascends
  for (const h of world.humans) {
    if (h.alive) h.alive = false;
  }
  world.eventLog.push({ tick: world.tick, type: "disaster", msg: "The Rapture took every soul." });
}
