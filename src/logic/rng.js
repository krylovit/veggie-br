// Deterministic RNG (mulberry32) stored on the state — portable and
// reproducible, which also makes headless playtests deterministic.
export function rand(state) {
  state.rngState = (state.rngState + 0x6d2b79f5) | 0;
  let t = state.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const randRange = (state, lo, hi) => lo + rand(state) * (hi - lo);
