// Animals — herbivores and predators that evolve over generations.
// They share the world with humans: predators may hunt humans,
// humans may hunt prey for food, and prey graze on grass food tiles.

import { CONFIG, TERRAIN } from "./config.js";
import { chance, rand, randInt, pick, clamp, jitter, NEIGHBORS_4, NEIGHBORS_8 } from "./utils.js";
import { newAnimalBrain } from "./brain.js";

// Directional offsets that line up with the animal brain's 9 movement
// outputs in the order [NW, N, NE, W, stay, E, SW, S, SE].
const ANIMAL_MOVES = [
  [-1, -1], [0, -1], [1, -1],
  [-1,  0], [0,  0], [1,  0],
  [-1,  1], [0,  1], [1,  1],
];

let animalId = 1;

// Species table — defaults can mutate via genes per-individual.
export const SPECIES = {
  DEER: { name: "Deer", color: "#c8a06a", carnivore: false, speedMul: 1.0, threat: 0.0 },
  BOAR: { name: "Boar", color: "#86604a", carnivore: false, speedMul: 0.85, threat: 0.1 },
  WOLF: { name: "Wolf", color: "#9faab2", carnivore: true,  speedMul: 0.95, threat: 0.7 },
  FOX:  { name: "Fox",  color: "#d8794a", carnivore: true,  speedMul: 1.1, threat: 0.3 },
};

export function randomAnimalGenes(speciesKey) {
  const def = SPECIES[speciesKey];
  return {
    speed:     clamp(0.5 + jitter(0.25), 0.1, 1.0),
    strength:  clamp((def.carnivore ? 0.6 : 0.3) + jitter(0.25), 0.05, 1.0),
    fertility: clamp(0.5 + jitter(0.25), 0.05, 1.0),
    vision:    clamp(0.5 + jitter(0.25), 0.05, 1.0),
  };
}

export function inheritAnimalGenes(parent, rate = CONFIG.ANIMAL_GENE_MUTATE_RATE) {
  const g = {};
  for (const k of ["speed", "strength", "fertility", "vision"]) {
    const base = parent[k];
    g[k] = clamp(chance(rate) ? base + jitter(0.2) : base + jitter(0.04), 0.05, 1.0);
  }
  return g;
}

export class Animal {
  constructor(x, y, speciesKey, genes, brain = null) {
    this.id = animalId++;
    this.x = x;
    this.y = y;
    this.species = speciesKey;       // string key into SPECIES
    this.genes = genes || randomAnimalGenes(speciesKey);
    this.hunger = 1.0;
    this.age = 0;
    this.lifespan = CONFIG.ANIMAL_LIFESPAN + randInt(-200, 200);
    this.alive = true;
    this.moveCooldown = randInt(0, CONFIG.ANIMAL_MOVE_INTERVAL);
    // Brain: tiny neural net that scores 8 movement directions + stay.
    // Inherited with mutation through `tryReproduce`; selection picks
    // out the wirings that find food and avoid predators best.
    this.brain = brain || newAnimalBrain();
    this.brain.reset();
  }

  def() { return SPECIES[this.species]; }
  isCarnivore() { return this.def().carnivore; }

  tick(world) {
    if (!this.alive) {
      world.setAnimalAt(this.x, this.y, null);
      return;
    }
    this.age++;
    this.hunger -= CONFIG.ANIMAL_HUNGER_TICK;
    if (this.age > this.lifespan || this.hunger <= 0) {
      this.die(world);
      return;
    }

    // forage
    if (this.tryEat(world)) {
      // ate something
    }

    // move toward something interesting
    if (--this.moveCooldown <= 0) {
      // higher speed gene = shorter cooldown
      this.moveCooldown = Math.max(2, Math.round(CONFIG.ANIMAL_MOVE_INTERVAL * (1.4 - this.genes.speed) / this.def().speedMul));
      this.moveStep(world);
    }

    // reproduce
    if (this.hunger >= CONFIG.ANIMAL_REPRODUCE_AT && chance(0.004 * this.genes.fertility)) {
      this.tryReproduce(world);
    }
  }

