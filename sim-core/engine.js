// Engine module: blower/fuel/ignition/compression settings -> power
// multiplier, and heat/detonation risk. Pure functions, no DOM access.

// Nitro% and brandstoftoevoer (fuel volume) are the big power knobs (the
// chemical energy content of the mixture). Blower and gasket/compression
// give a comparable, smaller range. Blower additionally has diminishing
// returns (sqrt curve): the higher the overdrive, the less extra power each
// step gives, and the more heat it puts into the mixture.
export function calcEngineFactors({ blowerOD, fuelPct, fuelVolPct, gasketThou, ignition, powerMult }) {
  const fuelFactor = 0.60 + (fuelPct - 75) / 23 * 0.80;
  const fuelVolFactor = 0.60 + (fuelVolPct - 40) / 60 * 0.80;
  const blowerNorm = Math.max(0, (blowerOD - 20) / 50);
  const blowerFactor = 0.85 + Math.sqrt(blowerNorm) * 0.27;
  const ignEff = 1 - Math.abs(ignition - 40) / 40 * 0.30;
  const compressionFactor = 0.85 + (60 - gasketThou) / 35 * 0.27;
  const mult = fuelFactor * fuelVolFactor * blowerFactor * ignEff * compressionFactor * powerMult;

  // Detonation risk is mostly a blower/heat story: the faster the blower
  // spins, the hotter the mixture gets, with compression and nitro% as
  // amplifying factors.
  const heatRisk = blowerNorm * 0.65 + Math.max(0, (compressionFactor - 1)) * 1.1 + Math.max(0, (fuelPct - 88)) / 10 * 0.15;
  const detonationRisk = heatRisk > 0.62;

  return { fuelFactor, fuelVolFactor, blowerNorm, blowerFactor, ignEff, compressionFactor, mult, heatRisk, detonationRisk };
}

// Solve for the fuelPct that restores the same effective power as a 90%
// tune at reference (sea-level) conditions - used for the "recommended
// nitro%" hint.
export function calcRecommendedNitro(powerMultNow) {
  const fuelFactor90 = 0.60 + (90 - 75) / 23 * 0.80;
  const powerMultRef = 1;
  const targetFuelFactor = fuelFactor90 * (powerMultRef / powerMultNow);
  const recommendedNitro = 75 + 23 * (targetFuelFactor - 0.60) / 0.80;
  return Math.max(75, Math.min(98, Math.round(recommendedNitro)));
}
