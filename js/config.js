// Tunable simulation constants. All numbers live here so the rest of the
// code reads like rules rather than magic.

export const CONFIG = {
  // grid
  GRID_W: 180,
  GRID_H: 110,
  CELL_PX: 6, // initial draw size; controlled by zoom slider

  // tick
  TICKS_PER_SECOND: 60,

  // terrain regen
  GRASS_REGROW_CHANCE: 0.0008,
  WATER_EVAPORATE_CHANCE: 0.00005,
  LAVA_COOL_CHANCE: 0.004,
  FOOD_NATURAL_SPAWN_CHANCE: 0.00002,
  FOOD_MAX_PER_TILE: 1,

  // organism / cells
  START_ORGANISMS: 18,
  START_ENERGY: 6,
  REPRODUCE_AT_ENERGY_PER_CELL: 4,
  CELL_BASE_UPKEEP: 0.012,
  PRODUCER_FOOD_CHANCE: 0.011,
  MOUTH_BITE_GAIN: 1.4,
  KILLER_DAMAGE: 1.0,
  EYE_RANGE: 6,
  MAX_LIFESPAN_PER_CELL: 110,
  MUTATION_RATE: 0.45, // chance of any mutation on reproduction
  MUTATION_PER_CELL_RATE: 0.08,
  MOVE_INTERVAL_BASE: 6, // bigger = slower movement

  // civilization
  SENTIENT_TRIGGER_MAX_CELLS: 9, // when any organism reaches this size
  HUMAN_INITIAL_SPAWN: 6, // when era flips, spawn this many seed humans
  HUMAN_HUNGER_TICK: 0.018,
  HUMAN_EAT_GAIN: 0.6,
  HUMAN_REPRODUCE_AT: 1.6,
  HUMAN_REPRODUCE_COST: 0.7,
  HUMAN_BABY_HUNGER: 0.8,
  HUMAN_LIFESPAN: 7200, // ticks
  HUMAN_MOVE_INTERVAL: 5,
  HUMAN_BUILD_INTERVAL: 200,
  HUMAN_FORAGE_RADIUS: 14,
  HUMAN_FIGHT_CHANCE: 0.15,
  KINGDOM_FOUND_POP: 4,
  TECH_TIERS: ["Stone", "Bronze", "Iron", "Industrial", "Atomic"],
  TECH_THRESHOLDS: [0, 20, 60, 150, 350], // pop needed for each tier
  WAR_DECLARE_CHANCE: 0.00015,
  WAR_END_CHANCE: 0.0008,
  BUILD_VILLAGE_AT_POP: 4,
  BUILD_TOWN_AT_POP: 18,
  BUILD_CASTLE_AT_POP: 50,

  // disasters
  METEOR_RADIUS: 9,
  EARTHQUAKE_TILES: 320,
  PLAGUE_KILL_CHANCE: 0.35,
  FLOOD_RADIUS: 14,
};

// Terrain ids — packed into the Uint8Array world buffer
export const TERRAIN = {
  GRASS: 0,
  WATER: 1,
  SAND: 2,
  MOUNTAIN: 3,
  SNOW: 4,
  LAVA: 5,
  DIRT: 6,
};

export const TERRAIN_COLOR = {
  [TERRAIN.GRASS]: "#3a6b3a",
  [TERRAIN.WATER]: "#1d4d7a",
  [TERRAIN.SAND]: "#c7b07c",
  [TERRAIN.MOUNTAIN]: "#5b5550",
  [TERRAIN.SNOW]: "#dde7ec",
  [TERRAIN.LAVA]: "#d04a1f",
  [TERRAIN.DIRT]: "#5a4434",
};

export const TERRAIN_WALKABLE = {
  [TERRAIN.GRASS]: true,
  [TERRAIN.WATER]: false,
  [TERRAIN.SAND]: true,
  [TERRAIN.MOUNTAIN]: false,
  [TERRAIN.SNOW]: true,
  [TERRAIN.LAVA]: false,
  [TERRAIN.DIRT]: true,
};

export const ERAS = {
  PRIMORDIAL: {
    id: "primordial",
    name: "Primordial",
    desc: "Only cells exist. Mutation & selection.",
  },
  SENTIENT: {
    id: "sentient",
    name: "Sentient",
    desc: "Humans, tribes and kingdoms rise.",
  },
};