  tryEat(world) {
    if (this.isCarnivore()) {
      // hunt small organisms, other prey animals, or humans
      for (const [dx, dy] of NEIGHBORS_8) {
        const nx = this.x + dx;
        const ny = this.y + dy;
        if (!world.inBounds(nx, ny)) continue;
        // prey animal
        const other = world.animalAtTile(nx, ny);
        if (other && other !== this && !other.isCarnivore()) {
          if (chance(0.4 + this.genes.strength * 0.4 - other.genes.speed * 0.3)) {
            other.alive = false;
            this.hunger = Math.min(1.6, this.hunger + CONFIG.ANIMAL_FOOD_GAIN_FROM_HUNT);
            return true;
          }
        }
        // wandering organism
        const o = world.organismAt(nx, ny);
        if (o && o.cells.length <= 3) {
          o.die(world);
          this.hunger = Math.min(1.6, this.hunger + CONFIG.ANIMAL_EAT_GAIN);
          return true;
        }
        // attack humans only rarely; warriors fight back. A lone human in
        // their own territory has the kingdom's tech tier defending them.
        const h = world.humanAt[world.idx(nx, ny)];
        if (h && h.alive) {
          const warriorDef = h.role === "warrior" ? 0.6 : 0.0;
          const techDef = h.kingdom ? h.kingdom.techTier * 0.08 : 0;
          const pAtt = 0.025 * this.genes.strength * (1 - warriorDef - techDef);
          if (pAtt > 0 && chance(pAtt)) {
            h.alive = false;
            if (h.kingdom) h.kingdom.population = Math.max(0, h.kingdom.population - 1);
            this.hunger = Math.min(1.6, this.hunger + CONFIG.ANIMAL_FOOD_GAIN_FROM_HUNT);
            return true;
          }
        }
      }
      return false;
    }
    // herbivore: eat food on tile or adjacent, or graze on microbes
    for (const [dx, dy] of [[0, 0], ...NEIGHBORS_4]) {
      const nx = this.x + dx;
      const ny = this.y + dy;
      if (!world.inBounds(nx, ny)) continue;
      if (world.takeFood(nx, ny)) {
        this.hunger = Math.min(1.6, this.hunger + CONFIG.ANIMAL_EAT_GAIN);
        return true;
      }
    }
    // grazing on microbe-rich grass gives a small nibble
    const here = world.idx(this.x, this.y);
    if (world.microbe[here] === 1 && chance(0.3)) {
      world.microbe[here] = 0;
      this.hunger = Math.min(1.6, this.hunger + 0.1);
      return true;
    }
    return false;
  }

