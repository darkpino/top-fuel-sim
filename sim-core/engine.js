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
// NHRA Top Fuel is nominally capped at 90% nitromethane - that's the
// legal reference point the "geschat piekvermogen" baseline is built
// around, not just an arbitrary point partway up the slider. fuelFactor
// hits exactly 1.0 there; the slider still goes to 98% for testing what
// more nitro WOULD do, but anything past 90% is flagged illegal rather
// than silently treated as a normal tuning knob.
const LEGAL_NITRO_MAX = 90;

// Real numbers (MSD's Joe Pando, on the actual Power Grid system): "At
// launch, you need 60 to 65 degrees of timing to get power up" - nitro's
// slow burn means these motors run FAR more advance than a gasoline engine
// ever would, and there's no symmetric "optimal" advance the way a
// gasoline tune has one - more advance simply makes more power, right up
// to where sustained heat/cylinder pressure risks taking the engine out
// (see IGNITION_SAFE_DEG below, and the retarder in calcIgnitionRetard).
// Saturates at 65deg since that's the real ceiling the article gives -
// past it there's no evidence pushing further does anything but add risk.
export function calcIgnEff(ignitionDeg) {
  return 0.80 + Math.min(ignitionDeg, 65) / 65 * 0.30;
}

// "Between those two lines the timing is limited to 15 degrees per second
// of timing advance. That doesn't allow timing to come back in too fast."
// A real, ruled rate limit - timing can drop (retard) as fast as the curve
// or retarder call for, but climbing back up is capped, so a driver can't
// just slam full advance back in the instant RPM dips.
export const IGNITION_MAX_ADVANCE_RATE = 15; // deg/s

// How much sustained advance the engine can take before cylinder heat
// becomes real damage risk - this is what the retarder exists to protect
// against. Only matters if the curve is set aggressively enough that even
// -30deg of retard can't pull it back under this line.
export const IGNITION_SAFE_DEG = 50;
const IGNITION_HEAT_RATE = 0.12;

export function calcIgnitionHeatDamageRate(effectiveIgnitionDeg) {
  return Math.max(0, (effectiveIgnitionDeg - IGNITION_SAFE_DEG) / 30) * IGNITION_HEAT_RATE;
}

export function calcEngineFactors({ blowerOD, fuelPct, gasketThou, ignition }) {
  const fuelFactor = 0.60 + (fuelPct - 75) / 15 * 0.40;
  const blowerNorm = Math.max(0, (blowerOD - 20) / 50);
  const blowerFactor = 0.85 + Math.sqrt(blowerNorm) * 0.27;
  const ignEff = calcIgnEff(ignition);
  const compressionFactor = 0.85 + (60 - gasketThou) / 35 * 0.27;
  const nitroIllegal = fuelPct > LEGAL_NITRO_MAX;

  // Detonation risk is mostly a blower/heat story: the faster the blower
  // spins, the hotter the mixture gets, with compression and nitro% as
  // amplifying factors.
  const heatRisk = blowerNorm * 0.65 + Math.max(0, (compressionFactor - 1)) * 1.1 + Math.max(0, (fuelPct - 88)) / 10 * 0.15;
  const detonationRisk = heatRisk > 0.62;

  return { fuelFactor, blowerNorm, blowerFactor, ignEff, compressionFactor, heatRisk, detonationRisk, nitroIllegal };
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
  const fuelFactor90 = 1.0; // fuelFactor is defined to hit exactly 1.0 at the 90% legal max
  const powerMultRef = 1;
  const targetFuelFactor = fuelFactor90 * (powerMultRef / powerMultNow);
  const recommendedNitro = 75 + 15 * (targetFuelFactor - 0.60) / 0.40;
  return Math.max(75, Math.min(98, Math.round(recommendedNitro)));
}

// Engine RPM: informational channel (same status as "geschat piekvermogen"),
// not a calibrated output like ET/mph. Real onboard RPM traces (data
// loggers, not driver lore) show a sharp rise off the line to a plateau
// that then holds FLAT for nearly the whole run - not a pronounced dip and
// climb. Top Fuel runs no gearbox, so the clutch is the only thing between
// engine and wheel, and it's tuned specifically to keep RPM flat despite
// ground speed climbing; the "pulldown" crew chiefs tune the fuel curve
// around is a real but comparatively subtle sag layered on top of that
// flat band, centered on the clutch's s2->s3 lockup ramp where the load
// spikes hardest.
const STAGING_RPM = 3000; // idling, staged, before the tree drops
const LAUNCH_RPM = 8600; // the flat plateau band the clutch holds RPM in
const RISE_DURATION = 0.3; // s - how fast RPM climbs off the line to the plateau
const PULLDOWN_DEPTH_RPM = 400;
const DRIFT_RPM_PER_FTS = 0.3; // faint drift with speed - the band is not perfectly flat

