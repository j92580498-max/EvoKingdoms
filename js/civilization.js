// Humans, tribes, kingdoms, religion, genes, real-resource economy and wars.
//
// Humans run a small task-based AI: each picks a role from their dominant
// gene (warrior, scholar, priest, mother, raider, forager) and then chases
// a target tile that satisfies the highest-priority unmet need. Walking
// is a Chebyshev step toward the target; if blocked, the human falls
// back to a scored 1-step wander. Kingdoms keep a shared resource
// memory so harvesters can re-visit known wood / stone / iron tiles.

import { CONFIG, TERRAIN, TERRAIN_WALKABLE } from "./config.js";
import {
  chance, rand, randInt, pick, clamp,
  NEIGHBORS_4, NEIGHBORS_8,
  kingdomName, humanName, dist2,
  pickCulture, pickReligion,
  randomHumanGenes, inheritGenes,
} from "./utils.js";
import { newHumanBrain, HUMAN_OUTPUT_NAMES } from "./brain.js";

let humanId = 1;
let kingdomId = 1;

const ROLE_BY_DOMINANT = {
  strength:  "warrior",
  smarts:    "scholar",
  faith:     "priest",
  fertility: "mother",
  agg:       "raider",
};
const TASK_TTL = {
  eat:      80,
  flee:     30,
  harvest:  220,
  deposit:  300,
  attack:   140,
  march:    200,
  pray:     160,
  wander:   28,
};

export class Human {
  constructor(x, y, kingdom = null, genes = null, brain = null) {
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
    // AI state
    this.role = pickRole(this.genes);
    this.task = null;          // { kind, tx, ty, ttl }
    this.thinkCooldown = randInt(0, 20);
    // Brain: a small neural network that biases task selection. Random
    // by default; inherited (with mutation) from parents on birth.
    this.brain = brain || newHumanBrain();
    this.brain.reset();
    // Filled in by pickTask so the inspector can show what the brain
    // most recently decided to do.
    this.lastBrainBias = null;
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

    // 1. Share what we see with the kingdom (cheap, every few ticks).
    if (this.kingdom && (((this.id + world.tick) & 7) === 0)) {
      this.shareVision(world);
    }

    // 2. Pick / refresh a task.
    if (this.thinkCooldown-- <= 0 || !this.task || this.task.ttl <= 0) {
      this.pickTask(world);
      this.thinkCooldown = 20 + randInt(0, 10);
    } else if (this.task) {
      this.task.ttl--;
    }

    // 3. Eat anything tasty in reach.
    if (this.hunger < 1.4) this.tryEat(world);

    // 4. Harvest adjacent resources (cheap free-action while passing through).
    if (this.kingdom && this.carryTotal() < CONFIG.HUMAN_CARRY_MAX) {
      this.tryHarvest(world);
    }

    // 5. Deposit at home / building when standing next to it.
    if (this.kingdom && this.carryTotal() > 0) this.tryDeposit(world);

    // 6. Move toward task target (or wander if no target).
    if (this.moveCooldown-- <= 0) {
      this.moveCooldown = CONFIG.HUMAN_MOVE_INTERVAL;
      this.moveStep(world);
    }

    // 7. Reproduce when well-fed; fertility gene biases this.
    if (this.hunger >= CONFIG.HUMAN_REPRODUCE_AT && chance(0.0035 + 0.006 * this.genes.fertility)) {
      this.tryReproduce(world);
    }

    // 8. Builders try to raise a building when standing in their kingdom.
    if (this.kingdom && --this.buildCooldown <= 0) {
      this.buildCooldown = CONFIG.HUMAN_BUILD_INTERVAL + randInt(-30, 60);
      this.kingdom.maybeBuild(world, this);
    }

    // 9. Tribeless: try to find or found a kingdom.
    if (!this.kingdom) this.maybeJoinOrFoundKingdom(world);

    // 10. Warrior / raider tasks already direct them to the enemy.
    //     Attacks happen when standing next to one.
    if (this.kingdom && this.kingdom.warTarget) {
      this.maybeAttackEnemy(world);
    }
  }

