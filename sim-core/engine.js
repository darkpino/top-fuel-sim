// Engine module: blower/fuel/ignition/compression settings -> power
// multiplier, and heat/detonation risk. Pure functions, no DOM access.

// Nitro% and brandstoftoevoer (fuel volume) are the big power knobs (the
// chemical energy content of the mixture). Blower and gasket/compression
// give a comparable, smaller range. Blower additionally has diminishing
// returns (sqrt curve): the higher the overdrive, the less extra power each
// step gives, and the more heat it puts into the mixture.
//
// fuelVolPct is intentionally NOT part of this: brandstoftoevoer now runs
// on its own fuel curve (see activeFuelPct below) that can change several
// times during a run, while everything else here is a fixed per-run
// setting - so this only covers the static half, and calcMult() below
// folds in whatever the fuel curve is doing at a given instant.
export function calcEngineFactors({ blowerOD, fuelPct, gasketThou, ignition }) {
  const fuelFactor = 0.60 + (fuelPct - 75) / 23 * 0.80;
  const blowerNorm = Math.max(0, (blowerOD - 20) / 50);
  const blowerFactor = 0.85 + Math.sqrt(blowerNorm) * 0.27;
  const ignEff = 1 - Math.abs(ignition - 40) / 40 * 0.30;
  const compressionFactor = 0.85 + (60 - gasketThou) / 35 * 0.27;

  // Detonation risk is mostly a blower/heat story: the faster the blower
  // spins, the hotter the mixture gets, with compression and nitro% as
  // amplifying factors.
  const heatRisk = blowerNorm * 0.65 + Math.max(0, (compressionFactor - 1)) * 1.1 + Math.max(0, (fuelPct - 88)) / 10 * 0.15;
  const detonationRisk = heatRisk > 0.62;

  return { fuelFactor, blowerNorm, blowerFactor, ignEff, compressionFactor, heatRisk, detonationRisk };
}

// The fuelVolPct-dependent half of the power multiplier, computed
// separately so it can be re-evaluated at whatever point the fuel curve is
// at each timestep while the rest of calcEngineFactors() is computed once
// per run.
export function calcMult({ fuelFactor, fuelVolPct, blowerFactor, ignEff, compressionFactor, powerMult }) {
  const fuelVolFactor = 0.60 + (fuelVolPct - 40) / 60 * 0.80;
  const mult = fuelFactor * fuelVolFactor * blowerFactor * ignEff * compressionFactor * powerMult;
  return { fuelVolFactor, mult };
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

// Engine RPM: informational channel (same status as "geschat piekvermogen"),
// not a calibrated output like ET/mph. Top Fuel runs no gearbox - the clutch
// IS the only thing between engine and wheel, and it's tuned to keep RPM in
// a fairly narrow band for most of the run rather than let it follow ground
// speed 1:1 from a stop. We model that directly against time and speed
// (not against the clutch's lockup fraction, which produced runaway values
// at moderate lockup + low speed - a slipping clutch does not simply
// interpolate RPM linearly toward "locked"): RPM holds near LAUNCH_RPM,
// dips through a "pulldown" bump centered on the clutch's s2->s3 lockup
// ramp (the real load spike crew chiefs tune the fuel curve around), and
// climbs gently above LAUNCH_RPM as ground speed builds through the rest
// of the run.
const LAUNCH_RPM = 8200;
const PULLDOWN_DEPTH_RPM = 1200;
const CLIMB_RPM_PER_FTS = 2.4; // ~1200rpm climb by trap speed

function pulldownBump(t, s2time, s3time) {
  if (t < s2time || t >= s3time) return 0;
  const frac = (t - s2time) / Math.max(0.001, s3time - s2time);
  return Math.sin(Math.PI * frac); // 0 at both edges, 1 at the midpoint
}

export function calcEngineRpm({ t, groundSpeedFtS, s2time, s3time }) {
  const climb = CLIMB_RPM_PER_FTS * groundSpeedFtS;
  const dip = PULLDOWN_DEPTH_RPM * pulldownBump(t, s2time, s3time);
  return LAUNCH_RPM + climb - dip;
}

// Fuel flow: a nitro fuel pump is a positive-displacement gear pump driven
// directly off the blower, so flow scales with engine RPM rather than load;
// the barrel valve / fuel curve (fuelVolFactor) sets how much of that flow
// actually reaches the injectors.
const FUEL_FLOW_BASE_GPM = 90;

export function calcFuelFlowGpm(rpm, fuelVolFactor) {
  return FUEL_FLOW_BASE_GPM * fuelVolFactor * (rpm / LAUNCH_RPM);
}

// Ideal fuel curve: since the pump's own flow already rises and falls with
// RPM, holding the barrel valve at a fixed opening does NOT hold the
// mixture constant - it over-fuels (rich) whenever RPM is above the
// reference and under-fuels (lean) whenever RPM sags below it, exactly the
// "pulldown" moment where the motor is under the most load and can least
// afford to go lean. This is the target curve a crew chief is chasing with
// timed fuel stages: open the valve further when RPM sags, pull it back
// when RPM climbs, to keep the delivered mixture roughly constant despite
// the pump's own RPM-driven swings.
export function calcIdealFuelPct(rpm, referenceFuelPct) {
  return referenceFuelPct * (LAUNCH_RPM / rpm);
}

// Deviation between what's actually being fed in and what the RPM at that
// instant calls for - positive means running rich, negative means lean.
export function calcMixtureRichness(actualFuelPct, idealFuelPct) {
  return (actualFuelPct - idealFuelPct) / 100;
}

// Fuel curve: brandstoftoevoer is a 3-stage timer just like the clutch (in
// a real car it's typically driven off the same timer box) - fuel1Pct
// through launch and the dip, fuel2Pct through the lockup/pulldown (richer,
// to counter the RPM sag), fuel3Pct once fully locked and speed - and RPM -
// is climbing again (leaner, to counter the RPM rise). Reuses the clutch's
// s2time/s3time as its stage boundaries rather than adding a separate timer.
export function activeFuelPct(t, fuelStages) {
  const { s2time, fuel1Pct, s3time, fuel2Pct, fuel3Pct } = fuelStages;
  if (t < s2time) return fuel1Pct;
  if (t < s3time) return fuel2Pct;
  return fuel3Pct;
}
