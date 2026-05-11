// Cell types — the building blocks of an organism's anatomy.

export const CELL = {
  EMPTY: 0,
  PRODUCER: 1,
  MOUTH: 2,
  MOVER: 3,
  KILLER: 4,
  EYE: 5,
  ARMOR: 6,
};

export const CELL_DEFS = {
  [CELL.PRODUCER]: {
    name: "Producer",
    color: "#4fc16f",
    short: "P",
    desc: "Photosynthesises — periodically drops food onto adjacent grass.",
  },
  [CELL.MOUTH]: {
    name: "Mouth",
    color: "#ff983f",
    short: "M",
    desc: "Eats adjacent food, adding energy to the organism.",
  },
  [CELL.MOVER]: {
    name: "Mover",
    color: "#4fb6ff",
    short: ">",
    desc: "Allows the organism to crawl across the grid.",
  },
  [CELL.KILLER]: {
    name: "Killer",
    color: "#ff5050",
    short: "K",
    desc: "Damages adjacent foreign cells. Requires food to maintain.",
  },
  [CELL.EYE]: {
    name: "Eye",
    color: "#e056ff",
    short: "@",
    desc: "Senses food and threats; biases movement direction.",
  },
  [CELL.ARMOR]: {
    name: "Armor",
    color: "#9a7bff",
    short: "#",
    desc: "Tougher cell; absorbs damage from killers.",
  },
};

export const CELL_TYPES_PICK = [
  CELL.PRODUCER,
  CELL.MOUTH,
  CELL.MOVER,
  CELL.KILLER,
  CELL.EYE,
  CELL.ARMOR,
];

export function cellColor(type) {
  return CELL_DEFS[type]?.color || "#ffffff";
}
