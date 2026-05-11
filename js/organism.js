// An Organism is a small graph of cells anchored at an integer (x,y) on the
// world grid. Its DNA is just the list of cells (relative offsets + types).

import { CONFIG, TERRAIN, TERRAIN_WALKABLE } from "./config.js";
import { CELL, CELL_TYPES_PICK } from "./cell.js";
import { chance, rand, randInt, pick, shuffle, NEIGHBORS_4, NEIGHBORS_8 } from "./utils.js";

let nextId = 1;

export class Organism {
  /**
   * @param {number} x anchor x
   * @param {number} y anchor y
   * @param {Array<{dx:number,dy:number,type:number}>} cells anatomy
   */
  constructor(x, y, cells, hue = null) {
    this.id = nextId++;
    this.x = x;
    this.y = y;
    this.cells = cells;
    this.energy = CONFIG.START_ENERGY;
    this.age = 0;
    this.hue = hue == null ? (rand() * 360) | 0 : hue;
    this.dirX = 0;
    this.dirY = 0;
    this.moveCooldown = 0;
    this.alive = true;
    this.maxLifespan = cells.length * CONFIG.MAX_LIFESPAN_PER_CELL + randInt(50, 200);
    this.recomputeFlags();
  }

  recomputeFlags() {
    this.hasMover = false;
    this.hasEye = false;
    this.producerCount = 0;
    this.mouthCount = 0;
    this.killerCount = 0;
    this.armorCount = 0;
    for (const c of this.cells) {
      if (c.type === CELL.MOVER) this.hasMover = true;
      else if (c.type === CELL.EYE) this.hasEye = true;
      else if (c.type === CELL.PRODUCER) this.producerCount++;
      else if (c.type === CELL.MOUTH) this.mouthCount++;
      else if (c.type === CELL.KILLER) this.killerCount++;
      else if (c.type === CELL.ARMOR) this.armorCount++;
    }
  }

  /** Returns true iff every absolute cell coord lies on a walkable, empty tile. */
  fits(world, x, y) {
    for (const c of this.cells) {
      const ax = x + c.dx;
      const ay = y + c.dy;
      if (ax < 0 || ay < 0 || ax >= world.W || ay >= world.H) return false;
      const t = world.terrainAt(ax, ay);
      if (!TERRAIN_WALKABLE[t]) return false;
      const occ = world.organismAt(ax, ay);
      if (occ && occ !== this) return false;
    }
    return true;
  }

  place(world) {
    for (const c of this.cells) {
      world.setOrganismCell(this.x + c.dx, this.y + c.dy, this);
    }
  }

  unplace(world) {
    for (const c of this.cells) {
      world.setOrganismCell(this.x + c.dx, this.y + c.dy, null);
    }
  }

  tick(world) {
    if (!this.alive) return;
    this.age++;
    if (this.age > this.maxLifespan) {
      this.die(world);
      return;
    }

    // upkeep
    const upkeep = this.cells.length * CONFIG.CELL_BASE_UPKEEP;
    this.energy -= upkeep;
    if (this.killerCount > 0) this.energy -= this.killerCount * 0.02;
    if (this.energy <= 0) {
      this.die(world);
      return;
    }

    this.actCells(world);

    if (this.hasMover) this.maybeMove(world);

    if (this.canReproduce()) this.reproduce(world);
  }

  actCells(world) {
    for (const c of this.cells) {
      const ax = this.x + c.dx;
      const ay = this.y + c.dy;
      if (c.type === CELL.PRODUCER) {
        if (chance(CONFIG.PRODUCER_FOOD_CHANCE)) {
          const [dx, dy] = pick(NEIGHBORS_8);
          const tx = ax + dx;
          const ty = ay + dy;
          if (world.inBounds(tx, ty) && world.terrainAt(tx, ty) === TERRAIN.GRASS &&
              !world.organismAt(tx, ty)) {
            world.addFood(tx, ty);
          }
        }
      } else if (c.type === CELL.MOUTH) {
        // eat adjacent food
        for (const [dx, dy] of NEIGHBORS_4) {
          const tx = ax + dx;
          const ty = ay + dy;
          if (world.inBounds(tx, ty) && world.takeFood(tx, ty)) {
            this.energy += CONFIG.MOUTH_BITE_GAIN;
            break;
          }
        }
      } else if (c.type === CELL.KILLER) {
        for (const [dx, dy] of NEIGHBORS_4) {
          const tx = ax + dx;
          const ty = ay + dy;
          const target = world.organismAt(tx, ty);
          if (target && target !== this) {
            const dmg = CONFIG.KILLER_DAMAGE / (1 + target.armorCount * 0.6);
            target.energy -= dmg;
            if (target.energy <= 0) target.die(world);
            break;
          }
        }
      }
    }
  }

