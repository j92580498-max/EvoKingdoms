// Humans, tribes, kingdoms, religion, genes, real-resource economy and wars.

import { CONFIG, TERRAIN, TERRAIN_WALKABLE } from "./config.js";
import {
  chance, rand, randInt, pick, clamp,
  NEIGHBORS_4, NEIGHBORS_8,
  kingdomName, humanName, dist2,
  pickCulture, pickReligion,
  randomHumanGenes, inheritGenes,
} from "./utils.js";

let humanId = 1;
let kingdomId = 1;

export class Human {
  constructor(x, y, kingdom = null, genes = null) {
    this.id = humanId++;
    this.x = x;
    this.y = y;
    this.kingdom = kingdom;
    this.name = humanName();
    this.hunger = 1.0;
    this.age = 0;
    this.lifespan = CONFIG.HUMAN_LIFESPAN + randInt(-600, 800);
    this.moveCooldown = 0;
    this.alive = true;
    this.buildCooldown = randInt(0, CONFIG.HUMAN_BUILD_INTERVAL);
    this.atWar = false;
    this.genes = genes || randomHumanGenes();
    this.generation = 1;
    // What this human is currently carrying back to their kingdom's coffers.
    this.carry = { wood: 0, stone: 0, iron: 0 };
  }

  carryTotal() {
    return this.carry.wood + this.carry.stone + this.carry.iron;
  }

  tick(world) {
    if (!this.alive) {
      world.setHumanAt(this.x, this.y, null);
      return;
    }
    this.age++;
    this.hunger -= CONFIG.HUMAN_HUNGER_TICK;
    if (this.age > this.lifespan || this.hunger <= 0) {
      this.die(world);
      return;
    }

    // forage / hunt
    if (this.hunger < 1.4 && this.tryEat(world)) {
      // ate
    } else if (this.moveCooldown-- <= 0) {
      this.moveCooldown = CONFIG.HUMAN_MOVE_INTERVAL;
      this.moveStep(world);
    }

    // gather adjacent resources (real harvesting)
    if (this.kingdom && this.carryTotal() < CONFIG.HUMAN_CARRY_MAX) {
      this.tryHarvest(world);
    }

    // deposit at any owned building (capital counts) when carrying anything
    if (this.kingdom && this.carryTotal() > 0) this.tryDeposit(world);

    // attempt reproduction (fertility gene biases chance)
    if (this.hunger >= CONFIG.HUMAN_REPRODUCE_AT && chance(0.0035 + 0.006 * this.genes.fertility)) {
      this.tryReproduce(world);
    }

    // attempt to build something for the kingdom
    if (this.kingdom && --this.buildCooldown <= 0) {
      this.buildCooldown = CONFIG.HUMAN_BUILD_INTERVAL + randInt(-30, 60);
      this.kingdom.maybeBuild(world, this);
    }

    // attempt to claim or join a kingdom
    if (!this.kingdom) this.maybeJoinOrFoundKingdom(world);

    // war combat
    if (this.kingdom && this.kingdom.warTarget) {
      this.maybeAttackEnemy(world);
    }
  }

  tryEat(world) {
    // 1. eat food on current tile or adjacent
    for (const [dx, dy] of [[0, 0], ...NEIGHBORS_4]) {
      const nx = this.x + dx;
      const ny = this.y + dy;
      if (world.inBounds(nx, ny) && world.takeFood(nx, ny)) {
        this.hunger += CONFIG.HUMAN_EAT_GAIN;
        return true;
      }
    }
    // 2. hunt nearby small organisms or prey animals
    for (const [dx, dy] of NEIGHBORS_8) {
      const nx = this.x + dx;
      const ny = this.y + dy;
      const o = world.organismAt(nx, ny);
      if (o && o.cells.length <= 3) {
        o.die(world);
        this.hunger += CONFIG.HUMAN_EAT_GAIN * 1.5;
        return true;
      }
      const a = world.animalAtTile(nx, ny);
      if (a && a.alive && !a.isCarnivore() && chance(0.4 + this.genes.strength * 0.3)) {
        a.alive = false;
        this.hunger += CONFIG.HUMAN_EAT_GAIN * 1.6;
        if (this.kingdom) this.kingdom.history.push({ tick: world.tick, msg: `${this.name} killed a ${a.def().name.toLowerCase()}.` });
        return true;
      }
    }
    return false;
  }