  moveStep(world) {
    const carnivore = this.isCarnivore();
    // Coarse 9-tile senses driven by genes.vision. Each is in {-1, +1}.
    const visionTiles = Math.max(1, (this.genes.vision * 6) | 0);
    let foodHere = world.hasFood(this.x, this.y) ? 1 : -1;
    let foodVisible = -1;
    let predClose = -1;
    let preyClose = -1;
    let humanClose = -1;
    // Track the nearest food / prey direction so a starving animal can
    // bypass the brain and head straight at it (otherwise a randomly
    // initialised brain can override the food drive and starve).
    let bestFoodDx = 0, bestFoodDy = 0, bestFoodD = Infinity;
    let bestPreyDx = 0, bestPreyDy = 0, bestPreyD = Infinity;
    for (let dy = -visionTiles; dy <= visionTiles; dy++) {
      for (let dx = -visionTiles; dx <= visionTiles; dx++) {
        const nx = this.x + dx;
        const ny = this.y + dy;
        if (!world.inBounds(nx, ny)) continue;
        const d = dx * dx + dy * dy;
        if (world.hasFood(nx, ny)) {
          if (foodVisible < 1) foodVisible = 1;
          if (d < bestFoodD) { bestFoodD = d; bestFoodDx = dx; bestFoodDy = dy; }
        }
        const a = world.animalAtTile(nx, ny);
        if (a && a !== this) {
          if (a.isCarnivore()) predClose = 1;
          else {
            preyClose = 1;
            if (carnivore && d < bestPreyD) { bestPreyD = d; bestPreyDx = dx; bestPreyDy = dy; }
          }
        }
        const h = world.humanAt[world.idx(nx, ny)];
        if (h && h.alive) {
          humanClose = 1;
          if (carnivore && d < bestPreyD) { bestPreyD = d; bestPreyDx = dx; bestPreyDy = dy; }
        }
      }
    }
    const inputs = new Float32Array([
      clamp(this.hunger - 1.0, -1, 1),
      carnivore ? 1 : -1,
      foodHere,
      foodVisible,
      predClose,
      preyClose,
      humanClose,
      clamp((this.age / this.lifespan) * 2 - 1, -1, 1),
    ]);
    const brainOut = this.brain.think(inputs);

    // Reflex: when really hungry, step straight toward the nearest
    // food (herbivores) or prey (carnivores) if any is visible. Brain
    // still ran above so its hidden state stays in sync, but it does
    // not get to veto survival.
    const starving = this.hunger < 0.5;
    let reflexTarget = null;
    if (starving) {
      if (!carnivore && bestFoodD < Infinity) reflexTarget = [bestFoodDx, bestFoodDy];
      else if (carnivore && bestPreyD < Infinity) reflexTarget = [bestPreyDx, bestPreyDy];
    }

    // Score every move: brain output for that direction + a small
    // hand-coded survival prior, so even random brains still avoid
    // walking into walls or onto a predator.
    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < ANIMAL_MOVES.length; i++) {
      const [dx, dy] = ANIMAL_MOVES[i];
      const nx = this.x + dx;
      const ny = this.y + dy;
      const isStay = dx === 0 && dy === 0;
      if (!isStay && !world.canAnimalStand(nx, ny)) continue;
      let score = brainOut[i] * 0.6 + rand() * 0.05;
      if (!isStay) {
        if (world.hasFood(nx, ny)) score += carnivore ? 0.2 : 1.2;
        if (world.microbe[world.idx(nx, ny)] === 1 && !carnivore) score += 0.2;
        const a = world.animalAtTile(nx, ny);
        if (a) {
          // can't actually step onto an occupied tile, but adjacency
          // still informs the brain's bias for next tick.
          score -= 0.4;
        }
        if (reflexTarget) {
          // Strong pull toward the reflex direction (sign-aligned step).
          const sx = Math.sign(reflexTarget[0]);
          const sy = Math.sign(reflexTarget[1]);
          if ((sx === 0 || Math.sign(dx) === sx) && (sy === 0 || Math.sign(dy) === sy)) {
            score += 2.0;
          }
        }
      }
      if (score > bestScore) { bestScore = score; best = [nx, ny]; }
    }
    if (best && (best[0] !== this.x || best[1] !== this.y)) {
      world.setAnimalAt(this.x, this.y, null);
      this.x = best[0];
      this.y = best[1];
      world.setAnimalAt(this.x, this.y, this);
    }
  }

  tryReproduce(world) {
    for (const [dx, dy] of NEIGHBORS_8) {
      const nx = this.x + dx;
      const ny = this.y + dy;
      if (!world.canAnimalStand(nx, ny)) continue;
      this.hunger -= CONFIG.ANIMAL_REPRODUCE_COST;
      const childGenes = inheritAnimalGenes(this.genes);
      // Brain inheritance: asexual mutation (animals don't pair here).
      // Smarter (higher-vision) animals mutate a little less.
      const brainRate = CONFIG.ANIMAL_GENE_MUTATE_RATE * (1.2 - 0.4 * childGenes.vision);
      const childBrain = this.brain.mutated(brainRate);
      const child = new Animal(nx, ny, this.species, childGenes, childBrain);
      child.hunger = 0.8;
      world.animals.push(child);
      world.setAnimalAt(nx, ny, child);
      return;
    }
  }

  die(world) {
    if (!this.alive) return;
    this.alive = false;
    world.setAnimalAt(this.x, this.y, null);
    // herbivore corpse drops food on grass
    if (!this.isCarnivore() && world.terrainAt(this.x, this.y) === TERRAIN.GRASS && chance(0.6)) {
      world.addFood(this.x, this.y);
    }
  }
}

export const SPECIES_KEYS = Object.keys(SPECIES);