function pulldownBump(t, s2time, s3time) {
  if (t < s2time || t >= s3time) return 0;
  const frac = (t - s2time) / Math.max(0.001, s3time - s2time);
  return Math.sin(Math.PI * frac); // 0 at both edges, 1 at the midpoint
}

export function calcEngineRpm({ t, groundSpeedFtS, s2time, s3time }) {
  const riseFrac = Math.min(1, t / RISE_DURATION);
  const plateau = STAGING_RPM + (LAUNCH_RPM - STAGING_RPM) * riseFrac;
  const drift = DRIFT_RPM_PER_FTS * groundSpeedFtS;
  const dip = PULLDOWN_DEPTH_RPM * pulldownBump(t, s2time, s3time);
  return plateau + drift - dip;
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
// the pump's own RPM-driven swings. Floored at the pulldown's own minimum
// so the brief staging-to-launch spin-up (RPM starting well below the
// plateau by design, not from being under load) doesn't read as a lean
// spike - that transient isn't a mixture problem, just the motor coming up
// to speed.
export function calcIdealFuelPct(rpm, referenceFuelPct) {
  const rpmFloor = LAUNCH_RPM - PULLDOWN_DEPTH_RPM;
  return referenceFuelPct * (LAUNCH_RPM / Math.max(rpm, rpmFloor));
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

// Generic breakpoint-curve sampler: points is an array of {t, v} sorted by
// t. Linearly interpolates between the two bracketing points; clamps to the
// first/last value outside the covered range. Shared by any curve that's
// dialed in as a handful of (time, value) points rather than a formula.
export function sampleCurve(t, points) {
  if (t <= points[0].t) return points[0].v;
  for (let i = 1; i < points.length; i++) {
    if (t <= points[i].t) {
      const a = points[i - 1], b = points[i];
      const frac = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
      return a.v + (b.v - a.v) * frac;
    }
  }
  return points[points.length - 1].v;
}

// Ontsteking is now a 6-point curve like the fuel/clutch timers, sampled at
// fixed checkpoints through the run rather than one static number for the
// whole pass - real ignition boxes (MSD Power Grid and similar) step timing
// through several programmed points, not just launch-vs-cruise. 2.75s is
// deliberately one of the checkpoints: that's also where the retard system
// below arms itself, so a crew chief can see and shape exactly what the
// curve is doing right as the safety system comes online.
export const IGNITION_CURVE_TIMES = [0, 0.5, 1.0, 1.5, 2.75, 4.0];

export function activeIgnition(t, ignitionCurve) {
  const points = IGNITION_CURVE_TIMES.map((ct, i) => ({ t: ct, v: ignitionCurve[i] }));
  return sampleCurve(t, points);
}

// Real Top Fuel ignition boxes (e.g. MSD's Power Grid) carry a built-in
// overspeed protection: time-blocked for the first couple seconds so it
// can't interfere with normal launch wheelspin, then arms itself and pulls
// timing out (dynamically, up to a hard cap) any time RPM creeps past the
// class redline. This is NOT a tuning knob the driver dials in - it's
// safety equipment that kicks in on top of whatever ignition curve was
// set, same as it does in the real car.
export const IGNITION_RETARD_ARM_TIME = 2.75; // s - blocked before this
export const IGNITION_REDLINE_RPM = 7900; // NHRA Top Fuel max
export const IGNITION_MAX_RETARD_DEG = 30; // hard cap on pull-out
// Our RPM channel's own plateau (see LAUNCH_RPM below) already sits a few
// hundred rpm above this redline by design (it's an indicative "how hard
// is it spinning" channel, not literally redline-limited on its own) - so
// a steep gain would slam to max retard the instant the system arms, on
// every run, which isn't what "safety net for an aggressive tune" means.
// This gain keeps a normal run's steady-state overshoot in a modest,
// single-digit-degrees range and only climbs toward the 30deg cap for a
// real excursion on top of that.
const IGNITION_RETARD_GAIN = 30 / 2500; // deg per rpm over redline

export function calcIgnitionRetard(t, rpm) {
  if (t < IGNITION_RETARD_ARM_TIME) return 0;
  const over = Math.max(0, rpm - IGNITION_REDLINE_RPM);
  return Math.min(IGNITION_MAX_RETARD_DEG, over * IGNITION_RETARD_GAIN);
}