  tryHarvest(world) {
    // chop wood / mine stone or iron from a single neighbouring tile per tick
    if (!chance(CONFIG.HUMAN_HARVEST_CHANCE)) return;
    for (const [dx, dy] of NEIGHBORS_8) {
      const nx = this.x + dx;
      const ny = this.y + dy;
      if (!world.inBounds(nx, ny)) continue;
      if (this.carry.wood + this.carry.stone + this.carry.iron >= CONFIG.HUMAN_CARRY_MAX) return;
      if (world.takeWood(nx, ny)) { this.carry.wood++; return; }
      // smarts gene lets people prefer iron over stone when both are available
      if (this.genes.smarts > 0.55 && world.takeIron(nx, ny)) { this.carry.iron++; return; }
      if (world.takeStone(nx, ny)) { this.carry.stone++; return; }
      if (world.takeIron(nx, ny)) { this.carry.iron++; return; }
    }
  }

  tryDeposit(world) {
    // any building of the same kingdom (or its capital) counts as deposit point
    const k = this.kingdom;
    if (!k) return;
    const here = (x, y) => Math.abs(this.x - x) <= 1 && Math.abs(this.y - y) <= 1;
    if (here(k.capital.x, k.capital.y)) {
      k.resources.wood += this.carry.wood;
      k.resources.stone += this.carry.stone;
      k.resources.iron += this.carry.iron;
      this.carry.wood = this.carry.stone = this.carry.iron = 0;
      return;
    }
    for (const b of k.buildings) {
      if (here(b.x, b.y)) {
        k.resources.wood += this.carry.wood;
        k.resources.stone += this.carry.stone;
        k.resources.iron += this.carry.iron;
        this.carry.wood = this.carry.stone = this.carry.iron = 0;
        return;
      }
    }
  }

