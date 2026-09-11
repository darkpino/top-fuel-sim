// RunSimulator: integrates Environment + Engine + Clutch + Tires over time
// into a full 1000ft run trace. Pure function, no DOM access.

import { calcDensityAltitude, calcPowerMult, calcGripCoeff, calcAirDensityRatio } from "./environment.js";
import {
  calcEngineFactors, calcMult, stepEngineRpm, calcFuelFlowGpm,
  calcIdealFuelPct, calcMixtureRichness, activeFuelPct, calcOxygenMult,
  calcIgnEff, activeIgnition, calcIgnitionRetard,
  IGNITION_MAX_ADVANCE_RATE, calcIgnitionHeatDamageRate, HEAT_RISK_THRESHOLD,
} from "./engine.js";
import { activeSetpoint, activeSpeed, calcFingerDesired, calcWornFingerDesired, stepBearingPos } from "./clutch.js";
import { calcOptimalPsi, calcPsiPenalty, calcTireWear } from "./tires.js";
import { createDriverState, stepDriver } from "./driver.js";

// Also the NHRA-mandated minimum: a Top Fuel car (with driver) has to
// weigh at least this much at the scale. Real cars that build lighter
// than this just carry ballast to make it up - see weightIllegal below.
export const WEIGHT_LB = 2320;
const V_FLOOR = 30;
const CDA = 9.0;
const RHO_REF = 0.00237;
// Ballast: NHRA General Reg 4:2 permits up to 250 lb for cars running
// 8.49s or quicker (Top Fuel qualifies), normally mounted in the front
// wing tube - that's ballastFrontLb, capped at the slider level. Anything
// placed elsewhere in the car (ballastRearLb) isn't subject to that same
// nose-specific cap; both simply add to the car's total weight, but only
// the nose ballast (and the wheelie bar / front wing settings below) do
// anything for front-end lift risk.
// Wheelie risk: how hard the launch is trying to pick the front end up,
// net of what's fighting that - nose ballast, front wing "bite," and a
// shorter wheelie bar (more leverage against the lift) all relieve it,
// none of them eliminate it outright. Reuses avgEarlyLoad (already
// computed for tire-shake risk) as the "how hard is the hit" input, since
// that's the same quantity that determines how much force is trying to
// rotate the car onto its rear wheels.
const WHEELIE_BAR_MAX_IN = 4.0; // rulebook cap: racing surface to underside of wheels
const WHEELIE_RISK_LOAD_COEFF = 1.0;
const WHEELIE_RISK_BALLAST_RELIEF = 1 / 300; // risk relieved per lb of nose ballast
const WHEELIE_RISK_WING_RELIEF = 1 / 150; // risk relieved per 1% front wing
const WHEELIE_RISK_BAR_RELIEF = 0.15; // risk relieved per inch below the 4" max
const WHEELIE_RISK_THRESHOLD = 0.55;
// Front wing "hunting": too much front-end aero bite at real speed makes
// the nose hunt side to side instead of tracking straight - the opposite
// failure mode from too little (which just lets the front end come up,
// covered by wheelie risk above). Scales with both how aggressive the
// wing is set and how fast the car actually got, so a mild front wing
// setting that never reaches speed where it'd matter doesn't flag.
const FRONT_WING_HUNT_REF_MPH = 300;
const FRONT_WING_HUNT_THRESHOLD = 0.85;
// Rear wing: NHRA rules cap adjustable trim asymmetrically at +1 deg max /
// -2 deg min from level (no max in Denver); the fixed wing itself produces
// most of the ~5000-6000 lb of downforce at 300 mph.
const WING_BASE_K = 0.0284;
// Clutch temperature builds from tire slip AND from the clutch's own
// internal slip (see CLUTCH_SLIP_HEAT_RATE below), and makes the pack
// grabbier (aggressiveness boost) up to a point - but past HEAT_GLAZE_START
// (the same "oververhit" line the failure clock uses) the material starts
// glazing over and loses bite instead, on top of accumulating damage. A
// clutch that's just warm helps; one that's cooking is actively costing
// forward force, not just risking a later failure.
const HEAT_RATE = 3.2;
const HEAT_CAP_BOOST = 0.22;
const HEAT_GLAZE_START = 70;
const HEAT_GLAZE_LOSS = 0.35;
// Lifting off doesn't let the car freewheel - Top Fuel runs no gearbox, so
// once the clutch is locked (or partway there) the crank is still
// mechanically tied to the wheels and has to keep spinning against its own
// pumping losses with no fuel to drive it. That engine braking, not just
// aero drag, is why an early lift costs real time and trap speed instead
// of just gently coasting out the rest of the pass.
const ENGINE_BRAKE_COEFF = 12;
// A drag slick doesn't peak its grip at zero slip - it has to GROW into
// its optimal rolling diameter and contact patch first, which only
// happens under load, so the true traction ceiling sits a bit above the
// naive static-friction estimate. This is a constant physical property of
// the tire (not a launch-only effect - it just only matters while the car
// is still traction-limited, which in practice is the first ~50-60ft;
// past that the clutch/motor ceiling is already the binding constraint
// regardless of how much grip is on offer, so this bonus has zero further
// effect there - see TIRE_GROWTH_RATE below for the wheelspeed/shake side
// of the same phenomenon).
// Calibrated against real NHRA time slips (see docs/nhra-reference-times.md)
// rather than a single ET target: matching a solid full-split example
// (0.828/2.156/3.089@274/3.853) needed more than just a bigger bonus - the
// old value only fixed the 0-60ft window and left 60-660ft compressed well
// past what any real split shows, however this constant was tuned. 0.40
// pairs with the widened stage-2 hold below to get the WHOLE early-to-mid
// shape in the right neighborhood, not just the launch number.
const TIRE_PEAK_GRIP_BONUS = 0.4;
// How much wheelspeed-over-groundspeed a healthy, well-matched tire builds
// as it grows under load (loadRatio = engineForce/maxTraction) - this is
// the margin real data-logger traces show even on a clean, non-smoking
// run (see calcGrowthEfficiency below for why a mismatched tire pressure
// can suppress it instead of just cost ET).
const TIRE_GROWTH_RATE = 8;
// Tire pressure sets how readily the carcass can actually grow into that
// margin - matched to track temp (psiPenalty ~ 0), it grows freely;
// badly mismatched, the growth is suppressed even while the tune is still
// asking a lot of the tire (high loadRatio) - exactly the combination
// that produces tire shake in real cars: not enough margin to slip
// smoothly, not enough grip to hook up clean either.
const GROWTH_EFFICIENCY_PSI_REF = 1.5;
const TIRE_SHAKE_LOAD_THRESHOLD = 0.48;
const TIRE_SHAKE_EFFICIENCY_THRESHOLD = 0.68;
const DT = 0.004;
const MAX_T = 10.0;
// Holding lockup back to stay under the traction ceiling isn't free: the
// clutch itself is slipping under whatever torque the motor is making but
// not transmitting, and that difference is dissipated as heat in the
// pack. CLUTCH_DAMAGE_RATE only starts counting once clutchTemp is
// already deep in the "oververhit" zone (>70/100) - a brief flash of heat
// early in a stage transition isn't fatal, sustained cooking is.
const CLUTCH_SLIP_HEAT_RATE = 0.0025;
const CLUTCH_DAMAGE_RATE = 0.006;
const CLUTCH_FAILURE_THRESHOLD = 0.15;
// Sustained lean-under-load (not enough fuel curve to cover the RPM the
// pump is losing) accumulates damage on the SAME clock as heat-risk damage
// below - both represent "you are killing this engine," just from opposite
// ends of the mixture. Sustained rich (fouling) is tracked separately: it
// costs cylinders, but on its own it never escalates to a full failure the
// way running lean under load does.
// FOUL_DAMAGE_RATE deliberately sits well below LEAN_DAMAGE_RATE, not just
// a bit under it: rich staying the lesser of the two mixture failure modes
// (it costs a cylinder, never the full engine the way lean does) is the
// design intent CYLINDER_DROP_THRESHOLD assumed, and at the old 0.4
// (nearly as aggressive as LEAN_DAMAGE_RATE's 0.5) that intent wasn't
// being honored. Now that activeFuelPct only actually delivers a later
// stage's richer setting once the clutch has genuinely started locking up
// (see engine.js), a stock default pass stays close to a clean 0 for most
// of the run instead of running rich the moment the clock reaches a later
// stage - 0.15 leaves that pass a comfortable margin under
// CYLINDER_DROP_THRESHOLD while still catching a genuinely over-rich tune.
const LEAN_DAMAGE_RATE = 0.5;
const FOUL_DAMAGE_RATE = 0.15;
// CYLINDER_DROP_THRESHOLD and ENGINE_FAILURE_THRESHOLD both pulled down a
// bit (were 0.075/0.15): between this and HEAT_RISK_THRESHOLD above, a
// stock default pass keeps a healthy margin under every one of these
// (still verified against the regression baseline), but there's
// noticeably less room left to push blower/compression/nitro together
// before something actually gives - narrower on purpose, see the note on
// HEAT_RISK_THRESHOLD in engine.js.
const CYLINDER_DROP_THRESHOLD = 0.065;
const ENGINE_FAILURE_THRESHOLD = 0.13;
// Hydraulic lock: too much liquid fuel pooling in a cylinder doesn't fully
// vaporize/burn before the piston reaches it - and liquid doesn't
// compress, so something mechanical gives (a bent rod, worse) rather than
// the gradual "loses a cylinder over time" story foulDamage tells above.
// That makes it a THIS-INSTANT mechanical event tied to the peak richness
// actually seen, not an accumulated clock - checked directly against
// richness every tick, independent of heatDamage/leanDamage/foulDamage.
// Calibrated above what a default pass reaches (peaks around 0.15) with
// real but tighter room above that (was 0.55) before a genuinely
// over-rich build hits it, in line with the other margins above.
const HYDROLOCK_RICHNESS_THRESHOLD = 0.48;
const CYLINDER_DROP_FORCE_PENALTY = 0.85; // one or more cylinders misfiring
// How far (ft) past the commanded shutoff point an undisciplined driver
// drifts before actually lifting - a pay driver who "doesn't listen," the
// direct ask. Scales with the driver's own disciplineMult (see team.js):
// a driver at or above the 1.0 baseline gets zero overshoot (executes
// exactly, same as no hired driver at all - a complete no-op), a weaker
// one drifts proportionally further past the mark, taking extra engine/
// clutch stress the whole way there.
const DRIVER_DISCIPLINE_OVERSHOOT_FT = 300;