  /** Move the whole body one tile in (dirX, dirY) if free. */
  maybeMove(world) {
    if (this.moveCooldown > 0) {
      this.moveCooldown--;
      return;
    }
    this.moveCooldown = CONFIG.MOVE_INTERVAL_BASE;

    if (this.hasEye && chance(0.7)) {
      const sense = this.senseDirection(world);
      if (sense) {
        this.dirX = sense[0];
        this.dirY = sense[1];
      }
    }
    if (chance(0.18) || (this.dirX === 0 && this.dirY === 0)) {
      const [dx, dy] = pick(NEIGHBORS_4);
      this.dirX = dx;
      this.dirY = dy;
    }

    const nx = this.x + this.dirX;
    const ny = this.y + this.dirY;
    this.unplace(world);
    if (this.fits(world, nx, ny)) {
      this.x = nx;
      this.y = ny;
    } else {
      this.dirX = -this.dirX;
      this.dirY = -this.dirY;
    }
    this.place(world);
  }

  senseDirection(world) {
    const range = CONFIG.EYE_RANGE;
    let bestScore = 0;
    let best = null;
    for (let r = 1; r <= range; r++) {
      for (const [dx, dy] of NEIGHBORS_4) {
        const tx = this.x + dx * r;
        const ty = this.y + dy * r;
        if (!world.inBounds(tx, ty)) continue;
        const score = world.cellInterest(tx, ty, this) / r;
        if (score > bestScore) {
          bestScore = score;
          best = [dx, dy];
        }
      }
    }
    return best;
  }

  canReproduce() {
    return this.alive && this.energy >= this.cells.length * CONFIG.REPRODUCE_AT_ENERGY_PER_CELL;
  }

  reproduce(world) {
    const childCells = this.mutate(this.cells);
    if (childCells.length === 0) return;
    // try to place child near
    const tries = 12;
    const offsets = shuffle([...NEIGHBORS_8]);
    for (let t = 0; t < tries; t++) {
      const [dx, dy] = offsets[t % offsets.length];
      const step = randInt(2, 4);
      const cx = this.x + dx * step;
      const cy = this.y + dy * step;
      const child = new Organism(cx, cy, childCells, (this.hue + randInt(-12, 12) + 360) % 360);
      if (child.fits(world, cx, cy)) {
        child.energy = this.energy / 2;
        this.energy /= 2;
        child.place(world);
        world.organisms.push(child);
        return;
      }
    }
  }

  mutate(srcCells) {
    let cells = srcCells.map((c) => ({ ...c }));
    if (!chance(CONFIG.MUTATION_RATE)) return cells;

    const r = rand();
    if (r < 0.25 && cells.length > 1) {
      // remove a random cell (but never the anchor 0,0)
      const candidates = cells.map((_, i) => i).filter((i) => !(cells[i].dx === 0 && cells[i].dy === 0));
      if (candidates.length) {
        const idx = pick(candidates);
        cells.splice(idx, 1);
      }
    } else if (r < 0.6) {
      // add a cell adjacent to an existing one
      const seed = pick(cells);
      const off = pick(NEIGHBORS_4);
      const dx = seed.dx + off[0];
      const dy = seed.dy + off[1];
      if (!cells.some((c) => c.dx === dx && c.dy === dy) && cells.length < 24) {
        cells.push({ dx, dy, type: pick(CELL_TYPES_PICK) });
      }
    } else {
      // mutate type of one cell
      const cell = pick(cells);
      cell.type = pick(CELL_TYPES_PICK);
    }

    // small per-cell type drift
    for (const c of cells) {
      if (chance(CONFIG.MUTATION_PER_CELL_RATE)) c.type = pick(CELL_TYPES_PICK);
    }

    return cells;
  }

  die(world) {
    if (!this.alive) return;
    this.alive = false;
    this.unplace(world);
    // drop some food where it died
    for (const c of this.cells) {
      const ax = this.x + c.dx;
      const ay = this.y + c.dy;
      if (world.inBounds(ax, ay) && world.terrainAt(ax, ay) === TERRAIN.GRASS && chance(0.55)) {
        world.addFood(ax, ay);
      }
    }
  }
}

/** Build a tiny starter organism (producer + mouth). */
export function makeStarterOrganism(x, y) {
  const cells = [
    { dx: 0, dy: 0, type: CELL.MOUTH },
    { dx: 1, dy: 0, type: CELL.PRODUCER },
    { dx: -1, dy: 0, type: CELL.PRODUCER },
  ];
  return new Organism(x, y, cells);
}
