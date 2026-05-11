// World: terrain, food, resources, occupants. Drives the per-tick simulation loop.

import { CONFIG, TERRAIN, TERRAIN_WALKABLE } from "./config.js";
import { chance, rand, randInt, pick, NEIGHBORS_4, NEIGHBORS_8 } from "./utils.js";
import { Organism, makeStarterOrganism } from "./organism.js";
import { Animal, SPECIES, randomAnimalGenes } from "./animal.js";

export class World {
  constructor(width = CONFIG.GRID_W, height = CONFIG.GRID_H) {
    this.W = width;
    this.H = height;
    this.size = width * height;
    this.terrain = new Uint8Array(this.size);
    this.food = new Uint8Array(this.size);
    // Resources packed per-tile
    this.wood = new Uint8Array(this.size);
    this.stoneOre = new Uint8Array(this.size);
    this.ironOre = new Uint8Array(this.size);
    this.microbe = new Uint8Array(this.size); // 0 = none, 1 = benign, 2 = pathogen

    this.org = new Array(this.size).fill(null); // Organism refs per tile
    this.humanAt = new Array(this.size).fill(null); // Human ref per tile
    this.animalAt = new Array(this.size).fill(null); // Animal ref per tile
    this.buildingAt = new Array(this.size).fill(null);
    this.kingdomTerritory = new Int16Array(this.size); // -1 unclaimed, else kingdom id
    this.kingdomTerritory.fill(-1);

    this.organisms = [];
    this.humans = [];
    this.animals = [];
    this.kingdoms = [];
    this.buildings = [];
    this.wars = []; // { a, b, ticks }
    this.era = "primordial";
    this.tick = 0;
    this.eventLog = [];
    this.generateTerrain();
    this.generateResources();
    this.seedMicrobes();
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

  // ----- resource accessors -----
  hasWood(x, y)  { return this.inBounds(x, y) && this.wood[this.idx(x, y)] > 0; }
  hasStone(x, y) { return this.inBounds(x, y) && this.stoneOre[this.idx(x, y)] > 0; }
  hasIron(x, y)  { return this.inBounds(x, y) && this.ironOre[this.idx(x, y)] > 0; }
  takeWood(x, y) {
    if (!this.hasWood(x, y)) return 0;
    this.wood[this.idx(x, y)]--;
    return 1;
  }
  takeStone(x, y) {
    if (!this.hasStone(x, y)) return 0;
    this.stoneOre[this.idx(x, y)]--;
    return 1;
  }
  takeIron(x, y) {
    if (!this.hasIron(x, y)) return 0;
    this.ironOre[this.idx(x, y)]--;
    return 1;
  }

  animalAtTile(x, y) {
    if (!this.inBounds(x, y)) return null;
    return this.animalAt[this.idx(x, y)];
  }
  setAnimalAt(x, y, a) {
    if (!this.inBounds(x, y)) return;
    this.animalAt[this.idx(x, y)] = a;
  }
  canAnimalStand(x, y) {
    if (!this.inBounds(x, y)) return false;
    const t = this.terrainAt(x, y);
    if (!TERRAIN_WALKABLE[t]) return false;
    if (this.animalAt[this.idx(x, y)]) return false;
    return true;
  }

  /** Scoring used by Eye senses. */
  cellInterest(x, y, self) {
    if (!this.inBounds(x, y)) return 0;
    let s = 0;
    if (this.food[this.idx(x, y)] > 0) s += 1;
    const other = this.org[this.idx(x, y)];
    if (other && other !== self) {
      if (other.killerCount > self.killerCount + 1) s -= 1.2;
      else if (self.killerCount > 0) s += 0.6;
    }
    return s;
  }

  // ----- terrain generation -----
  generateTerrain() {
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

  /** Place trees on grass and stone/iron ore on mountains. Called once at
   *  world birth — natural regrowth is in resourcesTick. */
  generateResources() {
    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        const t = this.terrainAt(x, y);
        const i = this.idx(x, y);
        if (t === TERRAIN.GRASS && chance(CONFIG.TREE_DENSITY)) {
          this.wood[i] = randInt(1, CONFIG.MAX_WOOD_PER_TILE);
        } else if (t === TERRAIN.MOUNTAIN || t === TERRAIN.SNOW) {
          // mountains hold stone and (rarer) iron
          if (chance(CONFIG.STONE_VEIN_CHANCE)) {
            this.stoneOre[i] = randInt(1, CONFIG.MAX_ORE_PER_TILE);
          }
          if (chance(CONFIG.IRON_VEIN_CHANCE)) {
            this.ironOre[i] = randInt(1, 2);
          }
        } else if (t === TERRAIN.DIRT && chance(0.04)) {
          // small chance of surface stone in dirt
          this.stoneOre[i] = 1;
        }
      }
    }
  }