  /** Note nearby resource tiles for the kingdom's shared memory. */
  shareVision(world) {
    const k = this.kingdom;
    if (!k) return;
    const R = 3;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const nx = this.x + dx;
        const ny = this.y + dy;
        if (!world.inBounds(nx, ny)) continue;
        const idx = world.idx(nx, ny);
        if (world.hasWood(nx, ny))  k.knownWood.add(idx);
        if (world.hasStone(nx, ny)) k.knownStone.add(idx);
        if (world.hasIron(nx, ny))  k.knownIron.add(idx);
      }
    }
  }

  /** Decide what to do next based on need × role priorities, biased by
   *  what this human's brain has learned to prefer across generations.
   *
   *  Each candidate task starts with a hard-coded utility score (need is
   *  food, the kingdom is short on stone, we are at war, …). The brain
   *  contributes a *small* additive bias per task kind on top of those
   *  scores — it nudges priorities, it does not override them. Lethal
   *  threats (predator nearby) and starvation short-circuit the scoring
   *  entirely; those are reflexes, not deliberation. */
  pickTask(world) {
    // 0a. Reflex: flee predator within 4 tiles. Warriors stand and fight.
    const pred = this.findNearest(world, 4, (x, y) => {
      const a = world.animalAtTile(x, y);
      return a && a.alive && a.isCarnivore();
    });
    if (pred) {
      if (this.role === "warrior" && this.genes.strength > 0.45) {
        this.task = { kind: "attack", tx: pred[0], ty: pred[1], ttl: 30 };
        return;
      }
      // Flee opposite direction.
      const fx = clamp(this.x - (pred[0] - this.x) * 3, 0, world.W - 1);
      const fy = clamp(this.y - (pred[1] - this.y) * 3, 0, world.H - 1);
      this.task = { kind: "flee", tx: fx, ty: fy, ttl: TASK_TTL.flee };
      return;
    }

    // 0b. Reflex: starving — eat anything nearby regardless of brain.
    // Random initial brains can otherwise suppress the eat output, which
    // tipped the first generation into mass starvation.
    if (this.hunger < 0.6) {
      const t = this.findNearest(world, 14, (x, y) => world.hasFood(x, y));
      if (t) {
        this.task = { kind: "eat", tx: t[0], ty: t[1], ttl: TASK_TTL.eat };
        // Still run the brain so its hidden state and inspector
        // visualisation stay in sync with the world.
        this.lastBrainBias = this.brainStep(world);
        return;
      }
    }

    // 1. Senses → inputs → brain. Brain output is in [-1, 1]; we scale
    //    it down so deliberation only nudges hand-coded utilities.
    const rawBias = this.brainStep(world);
    const BIAS_GAIN = 0.5;
    const bias = {};
    for (const k of Object.keys(rawBias)) bias[k] = rawBias[k] * BIAS_GAIN;

    // 2. Build a candidate list with (score, factory) entries.
    const candidates = [];
    const push = (kind, score, mk) => {
      if (!mk) return;
      candidates.push({ kind, score: score + (bias[kind] || 0), make: mk });
    };

    // Hungry: find food. The score grows steeply as hunger drops so it
    // dominates other candidates well before starvation.
    if (this.hunger < 1.2) {
      const t = this.findNearest(world, 14, (x, y) => world.hasFood(x, y));
      if (t) {
        const urgency = clamp(1.4 - this.hunger, 0, 1.4);
        push("eat", 0.8 + urgency * 2.2, () => ({ kind: "eat", tx: t[0], ty: t[1], ttl: TASK_TTL.eat }));
      }
    }

    // Carrying load: head home to deposit.
    if (this.kingdom && this.carryTotal() > 0) {
      const home = this.kingdom.depositTarget(this);
      const fullness = this.carryTotal() / CONFIG.HUMAN_CARRY_MAX;
      push("deposit", 0.2 + fullness * 1.6, () => ({
        kind: "deposit", tx: home.x, ty: home.y, ttl: TASK_TTL.deposit,
      }));
    }

    // At war + warrior/raider: hunt enemy citizens.
    if (this.kingdom && this.kingdom.warTarget && (this.role === "warrior" || this.role === "raider")) {
      const enemy = this.kingdom.warTarget;
      const t = this.findNearest(world, 14, (x, y) => {
        const h = world.humanAt[world.idx(x, y)];
        return !!(h && h.alive && h.kingdom === enemy);
      });
      if (t) {
        push("attack", 1.0 + this.genes.agg * 0.6, () => ({ kind: "attack", tx: t[0], ty: t[1], ttl: TASK_TTL.attack }));
      }
      push("march", 0.5 + this.genes.agg * 0.4, () => ({
        kind: "march", tx: enemy.capital.x, ty: enemy.capital.y, ttl: TASK_TTL.march,
      }));
    }

    // Priest: pray at the nearest shrine.
    if (this.kingdom) {
      const shrine = this.kingdom.buildings.find((b) => b.kind === "shrine");
      if (shrine) {
        const roleBoost = this.role === "priest" ? 0.6 : 0.0;
        push("pray", 0.2 + this.genes.faith * 0.8 + roleBoost, () => ({
          kind: "pray", tx: shrine.x, ty: shrine.y, ttl: TASK_TTL.pray,
        }));
      }
    }

    // Harvest resources when there is room to carry more.
    if (this.kingdom && this.carryTotal() < CONFIG.HUMAN_CARRY_MAX) {
      const need = this.kingdom.mostNeededResource();
      const known = (
        need === "wood" ? this.kingdom.knownWood :
        need === "stone" ? this.kingdom.knownStone :
        this.kingdom.knownIron
      );
      let tile = this.pickClosestKnown(world, known);
      if (!tile) {
        tile = this.findNearest(world, 10, (x, y) => (
          (need === "wood"  && world.hasWood(x, y))  ||
          (need === "stone" && world.hasStone(x, y)) ||
          (need === "iron"  && world.hasIron(x, y))
        ));
      }
      if (tile) {
        push("harvest", 0.6, () => ({ kind: "harvest", tx: tile[0], ty: tile[1], ttl: TASK_TTL.harvest }));
      }
    }

    // 3. Pick the top scorer. Brain bias can dip a candidate below
    //    zero, so we accept anything that beats wander's noise floor.
    let best = null;
    for (const c of candidates) {
      if (!best || c.score > best.score) best = c;
    }
    this.lastBrainBias = bias;
    if (best && best.score > -0.1) {
      this.task = best.make();
      return;
    }

    // 4. Default: scored wander, mildly drifting toward home if we have one.
    if (this.kingdom) {
      const tx = this.kingdom.capital.x + randInt(-8, 8);
      const ty = this.kingdom.capital.y + randInt(-8, 8);
      this.task = { kind: "wander", tx, ty, ttl: TASK_TTL.wander };
    } else {
      this.task = { kind: "wander", tx: this.x + randInt(-4, 4), ty: this.y + randInt(-4, 4), ttl: TASK_TTL.wander };
    }
  }

  /** Sense the world, run the brain forward one step, and return an
   *  object mapping each output name to its [-1, 1] activation. */
  brainStep(world) {
    const k = this.kingdom;
    // Sensory inputs, all in roughly [-1, 1] so the brain stays in its
    // sweet spot.
    const hunger = clamp(this.hunger - 1.0, -1, 1);
    const carry  = (this.carryTotal() / CONFIG.HUMAN_CARRY_MAX) * 2 - 1;
    const foodNear  = this.senseNear(world, 4, (x, y) => world.hasFood(x, y));
    const predNear  = this.senseNear(world, 5, (x, y) => {
      const a = world.animalAtTile(x, y);
      return !!(a && a.alive && a.isCarnivore());
    });
    const enemyNear = (k && k.warTarget) ? this.senseNear(world, 6, (x, y) => {
      const h = world.humanAt[world.idx(x, y)];
      return !!(h && h.alive && h.kingdom === k.warTarget);
    }) : -1;
    const woodNear  = this.senseNear(world, 4, (x, y) => world.hasWood(x, y));
    const stoneNear = this.senseNear(world, 5, (x, y) => world.hasStone(x, y));
    const ironNear  = this.senseNear(world, 5, (x, y) => world.hasIron(x, y));
    const needWood  = k ? (k.mostNeededResource() === "wood"  ? 1 : -1) : 0;
    const needStone = k ? (k.mostNeededResource() === "stone" ? 1 : -1) : 0;
    const needIron  = k ? (k.mostNeededResource() === "iron"  ? 1 : -1) : 0;
    const atWar     = k && k.warTarget ? 1 : -1;
    const ageNorm   = clamp((this.age / this.lifespan) * 2 - 1, -1, 1);
    const smarts    = this.genes.smarts * 2 - 1;

    const inputs = new Float32Array([
      hunger, carry, foodNear, predNear,
      enemyNear, woodNear, stoneNear, ironNear,
      needWood, needStone, needIron, atWar,
      ageNorm, smarts,
    ]);
    const out = this.brain.think(inputs);
    const bias = {};
    for (let i = 0; i < HUMAN_OUTPUT_NAMES.length; i++) {
      bias[HUMAN_OUTPUT_NAMES[i]] = out[i];
    }
    return bias;
  }

  /** Returns 1 if any tile in the square radius around the human
   *  matches `predicate`, else -1. */
  senseNear(world, radius, predicate) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = this.x + dx;
        const ny = this.y + dy;
        if (!world.inBounds(nx, ny)) continue;
        if (predicate(nx, ny)) return 1;
      }
    }
    return -1;
  }

  /** Walk one tile (8-connected) toward the task target. Falls back to
   *  a scored 1-step wander if blocked or no task. */
  moveStep(world) {
    const t = this.task;
    if (t && t.tx >= 0 && t.ty >= 0) {
      const sdx = Math.sign(t.tx - this.x);
      const sdy = Math.sign(t.ty - this.y);
      if (sdx === 0 && sdy === 0) {
        // arrived
        this.task.ttl = Math.min(this.task.ttl, 4);
        return;
      }
      const cands = [
        [sdx, sdy],
        [sdx, 0],
        [0, sdy],
        [sdx, -sdy],
        [-sdx, sdy],
        [-sdx, 0],
        [0, -sdy],
        [-sdx, -sdy],
      ];
      for (const [dx, dy] of cands) {
        if (dx === 0 && dy === 0) continue;
        const nx = this.x + dx;
        const ny = this.y + dy;
        if (!world.canHumanStand(nx, ny)) continue;
        const a = world.animalAtTile(nx, ny);
        if (a && a.alive && a.isCarnivore() && this.role !== "warrior") continue;
        world.setHumanAt(this.x, this.y, null);
        this.x = nx;
        this.y = ny;
        world.setHumanAt(this.x, this.y, this);
        return;
      }
      // blocked — clear task; next think will repick
      this.task = null;
    }
    // No target — scored 1-step wander.
    let best = null;
    let bestScore = -Infinity;
    for (const [dx, dy] of NEIGHBORS_8) {
      const nx = this.x + dx;
      const ny = this.y + dy;
      if (!world.canHumanStand(nx, ny)) continue;
      let score = rand() * 0.3;
      if (world.hasFood(nx, ny)) score += 1.5;
      const aHere = world.animalAtTile(nx, ny);
      if (aHere && aHere.isCarnivore() && this.role !== "warrior") score -= 2.5;
      if (this.kingdom && world.kingdomAtTile(nx, ny) === this.kingdom.id) score += 0.3;
      if (score > bestScore) { bestScore = score; best = [nx, ny]; }
    }
    if (best) {
      world.setHumanAt(this.x, this.y, null);
      this.x = best[0];
      this.y = best[1];
      world.setHumanAt(this.x, this.y, this);
    }
  }

  /** Scan an n×n window for the first tile that satisfies `predicate`,
   *  return [x, y] of the geometrically closest. */
  findNearest(world, radius, predicate) {
    let best = null;
    let bestD = Infinity;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = this.x + dx;
        const ny = this.y + dy;
        if (!world.inBounds(nx, ny)) continue;
        if (!predicate(nx, ny)) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = [nx, ny]; }
      }
    }
    return best;
  }

  /** Pick the closest tile-index from a Set, verifying the resource
   *  still exists (lazy GC on the kingdom's memory). */
  pickClosestKnown(world, set) {
    if (!set || set.size === 0) return null;
    let best = null;
    let bestD = Infinity;
    let cleared = 0;
    for (const idx of set) {
      const x = idx % world.W;
      const y = (idx / world.W) | 0;
      // Cull stale memory of fully-mined tiles.
      if (!world.hasWood(x, y) && !world.hasStone(x, y) && !world.hasIron(x, y)) {
        set.delete(idx);
        cleared++;
        if (cleared > 12) break;
        continue;
      }
      const d = dist2(this.x, this.y, x, y);
      if (d < bestD) { bestD = d; best = [x, y]; }
    }
    return best;
  }

  tryEat(world) {
    // eat food on current tile or adjacent
    for (const [dx, dy] of [[0, 0], ...NEIGHBORS_4]) {
      const nx = this.x + dx;
      const ny = this.y + dy;
      if (world.inBounds(nx, ny) && world.takeFood(nx, ny)) {
        this.hunger += CONFIG.HUMAN_EAT_GAIN;
        return true;
      }
    }
    // hunt small organisms or prey animals
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
      if (a && a.alive) {
        // warriors gore predators for food; everyone else hunts prey
        const isPrey = !a.isCarnivore();
        const canKill = isPrey
          ? chance(0.4 + this.genes.strength * 0.3)
          : (this.role === "warrior" && chance(0.18 + this.genes.strength * 0.45));
        if (canKill) {
          a.alive = false;
          this.hunger += CONFIG.HUMAN_EAT_GAIN * (isPrey ? 1.6 : 1.1);
          if (this.kingdom) {
            this.kingdom.history.push({ tick: world.tick, msg: `${this.name} ${isPrey ? "killed" : "slew"} a ${a.def().name.toLowerCase()}.` });
          }
          return true;
        }
      }
    }
    return false;
  }

  tryHarvest(world) {
    if (!chance(CONFIG.HUMAN_HARVEST_CHANCE)) return;
    for (const [dx, dy] of NEIGHBORS_8) {
      const nx = this.x + dx;
      const ny = this.y + dy;
      if (!world.inBounds(nx, ny)) continue;
      if (this.carryTotal() >= CONFIG.HUMAN_CARRY_MAX) return;
      if (world.takeWood(nx, ny))                                     { this.carry.wood++;  return; }
      if (this.genes.smarts > 0.55 && world.takeIron(nx, ny))         { this.carry.iron++;  return; }
      if (world.takeStone(nx, ny))                                    { this.carry.stone++; return; }
      if (world.takeIron(nx, ny))                                     { this.carry.iron++;  return; }
    }
  }

  tryDeposit(world) {
    const k = this.kingdom;
    if (!k) return;
    const here = (x, y) => Math.abs(this.x - x) <= 1 && Math.abs(this.y - y) <= 1;
    if (here(k.capital.x, k.capital.y)) {
      k.resources.wood  += this.carry.wood;
      k.resources.stone += this.carry.stone;
      k.resources.iron  += this.carry.iron;
      this.carry.wood = this.carry.stone = this.carry.iron = 0;
      return;
    }
    for (const b of k.buildings) {
      if (here(b.x, b.y)) {
        k.resources.wood  += this.carry.wood;
        k.resources.stone += this.carry.stone;
        k.resources.iron  += this.carry.iron;
        this.carry.wood = this.carry.stone = this.carry.iron = 0;
        return;
      }
    }
  }

  tryReproduce(world) {
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
    // Detect a nearby elder for cultural mentorship.
    let elderBoost = null;
    for (const h of nearbyHumans(world, this.x, this.y, 2)) {
      if (h !== this && h !== partner && h.alive && h.age > h.lifespan * 0.6 && h.kingdom === this.kingdom) {
        elderBoost = h;
        break;
      }
    }
    for (const [dx, dy] of NEIGHBORS_8) {
      const nx = this.x + dx;
      const ny = this.y + dy;
      if (!world.canHumanStand(nx, ny)) continue;
      this.hunger -= CONFIG.HUMAN_REPRODUCE_COST;
      let childGenes = inheritGenes(this.genes, partner ? partner.genes : null, CONFIG.HUMAN_GENE_MUTATE_RATE);
      if (elderBoost) {
        // Cultural transmission: elders pass on a small smarts/faith bump.
        childGenes.smarts = clamp(childGenes.smarts + 0.04, 0, 1);
        childGenes.faith  = clamp(childGenes.faith  + 0.02, 0, 1);
      }
      // Brain inheritance: uniform crossover with the partner if any,
      // then mutation. Smarter humans mutate a little less, so a
      // working brain is preserved more reliably.
      const brainRate = CONFIG.HUMAN_GENE_MUTATE_RATE * (1.2 - 0.4 * childGenes.smarts);
      const childBrain = this.brain.childWith(partner ? partner.brain : null, brainRate);
      const child = new Human(nx, ny, this.kingdom, childGenes, childBrain);
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
        const aBonus = this.genes.strength * 0.5 + this.genes.agg * 0.25 + (this.role === "warrior" ? 0.3 : 0);
        const bDef = (other.genes.strength + 0.5) * 0.5;
        const p = CONFIG.HUMAN_FIGHT_CHANCE * (1 + this.kingdom.techTier * 0.3) * (1 + aBonus) / bDef;
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

function pickRole(genes) {
  let bestKey = "fertility";
  let bestVal = -1;
  for (const k of Object.keys(ROLE_BY_DOMINANT)) {
    if (genes[k] > bestVal) { bestVal = genes[k]; bestKey = k; }
  }
  if (bestVal < 0.55) return "forager";
  return ROLE_BY_DOMINANT[bestKey];
}

function* nearbyHumans(world, cx, cy, radius) {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!world.inBounds(nx, ny)) continue;
      const h = world.humanAt[world.idx(nx, ny)];
      if (h) yield h;
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
    // Group memory: tile indices we've seen with each resource.
    this.knownWood  = new Set();
    this.knownStone = new Set();
    this.knownIron  = new Set();
  }

  /** Which resource is most lacking right now? Drives harvester targeting. */
  mostNeededResource() {
    const r = this.resources;
    // weight by build cost demands at our current tech
    const wantsIron = this.techTier >= CONFIG.BUILD_COSTS.town.minTech;
    const def = { wood: r.wood, stone: r.stone, iron: r.iron + (wantsIron ? 0 : 99) };
    let lowest = "wood";
    let lo = def.wood;
    if (def.stone < lo) { lowest = "stone"; lo = def.stone; }
    if (def.iron  < lo) { lowest = "iron";  lo = def.iron;  }
    return lowest;
  }

  /** Where should a carrier with a full load go to drop off? */
  depositTarget(_human) {
    // Capital is always valid; pick a closer building if there is one.
    let best = this.capital;
    let bestD = Infinity;
    for (const b of this.buildings) {
      const d = dist2(_human.x, _human.y, b.x, b.y);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  tick(world) {
    if ((world.tick & 31) === 0) this.expandTerritory(world);

    if ((world.tick & 63) === 0) this.advanceTech(world);

    if (!this.warTarget) {
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

  /** Tech progress is driven by population × meanSmarts, plus a small
   *  scholar count bonus. Faster than pop-only thresholds. */
  advanceTech(world) {
    let smartsSum = 0;
    let count = 0;
    let scholars = 0;
    let priests = 0;
    for (const h of world.humans) {
      if (h.alive && h.kingdom === this) {
        smartsSum += h.genes.smarts;
        count++;
        if (h.role === "scholar") scholars++;
        if (h.role === "priest")  priests++;
      }
    }
    const meanSmarts = count ? smartsSum / count : 0.5;
    const effectivePop = Math.round(this.population * (0.7 + meanSmarts * 0.7) + scholars * 1.5 + priests * 0.5);
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

  expandTerritory(world) {
    if (this.population <= 0) return;
    const ring = [this.capital, ...this.buildings];
    const frontier = [];
    for (const o of ring) frontier.push([o.x, o.y]);
    let claimedThisTick = 0;
    const maxClaim = Math.min(12, 2 + (this.population >> 1));
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
    const counts = { shrine: 0, village: 0, town: 0, castle: 0 };
    for (const b of this.buildings) counts[b.kind] = (counts[b.kind] || 0) + 1;

    let kind = null;
    if (counts.shrine < 1 && pop >= CONFIG.BUILD_COSTS.shrine.atPop && this.meanFaith(world) > 0.45) kind = "shrine";
    else if (pop >= CONFIG.BUILD_COSTS.castle.atPop && counts.castle === 0 && this.techTier >= CONFIG.BUILD_COSTS.castle.minTech) kind = "castle";
    else if (pop >= CONFIG.BUILD_COSTS.town.atPop && counts.town < 1 + (pop / 30 | 0) && this.techTier >= CONFIG.BUILD_COSTS.town.minTech) kind = "town";
    else if (pop >= CONFIG.BUILD_COSTS.village.atPop && counts.village < 1 + (pop / 10 | 0)) kind = "village";
    if (!kind) return;

    const cost = CONFIG.BUILD_COSTS[kind];
    if (this.resources.wood  < cost.wood)  return;
    if (this.resources.stone < cost.stone) return;
    if (this.resources.iron  < cost.iron)  return;

    for (const [dx, dy] of NEIGHBORS_8) {
      const x = founder.x + dx;
      const y = founder.y + dy;
      if (!world.inBounds(x, y)) continue;
      const t = world.terrainAt(x, y);
      if (!TERRAIN_WALKABLE[t]) continue;
      if (world.buildingAt[world.idx(x, y)]) continue;

      this.resources.wood  -= cost.wood;
      this.resources.stone -= cost.stone;
      this.resources.iron  -= cost.iron;

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

  /** Live count of each role for the Peoples panel. */
  roleCounts(world) {
    const out = { warrior: 0, scholar: 0, priest: 0, mother: 0, raider: 0, forager: 0 };
    for (const h of world.humans) {
      if (h.alive && h.kingdom === this) out[h.role] = (out[h.role] || 0) + 1;
    }
    return out;
  }

  techName() {
    return CONFIG.TECH_TIERS[this.techTier];
  }
}
