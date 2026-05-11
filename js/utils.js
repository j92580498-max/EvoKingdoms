// Deterministic-ish helpers. We don't need true PRNG repeatability,
// just convenient wrappers around Math.random().

export const rand = () => Math.random();
export const randInt = (min, max) => (min + Math.floor(Math.random() * (max - min + 1))) | 0;
export const randRange = (min, max) => min + Math.random() * (max - min);
export const chance = (p) => Math.random() < p;
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 8-neighbourhood deltas (excluding self)
export const NEIGHBORS_8 = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

export const NEIGHBORS_4 = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
];

// HSL helper
export function hsl(h, s = 65, l = 55) {
  return `hsl(${(h | 0) % 360} ${s}% ${l}%)`;
}

// Name generators
const SYL_A = ["ka", "ru", "men", "tar", "vol", "an", "ish", "or", "el", "sur", "bri", "dor", "fen", "gal", "hel", "iri", "jor", "kel", "lim", "nor", "ond", "pel", "qua", "ral", "sin", "tov", "umb", "vex", "wol", "xan", "yor", "zur"];
const SYL_B = ["dor", "lin", "wyn", "thar", "gard", "moor", "shire", "bain", "fold", "haven", "hold", "march", "reach", "spire", "vale", "watch", "wood", "burg", "stead", "crest", "fall", "gate", "mere"];

export function kingdomName() {
  const a = pick(SYL_A);
  const b = pick(SYL_B);
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  return cap(a) + b;
}

const HUMAN_NAMES = [
  "Aren", "Bryn", "Cael", "Dorn", "Eira", "Fyr", "Gael", "Hild", "Ivar", "Joro", "Kael", "Lira",
  "Mira", "Norn", "Osha", "Pell", "Quil", "Ryn", "Sara", "Tarn", "Una", "Vex", "Wyn", "Xal", "Yara", "Zev",
];
export const humanName = () => pick(HUMAN_NAMES) + " " + pick(SYL_B);

// 2D-distance squared (no sqrt where possible)
export const dist2 = (ax, ay, bx, by) => {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
};
