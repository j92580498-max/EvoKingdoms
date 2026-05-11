// A tiny per-creature "brain" — a feed-forward neural network with a
// recurrent hidden layer ("cortex"). Weights are not trained by gradient
// descent. Instead they are passed down through reproduction with random
// mutation, so behaviour is shaped by natural selection: creatures whose
// brains keep them alive longer pass on their wiring more often.
//
// The brain is the same shape across a species. Only the weights differ
// per individual, so two brains can be crossed by picking weights from
// either parent. The hidden state is reset on birth so children do not
// inherit short-term memories.

import { rand, randRange, jitter, chance, clamp } from "./utils.js";

const tanh = Math.tanh;

/** Bound for any single weight after mutation — keeps activations sane. */
const WEIGHT_CLAMP = 3.0;

export class Brain {
  /**
   * @param {number} inSize  number of sensory inputs (a bias is added)
   * @param {number} hidSize number of hidden neurons
   * @param {number} outSize number of motor outputs
   * @param {{w1:Float32Array,w2:Float32Array}|null} weights
   */
  constructor(inSize, hidSize, outSize, weights = null) {
    this.inSize = inSize;
    this.hidSize = hidSize;
    this.outSize = outSize;

    // Layer 1: hidden = tanh(W1 · [inputs, 1, prevHidden])
    //   stride = inSize + 1 + hidSize   (sensors + bias + recurrent context)
    this.w1Stride = inSize + 1 + hidSize;
    // Layer 2: out = tanh(W2 · [hidden, 1])
    this.w2Stride = hidSize + 1;

    this.w1 = weights ? weights.w1 : randomMatrix(hidSize * this.w1Stride);
    this.w2 = weights ? weights.w2 : randomMatrix(outSize * this.w2Stride);

    this.hidden = new Float32Array(hidSize);

    // Diagnostic state — purely for the UI inspector.
    this.lastInputs = null;
    this.lastOutputs = null;
    this.activation = 0;
  }

  /**
   * Run one forward pass. `inputs` may be a regular Array or Float32Array
   * with exactly `inSize` numeric entries in roughly [-1, 1].
   *
   * Returns the freshly-computed output vector (length `outSize`). The
   * brain's hidden state is updated in-place so the next call sees a
   * short-term memory of what just happened.
   */
  think(inputs) {
    const { inSize, hidSize, outSize, w1, w2, w1Stride, w2Stride } = this;
    if (inputs.length !== inSize) {
      throw new Error(`brain expected ${inSize} inputs, got ${inputs.length}`);
    }
    const prevHidden = this.hidden;
    const nextHidden = new Float32Array(hidSize);
    for (let j = 0; j < hidSize; j++) {
      const row = j * w1Stride;
      let sum = w1[row + inSize]; // bias
      for (let i = 0; i < inSize; i++) sum += w1[row + i] * inputs[i];
      // recurrent context
      const off = row + inSize + 1;
      for (let k = 0; k < hidSize; k++) sum += w1[off + k] * prevHidden[k];
      nextHidden[j] = tanh(sum);
    }
    const out = new Float32Array(outSize);
    let totalAct = 0;
    for (let o = 0; o < outSize; o++) {
      const row = o * w2Stride;
      let sum = w2[row + hidSize]; // bias
      for (let j = 0; j < hidSize; j++) sum += w2[row + j] * nextHidden[j];
      const v = tanh(sum);
      out[o] = v;
      totalAct += v * v;
    }
    this.hidden = nextHidden;
    this.lastInputs = inputs;
    this.lastOutputs = out;
    this.activation = Math.sqrt(totalAct / outSize);
    return out;
  }

  /** Forget short-term context. Called on birth so a child does not start
   *  with a leftover memory from whichever brain we cloned weights from. */
  reset() {
    this.hidden = new Float32Array(this.hidSize);
  }

