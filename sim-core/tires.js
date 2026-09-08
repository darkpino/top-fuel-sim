// Tires module: tire pressure vs track temp -> optimal psi, grip penalty for
// being off that optimum, and post-run tire wear. Pure functions, no DOM.

// NHRA Top Fuel rear tire pressure typically runs 6-9 psi. On a hot, greasy
// track higher pressure helps; on a cool, grippy track lower helps.
export function calcOptimalPsi(trackTempC) {
  return 6.5 + (trackTempC - 15) / 50 * 2.3;
}

export function calcPsiPenalty(tirePsi, optimalPsi) {
  return Math.abs(tirePsi - optimalPsi) * 0.45;
}

export function calcTireWear(tirePsi, optimalPsi, slipEnergy) {
  return Math.min(100, Math.abs(tirePsi - optimalPsi) * 8 + slipEnergy * 1.5);
}
