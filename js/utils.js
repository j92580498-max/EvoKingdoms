// Deterministic-ish helpers. We don't need true PRNG repeatability,
// just convenient wrappers around Math.random().

import { RELIGIONS, CULTURES } from "./config.js";

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

// Triangular-ish jitter centred on 0 — used for gene mutation.
export function jitter(amount = 0.1) {
  return (rand() - rand()) * amount;
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

// Pick a culture not yet used by any kingdom. Falls back to a numbered
// variant if the catalogue is exhausted, so each people is uniquely
// identifiable in the UI.
export function pickCulture(usedSet) {
  const free = CULTURES.filter((c) => !usedSet.has(c));
  if (free.length > 0) return pick(free);
  return pick(CULTURES) + "-" + (((Math.random() * 999) | 0) + 1);
}

export const pickReligion = () => pick(RELIGIONS);

// Build a fresh gene set for a human. Each gene is roughly normally
// distributed around 0.5 in [0, 1].
export function randomHumanGenes() {
  const g = () => clamp(0.5 + jitter(0.25), 0, 1);
  return {
    strength: g(),
    smarts: g(),
    faith: g(),
    fertility: g(),
    agg: g(),
  };
}

// Inherit genes from one or two parents, with mutation. Over many
// generations a kingdom's gene means drift in the direction of whichever
// trait kept its bearers alive longest.
export function inheritGenes(a, b = null, rate = 0.12) {
  const out = {};
  for (const k of ["strength", "smarts", "faith", "fertility", "agg"]) {
    const base = b ? (a[k] + b[k]) * 0.5 : a[k];
    const mutated = chance(rate) ? base + jitter(0.2) : base + jitter(0.04);
    out[k] = clamp(mutated, 0, 1);
  }
  return out;
}

export function averageGenes(humans) {
  const out = { strength: 0, smarts: 0, faith: 0, fertility: 0, agg: 0 };
  let n = 0;
  for (const h of humans) {
    if (!h.alive || !h.genes) continue;
    out.strength += h.genes.strength;
    out.smarts += h.genes.smarts;
    out.faith += h.genes.faith;
    out.fertility += h.genes.fertility;
    out.agg += h.genes.agg;
    n++;
  }
  if (!n) return out;
  for (const k of Object.keys(out)) out[k] /= n;
  return out;
}