  moveStep(world) {
    let best = null;
    let bestScore = -Infinity;
    const seekResource = !!this.kingdom && this.carryTotal() < CONFIG.HUMAN_CARRY_MAX;
    const goingHome = !!this.kingdom && this.carryTotal() >= CONFIG.HUMAN_CARRY_MAX;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = this.x + dx;
        const ny = this.y + dy;
        if (!world.canHumanStand(nx, ny)) continue;
        let score = rand() * 0.3;
        if (world.hasFood(nx, ny)) score += 2;
        if (seekResource) {
          if (world.hasWood(nx, ny)) score += 1.5;
          if (world.hasStone(nx, ny)) score += 1.1;
          if (world.hasIron(nx, ny)) score += 1.3 + this.genes.smarts;
        }
        // avoid predators
        const aHere = world.animalAtTile(nx, ny);
        if (aHere && aHere.isCarnivore()) score -= 2;
        if (this.kingdom && world.kingdomAtTile(nx, ny) === this.kingdom.id) score += 0.3;
        if (this.kingdom && this.kingdom.capital) {
          const d = Math.sqrt(dist2(nx, ny, this.kingdom.capital.x, this.kingdom.capital.y));
          if (goingHome) score -= d * 0.05;
          else score -= d * 0.005 * (this.hunger < 0.7 ? 1.5 : 0.5);
        }
        if (score > bestScore) {
          bestScore = score;
          best = [nx, ny];
        }
      }
    }
    if (best) {
      world.setHumanAt(this.x, this.y, null);
      this.x = best[0];
      this.y = best[1];
      world.setHumanAt(this.x, this.y, this);
    }
  }

  tryReproduce(world) {
    // Find an adjacent partner (same kingdom or both tribeless) for gene mixing
    let partner = null;
    for (const [dx, dy] of NEIGHBORS_8) {
      const nx = this.x + dx;
      const ny = this.y + dy;
      if (!world.inBounds(nx, ny)) continue;
      const h = world.humanAt[world.idx(nx, ny)];
      if (h && h !== this && h.alive && h.kingdom === this.kingdom) {
        partner = h;
        break;
      }
    }
    // Place child adjacent
    for (const [dx, dy] of NEIGHBORS_8) {
      const nx = this.x + dx;
      const ny = this.y + dy;
      if (!world.canHumanStand(nx, ny)) continue;
      this.hunger -= CONFIG.HUMAN_REPRODUCE_COST;
      const childGenes = inheritGenes(this.genes, partner ? partner.genes : null, CONFIG.HUMAN_GENE_MUTATE_RATE);
      const child = new Human(nx, ny, this.kingdom, childGenes);
      child.hunger = CONFIG.HUMAN_BABY_HUNGER;
      child.generation = (this.generation || 1) + 1;
      world.humans.push(child);
      world.setHumanAt(nx, ny, child);
      if (this.kingdom) this.kingdom.population++;
      return;
    }
  }

  maybeJoinOrFoundKingdom(world) {
    for (const [dx, dy] of NEIGHBORS_8) {
      const nx = this.x + dx;
      const ny = this.y + dy;
      if (!world.inBounds(nx, ny)) continue;
      const other = world.humanAt[world.idx(nx, ny)];
      if (other && other.kingdom) {
        this.kingdom = other.kingdom;
        other.kingdom.population++;
        return;
      }
    }
    if (!chance(0.003)) return;
    let nearby = 1;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const nx = this.x + dx;
        const ny = this.y + dy;
        if (!world.inBounds(nx, ny)) continue;
        const o = world.humanAt[world.idx(nx, ny)];
        if (o && !o.kingdom) nearby++;
      }
    }
    if (nearby >= CONFIG.KINGDOM_FOUND_POP) {
      const k = new Kingdom(this.x, this.y, world);
      world.kingdoms.push(k);
      this.kingdom = k;
      k.population = 1;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const nx = this.x + dx;
          const ny = this.y + dy;
          if (!world.inBounds(nx, ny)) continue;
          const o = world.humanAt[world.idx(nx, ny)];
          if (o && !o.kingdom) {
            o.kingdom = k;
            k.population++;
          }
        }
      }
      world.eventLog.push({
        tick: world.tick,
        type: "kingdom",
        msg: `${k.culture} folk founded ${k.name} (${k.religion.name}).`,
      });
    }
  }

  maybeAttackEnemy(world) {
    const enemy = this.kingdom.warTarget;
    for (const [dx, dy] of NEIGHBORS_8) {
      const nx = this.x + dx;
      const ny = this.y + dy;
      if (!world.inBounds(nx, ny)) continue;
      const other = world.humanAt[world.idx(nx, ny)];
      if (other && other.kingdom === enemy) {
        // strength gene + agg gene + tech tier all contribute
        const aBonus = this.genes.strength * 0.4 + this.genes.agg * 0.2;
        const bDef = (other.genes.strength + 0.5) * 0.5;
        const p = CONFIG.HUMAN_FIGHT_CHANCE * (1 + this.kingdom.techTier * 0.25) * (1 + aBonus) / bDef;
        if (chance(p)) {
          other.alive = false;
          if (other.kingdom) other.kingdom.population--;
          break;
        }
      }
    }
  }

  die(world) {
    this.alive = false;
    world.setHumanAt(this.x, this.y, null);
    if (this.kingdom) this.kingdom.population = Math.max(0, this.kingdom.population - 1);
    if (world.terrainAt(this.x, this.y) === TERRAIN.GRASS && chance(0.4)) {
      world.addFood(this.x, this.y);
    }
  }
}

let buildingId = 1;
export class Building {
  constructor(x, y, kind, kingdom) {
    this.id = buildingId++;
    this.x = x;
    this.y = y;
    this.kind = kind; // 'shrine' | 'village' | 'town' | 'castle'
    this.kingdom = kingdom;
  }
}