  seedMicrobes() {
    for (let y = 0; y < this.H; y++) {
      for (let x = 0; x < this.W; x++) {
        if (this.terrainAt(x, y) === TERRAIN.GRASS && chance(CONFIG.MICROBE_START_DENSITY)) {
          this.microbe[this.idx(x, y)] = 1;
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
    this.seedAnimals();
  }

  seedAnimals(n = CONFIG.START_ANIMALS) {
    const speciesKeys = Object.keys(SPECIES);
    for (let i = 0; i < n; i++) {
      for (let tries = 0; tries < 40; tries++) {
        const x = randInt(2, this.W - 3);
        const y = randInt(2, this.H - 3);
        if (!this.canAnimalStand(x, y)) continue;
        const sp = pick(speciesKeys);
        const a = new Animal(x, y, sp, randomAnimalGenes(sp));
        this.animals.push(a);
        this.setAnimalAt(x, y, a);
        break;
      }
    }
  }

  // ----- per-tick driver -----
  step() {
    this.tick++;
    this.terrainTick();
    this.resourcesTick();
    this.microbeTick();
    this.organismsTick();
    this.animalsTick();
    this.humansTick();
    this.kingdomsTick();
    this.maybeEnterSentientEra();
  }

  terrainTick() {
    const samples = (this.size * 0.01) | 0;
    for (let s = 0; s < samples; s++) {
      const i = (rand() * this.size) | 0;
      const t = this.terrain[i];
      if (t === TERRAIN.DIRT && chance(CONFIG.GRASS_REGROW_CHANCE * 100)) {
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

  resourcesTick() {
    // Forests slowly regrow on grass tiles adjacent to existing trees.
    const samples = (this.size * 0.004) | 0;
    for (let s = 0; s < samples; s++) {
      const i = (rand() * this.size) | 0;
      if (this.terrain[i] !== TERRAIN.GRASS) continue;
      if (this.wood[i] >= CONFIG.MAX_WOOD_PER_TILE) continue;
      if (!chance(CONFIG.TREE_REGROW_CHANCE * 200)) continue;
      const x = i % this.W;
      const y = (i / this.W) | 0;
      let neigh = 0;
      for (const [dx, dy] of NEIGHBORS_4) {
        if (this.hasWood(x + dx, y + dy)) neigh++;
      }
      if (neigh > 0) this.wood[i] = Math.min(CONFIG.MAX_WOOD_PER_TILE, this.wood[i] + 1);
    }
  }

  microbeTick() {
    // Spreading microflora — a low-resolution organic veneer over the grass.
    const samples = (this.size * 0.004) | 0;
    for (let s = 0; s < samples; s++) {
      const i = (rand() * this.size) | 0;
      const m = this.microbe[i];
      if (m === 0) continue;
      // chance to decay
      if (chance(CONFIG.MICROBE_DECAY_CHANCE)) {
        this.microbe[i] = 0;
        continue;
      }
      // chance to spread to a grass neighbor
      if (chance(CONFIG.MICROBE_SPREAD_CHANCE)) {
        const x = i % this.W;
        const y = (i / this.W) | 0;
        const [dx, dy] = pick(NEIGHBORS_4);
        const nx = x + dx;
        const ny = y + dy;
        if (this.inBounds(nx, ny) &&
            this.terrainAt(nx, ny) === TERRAIN.GRASS &&
            this.microbe[this.idx(nx, ny)] === 0) {
          this.microbe[this.idx(nx, ny)] = m;
        }
      }
      // ultra-rare pathogenic mutation, leads to a local plague
      if (m === 1 && chance(CONFIG.MICROBE_PATHOGEN_CHANCE)) {
        this.microbe[i] = 2;
        this.eventLog.push({
          tick: this.tick,
          type: "disaster",
          msg: "A microbe turned pathogenic.",
        });
      }
      // pathogens that touch a human kill them and dissipate
      if (m === 2) {
        const x = i % this.W;
        const y = (i / this.W) | 0;
        for (const [dx, dy] of NEIGHBORS_8) {
          const h = this.humanAt[this.idx((x + dx + this.W) % this.W, (y + dy + this.H) % this.H)];
          if (h && h.alive && chance(0.02)) {
            h.alive = false;
            this.microbe[i] = 0;
            break;
          }
        }
      }
    }
  }

  organismsTick() {
    const list = this.organisms;
    for (let i = 0; i < list.length; i++) {
      list[i].tick(this);
    }
    if ((this.tick & 31) === 0) {
      this.organisms = this.organisms.filter((o) => o.alive);
    }
  }

  animalsTick() {
    const list = this.animals;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.alive) a.tick(this);
    }
    if ((this.tick & 31) === 0) {
      this.animals = this.animals.filter((a) => a.alive);
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
    import("./civilization.js").then(({ Human }) => {
      // Stagger the starting age of the initial generation so they
      // don't all die of old age within the same handful of ticks
      // (which previously collapsed the whole population just as
      // wars were ending).
      const spreadAge = (h) => {
        h.age = randInt(0, Math.floor(h.lifespan * 0.4));
      };
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
            spreadAge(h);
            this.humans.push(h);
            this.setHumanAt(x, y, h);
            spawned++;
            break;
          }
        }
      }
      let tries = 0;
      while (spawned < CONFIG.HUMAN_INITIAL_SPAWN && tries++ < 800) {
        const x = randInt(2, this.W - 3);
        const y = randInt(2, this.H - 3);
        if (!this.canHumanStand(x, y)) continue;
        const h = new Human(x, y);
        spreadAge(h);
        this.humans.push(h);
        this.setHumanAt(x, y, h);
        spawned++;
      }
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
    const wood = this.wood[i];
    const stone = this.stoneOre[i];
    const iron = this.ironOre[i];
    const microbe = this.microbe[i];
    const org = this.org[i];
    const h = this.humanAt[i];
    const animal = this.animalAt[i];
    const b = this.buildingAt[i];
    const k = this.kingdomTerritory[i];
    return {
      x, y, terrain: t, food, wood, stone, iron, microbe,
      organism: org, human: h, animal, building: b, kingdom: k,
    };
  }

  // ----- direct manipulation (god tools) -----
  paintTerrain(x, y, t) {
    if (!this.inBounds(x, y)) return;
    const i = this.idx(x, y);
    this.terrain[i] = t;
    // changing terrain wipes resource overlays that don't belong there
    if (t !== TERRAIN.GRASS) this.wood[i] = 0;
    if (t !== TERRAIN.MOUNTAIN && t !== TERRAIN.SNOW && t !== TERRAIN.DIRT) {
      this.stoneOre[i] = 0;
      this.ironOre[i] = 0;
    }
    if (t !== TERRAIN.GRASS) this.microbe[i] = 0;
    if (!TERRAIN_WALKABLE[t]) {
      const o = this.org[i];
      if (o) o.die(this);
      const h = this.humanAt[i];
      if (h) h.alive = false;
      const a = this.animalAt[i];
      if (a) a.alive = false;
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
    const a = this.animalAt[this.idx(x, y)];
    if (a) a.alive = false;
  }

  pickRandomPosition() {
    return [randInt(0, this.W - 1), randInt(0, this.H - 1)];
  }
}

export function makeWorld(w, h) {
  return new World(w, h);
}