  /**
   * Produce a mutated copy. `rate` (~0.05–0.2) is the per-weight chance
   * of a small jitter; a much smaller fraction of weights are re-rolled
   * entirely, which lets the population escape local optima.
   */
  mutated(rate) {
    const child = new Brain(this.inSize, this.hidSize, this.outSize, {
      w1: new Float32Array(this.w1),
      w2: new Float32Array(this.w2),
    });
    mutateInto(child.w1, rate);
    mutateInto(child.w2, rate);
    return child;
  }

  /**
   * Sexual reproduction — uniform crossover of weights, then mutate.
   * Falls back to an asexual mutated copy if the partner has a different
   * brain shape (which shouldn't happen for same-species creatures).
   */
  childWith(partner, rate) {
    if (!partner ||
        partner.inSize !== this.inSize ||
        partner.hidSize !== this.hidSize ||
        partner.outSize !== this.outSize) {
      return this.mutated(rate);
    }
    const w1 = new Float32Array(this.w1.length);
    const w2 = new Float32Array(this.w2.length);
    for (let i = 0; i < w1.length; i++) {
      w1[i] = rand() < 0.5 ? this.w1[i] : partner.w1[i];
    }
    for (let i = 0; i < w2.length; i++) {
      w2[i] = rand() < 0.5 ? this.w2[i] : partner.w2[i];
    }
    mutateInto(w1, rate);
    mutateInto(w2, rate);
    return new Brain(this.inSize, this.hidSize, this.outSize, { w1, w2 });
  }
}

function mutateInto(arr, rate) {
  // A small slice of weights are re-rolled entirely; the rest get a
  // gentle Gaussian-ish jitter. Combined they let the population both
  // refine and explore the weight space.
  const rerollRate = rate * 0.15;
  for (let i = 0; i < arr.length; i++) {
    if (chance(rerollRate)) {
      arr[i] = randRange(-1, 1);
    } else if (chance(rate)) {
      arr[i] = clamp(arr[i] + jitter(0.35), -WEIGHT_CLAMP, WEIGHT_CLAMP);
    }
  }
}

function randomMatrix(n) {
  const arr = new Float32Array(n);
  // Xavier-ish initialisation: small enough that tanh isn't saturated
  // at the start, large enough that gradients (here: mutations) move
  // outputs meaningfully.
  const k = 0.6;
  for (let i = 0; i < arr.length; i++) arr[i] = (rand() * 2 - 1) * k;
  return arr;
}

// ---------- Brain shapes used by the simulation ----------
//
// Keeping these here (rather than in config.js) means the brain module
// can be imported on its own without dragging in simulation constants.

export const HUMAN_BRAIN_SHAPE  = { in: 14, hid: 10, out: 8 };
export const ANIMAL_BRAIN_SHAPE = { in: 8,  hid: 6,  out: 9 };

/** Index → semantic name. The order is wire-protocol-stable for the
 *  inspector UI; do not reorder casually. */
export const HUMAN_OUTPUT_NAMES = [
  "eat", "flee", "attack", "harvest",
  "deposit", "march", "pray", "reproduce",
];
export const HUMAN_INPUT_NAMES = [
  "hunger", "carry", "foodNear", "predNear",
  "enemyNear", "woodNear", "stoneNear", "ironNear",
  "needWood", "needStone", "needIron", "atWar",
  "ageNorm", "smarts",
];

export const ANIMAL_OUTPUT_NAMES = [
  "NW", "N", "NE", "W", "stay", "E", "SW", "S", "SE",
];
export const ANIMAL_INPUT_NAMES = [
  "hunger", "carnivore", "foodHere", "foodVisible",
  "predClose", "preyClose", "humanClose", "ageNorm",
];

/** Factory helpers so call sites don't have to repeat the shape. */
export const newHumanBrain  = () => new Brain(HUMAN_BRAIN_SHAPE.in,  HUMAN_BRAIN_SHAPE.hid,  HUMAN_BRAIN_SHAPE.out);
export const newAnimalBrain = () => new Brain(ANIMAL_BRAIN_SHAPE.in, ANIMAL_BRAIN_SHAPE.hid, ANIMAL_BRAIN_SHAPE.out);
