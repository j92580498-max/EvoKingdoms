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
  FOOD_NATURAL_SPAWN_CHANCE: 0.00012,
  FOOD_MAX_PER_TILE: 1,

  // resources (real, gathered, not from nowhere)
  TREE_DENSITY: 0.06,            // probability per grass tile at gen time
  TREE_REGROW_CHANCE: 0.00006,
  STONE_VEIN_CHANCE: 0.30,       // per mountain-edge tile
  IRON_VEIN_CHANCE: 0.07,        // per mountain tile
  MAX_WOOD_PER_TILE: 4,
  MAX_ORE_PER_TILE: 3,
  HUMAN_HARVEST_CHANCE: 0.30,    // per tick when next to a resource
  HUMAN_CARRY_MAX: 2,            // resource units carried before depositing

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
  MUTATION_RATE: 0.45,
  MUTATION_PER_CELL_RATE: 0.08,
  MOVE_INTERVAL_BASE: 6,

  // animals (evolving fauna — herbivores and predators)
  START_ANIMALS: 24,
  ANIMAL_HUNGER_TICK: 0.0015,
  ANIMAL_EAT_GAIN: 0.7,
  ANIMAL_LIFESPAN: 3600,
  ANIMAL_REPRODUCE_AT: 1.15,
  ANIMAL_REPRODUCE_COST: 0.5,
  ANIMAL_MOVE_INTERVAL: 7,
  ANIMAL_GENE_MUTATE_RATE: 0.18,
  ANIMAL_FOOD_GAIN_FROM_HUNT: 0.9,

  // microflora (mostly cosmetic; pathogenic mutation can trigger local plague)
  MICROBE_START_DENSITY: 0.05,
  MICROBE_SPREAD_CHANCE: 0.0009,
  MICROBE_DECAY_CHANCE: 0.0008,
  MICROBE_PATHOGEN_CHANCE: 0.0000015,

  // civilization
  SENTIENT_TRIGGER_MAX_CELLS: 9,
  HUMAN_INITIAL_SPAWN: 14,
  HUMAN_HUNGER_TICK: 0.0005,
  HUMAN_EAT_GAIN: 0.5,
  HUMAN_REPRODUCE_AT: 1.1,
  HUMAN_REPRODUCE_COST: 0.4,
  HUMAN_BABY_HUNGER: 1.0,
  HUMAN_LIFESPAN: 12000,
  HUMAN_MOVE_INTERVAL: 5,
  HUMAN_BUILD_INTERVAL: 220,
  HUMAN_FORAGE_RADIUS: 14,
  HUMAN_FIGHT_CHANCE: 0.04,
  HUMAN_GENE_MUTATE_RATE: 0.12,
  KINGDOM_FOUND_POP: 3,
  TECH_TIERS: ["Stone", "Bronze", "Iron", "Industrial", "Atomic"],
  TECH_THRESHOLDS: [0, 12, 40, 100, 240],
  WAR_DECLARE_CHANCE: 0.00008,
  WAR_END_CHANCE: 0.0025,
  WAR_COOLDOWN_TICKS: 1800,

  // Building costs by kind: { wood, stone, iron, minTech, atPop }
  BUILD_COSTS: {
    shrine:  { wood: 2,  stone: 1,  iron: 0,  minTech: 0, atPop: 3 },
    village: { wood: 6,  stone: 2,  iron: 0,  minTech: 0, atPop: 4 },
    town:    { wood: 10, stone: 6,  iron: 1,  minTech: 1, atPop: 14 },
    castle:  { wood: 14, stone: 12, iron: 6,  minTech: 2, atPop: 35 },
  },

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

// Religion catalogue — assigned per kingdom at founding.
export const RELIGIONS = [
  { id: "animism",    name: "Animism",      icon: "\u{1F33F}", color: "#7bc97f" },
  { id: "sun",        name: "Sun Cult",     icon: "\u2600",    color: "#f5b94a" },
  { id: "moon",       name: "Moon Cult",    icon: "\u{1F319}", color: "#9a7bff" },
  { id: "ancestor",   name: "Ancestor",     icon: "\u{1F480}", color: "#cfcfcf" },
  { id: "fire",       name: "Fire-walker",  icon: "\u{1F525}", color: "#ff5b3f" },
  { id: "sea",        name: "Sea-blessed",  icon: "\u{1F30A}", color: "#4f8fff" },
  { id: "earth",      name: "Earth Mother", icon: "\u{1F30D}", color: "#9ad17a" },
  { id: "sky",        name: "Sky Father",   icon: "\u26C5",    color: "#74b4d3" },
  { id: "mono",       name: "Monotheism",   icon: "\u2728",    color: "#e6e6e6" },
  { id: "war",        name: "War-host",     icon: "\u2694",    color: "#d04a1f" },
];

// Cultures — each kingdom picks one (unique while possible).
export const CULTURES = [
  "Norse", "Aztec", "Slavic", "Egyptian", "Mongol", "Inuit", "Maori",
  "Bantu", "Yamato", "Han", "Persian", "Celtic", "Sumer", "Cherokee",
  "Greek", "Khmer", "Berber", "Kongo", "Maya", "Skyfolk", "Tundra",
  "Marsh", "Ironfoot", "Ashen", "Rivermen", "Highland", "Dawnfolk",
];