export class Kingdom {
  constructor(x, y, world = null) {
    this.id = kingdomId++;
    this.name = kingdomName();
    this.culture = pickCulture(new Set(world ? world.kingdoms.map((k) => k.culture) : []));
    this.religion = pickReligion();
    this.color = `hsl(${(rand() * 360) | 0} 70% 55%)`;
    this.bannerColor = this.religion.color;
    this.capital = { x, y };
    this.population = 0;
    this.techTier = 0;
    this.warTarget = null;
    this.warTicks = 0;
    this.tilesClaimed = 0;
    this.buildings = [];
    this.history = [];
    this.resources = { wood: 0, stone: 0, iron: 0 };
  }

  tick(world) {
    // claim adjacent unclaimed tiles around capital + buildings
    if ((world.tick & 31) === 0) this.expandTerritory(world);

    // tech advancement — smarts gene of average citizen accelerates this
    if ((world.tick & 63) === 0) {
      // sum smarts to compute a tech bonus (rare drift)
      let smartsSum = 0;
      let count = 0;
      for (const h of world.humans) {
        if (h.alive && h.kingdom === this) { smartsSum += h.genes.smarts; count++; }
      }
      const meanSmarts = count ? smartsSum / count : 0.5;
      const effectivePop = Math.round(this.population * (0.7 + meanSmarts * 0.6));
      while (
        this.techTier < CONFIG.TECH_TIERS.length - 1 &&
        effectivePop >= CONFIG.TECH_THRESHOLDS[this.techTier + 1]
      ) {
        this.techTier++;
        world.eventLog.push({
          tick: world.tick,
          type: "tech",
          msg: `${this.culture} ${this.name} entered the ${CONFIG.TECH_TIERS[this.techTier]} Age.`,
        });
      }
    }

    // wars: declare/end — aggression gene biases declaration
    if (!this.warTarget) {
      // mean aggression of citizens
      let agg = 0;
      let n = 0;
      for (const h of world.humans) {
        if (h.alive && h.kingdom === this) { agg += h.genes.agg; n++; }
      }
      const meanAgg = n ? agg / n : 0.5;
      if (chance(CONFIG.WAR_DECLARE_CHANCE * Math.max(this.population, 1) * 0.2 * (0.5 + meanAgg))) {
        const enemies = world.kingdoms.filter((k) => k !== this && k.population > 0);
        if (enemies.length) {
          const enemy = pick(enemies);
          this.warTarget = enemy;
          enemy.warTarget = this;
          this.warTicks = 0;
          world.eventLog.push({
            tick: world.tick,
            type: "war",
            msg: `${this.culture} ${this.name} declared war on ${enemy.culture} ${enemy.name}.`,
          });
        }
      }
    } else {
      this.warTicks++;
      if (this.warTarget.population <= 0) {
        world.eventLog.push({
          tick: world.tick,
          type: "war",
          msg: `${this.culture} ${this.name} annihilated ${this.warTarget.culture} ${this.warTarget.name}!`,
        });
        const dead = this.warTarget;
        this.warTarget = null;
        dead.warTarget = null;
      } else if (chance(CONFIG.WAR_END_CHANCE)) {
        world.eventLog.push({
          tick: world.tick,
          type: "war",
          msg: `${this.culture} ${this.name} signed peace with ${this.warTarget.culture} ${this.warTarget.name}.`,
        });
        const enemy = this.warTarget;
        this.warTarget = null;
        if (enemy.warTarget === this) enemy.warTarget = null;
      }
    }
  }