export function runSimulation(settings) {
  const {
    airtempC, humidity, baroInHg, trackTempC, gripSliderPct, trackElevationFt = 0,
    blowerOD, fuelPct, gasketThou, ignitionCurve,
    s1time, s1pct, s1speed, s2time, s2pct, s2speed, s3time, s3pct, s3speed,
    s4time, s4pct, s4speed, s5time, s5pct, s5speed, s6time, s6pct, s6speed,
    fuel1time, fuel1pct, fuel2time, fuel2pct, fuel3time, fuel3pct,
    fuel4time, fuel4pct, fuel5time, fuel5pct, fuel6time, fuel6pct,
    fingerWeight, tirePsi, wingAngle, driverAggressiveness, driverWatchUntilFt, driverShutoffFt,
    ballastFrontLb, ballastRearLb, frontWingPct, wheelieBarHeightIn,
    garageWeightDeltaLb = 0, garageWheelieRiskBallastEquivLb = 0, garageDragCdaMult = 1, garageDownforceMult = 1,
    garageClutchHeatRateMult = 1, garageClutchDamageMult = 1, garageClutchCapacityMult = 1,
    garageTractionMult = 1, garagePowerMult = 1, garageEngineDamageMult = 1,
    // Infinity: without a configured tank (AI opponents, or any caller that
    // doesn't pass this) there's no capacity ceiling to run afoul of - only
    // the player's own garage-sized tank can actually run dry.
    garageTankUsableGal = Infinity,
    // Hired-driver skill (see team.js) - both default to 1, an exact no-op
    // reproducing pre-team behavior for AI opponents and any team-less run.
    garageDriverCarControlMult = 1, garageDriverDisciplineMult = 1,
  } = settings;

  const densityAltitude = calcDensityAltitude(airtempC, humidity, baroInHg, trackElevationFt);
  const powerMult = calcPowerMult(densityAltitude);
  const airDensityRatio = calcAirDensityRatio(densityAltitude);
  const weightLb = WEIGHT_LB + ballastFrontLb + ballastRearLb + garageWeightDeltaLb;
  // Under minimum weight is illegal outright, not just a disadvantage that
  // balances itself out - real NHRA cars are weighed after every run, so
  // there's no way to actually race light and get away with it. The run
  // still executes at the car's true (lighter, faster) weight below, same
  // as an over-nitro run still executes at its true (also illegal) power -
  // it's the result that gets thrown out, not the physics.
  const weightIllegal = weightLb < WEIGHT_LB;

  // ignition: 40 is a throwaway - ignEff is no longer static, it's sampled
  // from ignitionCurve (and the retard system) fresh every timestep below.
  const { fuelFactor, blowerFactor, compressionFactor, heatRisk, detonationRisk, nitroIllegal } =
    calcEngineFactors({ blowerOD, fuelPct, gasketThou, ignition: 40, airDensityRatio });
  // Static for the whole run (blowerOD/gasketThou are fixed tune settings,
  // airDensityRatio is fixed weather/track) - how much oxygen this build
  // actually has to work with relative to a reference build at sea level.
  // See calcOxygenMult in engine.js for what feeds into it.
  const oxygenMult = calcOxygenMult({ blowerOD, compressionFactor, airDensityRatio });

  const optimalPsi = calcOptimalPsi(trackTempC);
  const psiPenalty = calcPsiPenalty(tirePsi, optimalPsi);
  const baseGripCoeff = calcGripCoeff({ gripSliderPct, trackTempC, psiPenalty });
  const growthEfficiency = Math.max(0.3, Math.min(1, 1 - psiPenalty / GROWTH_EFFICIENCY_PSI_REF));

  // Two engine-side ceilings, calibrated against real published Top Fuel
  // reference points (60ft ~0.8s @ ~100mph, 1000ft ~3.65s @ ~330-338mph,
  // peak launch g ~5.6, ~297mph+ by 660ft):
  // 1) LAUNCH_CAP - the clutch's maximum transmittable torque as a wheel
  //    force. This governs the early-mid run and is what gives the sharp
  //    early g's - constant regardless of speed.
  // 2) A power-based ceiling (force = power/speed) that naturally FALLS as
  //    speed rises. This is what makes real Top Fuel acceleration taper
  //    through the back half instead of holding a flat plateau to the
  //    finish - a flat-force model was the structural reason incrementals
  //    never lined up no matter how the individual constants were tuned.
  // Both now depend on the fuel curve (fuelVolPct), which changes over the
  // run, so they're recomputed each timestep below instead of once here.
  const wingTrim = 1 + (wingAngle / 2.5) * 0.45;
  const WING_K = WING_BASE_K * wingTrim * garageDownforceMult;

  const stages = {
    s1time, s1pct, s1speed, s2time, s2pct, s2speed, s3time, s3pct, s3speed,
    s4time, s4pct, s4speed, s5time, s5pct, s5speed, s6time, s6pct, s6speed,
  };
  // Fuel curve: its own independent 6-stage timer (see activeFuelPct in
  // engine.js), no longer tied to the clutch's stage boundaries.
  const fuelStages = {
    fuel1time, fuel1pct, fuel2time, fuel2pct, fuel3time, fuel3pct,
    fuel4time, fuel4pct, fuel5time, fuel5pct, fuel6time, fuel6pct,
  };
  const fingerDesired = calcFingerDesired(fingerWeight);
  const disciplineDeficit = Math.max(0, 1 - garageDriverDisciplineMult);
  const effectiveDriverShutoffFt = Math.min(1000, driverShutoffFt + disciplineDeficit * DRIVER_DISCIPLINE_OVERSHOOT_FT);

  let t = 0, v = 0, x = 0, wheelV = 0;
  let et60 = null, et330 = null, et660 = null, mph660 = null;
  let finishT = null;
  const trace = [];
  let clutchTemp = 0;
  let slipIntegral = 0;
  let bearingPos = 0.05;
  // Engine failure: sustained high heat risk (aggressive blower/compression/
  // nitro combo) and sustained lean-under-load (undersized fuel curve) are
  // tracked on separate clocks so the eventual failure/cylinder-drop can
  // report which one actually did it, but they sum to the same threshold -
  // both are "you are killing this engine," just from opposite ends.
  // Running rich instead costs cylinders (fouling) via a separate clock
  // that never escalates to a full failure on its own.
  let heatDamage = 0;
  let leanDamage = 0;
  let foulDamage = 0;
  let engineFailed = false;
  let engineFailTime = null;
  let engineFailCause = null;
  let fuelStarved = false;
  let fuelConsumedGal = 0;
  let engineRpmState = 3000; // matches engine.js's STAGING_RPM
  let cylindersDropped = false;
  let cylinderDropTime = null;
  let cylinderDropCause = null;
  let clutchDamage = 0;
  let clutchFailed = false;
  let clutchFailTime = null;
  let richnessIntegral = 0;
  const driverState = createDriverState();
  let lastSlipPct = 0;
  let peakWornGain = 0;
  let peakClutchOverForce = 0;
  let earlyLoadSum = 0;
  let earlyLoadCount = 0;
  let peakIgnitionRetard = 0;
  let ignitionRetardState = 0;
  let ignitionActual = ignitionCurve[0];
  let ignEffIntegral = 0;

  while (x < 1000 && t < MAX_T) {
    const xBefore = x;
    const target = activeSetpoint(t, stages);
    const speed = activeSpeed(t, stages);
    bearingPos = stepBearingPos(bearingPos, target, speed, DT);
    let heatBoost = 1 + Math.min(clutchTemp / 100, 1) * HEAT_CAP_BOOST;
    if (clutchTemp > HEAT_GLAZE_START) {
      const glazeFrac = Math.min(1, (clutchTemp - HEAT_GLAZE_START) / (100 - HEAT_GLAZE_START));
      heatBoost *= 1 - glazeFrac * HEAT_GLAZE_LOSS;
    }
    // clutchDamage here is last step's accumulated value - same
    // previous-step pattern as lastSlipPct below, avoiding a same-step
    // circular dependency (this step's damage is added further down).
    const wornFingerDesired = calcWornFingerDesired(fingerDesired, clutchDamage);
    peakWornGain = Math.max(peakWornGain, wornFingerDesired - fingerDesired);
    const lf = Math.min(wornFingerDesired, bearingPos) * heatBoost;
    // Computed here (ahead of engine RPM) because stepEngineRpm now needs
    // it too - whether the driver is still on the gas this instant is what
    // decides whether the free-revving engine keeps climbing/holding or
    // falls back toward idle (see engine.js).
    const throttle = stepDriver(driverState, t, x, lastSlipPct, driverAggressiveness, driverWatchUntilFt, effectiveDriverShutoffFt, DT, garageDriverCarControlMult);

    const rpmStep = stepEngineRpm(engineRpmState, { t, wheelSpeedFtS: wheelV, lf, priorSlipPct: lastSlipPct, throttle }, DT);
    engineRpmState = rpmStep.rpm;
    const rpm = engineRpmState;
    const fuelVolPctNow = activeFuelPct(t, fuelStages, rpmStep.pulldownFrac);
    // Ignition is a curve too now, and the retard system (real safety
    // equipment on cars like these, not a driver-tunable knob) can pull
    // timing further out on top of it once armed - see engine.js for both.
    const ignitionSet = activeIgnition(t, ignitionCurve);
    const ignitionRetardDeg = calcIgnitionRetard(t, rpm, ignitionRetardState, DT);
    ignitionRetardState = ignitionRetardDeg;
    const ignitionTarget = ignitionSet - ignitionRetardDeg;
    // Timing can drop (retard, or the curve itself calling for less) as
    // fast as it needs to, but climbing back toward more advance is rate-
    // limited - a real ruled cap so a tuner can't just slam full advance
    // back in the instant the retarder eases off.
    if (ignitionTarget > ignitionActual) {
      ignitionActual = Math.min(ignitionTarget, ignitionActual + IGNITION_MAX_ADVANCE_RATE * DT);
    } else {
      ignitionActual = ignitionTarget;
    }
    const ignitionEffective = ignitionActual;
    const ignEff = calcIgnEff(ignitionEffective);
    peakIgnitionRetard = Math.max(peakIgnitionRetard, ignitionRetardDeg);
    ignEffIntegral += ignEff * DT;
    const { fuelVolFactor, mult } = calcMult({ fuelFactor, fuelVolPct: fuelVolPctNow, blowerFactor, ignEff, compressionFactor, powerMult });

    // Re-anchored again: the previous 18000/6100 pair had 60ft and the
    // "typical" pace right, but left too little headroom underneath it -
    // stack a merely-decent AI tune's higher blower/nitro/lockup with a
    // good-track-conditions round and the achievable ET could dip into
    // the low 3.3s, well past the real-world ~3.6s wall no NHRA run has
    // ever crossed. Pulling both down further (16500/5600) moves the
    // whole band down while keeping the same ratio (so the LAUNCH_CAP/
    // POWER_HP crossover speed, and therefore the 60ft-vs-330ft+ SHAPE,
    // is unchanged - see the physics note this replaces, still accurate
    // on the mechanism, just re-anchored on the numbers).
    // mult itself is also capped: a tune that pushes blower/nitro/
    // compression/ignition all at once compounds multiplicatively (see
    // calcMult) into a raw multiplier that can exceed 1.7-1.9 at the
    // legal max - the failure-risk system is meant to be the check on
    // that, but a short/lucky run can still beat it. MULT_CEILING treats
    // that stacked-tune ceiling as a drivetrain/clutch-pack torque
    // capacity limit instead: legitimate extra chemical energy beyond it
    // still costs full reliability risk (heatRisk et al never read mult),
    // it just stops buying more speed - discourages tuning past it
    // without needing the failure model to catch every case on its own.
    const MULT_CEILING = 1.35;
    const cappedMult = Math.min(mult, MULT_CEILING);
    const LAUNCH_CAP = 16500 * cappedMult * garagePowerMult;
    const POWER_HP = 5600 * cappedMult * garagePowerMult;

    const powerForce = (POWER_HP * lf * 550) / Math.max(v, V_FLOOR);
    let engineForce = Math.min(powerForce, LAUNCH_CAP * lf) * throttle;
    // If the motor is making more force than the clutch PACK ITSELF can
    // hold (a weaker clutch's garageClutchCapacityMult < 1, or simply a
    // power tune that's out-built whatever clutch is bolted in), the
    // excess never reaches the wheel - it drives the pack through instead.
    // At the baseline clutch (capacityMult 1.0) this ceiling is exactly
    // LAUNCH_CAP, which engineForce can never exceed anyway (lf <= 1), so
    // this is a complete no-op for the default build - it only bites once
    // a tune genuinely out-powers the clutch that's mounted.
    const clutchCapacityForce = LAUNCH_CAP * garageClutchCapacityMult;
    if (engineForce > clutchCapacityForce) {
      peakClutchOverForce = Math.max(peakClutchOverForce, engineForce - clutchCapacityForce);
      engineForce = clutchCapacityForce;
    }
    // What the motor could send through a FULLY locked clutch right now,
    // vs. what's actually getting through at the current lockup fraction -
    // the gap is torque the clutch is holding back, dissipated as heat in
    // the pack rather than reaching the wheel. Holding lockup back on
    // purpose to stay under the traction ceiling protects the tires, but
    // it's the clutch that pays for it.
    const availableForce = Math.min(powerForce, LAUNCH_CAP) * throttle;
    const clutchSlipLoss = Math.max(0, availableForce - engineForce);

    // How much of the engine's full-lockup potential is actually reaching
    // the wheel THIS instant - captures both a deliberately held-back
    // lockup (lf < 1, the clutch curve's own doing) and a clutch pack
    // genuinely out-powered by the motor (engineForce clipped by
    // clutchCapacityForce above) as the same thing: less mechanical LOAD
    // landing on the engine than it's capable of putting out. At the
    // calibrated default build this sits at (or very near) 1 for almost
    // the whole run, so this is a near no-op there.
    const loadFraction = availableForce > 1e-6 ? Math.max(0, Math.min(1, engineForce / availableForce)) : 1;
    // Less load landing on the motor is less mechanical work extracted per
    // combustion event - it doesn't have to fight the car, so it runs
    // cooler (loadHeatMult, used below) but also needs comparatively LESS
    // fuel to stay correctly fed. A fuel curve tuned for full load now
    // over-fuels a lightly-loaded motor - reads rich, and if that's not
    // backed off, floods/fouls cylinders instead of blowing them lean.
    // Both floor above 0 rather than going all the way there - even a
    // freely slipping clutch is still turning the motor over under
    // throttle, not idling - and floor at different depths since heat and
    // mixture aren't the same size of effect.
    const loadFuelMult = 0.7 + 0.3 * loadFraction;
    const loadHeatMult = 0.3 + 0.7 * loadFraction;
    const idealFuelPct = calcIdealFuelPct(rpm, fuel1pct, oxygenMult * loadFuelMult);
    const richness = calcMixtureRichness(fuelVolPctNow, idealFuelPct);
    richnessIntegral += richness * DT;

    const wingDownforce = WING_K * v * v;
    const maxTraction = (weightLb + wingDownforce) * baseGripCoeff * (1 + TIRE_PEAK_GRIP_BONUS) * garageTractionMult;
    const loadRatio = engineForce / maxTraction;
    let appliedForce, slipPct, slipping;
    if (engineForce > maxTraction) {
      slipPct = Math.min(100, ((engineForce - maxTraction) / engineForce) * 100);
      // Progressive penalty: a little managed slip barely costs anything,
      // but heavy overpowering the tires (going up in smoke) costs real
      // forward force, not just a flat 7% haircut.
      const efficiency = 0.93 - Math.min(0.45, (slipPct / 100) * 0.65);
      appliedForce = maxTraction * efficiency;
      slipping = true;
    } else {
      appliedForce = engineForce;
      slipPct = 0;
      slipping = false;
    }
    lastSlipPct = slipPct;
    clutchTemp += (slipPct / 100) * HEAT_RATE * DT * 10;
    clutchTemp += clutchSlipLoss * CLUTCH_SLIP_HEAT_RATE * garageClutchHeatRateMult * DT;
    slipIntegral += slipPct * DT;

    // Only counts once the pack is already deep in the "oververhit" zone -
    // a brief spike during a stage transition isn't fatal, cooking it there
    // for a while is.
    clutchDamage += Math.max(0, clutchTemp - 70) * CLUTCH_DAMAGE_RATE * garageClutchDamageMult * DT;
    if (!clutchFailed && clutchDamage > CLUTCH_FAILURE_THRESHOLD) {
      clutchFailed = true;
      clutchFailTime = t;
    }

    // All three damage clocks below are combustion-event stress - heat
    // from the blower/nitro/compression combo, and lean/rich from how well
    // the fuel curve matches what's actually burning. None of that happens
    // without fuel/air actually flowing, which the driver's foot gates
    // (throttle) same as any barrel-valve nitro car - a full lift (shutoff
    // or a pedal dip) cuts off the combustion event these clocks are
    // tracking, not just the propulsive force. Without this, a run that
    // goes fully clean to a planned shutoff point could still blow up
    // afterward purely from the engine coasting through the rest of the
    // simulated time at the SAME damage rate as full throttle - the tune
    // did nothing wrong, the model just kept counting a stress that had
    // already stopped happening.
    heatDamage += Math.max(0, heatRisk - HEAT_RISK_THRESHOLD) * loadHeatMult * garageEngineDamageMult * throttle * DT;
    // The retarder exists specifically to keep this at bay - it only bites
    // if the curve is dialed aggressively enough that even -30deg of
    // retard can't pull effective timing back under a safe line.
    heatDamage += calcIgnitionHeatDamageRate(ignitionEffective) * garageEngineDamageMult * throttle * DT;
    // Lean under load hurts the most right where lf is high - the clutch
    // is loaded, so the motor can least afford to be starved right then.
    leanDamage += Math.max(0, -richness) * lf * LEAN_DAMAGE_RATE * garageEngineDamageMult * throttle * DT;
    foulDamage += Math.max(0, richness) * FOUL_DAMAGE_RATE * throttle * DT;
    const engineDamage = heatDamage + leanDamage;

    if (!cylindersDropped && (engineDamage > CYLINDER_DROP_THRESHOLD || foulDamage > CYLINDER_DROP_THRESHOLD)) {
      cylindersDropped = true;
      cylinderDropTime = t;
      cylinderDropCause = engineDamage > CYLINDER_DROP_THRESHOLD ? (heatDamage >= leanDamage ? "heat" : "lean") : "rich";
    }
    if (!engineFailed && engineDamage > ENGINE_FAILURE_THRESHOLD) {
      engineFailed = true;
      engineFailTime = t;
      engineFailCause = heatDamage >= leanDamage ? "heat" : "lean";
    }
    if (!engineFailed && richness > HYDROLOCK_RICHNESS_THRESHOLD) {
      engineFailed = true;
      engineFailTime = t;
      engineFailCause = "hydrolock";
    }
    if (engineFailed || clutchFailed) appliedForce = 0;
    else if (cylindersDropped) appliedForce *= CYLINDER_DROP_FORCE_PENALTY;

    const drag = 0.5 * RHO_REF * airDensityRatio * CDA * garageDragCdaMult * v * v;
    // Mechanical engine braking through the locked (or partly locked)
    // clutch - scales with how far off throttle the driver is and how
    // much of the driveline is actually coupled (lf), not just aero.
    const engineBrakeForce = ENGINE_BRAKE_COEFF * (1 - throttle) * lf * v;
    const net = appliedForce - drag - engineBrakeForce;
    const accel = net * 32.174 / weightLb;
    v = Math.max(0, v + accel * DT);
    x += v * DT;

    if (slipping) {
      // Wheel speed excess now comes directly from the same force-based
      // slip% that already governs the efficiency penalty above, instead of
      // a separately integrated "rotating mass" model - that model had no
      // ceiling tied to what the tire was actually costing in forward
      // force, so a sustained ~30% force slip (a real but modest amount -
      // nowhere near a full smoked-tire burnout) could still integrate the
      // displayed wheel speed up to 100+mph above ground speed. Treating
      // slipPct as a standard tire slip ratio - (wheelV-v)/wheelV - keeps
      // the number exactly as "smoky" as the ET consequence it's paired
      // with: 30% slip reads as ~1.4x ground speed, not a runaway spike.
      wheelV = v / (1 - Math.min(slipPct, 90) / 100);
    } else {
      // Below the smoke ceiling the tire is still visibly running ahead of
      // ground speed on a real data logger - it's growing into its patch,
      // not slipping in the "losing time" sense. How much depends on how
      // hard it's being loaded (loadRatio) and how well pressure matches
      // the track (growthEfficiency) - a badly matched pressure suppresses
      // this margin even under heavy load, which is the tire-shake
      // combination tracked below.
      const growthSlipPct = Math.min(TIRE_GROWTH_RATE, loadRatio * TIRE_GROWTH_RATE) * growthEfficiency;
      wheelV = v * (1 + growthSlipPct / 100);
    }
    if (x < 150) {
      earlyLoadSum += loadRatio;
      earlyLoadCount++;
    }

    const fuelGpm = calcFuelFlowGpm(rpm, fuelVolFactor);
    fuelConsumedGal += fuelGpm * (DT / 60); // gpm is gallons per MINUTE, DT is seconds
    if (!engineFailed && !fuelStarved && fuelConsumedGal > garageTankUsableGal) {
      // Running dry mid-pass isn't a gentle sputter - the pump goes instantly
      // to air, the mixture goes catastrophically lean at the worst possible
      // moment (full load), and the motor lets go. Reuses the exact same
      // "lean" engine failure the fuel-curve-lean-under-load path already
      // uses (rollEnginePartsFailed in finances.js still picks which
      // physical part(s) it actually takes), just flagged separately so the
      // UI can call out what actually happened.
      engineFailed = true;
      fuelStarved = true;
      engineFailTime = t;
      engineFailCause = "lean";
    }

    // Interpolated crossing time within this DT=0.004s step, not the raw
    // simulation-grid time - without this, two cars whose true finish
    // times differ by only a couple milliseconds could land in the same
    // 4ms tick and report a bit-identical ET (the actual cause behind
    // "veel auto's rijden dezelfde tijd" - not insufficient tune variety,
    // just display/output precision finer than the integration step).
    const crossingTime = (threshold) => t + DT * (threshold - xBefore) / Math.max(x - xBefore, 1e-9);
    if (et60 === null && x >= 60) et60 = crossingTime(60);
    if (et330 === null && x >= 330) et330 = crossingTime(330);
    if (et660 === null && x >= 660) { et660 = crossingTime(660); mph660 = v / 1.4667; }
    if (finishT === null && x >= 1000) finishT = crossingTime(1000);
    trace.push({ t, x, v_mph: v / 1.4667, wheel_mph: wheelV / 1.4667, slip: slipPct, clutch_pos: bearingPos * 100, effective_lockup: Math.min(1, lf) * 100, pulldown_frac: rpmStep.pulldownFrac * 100, fuel_gpm: fuelGpm, rpm, ignition_set: ignitionSet, ignition_retard: ignitionRetardDeg, ignition_effective: ignitionEffective });
    t += DT;
  }

  const finished = finishT !== null;
  const et = finished ? finishT : t;
  const mph = trace.length ? trace[trace.length - 1].v_mph : 0;

  const slipEnergy = trace.reduce((acc, p) => acc + p.slip, 0) / trace.length;
  const clutchHeat = Math.min(100, clutchTemp);
  const avgSlipPct = slipIntegral / Math.max(et, 0.001);
  // Mixture reading now tracks how well the fuel CURVE matched what the
  // RPM trace actually called for (see calcMixtureRichness), not just a
  // static nitro%/compression balance that read "rich" at any normal nitro
  // percentage regardless of tune. Compression/ignition still nudge it -
  // a hotter motor burns fuel more completely, reading slightly leaner for
  // the same delivered mixture.
  const avgRichness = richnessIntegral / Math.max(et, 0.001);
  const avgIgnEff = ignEffIntegral / Math.max(et, 0.001);
  const plugBalance = avgRichness + (compressionFactor - 1) * 0.3 - (avgIgnEff - 1) * 0.5;
  // Bearing wear now tracks the same clutchDamage clock that drives
  // failure risk AND the widening finger-to-bearing gap (see
  // calcWornFingerDesired) - it's the direct readout of how much extra
  // lockup ceiling sustained slip has quietly bought the clutch.
  const bearingWear = Math.min(100, (clutchDamage / CLUTCH_FAILURE_THRESHOLD) * 100);
  const tireWear = calcTireWear(tirePsi, optimalPsi, slipEnergy);
  const peakFuelGpm = trace.reduce((acc, p) => Math.max(acc, p.fuel_gpm), 0);
  // Tire shake: the tune is asking a lot of the tire in the launch phase
  // (avgEarlyLoad high - it's not being babied) but pressure is matched
  // badly enough to the track that it can't grow into that load smoothly
  // (growthEfficiency low) - the real-world combination that produces a
  // harsh, ET-costing vibration instead of either a clean hookup or smoke.
  const avgEarlyLoad = earlyLoadCount ? earlyLoadSum / earlyLoadCount : 0;
  const tireShakeRisk = avgEarlyLoad > TIRE_SHAKE_LOAD_THRESHOLD && growthEfficiency < TIRE_SHAKE_EFFICIENCY_THRESHOLD;

  // How hard the launch was trying to pick the front end up (avgEarlyLoad,
  // the same "how loaded was the hit" figure tire shake uses), net of
  // what's fighting that lift - nose ballast, front wing bite, and a
  // wheelie bar riding lower than the 4" legal max.
  const wheelieRisk = avgEarlyLoad * WHEELIE_RISK_LOAD_COEFF
    - ballastFrontLb * WHEELIE_RISK_BALLAST_RELIEF
    - garageWheelieRiskBallastEquivLb * WHEELIE_RISK_BALLAST_RELIEF
    - frontWingPct * WHEELIE_RISK_WING_RELIEF
    - (WHEELIE_BAR_MAX_IN - wheelieBarHeightIn) * WHEELIE_RISK_BAR_RELIEF
    > WHEELIE_RISK_THRESHOLD;
  const frontWingHuntRisk = (frontWingPct / 100) * (mph / FRONT_WING_HUNT_REF_MPH) > FRONT_WING_HUNT_THRESHOLD;

  return {
    finished, et, mph, et60, et330, et660, mph660, trace, densityAltitude,
    clutchHeat, avgSlipPct, plugBalance, bearingWear, tireWear, detonationRisk, nitroIllegal, tireShakeRisk,
    peakFuelGpm, fuelConsumedGal, engineFailed, engineFailTime, engineFailCause, fuelStarved,
    cylindersDropped, cylinderDropTime, cylinderDropCause,
    clutchFailed, clutchFailTime,
    driverLifted: driverState.lifted, driverLiftTime: driverState.liftTime, driverLiftReason: driverState.liftReason, pedalCount: driverState.pedalCount,
    clutchWearLockupGainPct: peakWornGain * 100,
    clutchOverpowered: peakClutchOverForce > 0,
    peakIgnitionRetard,
    anySpin: trace.some(p => p.slip > 5),
    weightLb, weightIllegal, wheelieRisk, frontWingHuntRisk,
  };
}
