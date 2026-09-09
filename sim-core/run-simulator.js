// RunSimulator: integrates Environment + Engine + Clutch + Tires over time
// into a full 1000ft run trace. Pure function, no DOM access.

import { calcDensityAltitude, calcPowerMult, calcGripCoeff } from "./environment.js";
import {
  calcEngineFactors, calcMult, calcEngineRpm, calcFuelFlowGpm,
  calcIdealFuelPct, calcMixtureRichness, activeFuelPct,
  calcIgnEff, activeIgnition, calcIgnitionRetard,
  IGNITION_MAX_ADVANCE_RATE, calcIgnitionHeatDamageRate,
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
const TIRE_SHAKE_LOAD_THRESHOLD = 0.55;
const TIRE_SHAKE_EFFICIENCY_THRESHOLD = 0.6;
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
const LEAN_DAMAGE_RATE = 0.5;
const FOUL_DAMAGE_RATE = 0.4;
const CYLINDER_DROP_THRESHOLD = 0.075;
const ENGINE_FAILURE_THRESHOLD = 0.15;
const CYLINDER_DROP_FORCE_PENALTY = 0.85; // one or more cylinders misfiring

export function runSimulation(settings) {
  const {
    airtempC, humidity, baroInHg, trackTempC, gripSliderPct,
    blowerOD, fuelPct, gasketThou, ignitionCurve,
    s1time, s1pct, s1speed, s2time, s2pct, s2speed, s3time, s3pct, s3speed,
    s4time, s4pct, s4speed, s5time, s5pct, s5speed, s6time, s6pct, s6speed,
    fuel1Pct, fuel2Pct, fuel3Pct,
    fingerWeight, tirePsi, wingAngle, driverAggressiveness, driverWatchUntilFt, driverShutoffFt,
    ballastFrontLb, ballastRearLb, frontWingPct, wheelieBarHeightIn,
    garageWeightDeltaLb = 0, garageWheelieRiskBallastEquivLb = 0, garageDragCdaMult = 1,
    garageClutchHeatRateMult = 1, garageClutchDamageMult = 1, garageTractionMult = 1, garagePowerMult = 1, garageEngineDamageMult = 1,
  } = settings;

  const densityAltitude = calcDensityAltitude(airtempC, humidity, baroInHg);
  const powerMult = calcPowerMult(densityAltitude);
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
    calcEngineFactors({ blowerOD, fuelPct, gasketThou, ignition: 40 });

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
  const WING_K = WING_BASE_K * wingTrim;

  const stages = {
    s1time, s1pct, s1speed, s2time, s2pct, s2speed, s3time, s3pct, s3speed,
    s4time, s4pct, s4speed, s5time, s5pct, s5speed, s6time, s6pct, s6speed,
  };
  // Fuel curve still only has 3 phases (launch/lockup-pulldown/eindfase),
  // sharing the clutch's own timing rather than a separate timer: fuel2
  // (pulldown) starts when the clutch begins its pullback (s2time, same
  // as before), fuel3 (eindfase) starts once the clutch reaches its final
  // stage-6 target - full lockup, now the last of six stages instead of
  // the third of three.
  const fuelStages = { s2time, fuel1Pct, s3time: s6time, fuel2Pct, fuel3Pct };
  const fingerDesired = calcFingerDesired(fingerWeight);

  let t = 0, v = 0, x = 0, wheelV = 0;
  let et60 = null, et330 = null, et660 = null, mph660 = null;
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
  let earlyLoadSum = 0;
  let earlyLoadCount = 0;
  let peakIgnitionRetard = 0;
  let ignitionRetardState = 0;
  let ignitionActual = ignitionCurve[0];
  let ignEffIntegral = 0;

  while (x < 1000 && t < MAX_T) {
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

    const rpm = calcEngineRpm({ t, wheelSpeedFtS: wheelV, lf, priorSlipPct: lastSlipPct });
    const fuelVolPctNow = activeFuelPct(t, fuelStages);
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
    const idealFuelPct = calcIdealFuelPct(rpm, fuel1Pct);
    const richness = calcMixtureRichness(fuelVolPctNow, idealFuelPct);
    richnessIntegral += richness * DT;

    // Re-anchored again for the 6-stage ratchet-only clutch model (the
    // stage curve that hits the real 60ft window can no longer also hold
    // the mid-run pace back the way the old retraction-capable curve did -
    // see clutch.js). Below the crossover speed where powerForce and
    // LAUNCH_CAP*lf cross (v = POWER_HP*550/LAUNCH_CAP, independent of lf),
    // the car is purely clutch-torque-limited - constant force regardless
    // of speed - which is what sets the 60ft time and peak launch g.
    // Above it, force falls off with speed (POWER_HP/v) and that's what
    // paces 330-1000ft. The old 20000/7300 pair put that crossover near
    // 137mph, well past where a real car's acceleration already starts
    // tapering, so the mid-late run came in far too quick even though 60ft
    // itself was right on the tape. Pulling both down (LAUNCH_CAP less
    // than POWER_HP, proportionally) moves the crossover down to ~112mph
    // without touching 60ft's math at all (that phase never reaches
    // crossover speed either way) - re-checked against real time slips
    // (see docs/nhra-reference-times.md) rather than a single ET number.
    const LAUNCH_CAP = 18000 * mult * garagePowerMult;
    const POWER_HP = 6100 * mult * garagePowerMult;

    const throttle = stepDriver(driverState, t, x, lastSlipPct, driverAggressiveness, driverWatchUntilFt, driverShutoffFt, DT);
    const powerForce = (POWER_HP * lf * 550) / Math.max(v, V_FLOOR);
    const engineForce = Math.min(powerForce, LAUNCH_CAP * lf) * throttle;
    // What the motor could send through a FULLY locked clutch right now,
    // vs. what's actually getting through at the current lockup fraction -
    // the gap is torque the clutch is holding back, dissipated as heat in
    // the pack rather than reaching the wheel. Holding lockup back on
    // purpose to stay under the traction ceiling protects the tires, but
    // it's the clutch that pays for it.
    const availableForce = Math.min(powerForce, LAUNCH_CAP) * throttle;
    const clutchSlipLoss = Math.max(0, availableForce - engineForce);
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
    heatDamage += Math.max(0, heatRisk - 0.62) * garageEngineDamageMult * throttle * DT;
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
    if (engineFailed || clutchFailed) appliedForce = 0;
    else if (cylindersDropped) appliedForce *= CYLINDER_DROP_FORCE_PENALTY;

    const drag = 0.5 * RHO_REF * CDA * garageDragCdaMult * v * v;
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

    if (et60 === null && x >= 60) et60 = t;
    if (et330 === null && x >= 330) et330 = t;
    if (et660 === null && x >= 660) { et660 = t; mph660 = v / 1.4667; }
    trace.push({ t, x, v_mph: v / 1.4667, wheel_mph: wheelV / 1.4667, slip: slipPct, clutch_pos: bearingPos * 100, effective_lockup: Math.min(1, lf) * 100, fuel_gpm: fuelGpm, rpm, ignition_set: ignitionSet, ignition_retard: ignitionRetardDeg, ignition_effective: ignitionEffective });
    t += DT;
  }

  const finished = x >= 1000;
  const et = t;
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
    peakFuelGpm, engineFailed, engineFailTime, engineFailCause,
    cylindersDropped, cylinderDropTime, cylinderDropCause,
    clutchFailed, clutchFailTime,
    driverLifted: driverState.lifted, driverLiftTime: driverState.liftTime, driverLiftReason: driverState.liftReason, pedalCount: driverState.pedalCount,
    clutchWearLockupGainPct: peakWornGain * 100,
    peakIgnitionRetard,
    anySpin: trace.some(p => p.slip > 5),
    weightLb, weightIllegal, wheelieRisk, frontWingHuntRisk,
  };
}