  expandTerritory(world) {
    if (this.population <= 0) return;
    const ring = [this.capital, ...this.buildings];
    const frontier = [];
    for (const o of ring) frontier.push([o.x, o.y]);
    let claimedThisTick = 0;
    const maxClaim = Math.min(8, 1 + (this.population >> 1));
    while (frontier.length && claimedThisTick < maxClaim) {
      const [x, y] = frontier.shift();
      for (const [dx, dy] of NEIGHBORS_4) {
        const nx = x + dx;
        const ny = y + dy;
        if (!world.inBounds(nx, ny)) continue;
        const t = world.terrainAt(nx, ny);
        if (!TERRAIN_WALKABLE[t]) continue;
        const cur = world.kingdomAtTile(nx, ny);
        if (cur === -1) {
          world.claimTile(nx, ny, this.id);
          this.tilesClaimed++;
          claimedThisTick++;
          if (claimedThisTick >= maxClaim) break;
        }
      }
    }
  }

  /** Pick the next viable building kind: shrine → village → town → castle.
   *  Each kind requires a population threshold AND enough resources in the
   *  kingdom's coffers. Buildings are constructed near `founder`. */
  maybeBuild(world, founder) {
    const pop = this.population;
    const counts = { shrine: 0, village: 0, town: 0, castle: 0 };
    for (const b of this.buildings) counts[b.kind] = (counts[b.kind] || 0) + 1;

    let kind = null;
    // Shrine: faith-driven; goes up early if any citizen is very faithful.
    if (counts.shrine < 1 && pop >= CONFIG.BUILD_COSTS.shrine.atPop && this.meanFaith(world) > 0.45) kind = "shrine";
    else if (pop >= CONFIG.BUILD_COSTS.castle.atPop && counts.castle === 0 && this.techTier >= CONFIG.BUILD_COSTS.castle.minTech) kind = "castle";
    else if (pop >= CONFIG.BUILD_COSTS.town.atPop && counts.town < 1 + (pop / 30 | 0) && this.techTier >= CONFIG.BUILD_COSTS.town.minTech) kind = "town";
    else if (pop >= CONFIG.BUILD_COSTS.village.atPop && counts.village < 1 + (pop / 10 | 0)) kind = "village";
    if (!kind) return;

    const cost = CONFIG.BUILD_COSTS[kind];
    if (this.resources.wood < cost.wood) return;
    if (this.resources.stone < cost.stone) return;
    if (this.resources.iron < cost.iron) return;

    for (const [dx, dy] of NEIGHBORS_8) {
      const x = founder.x + dx;
      const y = founder.y + dy;
      if (!world.inBounds(x, y)) continue;
      const t = world.terrainAt(x, y);
      if (!TERRAIN_WALKABLE[t]) continue;
      if (world.buildingAt[world.idx(x, y)]) continue;

      // Pay the cost only once we've found a slot.
      this.resources.wood -= cost.wood;
      this.resources.stone -= cost.stone;
      this.resources.iron -= cost.iron;

      const b = new Building(x, y, kind, this);
      world.setBuilding(x, y, b);
      this.buildings.push(b);
      if (kind === "shrine") {
        world.eventLog.push({ tick: world.tick, type: "build", msg: `${this.culture} ${this.name} raised a shrine to ${this.religion.name}.` });
      } else if (kind === "castle") {
        world.eventLog.push({ tick: world.tick, type: "build", msg: `${this.culture} ${this.name} raised a castle.` });
      } else if (kind === "town") {
        world.eventLog.push({ tick: world.tick, type: "build", msg: `${this.culture} ${this.name} built a new town.` });
      }
      return;
    }
  }

  meanFaith(world) {
    let s = 0;
    let n = 0;
    for (const h of world.humans) {
      if (h.alive && h.kingdom === this) { s += h.genes.faith; n++; }
    }
    return n ? s / n : 0.5;
  }

  meanGenes(world) {
    const acc = { strength: 0, smarts: 0, faith: 0, fertility: 0, agg: 0 };
    let n = 0;
    for (const h of world.humans) {
      if (h.alive && h.kingdom === this) {
        for (const k of Object.keys(acc)) acc[k] += h.genes[k];
        n++;
      }
    }
    if (!n) return acc;
    for (const k of Object.keys(acc)) acc[k] /= n;
    return acc;
  }

  techName() {
    return CONFIG.TECH_TIERS[this.techTier];
  }
}
