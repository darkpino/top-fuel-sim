// RunSimulator: integrates Environment + Engine + Clutch + Tires over time
// into a full 1000ft run trace. Pure function, no DOM access.

import { calcDensityAltitude, calcPowerMult, calcGripCoeff } from "./environment.js";
import {
  calcEngineFactors, calcMult, calcEngineRpm, calcFuelFlowGpm,
  calcIdealFuelPct, calcMixtureRichness, activeFuelPct,
} from "./engine.js";
import { activeSetpoint, activeSpeed, calcFingerDesired, stepBearingPos } from "./clutch.js";
import { calcOptimalPsi, calcPsiPenalty, calcTireWear } from "./tires.js";
import { createDriverState, stepDriver } from "./driver.js";

const WEIGHT_LB = 2320;
const V_FLOOR = 30;
const CDA = 9.0;
const RHO_REF = 0.00237;
// Rear wing: NHRA rules cap adjustable trim at +-2 deg from level; the fixed
// wing itself produces most of the ~5000-6000 lb of downforce at 300 mph.
const WING_BASE_K = 0.0284;
// Effective rotating-mass weight for the rear wheel/driveline: much lower
// than the car's weight, so a spinning tire can rev up far faster than the
// chassis accelerates - this is what produces the characteristic early
// wheel-speed spike above ground speed on real telemetry traces.
const WHEEL_WEIGHT_LB = 260;
const MAX_SLIP_EXCESS_FTS = 260;
// Clutch temperature builds from slip and makes the pack grabbier
// (aggressiveness boost), up to a capped ceiling.
const HEAT_RATE = 3.2;
const HEAT_CAP_BOOST = 0.22;
const DT = 0.004;
const MAX_T = 10.0;
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
    blowerOD, fuelPct, gasketThou, ignition,
    s1time, s1pct, s1speed, s2time, s2pct, s2speed, s3time, s3pct, s3speed,
    fuel1Pct, fuel2Pct, fuel3Pct,
    fingerWeight, tirePsi, wingAngle, driverAggressiveness, driverWatchUntilFt,
  } = settings;

  const densityAltitude = calcDensityAltitude(airtempC, humidity, baroInHg);
  const powerMult = calcPowerMult(densityAltitude);

  const { fuelFactor, blowerFactor, compressionFactor, ignEff, heatRisk, detonationRisk } =
    calcEngineFactors({ blowerOD, fuelPct, gasketThou, ignition });

  const optimalPsi = calcOptimalPsi(trackTempC);
  const psiPenalty = calcPsiPenalty(tirePsi, optimalPsi);
  const baseGripCoeff = calcGripCoeff({ gripSliderPct, trackTempC, psiPenalty });

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

  const stages = { s1time, s1pct, s1speed, s2time, s2pct, s2speed, s3time, s3pct, s3speed };
  const fuelStages = { s2time, fuel1Pct, s3time, fuel2Pct, fuel3Pct };
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
  let richnessIntegral = 0;
  const driverState = createDriverState();
  let lastSlipPct = 0;

  while (x < 1000 && t < MAX_T) {
    const target = activeSetpoint(t, stages);
    const speed = activeSpeed(t, stages);
    bearingPos = stepBearingPos(bearingPos, target, speed, DT);
    const heatBoost = 1 + Math.min(clutchTemp / 100, 1) * HEAT_CAP_BOOST;
    const lf = Math.min(fingerDesired, bearingPos) * heatBoost;

    const rpm = calcEngineRpm({ t, groundSpeedFtS: v, s2time, s3time });
    const fuelVolPctNow = activeFuelPct(t, fuelStages);
    const { fuelVolFactor, mult } = calcMult({ fuelFactor, fuelVolPct: fuelVolPctNow, blowerFactor, ignEff, compressionFactor, powerMult });
    const idealFuelPct = calcIdealFuelPct(rpm, fuel1Pct);
    const richness = calcMixtureRichness(fuelVolPctNow, idealFuelPct);
    richnessIntegral += richness * DT;

    const LAUNCH_CAP = 13000 * mult;
    const POWER_HP = 6500 * mult;

    const throttle = stepDriver(driverState, t, x, lastSlipPct, driverAggressiveness, driverWatchUntilFt, DT);
    const powerForce = (POWER_HP * lf * 550) / Math.max(v, V_FLOOR);
    const engineForce = Math.min(powerForce, LAUNCH_CAP * lf) * throttle;
    const wingDownforce = WING_K * v * v;
    const maxTraction = (WEIGHT_LB + wingDownforce) * baseGripCoeff;
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
    slipIntegral += slipPct * DT;

    heatDamage += Math.max(0, heatRisk - 0.62) * DT;
    // Lean under load hurts the most right where lf is high - the clutch
    // is loaded, so the motor can least afford to be starved right then.
    leanDamage += Math.max(0, -richness) * lf * LEAN_DAMAGE_RATE * DT;
    foulDamage += Math.max(0, richness) * FOUL_DAMAGE_RATE * DT;
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
    if (engineFailed) appliedForce = 0;
    else if (cylindersDropped) appliedForce *= CYLINDER_DROP_FORCE_PENALTY;

    const drag = 0.5 * RHO_REF * CDA * v * v;
    const net = appliedForce - drag;
    const accel = net * 32.174 / WEIGHT_LB;
    v = Math.max(0, v + accel * DT);
    x += v * DT;

    if (slipping) {
      const wheelAccel = (engineForce - appliedForce) * 32.174 / WHEEL_WEIGHT_LB + accel;
      wheelV = Math.min(v + MAX_SLIP_EXCESS_FTS, wheelV + wheelAccel * DT);
      if (wheelV < v) wheelV = v;
    } else {
      wheelV = v;
    }

    const fuelGpm = calcFuelFlowGpm(rpm, fuelVolFactor);

    if (et60 === null && x >= 60) et60 = t;
    if (et330 === null && x >= 330) et330 = t;
    if (et660 === null && x >= 660) { et660 = t; mph660 = v / 1.4667; }
    trace.push({ t, x, v_mph: v / 1.4667, wheel_mph: wheelV / 1.4667, slip: slipPct, clutch_pos: bearingPos * 100, effective_lockup: Math.min(1, lf) * 100, fuel_gpm: fuelGpm, rpm });
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
  const plugBalance = avgRichness + (compressionFactor - 1) * 0.3 - (ignEff - 1) * 0.5;
  const bearingWear = Math.min(100, (blowerOD - 20) * 0.9 + Math.max(0, (et - 3.8)) * 8);
  const tireWear = calcTireWear(tirePsi, optimalPsi, slipEnergy);
  const peakFuelGpm = trace.reduce((acc, p) => Math.max(acc, p.fuel_gpm), 0);

  return {
    finished, et, mph, et60, et330, et660, mph660, trace, densityAltitude,
    clutchHeat, avgSlipPct, plugBalance, bearingWear, tireWear, detonationRisk,
    peakFuelGpm, engineFailed, engineFailTime, engineFailCause,
    cylindersDropped, cylinderDropTime, cylinderDropCause,
    driverLifted: driverState.lifted, driverLiftTime: driverState.liftTime, pedalCount: driverState.pedalCount,
    anySpin: trace.some(p => p.slip > 5),
  };
}
