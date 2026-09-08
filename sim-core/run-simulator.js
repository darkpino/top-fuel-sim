// RunSimulator: integrates Environment + Engine + Clutch + Tires over time
// into a full 1000ft run trace. Pure function, no DOM access.

import { calcDensityAltitude, calcPowerMult, calcGripCoeff } from "./environment.js";
import { calcEngineFactors } from "./engine.js";
import { activeSetpoint, calcFingerDesired, stepBearingPos } from "./clutch.js";
import { calcOptimalPsi, calcPsiPenalty, calcTireWear } from "./tires.js";

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

export function runSimulation(settings) {
  const {
    airtempC, humidity, baroInHg, trackTempC, gripSliderPct,
    blowerOD, fuelPct, fuelVolPct, gasketThou, ignition,
    s1time, s1pct, s2time, s2pct, s3time, s3pct,
    fingerWeight, bearingSpeed, tirePsi, wingAngle,
  } = settings;

  const densityAltitude = calcDensityAltitude(airtempC, humidity, baroInHg);
  const powerMult = calcPowerMult(densityAltitude);

  const { fuelFactor, compressionFactor, ignEff, mult, heatRisk, detonationRisk } =
    calcEngineFactors({ blowerOD, fuelPct, fuelVolPct, gasketThou, ignition, powerMult });

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
  const LAUNCH_CAP = 13000 * mult;
  const POWER_HP = 6500 * mult;
  const wingTrim = 1 + (wingAngle / 2.5) * 0.45;
  const WING_K = WING_BASE_K * wingTrim;

  const stages = { s1time, s1pct, s2time, s2pct, s3time, s3pct };
  const fingerDesired = calcFingerDesired(fingerWeight);

  let t = 0, v = 0, x = 0, wheelV = 0;
  let et60 = null, et330 = null, et660 = null, mph660 = null;
  const trace = [];
  let clutchTemp = 0;
  let slipIntegral = 0;
  let bearingPos = 0.05;
  // Engine failure: sustained high heat risk (aggressive blower/compression/
  // nitro combo) accumulates damage. Cross the threshold and the motor lets
  // go mid-run - this is the real ceiling on "just turn everything up", not
  // a cosmetic warning.
  let engineDamage = 0;
  let engineFailed = false;
  let engineFailTime = null;

  while (x < 1000 && t < MAX_T) {
    const target = activeSetpoint(t, stages);
    bearingPos = stepBearingPos(bearingPos, target, bearingSpeed, DT);
    const heatBoost = 1 + Math.min(clutchTemp / 100, 1) * HEAT_CAP_BOOST;
    const lf = Math.min(fingerDesired, bearingPos) * heatBoost;
    const powerForce = (POWER_HP * lf * 550) / Math.max(v, V_FLOOR);
    const engineForce = Math.min(powerForce, LAUNCH_CAP * lf);
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
    clutchTemp += (slipPct / 100) * HEAT_RATE * DT * 10;
    slipIntegral += slipPct * DT;
    engineDamage += Math.max(0, heatRisk - 0.62) * DT;
    if (!engineFailed && engineDamage > 0.15) {
      engineFailed = true;
      engineFailTime = t;
    }
    if (engineFailed) appliedForce = 0;
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

    if (et60 === null && x >= 60) et60 = t;
    if (et330 === null && x >= 330) et330 = t;
    if (et660 === null && x >= 660) { et660 = t; mph660 = v / 1.4667; }
    trace.push({ t, x, v_mph: v / 1.4667, wheel_mph: wheelV / 1.4667, slip: slipPct, clutch_pos: bearingPos * 100, effective_lockup: Math.min(1, lf) * 100 });
    t += DT;
  }

  const finished = x >= 1000;
  const et = t;
  const mph = trace.length ? trace[trace.length - 1].v_mph : 0;

  const slipEnergy = trace.reduce((acc, p) => acc + p.slip, 0) / trace.length;
  const clutchHeat = Math.min(100, clutchTemp);
  const avgSlipPct = slipIntegral / Math.max(et, 0.001);
  const plugBalance = (fuelFactor - 1) + (compressionFactor - 1) - (ignEff - 1) * 0.5;
  const bearingWear = Math.min(100, (blowerOD - 20) * 0.9 + Math.max(0, (et - 3.8)) * 8);
  const tireWear = calcTireWear(tirePsi, optimalPsi, slipEnergy);

  return {
    finished, et, mph, et60, et330, et660, mph660, trace, densityAltitude,
    clutchHeat, avgSlipPct, plugBalance, bearingWear, tireWear, detonationRisk,
    engineFailed, engineFailTime,
    anySpin: trace.some(p => p.slip > 5),
  };
}
