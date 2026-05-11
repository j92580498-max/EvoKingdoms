// Humans, tribes, kingdoms, wars and tech — the WorldBox layer.

import { CONFIG, TERRAIN, TERRAIN_WALKABLE } from "./config.js";
import { chance, rand, randInt, pick, NEIGHBORS_4, NEIGHBORS_8, kingdomName, humanName, dist2 } from "./utils.js";

let humanId = 1;
let kingdomId = 1;

export class Human {
  constructor(x, y, kingdom = null) {
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

    // forage
    if (this.hunger < 1.4 && this.tryEat(world)) {
      // ate
    } else if (this.moveCooldown-- <= 0) {
      this.moveCooldown = CONFIG.HUMAN_MOVE_INTERVAL;
      this.moveStep(world);
    }

    // attempt reproduction (with another adjacent human of same kingdom, or solo)
    if (this.hunger >= CONFIG.HUMAN_REPRODUCE_AT && chance(0.005)) {
      this.tryReproduce(world);
    }

    // build village/town/castle if part of a kingdom and threshold met
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
    // 2. hunt nearby small organisms
    for (const [dx, dy] of NEIGHBORS_8) {
      const nx = this.x + dx;
      const ny = this.y + dy;
      const o = world.organismAt(nx, ny);
      if (o && o.cells.length <= 3) {
        o.die(world);
        this.hunger += CONFIG.HUMAN_EAT_GAIN * 1.5;
        return true;
      }
    }
    return false;
  }

  moveStep(world) {
    // simple foraging: pick the highest-interest tile in a small neighborhood
    let best = null;
    let bestScore = -Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = this.x + dx;
        const ny = this.y + dy;
        if (!world.canHumanStand(nx, ny)) continue;
        let score = rand() * 0.3;
        if (world.hasFood(nx, ny)) score += 2;
        if (this.kingdom && world.kingdomAtTile(nx, ny) === this.kingdom.id) score += 0.4;
        if (this.kingdom && this.kingdom.capital) {
          // bias toward capital if hungry
          const d = Math.sqrt(dist2(nx, ny, this.kingdom.capital.x, this.kingdom.capital.y));
          score -= d * 0.005 * (this.hunger < 0.7 ? 1.5 : 0.5);
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
    for (const [dx, dy] of NEIGHBORS_8) {
      const nx = this.x + dx;
      const ny = this.y + dy;
      if (!world.canHumanStand(nx, ny)) continue;
      this.hunger -= CONFIG.HUMAN_REPRODUCE_COST;
      const child = new Human(nx, ny, this.kingdom);
      child.hunger = CONFIG.HUMAN_BABY_HUNGER;
      world.humans.push(child);
      world.setHumanAt(nx, ny, child);
      if (this.kingdom) this.kingdom.population++;
      return;
    }
  }

  maybeJoinOrFoundKingdom(world) {
    // Join the kingdom of an adjacent human
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
    // Maybe found a brand new kingdom (low chance and only if enough nearby humans)
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
      const k = new Kingdom(this.x, this.y);
      world.kingdoms.push(k);
      this.kingdom = k;
      k.population = 1;
      // pull in unaffiliated neighbours
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
      world.eventLog.push({ tick: world.tick, type: "kingdom", msg: `${k.name} was founded.` });
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
        if (chance(CONFIG.HUMAN_FIGHT_CHANCE * (1 + this.kingdom.techTier * 0.25))) {
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
    // drop a little food
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
    this.kind = kind; // 'village' | 'town' | 'castle'
    this.kingdom = kingdom;
  }
}

export class Kingdom {
  constructor(x, y) {
    this.id = kingdomId++;
    this.name = kingdomName();
    this.color = `hsl(${(rand() * 360) | 0} 70% 55%)`;
    this.capital = { x, y };
    this.population = 0;
    this.techTier = 0;
    this.warTarget = null;
    this.warTicks = 0;
    this.tilesClaimed = 0;
    this.buildings = [];
    this.history = [];
  }

  tick(world) {
    // claim adjacent unclaimed tiles around capital + buildings
    if ((world.tick & 31) === 0) {
      this.expandTerritory(world);
    }

    // tech advancement
    while (
      this.techTier < CONFIG.TECH_TIERS.length - 1 &&
      this.population >= CONFIG.TECH_THRESHOLDS[this.techTier + 1]
    ) {
      this.techTier++;
      world.eventLog.push({
        tick: world.tick,
        type: "tech",
        msg: `${this.name} entered the ${CONFIG.TECH_TIERS[this.techTier]} Age.`,
      });
    }

    // wars: declare/end
    if (!this.warTarget && chance(CONFIG.WAR_DECLARE_CHANCE * Math.max(this.population, 1) * 0.2)) {
      const enemies = world.kingdoms.filter((k) => k !== this && k.population > 0);
      if (enemies.length) {
        const enemy = pick(enemies);
        this.warTarget = enemy;
        enemy.warTarget = this;
        this.warTicks = 0;
        world.eventLog.push({
          tick: world.tick,
          type: "war",
          msg: `${this.name} declared war on ${enemy.name}.`,
        });
      }
    } else if (this.warTarget) {
      this.warTicks++;
      if (this.warTarget.population <= 0) {
        world.eventLog.push({
          tick: world.tick,
          type: "war",
          msg: `${this.name} annihilated ${this.warTarget.name}!`,
        });
        const dead = this.warTarget;
        this.warTarget = null;
        dead.warTarget = null;
      } else if (chance(CONFIG.WAR_END_CHANCE)) {
        world.eventLog.push({
          tick: world.tick,
          type: "war",
          msg: `${this.name} and ${this.warTarget.name} signed peace.`,
        });
        const enemy = this.warTarget;
        this.warTarget = null;
        if (enemy.warTarget === this) enemy.warTarget = null;
      }
    }
  }

  expandTerritory(world) {
    // floodfill outward from capital up to N tiles
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

  maybeBuild(world, founder) {
    const pop = this.population;
    let kind = null;
    let already = this.buildings.length;
    if (pop >= CONFIG.BUILD_CASTLE_AT_POP && !this.buildings.some((b) => b.kind === "castle")) kind = "castle";
    else if (pop >= CONFIG.BUILD_TOWN_AT_POP && this.buildings.filter((b) => b.kind === "town").length < 1 + (pop / 30 | 0)) kind = "town";
    else if (pop >= CONFIG.BUILD_VILLAGE_AT_POP && this.buildings.filter((b) => b.kind === "village").length < 1 + (pop / 10 | 0)) kind = "village";
    if (!kind) return;

    for (const [dx, dy] of NEIGHBORS_8) {
      const x = founder.x + dx;
      const y = founder.y + dy;
      if (!world.inBounds(x, y)) continue;
      const t = world.terrainAt(x, y);
      if (!TERRAIN_WALKABLE[t]) continue;
      if (world.buildingAt[world.idx(x, y)]) continue;
      const b = new Building(x, y, kind, this);
      world.setBuilding(x, y, b);
      this.buildings.push(b);
      if (kind === "castle") {
        world.eventLog.push({ tick: world.tick, type: "build", msg: `${this.name} raised a castle.` });
      }
      return;
    }
    return already;
  }

  techName() {
    return CONFIG.TECH_TIERS[this.techTier];
  }
}
