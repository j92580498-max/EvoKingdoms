// World: terrain, food, occupants. Drives the per-tick simulation loop.

import { CONFIG, TERRAIN, TERRAIN_WALKABLE } from "./config.js";
import { chance, rand, randInt, pick, NEIGHBORS_4, NEIGHBORS_8 } from "./utils.js";
import { CELL } from "./cell.js";
import { Organism, makeStarterOrganism } from "./organism.js";

export class World {
  constructor(width = CONFIG.GRID_W, height = CONFIG.GRID_H) {
    this.W = width;
    this.H = height;
    this.size = width * height;
    this.terrain = new Uint8Array(this.size);
    this.food = new Uint8Array(this.size);
    this.org = new Array(this.size).fill(null); // Organism refs per tile
    this.humanAt = new Array(this.size).fill(null); // Human ref per tile
    this.buildingAt = new Array(this.size).fill(null);
    this.kingdomTerritory = new Int16Array(this.size); // -1 unclaimed, else kingdom id
    this.kingdomTerritory.fill(-1);

    this.organisms = [];
    this.humans = [];
    this.kingdoms = [];
    this.buildings = [];
    this.wars = []; // { a, b, ticks }
    this.era = "primordial";
    this.tick = 0;
    this.eventLog = [];
    this.generateTerrain();
  }

  idx(x, y) { return y * this.W + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }

  terrainAt(x, y) { return this.terrain[this.idx(x, y)]; }
  setTerrain(x, y, t) { this.terrain[this.idx(x, y)] = t; }

  organismAt(x, y) {
    if (!this.inBounds(x, y)) return null;
    return this.org[this.idx(x, y)];
  }
  setOrganismCell(x, y, org) {
    if (!this.inBounds(x, y)) return;
    this.org[this.idx(x, y)] = org;
  }

  hasFood(x, y) {
    return this.inBounds(x, y) && this.food[this.idx(x, y)] > 0;
  }
  addFood(x, y) {
    if (!this.inBounds(x, y)) return;
    const i = this.idx(x, y);
    if (this.food[i] < CONFIG.FOOD_MAX_PER_TILE) this.food[i]++;
  }
  takeFood(x, y) {
    if (!this.inBounds(x, y)) return false;
    const i = this.idx(x, y);
    if (this.food[i] > 0) {
      this.food[i]--;
      return true;
    }
    return false;
  }

  /** Scoring used by Eye senses. Positive = attractive (food, enemy mouth);
   *  Negative score is currently unused but space is here. */
  cellInterest(x, y, self) {
    if (!this.inBounds(x, y)) return 0;
    let s = 0;
    if (this.food[this.idx(x, y)] > 0) s += 1;
    const other = this.org[this.idx(x, y)];
    if (other && other !== self) {
      // approach prey-like organisms (no killers); avoid killers
      if (other.killerCount > self.killerCount + 1) s -= 1.2;
      else if (self.killerCount > 0) s += 0.6;
    }
    return s;
  }

  // ----- terrain generation -----
  generateTerrain() {
    // Simple Perlin-ish noise via stacked sin/cos. Not perfect but fast and
    // produces believable land/water masses.
    const seedA = rand() * 1000;
    const seedB = rand() * 1000;
    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        const n =
          Math.sin((x + seedA) * 0.13) * 0.5 +
          Math.cos((y + seedB) * 0.11) * 0.4 +
          Math.sin((x * 0.04 + y * 0.05 + seedA) * 1.3) * 0.35 +
          (rand() - 0.5) * 0.4;
        let t;
        if (n < -0.55) t = TERRAIN.WATER;
        else if (n < -0.4) t = TERRAIN.SAND;
        else if (n > 0.7) t = TERRAIN.MOUNTAIN;
        else if (n > 0.55) t = TERRAIN.DIRT;
        else t = TERRAIN.GRASS;
        this.terrain[this.idx(x, y)] = t;
      }
    }
    // sprinkle snow caps on mountain edges
    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        if (this.terrainAt(x, y) === TERRAIN.MOUNTAIN && chance(0.18)) {
          this.setTerrain(x, y, TERRAIN.SNOW);
        }
      }
    }
  }

  seedLife(n = CONFIG.START_ORGANISMS) {
    for (let i = 0; i < n; i++) {
      for (let tries = 0; tries < 50; tries++) {
        const x = randInt(2, this.W - 3);
        const y = randInt(2, this.H - 3);
        if (this.terrainAt(x, y) !== TERRAIN.GRASS) continue;
        const o = makeStarterOrganism(x, y);
        if (o.fits(this, x, y)) {
          o.place(this);
          this.organisms.push(o);
          break;
        }
      }
    }
    // and a bit of free food
    for (let i = 0; i < n * 12; i++) {
      const x = randInt(0, this.W - 1);
      const y = randInt(0, this.H - 1);
      if (this.terrainAt(x, y) === TERRAIN.GRASS && !this.org[this.idx(x, y)]) {
        this.addFood(x, y);
      }
    }
  }

  // ----- per-tick driver -----
  step() {
    this.tick++;
    this.terrainTick();
    this.organismsTick();
    this.humansTick();
    this.kingdomsTick();
    this.maybeEnterSentientEra();
  }

  terrainTick() {
    // small sampled cellular automaton — only inspect a fraction of tiles per tick
    const samples = (this.size * 0.01) | 0;
    for (let s = 0; s < samples; s++) {
      const i = (rand() * this.size) | 0;
      const t = this.terrain[i];
      if (t === TERRAIN.DIRT && chance(CONFIG.GRASS_REGROW_CHANCE * 100)) {
        // dirt slowly turns to grass if next to grass
        const x = i % this.W;
        const y = (i / this.W) | 0;
        let grassAdj = 0;
        for (const [dx, dy] of NEIGHBORS_4) {
          if (this.inBounds(x + dx, y + dy) && this.terrainAt(x + dx, y + dy) === TERRAIN.GRASS) grassAdj++;
        }
        if (grassAdj > 0) this.terrain[i] = TERRAIN.GRASS;
      } else if (t === TERRAIN.LAVA && chance(CONFIG.LAVA_COOL_CHANCE)) {
        this.terrain[i] = TERRAIN.MOUNTAIN;
      } else if (t === TERRAIN.WATER && chance(CONFIG.WATER_EVAPORATE_CHANCE)) {
        this.terrain[i] = TERRAIN.SAND;
      } else if (t === TERRAIN.GRASS && this.food[i] === 0 && chance(CONFIG.FOOD_NATURAL_SPAWN_CHANCE)) {
        this.food[i] = 1;
      }
    }
  }

  organismsTick() {
    // iterate over a snapshot since organisms may die / reproduce
    const list = this.organisms;
    for (let i = 0; i < list.length; i++) {
      list[i].tick(this);
    }
    // compact dead
    if ((this.tick & 31) === 0) {
      this.organisms = this.organisms.filter((o) => o.alive);
    }
  }

  humansTick() {
    if (this.era !== "sentient") return;
    const list = this.humans;
    for (let i = 0; i < list.length; i++) {
      const h = list[i];
      if (h.alive) h.tick(this);
    }
    if ((this.tick & 31) === 0) {
      this.humans = this.humans.filter((h) => h.alive);
    }
  }

  kingdomsTick() {
    if (this.era !== "sentient") return;
    for (const k of this.kingdoms) k.tick(this);
    if ((this.tick & 255) === 0) {
      this.kingdoms = this.kingdoms.filter((k) => k.population > 0);
    }
  }

  /** Auto-advance to sentient era when any organism has enough cells. */
  maybeEnterSentientEra() {
    if (this.era !== "primordial") return;
    if ((this.tick & 63) !== 0) return;
    for (const o of this.organisms) {
      if (o.alive && o.cells.length >= CONFIG.SENTIENT_TRIGGER_MAX_CELLS) {
        this.enterSentientEra();
        return;
      }
    }
  }

  enterSentientEra() {
    if (this.era === "sentient") return;
    this.era = "sentient";
    this.eventLog.push({ tick: this.tick, type: "era", msg: "The Sentient Era has begun — humans awaken!" });
    // Spawn humans from the largest organism colonies, then top up from random
    // grass tiles so the Sentient era is never DOA when there are no organisms.
    import("./civilization.js").then(({ Human }) => {
      const best = [...this.organisms]
        .filter((o) => o.alive)
        .sort((a, b) => b.cells.length - a.cells.length)
        .slice(0, 12);
      let spawned = 0;
      for (const o of best) {
        if (spawned >= CONFIG.HUMAN_INITIAL_SPAWN) break;
        for (const [dx, dy] of NEIGHBORS_8) {
          const x = o.x + dx;
          const y = o.y + dy;
          if (this.canHumanStand(x, y)) {
            const h = new Human(x, y);
            this.humans.push(h);
            this.setHumanAt(x, y, h);
            spawned++;
            break;
          }
        }
      }
      // Fallback: scatter remaining humans on any walkable tile so the
      // user-pressed "Advance Era" always produces a population.
      let tries = 0;
      while (spawned < CONFIG.HUMAN_INITIAL_SPAWN && tries++ < 800) {
        const x = randInt(2, this.W - 3);
        const y = randInt(2, this.H - 3);
        if (!this.canHumanStand(x, y)) continue;
        const h = new Human(x, y);
        this.humans.push(h);
        this.setHumanAt(x, y, h);
        spawned++;
      }
      // Seed a starter food field for the new humans so they don't immediately starve.
      for (let i = 0; i < this.size * 0.01; i++) {
        const x = randInt(0, this.W - 1);
        const y = randInt(0, this.H - 1);
        if (this.terrainAt(x, y) === TERRAIN.GRASS) this.addFood(x, y);
      }
    });
  }

  canHumanStand(x, y) {
    if (!this.inBounds(x, y)) return false;
    const t = this.terrainAt(x, y);
    if (t !== TERRAIN.GRASS && t !== TERRAIN.SAND && t !== TERRAIN.SNOW && t !== TERRAIN.DIRT) return false;
    return !this.humanAt[this.idx(x, y)] && !this.buildingAt[this.idx(x, y)];
  }

  setHumanAt(x, y, h) {
    if (!this.inBounds(x, y)) return;
    this.humanAt[this.idx(x, y)] = h;
  }

  setBuilding(x, y, b) {
    if (!this.inBounds(x, y)) return;
    this.buildingAt[this.idx(x, y)] = b;
    if (b) this.buildings.push(b);
  }

  claimTile(x, y, kingdomId) {
    if (!this.inBounds(x, y)) return;
    this.kingdomTerritory[this.idx(x, y)] = kingdomId;
  }

  kingdomAtTile(x, y) {
    if (!this.inBounds(x, y)) return -1;
    return this.kingdomTerritory[this.idx(x, y)];
  }

  // ----- inspector helpers -----
  describe(x, y) {
    if (!this.inBounds(x, y)) return null;
    const i = this.idx(x, y);
    const t = this.terrain[i];
    const food = this.food[i];
    const org = this.org[i];
    const h = this.humanAt[i];
    const b = this.buildingAt[i];
    const k = this.kingdomTerritory[i];
    return { x, y, terrain: t, food, organism: org, human: h, building: b, kingdom: k };
  }

  // ----- direct manipulation (god tools) -----
  paintTerrain(x, y, t) {
    if (!this.inBounds(x, y)) return;
    this.terrain[this.idx(x, y)] = t;
    if (!TERRAIN_WALKABLE[t]) {
      // kill anything standing here
      const o = this.org[this.idx(x, y)];
      if (o) o.die(this);
      const h = this.humanAt[this.idx(x, y)];
      if (h) h.alive = false;
    }
  }

  paintFood(x, y) {
    if (!this.inBounds(x, y)) return;
    if (this.terrainAt(x, y) === TERRAIN.GRASS) this.addFood(x, y);
  }

  spawnRandomOrganism(x, y) {
    if (!this.inBounds(x, y) || this.terrainAt(x, y) !== TERRAIN.GRASS) return false;
    const o = makeStarterOrganism(x, y);
    if (o.fits(this, x, y)) {
      o.place(this);
      this.organisms.push(o);
      return true;
    }
    return false;
  }

  spawnHumanAt(x, y) {
    if (!this.canHumanStand(x, y)) return false;
    return import("./civilization.js").then(({ Human }) => {
      const h = new Human(x, y);
      this.humans.push(h);
      this.setHumanAt(x, y, h);
      if (this.era !== "sentient") this.era = "sentient";
      return true;
    });
  }

  killAt(x, y) {
    const o = this.organismAt(x, y);
    if (o) o.die(this);
    const h = this.humanAt[this.idx(x, y)];
    if (h) h.alive = false;
  }

  pickRandomPosition() {
    return [randInt(0, this.W - 1), randInt(0, this.H - 1)];
  }
}

export function makeWorld(w, h) {
  return new World(w, h);
}
