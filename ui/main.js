import { calcDensityAltitude, calcPowerMult, calcGripCoeff } from "../sim-core/environment.js";
import { calcEngineFactors, calcMult, calcRecommendedNitro, calcIgnEff, IGNITION_CURVE_TIMES, IGNITION_RETARD_ARM_TIME, IGNITION_REDLINE_RPM } from "../sim-core/engine.js";
import { calcClutchReach } from "../sim-core/clutch.js";
import { calcOptimalPsi, calcPsiPenalty } from "../sim-core/tires.js";
import { runSimulation, WEIGHT_LB as WEIGHT_LB_MIN } from "../sim-core/run-simulator.js";
import { buildRoundDefs, generateEventConditions } from "../sim-core/event.js";
import { TRACKS, findTrack } from "../sim-core/tracks.js";
import {
  generateAiField, generateAiFieldFromRoster, generateRivalPool, deriveRunningOrder, runQualifyingAttempt, computeQualifyingLadder,
  pairBracketRound, calcReactionTime, resolveHeadToHead, mulberry32,
  generateLaneVariants, pickBetterLane,
} from "../sim-core/ladder.js";
import {
  PARTS, TRAILER_TYPES, findBrand, defaultGarageConfig, computeGarageEffects,
  totalBuildValue, spareLabel, computeWeightDistribution,
  equippedUnit, installUnit, unitPrice, computeClutchReliabilityMult, equippedPartPrice,
  isPartOwned, isCarRaceReady, totalSpareCount, trailerSpareCapacity, buyUnit, buyAndEquipUnit,
  migrateGarageConfig, generateUsedMarket, usedPriceMult, usedReliabilityMult,
  addRunWear, isPartBroken, isPartRepairable, isPackExhausted, estimatePartCondition,
  BLOWER_TYPES, BODY_MATERIALS, CHASSIS_LENGTH_MIN_IN, CHASSIS_LENGTH_MAX_IN,
  chassisBuildPrice, chassisListingPrice, buildNewChassis, buySecondhandChassis, buyNewBody,
  CLUTCH_PACK_MAX_RUNS,
  sellEquippedUnitValue, sellSpareUnitValue, sellTrailerValue, sellChassisValue,
} from "../sim-core/garage.js";
import {
  ENTRY_FEE, defaultFinancesState, addTransaction, chargeEntryFee, chargeRunCost, chargeTeamWages,
  rollEnginePartsFailed, chargePartFailure, chargeClutchPackExhaustion, repairPartUnit, REPAIR_FRACTION, awardEventPrize, generateSponsorOffers,
  sellEquippedPart, sellSparePartUnit, sellTrailerUnitTransaction, sellChassisUnitTransaction,
} from "../sim-core/finances.js";
import {
  TEAM_ROLES, defaultTeamConfig, computeTeamEffects, totalTeamWagesPerEvent,
  findTeamMember, hireTeamMember, fireTeamMember,
} from "../sim-core/team.js";
import {
  SEASON_MIN_RACES, RIVAL_POOL_SIZE, defaultSeasonState, addRaceToCalendar, removeRaceFromCalendar,
  startSeason, recordAttendedResult, recordSkippedResult, currentSeasonRound, travelMilesFor, travelCostFor,
  deriveSeasonFieldSize, addRivalPoints, seasonStandings, pointsForOutcome,
} from "../sim-core/season.js";

function $(id) { return document.getElementById(id); }

// Bump both on every commit that changes real behavior (not a pure
// comment/doc tweak) - this is the only way to tell, from the page
// itself, whether GitHub Pages (or a cached tab) is actually serving the
// latest build. Commit count is a convenient, always-increasing source:
// `git rev-list --count HEAD` just before committing, +1 for the commit
// about to land.
const APP_BUILD = "95";
const APP_BUILD_DATE = "2026-09-19";

// Real NHRA Top Fuel national events run a fixed 16-car eliminator ladder
// regardless of exactly how many cars show up to qualify - a short field
// (say 13) still fills all 16 slots on paper, with the unfilled spots
// resolved as byes in round 1 (see pairBracketRound in ladder.js), rather
// than shrinking the bracket itself. A bigger field than 16 just means
// only the fastest 16 qualifiers make the show, same as always.
const ELIMINATION_BRACKET_SIZE = 16;
$("app-version-note").textContent = `Build ${APP_BUILD} · ${APP_BUILD_DATE}`;

// The track's physical elevation isn't a slider (it's fixed for the
// whole event, not a per-round weather condition) - applyConditions
// stashes it here whenever a round's conditions get applied, and
// readSettings() reads it straight from this module state. Stays 0 for
// Testrun-tab runs outside an event, matching sea-level pre-tracks
// behavior exactly. Declared this early so the live density-altitude
// hint (updateEngineHints, called at module load below) can read it.
let currentTrackElevationFt = 0;

const sliders = ["airtemp", "hum", "baro", "track", "grip", "blower", "fuel", "fuel1t", "fuel1p", "fuel2t", "fuel2p", "fuel3t", "fuel3p", "fuel4t", "fuel4p", "fuel5t", "fuel5p", "fuel6t", "fuel6p", "gasket", "ign1", "ign2", "ign3", "ign4", "ign5", "ign6", "s1t", "s1p", "s1speed", "s2t", "s2p", "s2speed", "s3t", "s3p", "s3speed", "s4t", "s4p", "s4speed", "s5t", "s5p", "s5speed", "s6t", "s6p", "s6speed", "fw", "tpsi", "wing", "fwing", "wbar", "ballfront", "ballrear", "aggro", "shutoff"];

function fmt(id, val) {
  switch (id) {
    case "airtemp": return val + "°C";
    case "hum": return val + "%";
    case "baro": return (val / 100).toFixed(2) + " inHg";
    case "track": return val + "°C";
    case "grip": return val + "%";
    case "blower": return val + "%";
    case "fuel": return val + "%";
    case "fuel1p": case "fuel2p": case "fuel3p": case "fuel4p": case "fuel5p": case "fuel6p": return val + "%";
    case "fuel1t": case "fuel2t": case "fuel3t": case "fuel4t": case "fuel5t": case "fuel6t": return (val / 100).toFixed(2) + "s";
    case "gasket": return (val / 1000).toFixed(3) + '"';
    case "ign1": case "ign2": case "ign3": case "ign4": case "ign5": case "ign6": return val + "°";
    case "s1t": case "s2t": case "s3t": case "s4t": case "s5t": case "s6t": return (val / 100).toFixed(2) + "s";
    case "s1p": case "s2p": case "s3p": case "s4p": case "s5p": case "s6p": return val + "%";
    case "s1speed": case "s2speed": case "s3speed": case "s4speed": case "s5speed": case "s6speed": return val + "%/s";
    case "fw": return val;
    case "tpsi": return (val / 10).toFixed(1) + " psi";
    case "wing": return (val / 10).toFixed(1) + "°";
    case "fwing": return val + "%";
    case "wbar": return (val / 10).toFixed(1) + '"';
    case "ballfront": case "ballrear": return val + " lb";
    case "aggro": return val;
    case "shutoff": return val + " ft";
  }
}
sliders.forEach(id => {
  const el = $(id);
  const out = $("v-" + id);
  out.textContent = fmt(id, el.value);
  el.addEventListener("input", () => { out.textContent = fmt(id, el.value); });
});

function readClutchStages() {
  return {
    s1time: +$("s1t").value / 100,
    s1pct: +$("s1p").value / 100,
    s1speed: +$("s1speed").value / 100,
    s2time: +$("s2t").value / 100,
    s2pct: +$("s2p").value / 100,
    s2speed: +$("s2speed").value / 100,
    s3time: +$("s3t").value / 100,
    s3pct: +$("s3p").value / 100,
    s3speed: +$("s3speed").value / 100,
    s4time: +$("s4t").value / 100,
    s4pct: +$("s4p").value / 100,
    s4speed: +$("s4speed").value / 100,
    s5time: +$("s5t").value / 100,
    s5pct: +$("s5p").value / 100,
    s5speed: +$("s5speed").value / 100,
    s6time: +$("s6t").value / 100,
    s6pct: +$("s6p").value / 100,
    s6speed: +$("s6speed").value / 100,
  };
}

function readFuelStages() {
  return {
    fuel1time: +$("fuel1t").value / 100,
    fuel1pct: +$("fuel1p").value,
    fuel2time: +$("fuel2t").value / 100,
    fuel2pct: +$("fuel2p").value,
    fuel3time: +$("fuel3t").value / 100,
    fuel3pct: +$("fuel3p").value,
    fuel4time: +$("fuel4t").value / 100,
    fuel4pct: +$("fuel4p").value,
    fuel5time: +$("fuel5t").value / 100,
    fuel5pct: +$("fuel5p").value,
    fuel6time: +$("fuel6t").value / 100,
    fuel6pct: +$("fuel6p").value,
  };
}

const CLUTCH_STAGE_NUMBERS = [1, 2, 3, 4, 5, 6];

function updateClutchReachHint() {
  const stages = readClutchStages();
  const reach = calcClutchReach(stages);

  function fmtReach(setpoint, reached) {
    const dead = Math.abs(reached - setpoint) > 0.02;
    const pct = Math.round(reached * 100);
    return dead ? `${pct}% <span style="color:var(--red)">(setpoint ${Math.round(setpoint * 100)}% niet gehaald - te weinig tijd/snelheid)</span>` : `${pct}%`;
  }
  const parts = CLUTCH_STAGE_NUMBERS.map(n => `S${n} ${fmtReach(stages[`s${n}pct`], reach[`reach${n}`])}`);
  $("clutch-reach-hint").innerHTML = `Haalbare lockup per stage: ${parts.join(" · ")}`;
}
CLUTCH_STAGE_NUMBERS.flatMap(n => [`s${n}t`, `s${n}p`, `s${n}speed`]).forEach(id => {
  $(id).addEventListener("input", updateClutchReachHint);
});
updateClutchReachHint();

function updateEngineHints() {
  const airtempC = +$("airtemp").value;
  const humidity = +$("hum").value;
  const baroInHg = +$("baro").value / 100;
  const trackTempC = +$("track").value;
  const gripSliderPct = +$("grip").value;
  const blowerOD = +$("blower").value;
  const fuelPct = +$("fuel").value;
  const fuel1Pct = +$("fuel1p").value;
  const gasketThou = +$("gasket").value;
  const ignition = +$("ign1").value; // launch-point ignition, for this one-off "at launch" estimate
  const tirePsi = +$("tpsi").value / 10;

  const da = calcDensityAltitude(airtempC, humidity, baroInHg, currentTrackElevationFt);
  $("da-hint").textContent = `Density altitude: ${Math.round(da).toLocaleString("nl-NL")} ft${currentTrackElevationFt ? ` (incl. ${currentTrackElevationFt.toLocaleString("nl-NL")} ft baanhoogte)` : ""}`;
  const powerMultNow = calcPowerMult(da);
  const { fuelFactor, blowerFactor, compressionFactor } = calcEngineFactors({ blowerOD, fuelPct, gasketThou, ignition });
  const { mult } = calcMult({ fuelFactor, fuelVolPct: fuel1Pct, blowerFactor, ignEff: calcIgnEff(ignition), compressionFactor, powerMult: powerMultNow });
  $("power-hint").textContent = `Geschat piekvermogen bij launch: ${Math.round(12000 * mult).toLocaleString("nl-NL")} pk (basis 12.000 pk bij standaard lucht, voor eigen koppeling/grip-verlies; verandert tijdens de run met de brandstof- en ontstekingscurve)`;

  const recommendedNitro = calcRecommendedNitro(powerMultNow);
  const hint = $("nitro-hint");
  const delta = da;
  const trend = delta > 300 ? "warmer/ijlere lucht → wat meer nitro (of blower) om het vermogen op peil te houden"
    : (delta < -300 ? "koudere/dichtere lucht → wat minder nitro kan al genoeg zijn" : "conditie dicht bij standaard");
  let text = `Richtwaarde voor dit weer: ${recommendedNitro}% (${trend})`;

  const optimalPsi = calcOptimalPsi(trackTempC);
  const psiPenalty = calcPsiPenalty(tirePsi, optimalPsi);
  const gripEstimate = calcGripCoeff({ gripSliderPct, trackTempC, psiPenalty });

  // Bad track: recommend backing OFF power rather than compensating upward,
  // since more power you can't put to the ground just costs you via slip.
  if (gripEstimate < 2.2) {
    text += ` — let op: de baan/banden geven weinig grip, extra vermogen erbij zetten kost je nu waarschijnlijk meer aan wielspin dan het oplevert. Overweeg juist minder nitro/blower.`;
  }
  hint.textContent = text;
  $("nitro-illegal-flag").hidden = fuelPct <= 90;

  const gripHint = $("grip-hint");
  const optimalTrackTempC = 24;
  const trackTempDiff = trackTempC - optimalTrackTempC;
  const tempQuality = trackTempDiff < 0
    ? (trackTempDiff < -15 ? "veel te koud, traction compound activeert nauwelijks" : "iets aan de koude kant")
    : (trackTempDiff > 25 ? "veel te heet, baan wordt gooey/glad" : (trackTempDiff > 8 ? "iets aan de warme kant" : "in de sweet spot (~24°C / 75°F)"));
  // Displayed purely as a kN-flavored readout (2500-3300 span), rescaled
  // from the internal grip coefficient (0.6-6.6) after temp/tire penalties -
  // this is the OUTCOME of VHT% + track temp + tire pressure, not an input.
  const gripKN = Math.round(2500 + Math.max(0, Math.min(1, (gripEstimate - 0.6) / 6.0)) * 800);
  gripHint.textContent = `Effectieve grip: ${gripKN} kN (${tempQuality})`;
}
["airtemp", "hum", "baro", "track", "grip", "blower", "fuel", "fuel1p", "gasket", "ign1", "tpsi"].forEach(id => {
  $(id).addEventListener("input", updateEngineHints);
});
updateEngineHints();

function drawChart(trace, splits) {
  const W = 640, H = 280, padL = 42, padR = 38, padT = 10, padB = 34;
  const maxV = Math.max(...trace.map(p => Math.max(p.v_mph, p.wheel_mph)), 10) * 1.05;
  const maxT = trace[trace.length - 1].t;
  function xs(t) { return padL + (t / maxT) * (W - padL - padR); }
  function ysV(v) { return H - padB - (v / maxV) * (H - padT - padB); }
  function ysPct(p) { return H - padB - (p / 100) * (H - padT - padB); }

  let speedPath = "M " + trace.map(p => `${xs(p.t).toFixed(1)},${ysV(p.v_mph).toFixed(1)}`).join(" L ");
  let wheelPath = "M " + trace.map(p => `${xs(p.t).toFixed(1)},${ysV(p.wheel_mph).toFixed(1)}`).join(" L ");
  let clutchPath = "M " + trace.map(p => `${xs(p.t).toFixed(1)},${ysPct(p.clutch_pos).toFixed(1)}`).join(" L ");
  let effLockupPath = "M " + trace.map(p => `${xs(p.t).toFixed(1)},${ysPct(p.effective_lockup).toFixed(1)}`).join(" L ");

  let gridLines = "";
  for (let i = 0; i <= 4; i++) {
    const yy = padT + i * (H - padT - padB) / 4;
    const val = Math.round(maxV - i * maxV / 4);
    const pctVal = Math.round(100 - i * 100 / 4);
    gridLines += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="#2c333b" stroke-width="1"/>`;
    gridLines += `<text x="${padL - 6}" y="${yy + 4}" text-anchor="end" font-size="10" fill="#8b939b" font-family="ui-monospace,monospace">${val}</text>`;
    gridLines += `<text x="${W - padR + 6}" y="${yy + 4}" text-anchor="start" font-size="10" fill="#7a8fae" font-family="ui-monospace,monospace">${pctVal}</text>`;
  }

  let splitLines = "";
  splits.forEach(s => {
    if (s.t == null) return;
    const sx = xs(s.t);
    splitLines += `<line x1="${sx.toFixed(1)}" y1="${padT}" x2="${sx.toFixed(1)}" y2="${H - padB}" stroke="#5f5e5a" stroke-width="1" stroke-dasharray="3,3"/>`;
    splitLines += `<text x="${sx.toFixed(1)}" y="${H - padB + 13}" text-anchor="middle" font-size="9" fill="#8b939b" font-family="ui-monospace,monospace">${s.label}</text>`;
    splitLines += `<text x="${sx.toFixed(1)}" y="${H - padB + 25}" text-anchor="middle" font-size="9" fill="#5f5e5a" font-family="ui-monospace,monospace">${s.t.toFixed(2)}s</text>`;
  });

  const svg = `
    ${gridLines}
    <line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="#2c333b" stroke-width="1"/>
    ${splitLines}
    <path d="${effLockupPath}" fill="none" stroke="#8bc98b" stroke-width="1.5" opacity="0.9"/>
    <path d="${clutchPath}" fill="none" stroke="#7a8fae" stroke-width="1.5" stroke-dasharray="4,2" opacity="0.9"/>
    <path d="${wheelPath}" fill="none" stroke="#c23b32" stroke-width="1.5" opacity="0.85"/>
    <path d="${speedPath}" fill="none" stroke="#f2a71b" stroke-width="2.5"/>
  `;
  $("traceChart").setAttribute("viewBox", `0 0 ${W} ${H}`);
  $("traceChart").innerHTML = svg;
}

function drawEngineChart(trace, splits) {
  const W = 640, H = 200, padL = 48, padR = 66, padT = 10, padB = 34;
  const maxT = trace[trace.length - 1].t;
  function xs(t) { return padL + (t / maxT) * (W - padL - padR); }

  const rpms = trace.map(p => p.rpm);
  const rpmLo = Math.min(...rpms) * 0.97, rpmHi = Math.max(...rpms) * 1.03;
  function ysRpm(v) { return H - padB - ((v - rpmLo) / (rpmHi - rpmLo)) * (H - padT - padB); }

  const ignVals = trace.flatMap(p => [p.ignition_set, p.ignition_effective]);
  const ignLo = Math.min(...ignVals) - 2, ignHi = Math.max(...ignVals) + 2;
  function ysIgn(v) { return H - padB - ((v - ignLo) / (ignHi - ignLo)) * (H - padT - padB); }

  const gpmHi = Math.max(...trace.map(p => p.fuel_gpm), 10) * 1.1;
  function ysGpm(v) { return H - padB - (v / gpmHi) * (H - padT - padB); }

  const rpmPath = "M " + trace.map(p => `${xs(p.t).toFixed(1)},${ysRpm(p.rpm).toFixed(1)}`).join(" L ");
  const gpmPath = "M " + trace.map(p => `${xs(p.t).toFixed(1)},${ysGpm(p.fuel_gpm).toFixed(1)}`).join(" L ");
  const ignSetPath = "M " + trace.map(p => `${xs(p.t).toFixed(1)},${ysIgn(p.ignition_set).toFixed(1)}`).join(" L ");
  const ignEffPath = "M " + trace.map(p => `${xs(p.t).toFixed(1)},${ysIgn(p.ignition_effective).toFixed(1)}`).join(" L ");
  const armX = xs(Math.min(IGNITION_RETARD_ARM_TIME, maxT));

  let gridLines = "";
  for (let i = 0; i <= 2; i++) {
    const yy = padT + i * (H - padT - padB) / 2;
    const rpmVal = Math.round(rpmHi - i * (rpmHi - rpmLo) / 2);
    const ignVal = Math.round(ignHi - i * (ignHi - ignLo) / 2);
    const gpmVal = Math.round(gpmHi - i * gpmHi / 2);
    gridLines += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="#2c333b" stroke-width="1"/>`;
    gridLines += `<text x="${padL - 6}" y="${yy + 4}" text-anchor="end" font-size="10" fill="#b98ee0" font-family="ui-monospace,monospace">${rpmVal}</text>`;
    gridLines += `<text x="${W - padR + 6}" y="${yy + 4}" text-anchor="start" font-size="9" fill="#e0704a" font-family="ui-monospace,monospace">${ignVal}°</text>`;
    gridLines += `<text x="${W - padR + 34}" y="${yy + 4}" text-anchor="start" font-size="9" fill="#5ec8d8" font-family="ui-monospace,monospace">${gpmVal}</text>`;
  }

  let splitLines = "";
  (splits || []).forEach(s => {
    if (s.t == null) return;
    const sx = xs(Math.min(s.t, maxT));
    splitLines += `<line x1="${sx.toFixed(1)}" y1="${padT}" x2="${sx.toFixed(1)}" y2="${H - padB}" stroke="#5f5e5a" stroke-width="1" stroke-dasharray="3,3"/>`;
    splitLines += `<text x="${sx.toFixed(1)}" y="${H - padB + 13}" text-anchor="middle" font-size="9" fill="#8b939b" font-family="ui-monospace,monospace">${s.label}</text>`;
    splitLines += `<text x="${sx.toFixed(1)}" y="${H - padB + 25}" text-anchor="middle" font-size="9" fill="#5f5e5a" font-family="ui-monospace,monospace">${s.t.toFixed(2)}s</text>`;
  });

  const svg = `
    ${gridLines}
    <line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="#2c333b" stroke-width="1"/>
    ${splitLines}
    <line x1="${armX.toFixed(1)}" y1="${padT}" x2="${armX.toFixed(1)}" y2="${H - padB}" stroke="#e0b34a" stroke-width="1" stroke-dasharray="3,3"/>
    <text x="${armX.toFixed(1)}" y="${padT + 9}" font-size="9" fill="#e0b34a" font-family="ui-monospace,monospace">retarder armed</text>
    <path d="${gpmPath}" fill="none" stroke="#5ec8d8" stroke-width="1.5" opacity="0.85"/>
    <path d="${ignSetPath}" fill="none" stroke="#7a8fae" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.9"/>
    <path d="${ignEffPath}" fill="none" stroke="#e0704a" stroke-width="1.5" opacity="0.9"/>
    <path d="${rpmPath}" fill="none" stroke="#b98ee0" stroke-width="2.5"/>
  `;
  $("engineChart").setAttribute("viewBox", `0 0 ${W} ${H}`);
  $("engineChart").innerHTML = svg;
}

function statusClass(val, warnAt, badAt) {
  if (val >= badAt) return "bad";
  if (val >= warnAt) return "warn";
  return "ok";
}

function readSettings() {
  const garageEffects = computeGarageEffects(garageConfig);
  const teamEffects = computeTeamEffects(teamConfig);
  return {
    airtempC: +$("airtemp").value,
    humidity: +$("hum").value,
    baroInHg: +$("baro").value / 100,
    trackTempC: +$("track").value,
    gripSliderPct: +$("grip").value,
    trackElevationFt: currentTrackElevationFt,
    blowerOD: +$("blower").value,
    fuelPct: +$("fuel").value,
    gasketThou: +$("gasket").value,
    ignitionCurve: ["ign1", "ign2", "ign3", "ign4", "ign5", "ign6"].map(id => +$(id).value),
    ...readClutchStages(),
    ...readFuelStages(),
    fingerWeight: +$("fw").value,
    tirePsi: +$("tpsi").value / 10,
    wingAngle: +$("wing").value / 10,
    frontWingPct: +$("fwing").value,
    wheelieBarHeightIn: +$("wbar").value / 10,
    ballastFrontLb: +$("ballfront").value,
    ballastRearLb: +$("ballrear").value,
    driverAggressiveness: +$("aggro").value,
    driverWatchUntilFt: +$("watchft").value,
    driverShutoffFt: +$("shutoff").value,
    ...garageEffects,
    garageEngineDamageMult: garageEffects.garageEngineDamageMult * teamEffects.teamEngineDamageMult,
    garageClutchDamageMult: garageEffects.garageClutchDamageMult * teamEffects.teamClutchDamageMult,
    garageDriverCarControlMult: teamEffects.teamCarControlMult,
    garageDriverDisciplineMult: teamEffects.teamDisciplineMult,
  };
}

function renderRunResult(r, reactionTime = null) {
  $("placeholder").style.display = "none";
  $("resultsContent").style.display = "block";
  $("inspPanel").style.display = "block";

  $("r-60").textContent = r.et60 ? r.et60.toFixed(3) + "s" : "n.v.t.";
  $("r-330").textContent = r.et330 ? r.et330.toFixed(3) + "s" : "n.v.t.";
  $("r-660").textContent = r.et660 ? r.et660.toFixed(3) + "s" : "n.v.t.";
  $("r-660mph").textContent = r.mph660 ? r.mph660.toFixed(1) + " mph" : "n.v.t.";
  $("r-et").textContent = r.finished ? r.et.toFixed(3) + "s" : (r.engineFailed ? "MOTOR" : (r.clutchFailed ? "KOPPELING" : (r.driverLifted ? (r.driverLiftReason === "shutoff" ? "UIT" : "LIFT") : "DNF")));
  $("r-et").style.color = r.finished ? "var(--text)" : "var(--red)";
  $("r-mph").textContent = r.mph.toFixed(1) + " mph";

  // Reaction time is a driver/tree concept, not part of the physics run
  // itself - rolled by the caller (Testrun tab, kwalificatie, bye or
  // eliminatie) and passed in purely for display here. Never folded into
  // r.et or bestEt (see runPlayerQualifying/computeQualifyingLadder) -
  // same as real NHRA, it only decides an eliminatie duel (see
  // resolveHeadToHead), not qualifying position.
  if (reactionTime !== null) {
    const foul = reactionTime < 0;
    $("r-rt").textContent = (foul ? "" : "+") + reactionTime.toFixed(3) + "s" + (foul ? " (rood!)" : "");
    $("r-rt").style.color = foul ? "var(--red)" : "var(--text)";
    if (r.finished && !foul) {
      $("r-package").textContent = (reactionTime + r.et).toFixed(3) + "s";
      $("r-package").style.color = "var(--text)";
    } else {
      $("r-package").textContent = "n.v.t.";
      $("r-package").style.color = "var(--text)";
    }
  } else {
    $("r-rt").textContent = "--";
    $("r-rt").style.color = "var(--text)";
    $("r-package").textContent = "--";
    $("r-package").style.color = "var(--text)";
  }

  const splits = [
    { label: "60'", t: r.et60 },
    { label: "330'", t: r.et330 },
    { label: "660'", t: r.et660 },
    { label: r.finished ? "1000'" : null, t: r.finished ? r.et : null },
  ];
  drawChart(r.trace, splits);
  drawEngineChart(r.trace, splits);

  const spinFlag = $("spinFlag");
  let flags = "";
  if (r.engineFailed) {
    flags += r.fuelStarved
      ? `<div class="flag">Motor explodeert na ${r.engineFailTime.toFixed(2)}s — de tank liep leeg midden in de run, de motor viel in één klap kurkdroog en compleet mager. Zet een grotere tank, of stem de brandstofcurve zuiniger af.</div>`
      : r.engineFailCause === "hydrolock"
      ? `<div class="flag">Hydraulic lock na ${r.engineFailTime.toFixed(2)}s — veel te veel brandstof in de cilinder, kon niet op tijd verbranden of verdampen. Vloeistof comprimeert niet: de zuiger kon de slag niet voltooien en de motor is direct kapot. Zet de brandstofcurve fors terug.</div>`
      : r.engineFailCause === "bearing"
      ? `<div class="flag">Lager doorgeslagen na ${r.engineFailTime.toFixed(2)}s — aanhoudende detonatie (te heet of te mager onder belasting) heeft een drijfstanglager laten doorslaan. Een plotselinge mechanische klapper aan de onderkant van de motor, los van de cilinders zelf. Neem meer marge op blower/compressie/nitro of de brandstofcurve.</div>`
      : r.engineFailCause === "lean"
      ? `<div class="flag">Motor kapot na ${r.engineFailTime.toFixed(2)}s — te mager onder belasting, de brandstofcurve hield het toerental niet bij. Zet stage 2 (lockup) verder open.</div>`
      : `<div class="flag">Motor kapot na ${r.engineFailTime.toFixed(2)}s — de combinatie van blower, compressie en nitro% was te heet om vol te houden.</div>`;
  }
  else if (r.clutchFailed) flags += r.clutchFailCause === "weld"
    ? `<div class="flag">Koppeling vastgelast na ${r.clutchFailTime.toFixed(2)}s — de motor maakte fors meer vermogen dan het pakket kon vasthouden, en is er letterlijk doorheen blijven rijden tot de platen aan elkaar smolten. Vanaf dat moment zit de koppeling mechanisch potdicht op 100%, ongeacht de koppelingscurve - een plotselinge, harde grip die zomaar wielspin kan geven. Kies een sterkere koppeling, of temper het vermogen.</div>`
    : `<div class="flag">Koppeling vastgelast na ${r.clutchFailTime.toFixed(2)}s — te lang te ver teruggehouden onder te veel vermogen, tot de platen door de opgebouwde hitte aan elkaar smolten. Vanaf dat moment zit de koppeling mechanisch potdicht op 100%, ongeacht de koppelingscurve. Geef 'm iets meer lockup, of neem er genoegen mee dat dit 'm kost.</div>`;
  else if (r.driverLifted && r.driverLiftReason === "shutoff" && !r.finished) flags += `<div class="flag">Rijder heeft het ingestelde afschakelpunt bereikt op ${r.driverLiftTime.toFixed(2)}s en is van het gas gegaan — geplande shutoff, geen paniek. De auto heeft de 1000 ft niet op momentum gehaald.</div>`;
  else if (r.driverLifted && !r.finished) flags += `<div class="flag">Rijder is van het gas gegaan na aanhoudende bandenrook op ${r.driverLiftTime.toFixed(2)}s — run afgebroken. Verhoog de rijder-agressiviteit als hij vaker moet doorpedalen, of pak de tune aan voor minder wielspin.</div>`;
  else if (!r.finished) flags += `<div class="flag">Auto bereikte de 1000 ft niet binnen ${r.et.toFixed(1)}s — te weinig grip/vermogen om op snelheid te komen. Draai bij.</div>`;
  else if (r.driverLifted && r.driverLiftReason === "shutoff") flags += `<div class="flag">Rijder is op het ingestelde afschakelpunt (${r.driverLiftTime.toFixed(2)}s) van het gas gegaan — geplande shutoff, de auto heeft de 1000 ft alsnog op momentum gehaald.</div>`;
  else if (r.driverLifted) flags += `<div class="flag">Rijder is na aanhoudende bandenrook op ${r.driverLiftTime.toFixed(2)}s van het gas gegaan, maar de auto heeft de 1000 ft alsnog op momentum gehaald.</div>`;
  if (r.clutchWearLockupGainPct > 3 && !r.clutchFailed) flags += `<div class="flag">Koppelingsslijtage heeft het mechanische plafond tijdens deze run zo'n ${r.clutchWearLockupGainPct.toFixed(0)} procentpunt verder laten oplopen — het frictiemateriaal dunt uit, waardoor de vingers verder naar buiten kunnen dan een vers pakket zou toelaten. Bij nog meer slip op deze tune wordt de koppeling geleidelijk agressiever dan bedoeld.</div>`;
  if (r.clutchOverpowered && !r.clutchFailed) flags += `<div class="flag">De motor maakt meer vermogen dan deze koppeling kan vasthouden — hij rijdt er letterlijk doorheen en blijft slippen, ook bij volledige lockup. Dat kost tijd én kookt de koppeling extra hard op. Kies een sterkere koppeling, of temper het vermogen.</div>`;
  if (r.cylindersDropped) {
    if (r.cylinderDropCause === "rich") flags += `<div class="flag">Cilinder(s) verzopen na ${r.cylinderDropTime.toFixed(2)}s — de brandstofcurve stond op dat moment te rijk voor het toerental. Kost vermogen, maar de motor overleeft het.</div>`;
    else if (r.cylinderDropCause === "lean") flags += `<div class="flag">Cilinder(s) beginnen te missen na ${r.cylinderDropTime.toFixed(2)}s — te mager onder belasting, de brandstofcurve hield het toerental niet bij. Bij aanhouden loopt dit uit op motorschade.</div>`;
    else flags += `<div class="flag">Cilinder(s) beginnen te missen na ${r.cylinderDropTime.toFixed(2)}s — de combinatie van blower, compressie en nitro% liep te heet. Bij aanhouden loopt dit uit op motorschade.</div>`;
  }
  if (r.tireShakeRisk) flags += `<div class="flag">Tire shake-risico: de bandenspanning past niet goed bij deze baan terwijl de launch wel zwaar belast wordt — de band groeit niet goed in, wat in het echt een harde trilling geeft in plaats van een schone hook-up. Stel de bandenspanning bij richting de richtwaarde.</div>`;
  if (r.wheelieRisk) flags += `<div class="flag">Wheelie-risico: de launch belast de voorkant zwaarder dan de neus-ballast, voorvleugel en wheeliebar samen kunnen compenseren — de voorwielen komen te ver los. Meer ballast op de neus, meer voorvleugel, of de wheeliebar lager zetten helpen hier tegen.</div>`;
  if (r.frontWingHuntRisk) flags += `<div class="flag">De voorvleugel staat agressief genoeg, en de auto is snel genoeg, dat de besturing bij topsnelheid kan gaan "zoeken" (lichtjes heen en weer) in plaats van strak recht te lopen. Zet de voorvleugel iets terug.</div>`;
  if (r.peakIgnitionRetard > 15) flags += `<div class="flag">De retarder heeft flink ingegrepen (tot ${r.peakIgnitionRetard.toFixed(0)}° teruggetrokken) — het toerental zat ruim boven de 7.900 rpm-grens na 2,75s. Dat kost vermogen precies wanneer je het nodig hebt; zet de ontsteking in de latere punten wat conservatiever of werk aan wat het toerental daar zo hoog houdt.</div>`;
  if (r.nitroIllegal) flags += `<div class="flag">Deze run gebruikt meer dan 90% nitro — buiten het reglement, alleen geldig als testrun.</div>`;
  if (r.weightIllegal) flags += `<div class="flag">Ondergewicht: ${Math.round(r.weightLb)} lbs, het minimum is ${WEIGHT_LB_MIN} lbs — DQ. Deze tijd telt niet mee voor de kwalificatie, en in een eliminatieronde verlies je 'm automatisch. Compenseer met ballast of kies zwaardere onderdelen.</div>`;
  if (r.anySpin && !r.engineFailed) flags += `<div class="flag">Wielenspin gedetecteerd tijdens de run — motorvermogen overschreed de beschikbare grip.</div>`;
  if (r.detonationRisk && !r.engineFailed) flags += `<div class="flag">Detonatierisico: hoge compressie + hoog nitropercentage + veel voorontsteking is een gevaarlijke combinatie.</div>`;
  spinFlag.innerHTML = flags;

  const ch = r.clutchHeat;
  if (r.clutchFailed) {
    $("i-clutch").textContent = `vastgelast @ ${r.clutchFailTime.toFixed(2)}s`;
    $("i-clutch").className = "status bad";
  } else {
    const chCls = statusClass(ch, 45, 70);
    let chTxt = ch.toFixed(0) + "/100 " + (chCls === "ok" ? "(optimaal)" : chCls === "warn" ? "(warm)" : "(oververhit)");
    let chFinalCls = chCls;
    // clutchHeat is the ACCUMULATED total over the whole run - a real but
    // brief overpower moment (see the flag above) can drive the clutch
    // through without building up much total heat by the end of a short
    // run, which otherwise reads as a flat contradiction ("kookt op" next
    // to a cool number) instead of two true things about different slices
    // of the same run.
    if (r.clutchOverpowered && chCls === "ok") {
      chTxt = ch.toFixed(0) + "/100 (kort doorgereden - zie melding hierboven)";
      chFinalCls = "warn";
    }
    $("i-clutch").textContent = chTxt;
    $("i-clutch").className = "status " + chFinalCls;
  }

  const slipCls = statusClass(r.avgSlipPct, 15, 30);
  $("i-slip").textContent = r.avgSlipPct.toFixed(1) + "% gem.";
  $("i-slip").className = "status " + slipCls;

  let plugTxt, plugCls;
  if (r.plugBalance > 0.08) { plugTxt = "rijk mengsel"; plugCls = "warn"; }
  else if (r.plugBalance < -0.08) { plugTxt = "mager mengsel"; plugCls = "bad"; }
  else { plugTxt = "optimaal"; plugCls = "ok"; }
  // Same story as clutch heat above: this is a whole-run AVERAGE, which can
  // land back near zero after an early, localized lean/rich excursion that
  // already did enough damage to drop a cylinder (see the flag above) - an
  // "optimaal" reading here doesn't mean that didn't happen.
  if (r.cylindersDropped && (r.cylinderDropCause === "lean" || r.cylinderDropCause === "rich") && plugCls === "ok") {
    plugTxt += " gemiddeld - zie cilindermelding hierboven";
    plugCls = "warn";
  }
  $("i-plugs").textContent = plugTxt;
  $("i-plugs").className = "status " + plugCls;

  $("i-gasket").textContent = r.detonationRisk ? "risico op doorslaan" : "intact";
  $("i-gasket").className = "status " + (r.detonationRisk ? "bad" : "ok");

  const tw = r.tireWear;
  const twCls = statusClass(tw, 35, 65);
  $("i-tire").textContent = tw.toFixed(0) + "% slijtage";
  $("i-tire").className = "status " + twCls;

  $("i-da").textContent = Math.round(r.densityAltitude).toLocaleString("nl-NL") + " ft";
  $("i-da").className = "status ok";

  $("i-fuelpeak").textContent = r.peakFuelGpm.toFixed(1) + " gpm";
  $("i-fuelpeak").className = "status ok";

  const usableGal = computeGarageEffects(garageConfig).garageTankUsableGal;
  const fuelUsedCls = r.fuelStarved ? "bad" : statusClass(r.fuelConsumedGal, usableGal * 0.7, usableGal * 0.9);
  $("i-fuelused").textContent = `${r.fuelConsumedGal.toFixed(1)} / ${usableGal.toFixed(1)} gal`;
  $("i-fuelused").className = "status " + fuelUsedCls;

  let driverTxt, driverCls;
  if (r.driverLifted && r.driverLiftReason === "shutoff") { driverTxt = `shutoff @ ${r.driverLiftTime.toFixed(2)}s`; driverCls = "ok"; }
  else if (r.driverLifted) { driverTxt = `gas los @ ${r.driverLiftTime.toFixed(2)}s`; driverCls = "bad"; }
  else if (r.pedalCount > 0) { driverTxt = `gepedald (${r.pedalCount}x)`; driverCls = "warn"; }
  else { driverTxt = "volle run"; driverCls = "ok"; }
  $("i-driver").textContent = driverTxt;
  $("i-driver").className = "status " + driverCls;

  let cylTxt, cylCls;
  if (r.engineFailed) { cylTxt = "motor kapot"; cylCls = "bad"; }
  else if (r.cylindersDropped) { cylTxt = (r.cylinderDropCause === "rich" ? "verzopen" : "missen") + ` @ ${r.cylinderDropTime.toFixed(2)}s`; cylCls = "warn"; }
  else { cylTxt = "alle vuren"; cylCls = "ok"; }
  $("i-cyl").textContent = cylTxt;
  $("i-cyl").className = "status " + cylCls;

  // The actual gradual accumulator behind engineFailed's "bearing" cause -
  // watch this climb across a few (partial) runs instead of only ever
  // seeing the binary motor-kapot moment with nothing in between.
  // Monotonic within a run, so this is already the run's peak, wherever
  // the run actually stopped (full pass, early shutoff, or an actual
  // failure) - see run-simulator.js's rodBearingDamagePct. NOT the
  // clutch's own bearingWear - a mechanically unrelated part on the
  // other end of the driveline.
  const rodBearingCls = (r.engineFailed && r.engineFailCause === "bearing") ? "bad" : statusClass(r.rodBearingDamagePct, 50, 100);
  $("i-rod-bearing").textContent = r.rodBearingDamagePct.toFixed(0) + "%";
  $("i-rod-bearing").className = "status " + rodBearingCls;

  const retardCls = statusClass(r.peakIgnitionRetard, 8, 15);
  $("i-retard").textContent = r.peakIgnitionRetard > 0.1 ? `${r.peakIgnitionRetard.toFixed(1)}° teruggetrokken` : "niet geactiveerd";
  $("i-retard").className = "status " + (r.peakIgnitionRetard > 0.1 ? retardCls : "ok");

  $("i-weight").textContent = `${Math.round(r.weightLb).toLocaleString("nl-NL")} lb`;
  $("i-weight").className = "status ok";
}

$("runBtn").addEventListener("click", () => {
  if (!isCarRaceReady(garageConfig)) {
    $("placeholder").style.display = "block";
    $("placeholder").textContent = "Auto niet compleet, of een onderdeel is kapot - koop/repareer eerst in Auto bouwen (chassis, motor, koppen, blower, koppeling, koppelingspakket, brandstofpomp en trailer nodig, en geen kapotte onderdelen).";
    $("resultsContent").style.display = "none";
    $("inspPanel").style.display = "none";
    return;
  }
  // A test pass is free and has no failure/repair consequences (that
  // stays specific to real event runs, see chargePlayerRun), but it's
  // still a real physical run on the equipped parts - the same wear clock
  // a qualifying or elimination pass turns, see addRunWear in garage.js.
  // Run first so the wear THIS pass adds is based on how it actually went
  // (wearSeverityByPart), not applied blind before the result exists - and
  // so this pass's own physics sees last run's wear, not a bump from itself.
  const r = runSimulation(readSettings());
  addRunWear(garageConfig, wearSeverityByPart(r));
  saveGarageConfig();
  const rt = calcReactionTime(+$("aggro").value, Math.random, computeTeamEffects(teamConfig).teamReactionMult);
  renderRunResult(r, rt);
  if (currentMode === "garage") renderGarageSummary();
});

// ---- Evenement: 4 kwalificatierondes tegen een AI-veld (sim-core/ladder.js),
// gevolgd door een eliminatiebracket geseed op de kwalificatieladder. Elke
// ronde heeft eigen gegenereerde omstandigheden (sim-core/event.js) - die
// raken iedereen in het veld gelijk, dus een hete of gladde ronde is voor
// AI en speler hetzelfde probleem. ----

const envSliderIds = ["airtemp", "hum", "baro", "track", "grip"];
let currentMode = "test";
let viewingRoundIndex = null; // non-null while browsing a past round read-only via the history table
const EVENT_IDLE_STATUS = "Nog geen evenement gestart. Kies het aantal auto's en start: 4 kwalificatierondes bepalen de ladder, de beste 16 gaan door naar de eliminatie (minder dan 16 starters? dan gaat iedereen met een tijd door, met een bye erbij waar nodig). Elke ronde heeft eigen gesimuleerde omstandigheden - het hele veld rijdt onder dezelfde condities als jij.";

// ---- Financiën & garage: teambudget, transacties, sponsors en de
// auto-build (motor/kop/blower merken, chassis- en tankkeuzes). Beide
// bewaard lokaal in de browser, net als de opgeslagen setups. Garage-
// effecten (gewicht, sleeprisico, koppelingswarmte, tractie) worden in
// readSettings() meegenomen in elke run, test of evenement. ----

const FINANCES_KEY = "topfuel-finances";
const GARAGE_KEY = "topfuel-garage";

function loadFinancesState() {
  try {
    const raw = localStorage.getItem(FINANCES_KEY);
    return raw ? { ...defaultFinancesState(), ...JSON.parse(raw) } : defaultFinancesState();
  } catch { return defaultFinancesState(); }
}
function saveFinancesState() {
  try { localStorage.setItem(FINANCES_KEY, JSON.stringify(financesState)); } catch { /* private mode, storage full, etc - silently no-ops */ }
}
function loadGarageConfig() {
  try {
    const raw = localStorage.getItem(GARAGE_KEY);
    if (!raw) return defaultGarageConfig();
    // migrateGarageConfig needs to see the RAW saved shape (an absent
    // engineAgeMonths key means "never migrated," a real signal) - merging
    // with defaultGarageConfig() first would mask that, since the default
    // already supplies engineAgeMonths: 0 for every key the old save
    // doesn't have.
    return { ...defaultGarageConfig(), ...migrateGarageConfig(JSON.parse(raw)) };
  } catch { return defaultGarageConfig(); }
}
function saveGarageConfig() {
  try { localStorage.setItem(GARAGE_KEY, JSON.stringify(garageConfig)); } catch { /* private mode, storage full, etc - silently no-ops */ }
}

const MARKET_KEY = "topfuel-market";
function loadMarketState() {
  try {
    const raw = localStorage.getItem(MARKET_KEY);
    return raw ? JSON.parse(raw) : generateUsedMarket(Math.random);
  } catch { return generateUsedMarket(Math.random); }
}
function saveMarketState() {
  try { localStorage.setItem(MARKET_KEY, JSON.stringify(marketState)); } catch { /* private mode, storage full, etc - silently no-ops */ }
}

const TEAM_KEY = "topfuel-team";
function loadTeamConfig() {
  try {
    const raw = localStorage.getItem(TEAM_KEY);
    return raw ? { ...defaultTeamConfig(), ...JSON.parse(raw) } : defaultTeamConfig();
  } catch { return defaultTeamConfig(); }
}
function saveTeamConfig() {
  try { localStorage.setItem(TEAM_KEY, JSON.stringify(teamConfig)); } catch { /* private mode, storage full, etc - silently no-ops */ }
}

const SEASON_KEY = "topfuel-season";
function loadSeasonState() {
  try {
    const raw = localStorage.getItem(SEASON_KEY);
    return raw ? { ...defaultSeasonState(), ...JSON.parse(raw) } : defaultSeasonState();
  } catch { return defaultSeasonState(); }
}
function saveSeasonState() {
  try { localStorage.setItem(SEASON_KEY, JSON.stringify(seasonState)); } catch { /* private mode, storage full, etc - silently no-ops */ }
}

let financesState = loadFinancesState();
let garageConfig = loadGarageConfig();
let teamConfig = loadTeamConfig();
let marketState = loadMarketState();
let seasonState = loadSeasonState();

// ---- Evenement opslaan: ladderState (actieve kwalificatie/eliminatie-
// ladder) leeft normaal alleen in het geheugen - zonder dit zou een
// pagina-refresh midden in een evenement de hele voortgang wegvegen.
// De enige lastige eigenschap is ladderState.rng: een levende
// mulberry32-closure kun je niet naar JSON schrijven, dus wordt de
// INTERNE staat (rng.getState(), niet alleen de oorspronkelijke seed)
// apart bewaard en bij het laden teruggezet - zo gaat een hervat
// evenement precies verder waar de rng gebleven was, in plaats van de
// reeks vanaf het begin te herhalen. Daarnaast verwijzen bracketPool,
// qOrder, en de pairs/bye/playerOpponent/results in elimRounds allemaal
// naar DEZELFDE deelnemer-objecten als ladderState.field (zodat
// bijvoorbeeld "loser.eliminated = true" overal zichtbaar is) - een kale
// JSON.stringify zou die identiteit breken en losse kopieën maken. Dus
// worden die verwijzingen bij het opslaan vervangen door het
// deelnemer-id, en bij het laden weer teruggekoppeld naar de echte
// (herladen) objecten in field via een id-lookup.
const EVENT_KEY = "topfuel-event";

// Every runSimulation() result carries a full timestep trace (hundreds to
// thousands of points) purely for the just-finished run's own chart -
// nothing ever reads it back off an OLDER, already-stored result (browsing
// history is read-only text, see renderHistoryTable/renderLadderRoundUi).
// Persisting it anyway across every qualifying/elimination result in the
// event would balloon a save into tens of megabytes by the later rounds
// and risk silently blowing past localStorage's quota (the save calls
// below already swallow that error) - so it's stripped wherever it
// appears, generically by key name rather than tracking every specific
// spot a result object can live (field[].quals[], playerHistory[].result/
// .opponentResult, elimRounds[].byeResult/.results[].resultA/resultB).
function stripTraceDeep(value) {
  if (Array.isArray(value)) return value.map(stripTraceDeep);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "trace") continue;
      out[k] = stripTraceDeep(v);
    }
    return out;
  }
  return value;
}

function serializeElimRound(ed) {
  return {
    pairs: ed.pairs.map(([a, b]) => [a.id, b.id]),
    results: ed.results.map(res => res ? {
      aId: res.a.id, bId: res.b.id, resultA: res.resultA, resultB: res.resultB,
      reactA: res.reactA, reactB: res.reactB, winnerId: res.winner.id,
    } : null),
    bye: ed.bye ? ed.bye.id : null,
    byeResult: ed.byeResult,
    lanes: ed.lanes,
    playerPairIndex: ed.playerPairIndex,
    playerOpponent: ed.playerOpponent ? ed.playerOpponent.id : null,
    playerLaneChoice: ed.playerLaneChoice,
    opponentLaneChoice: ed.opponentLaneChoice,
  };
}
function deserializeElimRound(saved, byId) {
  return {
    pairs: saved.pairs.map(([aId, bId]) => [byId.get(aId), byId.get(bId)]),
    results: saved.results.map(res => res ? {
      a: byId.get(res.aId), b: byId.get(res.bId), resultA: res.resultA, resultB: res.resultB,
      reactA: res.reactA, reactB: res.reactB, winner: byId.get(res.winnerId),
    } : null),
    bye: saved.bye ? byId.get(saved.bye) : null,
    byeResult: saved.byeResult,
    lanes: saved.lanes,
    playerPairIndex: saved.playerPairIndex,
    playerOpponent: saved.playerOpponent ? byId.get(saved.playerOpponent) : null,
    playerLaneChoice: saved.playerLaneChoice,
    opponentLaneChoice: saved.opponentLaneChoice,
  };
}
function serializePlayerHistory(h) {
  if (!h || !h.opponent) return h;
  const { opponent, ...rest } = h;
  return { ...rest, opponentId: opponent.id };
}
function deserializePlayerHistory(h, byId) {
  if (!h || !h.opponentId) return h;
  const { opponentId, ...rest } = h;
  return { ...rest, opponent: byId.get(opponentId) };
}
function serializeLadderState(ls) {
  if (!ls) return null;
  return stripTraceDeep({
    bracketSize: ls.bracketSize, totalEntries: ls.totalEntries, seed: ls.seed,
    rounds: ls.rounds, trackId: ls.trackId, roundIndex: ls.roundIndex,
    field: ls.field,
    rngState: ls.rng.getState(),
    playerHistory: ls.playerHistory.map(serializePlayerHistory),
    qOrder: ls.qOrder ? ls.qOrder.map(e => e.id) : null,
    bracketPool: ls.bracketPool ? ls.bracketPool.map(e => e.id) : null,
    elimRounds: Object.fromEntries(Object.entries(ls.elimRounds).map(([idx, ed]) => [idx, serializeElimRound(ed)])),
    playerOutcome: ls.playerOutcome,
    finalResultText: ls.finalResultText,
    isSeasonRound: ls.isSeasonRound,
  });
}
function deserializeLadderState(saved) {
  if (!saved) return null;
  const byId = new Map(saved.field.map(e => [e.id, e]));
  const rng = mulberry32(0);
  rng.setState(saved.rngState);
  return {
    bracketSize: saved.bracketSize, totalEntries: saved.totalEntries, seed: saved.seed,
    rounds: saved.rounds, trackId: saved.trackId, roundIndex: saved.roundIndex,
    field: saved.field,
    rng,
    playerHistory: saved.playerHistory.map(h => deserializePlayerHistory(h, byId)),
    qOrder: saved.qOrder ? saved.qOrder.map(id => byId.get(id)) : null,
    bracketPool: saved.bracketPool ? saved.bracketPool.map(id => byId.get(id)) : null,
    elimRounds: Object.fromEntries(Object.entries(saved.elimRounds).map(([idx, ed]) => [idx, deserializeElimRound(ed, byId)])),
    playerOutcome: saved.playerOutcome,
    finalResultText: saved.finalResultText,
    isSeasonRound: !!saved.isSeasonRound,
  };
}
function loadEventState() {
  try {
    const raw = localStorage.getItem(EVENT_KEY);
    return raw ? deserializeLadderState(JSON.parse(raw)) : null;
  } catch { return null; }
}
function saveEventState() {
  try {
    if (ladderState) localStorage.setItem(EVENT_KEY, JSON.stringify(serializeLadderState(ladderState)));
    else localStorage.removeItem(EVENT_KEY);
  } catch { /* private mode, storage full, etc - silently no-ops */ }
}

let ladderState = loadEventState(); // null when no event is active

function eventInProgress() {
  return ladderState !== null && ladderState.playerOutcome === null;
}

function updateEnvLock() {
  const locked = currentMode === "event" && eventInProgress();
  envSliderIds.forEach(id => { $(id).disabled = locked; });
  $("event-env-note").style.display = locked ? "block" : "none";
}

const MODE_TAB_IDS = { test: "tabTest", event: "tabEvent", season: "tabSeason", finance: "tabFinance", garage: "tabGarage", team: "tabTeam" };

function setMode(mode) {
  currentMode = mode;
  Object.entries(MODE_TAB_IDS).forEach(([m, id]) => $(id).classList.toggle("active", m === mode));
  $("eventPanel").style.display = mode === "event" ? "block" : "none";
  $("seasonPanel").style.display = mode === "season" ? "block" : "none";
  $("financePanel").style.display = mode === "finance" ? "block" : "none";
  $("garagePanel").style.display = mode === "garage" ? "block" : "none";
  $("teamPanel").style.display = mode === "team" ? "block" : "none";
  $("settingsGrid").style.display = (mode === "test" || mode === "event") ? "grid" : "none";
  $("runBtn").style.display = mode === "test" ? "block" : "none";
  updateEnvLock();
  if (mode === "event" && eventInProgress()) refreshLadderView();
  if (mode === "season") renderSeasonPanel();
  if (mode === "finance") renderFinancePanel();
  if (mode === "garage") renderGaragePanel();
  if (mode === "team") renderTeamPanel();
}
Object.entries(MODE_TAB_IDS).forEach(([m, id]) => $(id).addEventListener("click", () => setMode(m)));

function applyConditions(cond) {
  $("airtemp").value = cond.airtempC;
  $("hum").value = cond.humidity;
  $("baro").value = Math.round(cond.baroInHg * 100);
  $("track").value = cond.trackTempC;
  $("grip").value = cond.gripSliderPct;
  currentTrackElevationFt = cond.elevationFt ?? 0;
  envSliderIds.forEach(id => $(id).dispatchEvent(new Event("input")));
}

function roundResultText(result) {
  if (!result) return "--";
  if (result.finished) return `${result.et.toFixed(3)}s @ ${result.mph.toFixed(1)} mph`;
  if (result.engineFailed) return "motor kapot";
  if (result.clutchFailed) return "koppeling vastgelast";
  return "DNF";
}
function entrantLabel(e) { return escapeHtml(e.name) + (e.isPlayer ? " (jij)" : ""); }

$("trackSelect").innerHTML = TRACKS.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("");
$("season-add-track").innerHTML = TRACKS.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("");
$("season-base-select").innerHTML = TRACKS.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("");
$("season-min-races-note").textContent = SEASON_MIN_RACES;

// Shared between starting a fresh event and restoring a saved one on page
// load - both land on the same "active event" panel state.
function showEventActiveUI() {
  const track = findTrack(ladderState.trackId);
  $("event-track-label").textContent = `Circuit: ${track.name} (${track.elevationFt.toLocaleString("nl-NL")} ft hoogte).`;
  $("event-setup").style.display = "none";
  $("event-active").style.display = "block";
  $("event-result").style.display = "none";
  $("startEventBtn").style.display = "none";
  $("newEventBtn").style.display = "block";
  $("runRoundBtn").style.display = "block";
  $("skipQualBtn").style.display = "block";
}

// The AI half of a season round's field is drawn from the season's own
// fixed rival roster (same named rivals all season, freshly re-tuned each
// week) instead of a fully anonymous one-off field - see season.js's
// RIVAL_POOL_SIZE/generateRivalPool. A season saved before this roster
// existed (or, defensively, a roster somehow short of what this week's
// field needs) gets topped up with regular one-off opponents rather than
// leaving seats empty.
function buildSeasonAiField(totalEntries, seed) {
  if (seasonState.rivalPool.length === 0) {
    seasonState.rivalPool = generateRivalPool(RIVAL_POOL_SIZE, Math.floor(Math.random() * 1e9));
    saveSeasonState();
  }
  const needed = totalEntries - 1;
  const field = generateAiFieldFromRoster(seasonState.rivalPool.slice(0, needed), seed);
  if (field.length < needed) field.push(...generateAiField(needed - field.length, seed + 999));
  return field;
}

// Shared by the manual "Start evenement" button and the season's "Ga naar
// deze race" button - both already handled their own readiness/budget
// checks and charged whatever's specific to that flow (entry fee + wages
// always, travel cost only for a season round) before calling this. Just
// builds the ladder itself and shows the active-event UI.
function beginEvent(trackId, totalEntries, isSeasonRound = false) {
  // The used-parts market turns over between events - fresh stock every
  // time a new one starts, same "time has passed" checkpoint the rest of
  // the economy (wages, sponsor offers) already keys off.
  marketState = generateUsedMarket(Math.random);
  saveMarketState();
  if (currentMode === "garage") renderGarageSummary();
  const bracketSize = ELIMINATION_BRACKET_SIZE;
  const seed = Math.floor(Math.random() * 1e9);
  const roundDefs = buildRoundDefs(bracketSize);
  const track = findTrack(trackId);
  const player = {
    id: "player", name: "Jij", team: "Jouw team", isPlayer: true,
    quals: [null, null, null, null], bestEt: null, bestMph: null,
    qualPosition: null, qualified: false, eliminated: false, eliminatedRound: null,
  };
  const rounds = generateEventConditions(roundDefs, seed, track);
  ladderState = {
    bracketSize, totalEntries, seed, rounds, trackId: track.id,
    roundIndex: 0,
    field: [player, ...(isSeasonRound ? buildSeasonAiField(totalEntries, seed + 1) : generateAiField(totalEntries - 1, seed + 1))],
    rng: mulberry32(seed + 777),
    playerHistory: new Array(rounds.length).fill(null),
    qOrder: null, bracketPool: null, elimRounds: {}, playerOutcome: null, finalResultText: null,
    isSeasonRound,
  };
  viewingRoundIndex = null;
  showEventActiveUI();
  activateLadderRound();
  updateEnvLock();
  saveEventState();
}

$("startEventBtn").addEventListener("click", () => {
  if (!isCarRaceReady(garageConfig)) {
    $("event-status").textContent = `Auto niet compleet of er staat een kapot onderdeel - koop/repareer eerst in Auto bouwen (chassis, motor, koppen, blower, koppeling, koppelingspakket, brandstofpomp en trailer nodig, niets kapot) voor je kunt inschrijven.`;
    return;
  }
  const rawEntries = Math.round(+$("fieldSizeSelect").value);
  const totalEntries = Number.isFinite(rawEntries) ? Math.min(32, Math.max(2, rawEntries)) : 16;
  $("fieldSizeSelect").value = totalEntries;
  const wagesPerEvent = totalTeamWagesPerEvent(teamConfig);
  const totalCost = ENTRY_FEE + Math.max(0, wagesPerEvent);
  if (financesState.budget < totalCost) {
    $("event-status").textContent = `Onvoldoende budget voor inschrijfgeld + teamsalarissen (€${totalCost.toLocaleString("nl-NL")}) - huidig budget €${financesState.budget.toLocaleString("nl-NL")}. Check Financiën voor sponsorvoorstellen.`;
    return;
  }
  chargeEntryFee(financesState);
  chargeTeamWages(financesState, wagesPerEvent);
  saveFinancesState();
  renderFinancePanel();
  beginEvent($("trackSelect").value, totalEntries);
});

$("newEventBtn").addEventListener("click", () => {
  ladderState = null;
  saveEventState();
  $("event-status").textContent = EVENT_IDLE_STATUS;
  $("event-setup").style.display = "block";
  $("event-active").style.display = "none";
  $("event-result").style.display = "none";
  $("startEventBtn").style.display = "block";
  $("newEventBtn").style.display = "none";
  updateEnvLock();
});

$("backToSeasonBtn").addEventListener("click", () => {
  ladderState = null;
  saveEventState();
  setMode("season");
});

// ---- Seizoen: speler-samengestelde kalender (circuits mogen vaker
// voorkomen), per race zelf attend/skip, NHRA-stijl punten (zie
// season.js) en reiskosten vanaf een gekozen teambasis. Draait de
// werkelijke race via dezelfde ladder/eventPanel-machinery als een los
// evenement (beginEvent, isSeasonRound=true) - finishEvent haakt daar
// zelf de puntentelling aan. ----

function seasonOutcomeLabel(entry) {
  if (!entry.attended) return "Overgeslagen";
  const o = entry.outcome;
  if (!o.qualified) return "Niet gekwalificeerd";
  if (o.champion) return "Kampioen";
  return `Uitgeschakeld ronde ${o.eliminatedRound}`;
}

function renderSeasonRoundRows(tbodyId) {
  return seasonState.calendar.map((entry, i) => {
    const track = findTrack(entry.trackId);
    const result = seasonState.results[i];
    let cls = "future";
    let statusTxt = "Nog niet gereden";
    let pointsTxt = "--";
    if (result) {
      cls = "done";
      statusTxt = seasonOutcomeLabel(result);
      pointsTxt = result.points;
    } else if (seasonState.active && i === seasonState.roundIndex) {
      cls = "current";
      statusTxt = "Aankomend";
    }
    return `<tr class="${cls}"><td>${i + 1}</td><td>${escapeHtml(track.name)}</td><td>${statusTxt}</td><td>${pointsTxt}</td></tr>`;
  }).join("");
}

// Player + every rival who's raced at least once, ranked by season points -
// used both for the running "tussenstand" during an active season and the
// final table once it's over. Returns the row HTML plus the player's own
// rank (1-based) and the field size, so callers can also show "P4 van 22".
function renderSeasonStandings() {
  const rows = seasonStandings(seasonState, "Jij", "Jouw team");
  const playerRank = rows.findIndex(r => r.isPlayer) + 1;
  const html = rows.map((r, i) => {
    const cls = r.isPlayer ? "current" : "done";
    return `<tr class="${cls}"><td>${i + 1}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.team)}</td><td>${r.points}</td></tr>`;
  }).join("");
  return { html, playerRank, fieldSize: rows.length };
}

function renderSeasonCalendarBuilder() {
  $("season-calendar-body").innerHTML = seasonState.calendar.map((entry, i) => {
    const track = findTrack(entry.trackId);
    const cost = seasonState.baseTrackId ? travelCostFor(seasonState.baseTrackId, entry.trackId) : null;
    const costTxt = cost === null ? "--" : `€${cost.toLocaleString("nl-NL")}`;
    return `<tr><td>${i + 1}</td><td>${escapeHtml(track.name)}</td><td>${costTxt}</td><td><button class="secondary mini-btn" type="button" data-remove-calendar-idx="${i}">Verwijder</button></td></tr>`;
  }).join("");
}

function seasonSetupStatusText() {
  const missing = [];
  if (seasonState.calendar.length < SEASON_MIN_RACES) missing.push(`nog minstens ${SEASON_MIN_RACES - seasonState.calendar.length} race(s) toevoegen`);
  if (!seasonState.baseTrackId) missing.push("een teambasis kiezen");
  if (!teamConfig.driverId) missing.push("een rijder aannemen (zie Team bouwen) - die zit vast zodra het seizoen start");
  if (missing.length) return `Nog te doen voor je kunt starten: ${missing.join(", ")}.`;
  return `Klaar om te starten: ${seasonState.calendar.length} races gepland vanaf ${findTrack(seasonState.baseTrackId).name}.`;
}

function renderSeasonPanel() {
  const complete = seasonState.calendar.length > 0 && !seasonState.active && seasonState.results.some(r => r !== null);
  $("season-setup").style.display = seasonState.active || complete ? "none" : "block";
  $("season-active").style.display = seasonState.active ? "block" : "none";
  $("season-complete").style.display = complete ? "block" : "none";

  if (!seasonState.active && !complete) {
    $("season-status").textContent = seasonSetupStatusText();
    $("season-base-select").value = seasonState.baseTrackId || TRACKS[0].id;
    renderSeasonCalendarBuilder();
    return;
  }

  if (seasonState.active) {
    $("season-status").textContent = "";
    $("season-total-points").textContent = seasonState.totalPoints;
    $("season-rounds-body").innerHTML = renderSeasonRoundRows();
    const round = currentSeasonRound(seasonState);
    if (round) {
      const track = findTrack(round.trackId);
      const cost = travelCostFor(seasonState.baseTrackId, round.trackId);
      const miles = travelMilesFor(seasonState.baseTrackId, round.trackId);
      $("season-current-note").textContent = `Volgende race (${round.index + 1}/${seasonState.calendar.length}): ${track.name} — reiskosten ≈ €${cost.toLocaleString("nl-NL")} (${miles} mijl vanaf teambasis), verwacht veld ${track.seasonFieldMin}-${track.seasonFieldMax} auto's (bekend pas als je start).`;
      $("season-attend-btn").style.display = "block";
      $("season-skip-btn").style.display = "block";
    }
    const standings = renderSeasonStandings();
    $("season-standings-body").innerHTML = standings.html;
    $("season-standings-note").textContent = seasonState.results.some(r => r) ? `Jij staat op P${standings.playerRank} van ${standings.fieldSize}.` : "Nog geen races gereden dit seizoen - de tussenstand vult zich na je eerste bijgewoonde race.";
    return;
  }

  // Season finished - final standings.
  const attendedCount = seasonState.results.filter(r => r && r.attended).length;
  $("season-final-summary").textContent = `Seizoen afgerond! Totaal ${seasonState.totalPoints} punten uit ${attendedCount}/${seasonState.calendar.length} bijgewoonde races.`;
  $("season-final-body").innerHTML = renderSeasonRoundRows();
  $("season-final-standings-body").innerHTML = renderSeasonStandings().html;
}

// Free to change for as long as the setup screen is showing (no travel cost
// is actually charged until you attend a race) - only visible during setup
// in the first place, so nothing further needs locking it once a season is
// under way.
$("season-base-select").addEventListener("change", () => {
  seasonState.baseTrackId = $("season-base-select").value;
  saveSeasonState();
  renderSeasonPanel();
});

$("season-add-race-btn").addEventListener("click", () => {
  addRaceToCalendar(seasonState, $("season-add-track").value);
  saveSeasonState();
  renderSeasonPanel();
});

$("season-calendar-body").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-remove-calendar-idx]");
  if (!btn) return;
  removeRaceFromCalendar(seasonState, +btn.dataset.removeCalendarIdx);
  saveSeasonState();
  renderSeasonPanel();
});

$("season-start-btn").addEventListener("click", () => {
  if (seasonState.calendar.length < SEASON_MIN_RACES || !seasonState.baseTrackId || !teamConfig.driverId) {
    $("season-status").textContent = seasonSetupStatusText();
    return;
  }
  seasonState.rivalPool = generateRivalPool(RIVAL_POOL_SIZE, Math.floor(Math.random() * 1e9));
  seasonState.rivalPoints = {};
  startSeason(seasonState);
  saveSeasonState();
  renderSeasonPanel();
  renderTeamPanel();
});

$("season-attend-btn").addEventListener("click", () => {
  const round = currentSeasonRound(seasonState);
  if (!round) return;
  if (!isCarRaceReady(garageConfig)) {
    $("season-status").textContent = `Auto niet compleet of er staat een kapot onderdeel - koop/repareer eerst in Auto bouwen voor je naar deze race kunt.`;
    return;
  }
  const wagesPerEvent = totalTeamWagesPerEvent(teamConfig);
  const travelCost = travelCostFor(seasonState.baseTrackId, round.trackId);
  const totalCost = ENTRY_FEE + Math.max(0, wagesPerEvent) + travelCost;
  if (financesState.budget < totalCost) {
    $("season-status").textContent = `Onvoldoende budget voor inschrijfgeld + teamsalarissen + reiskosten (€${totalCost.toLocaleString("nl-NL")}) - huidig budget €${financesState.budget.toLocaleString("nl-NL")}. Check Financiën voor sponsorvoorstellen.`;
    return;
  }
  const track = findTrack(round.trackId);
  const miles = travelMilesFor(seasonState.baseTrackId, round.trackId);
  chargeEntryFee(financesState);
  chargeTeamWages(financesState, wagesPerEvent);
  addTransaction(financesState, `Reiskosten naar ${track.name} (${miles} mijl)`, -travelCost);
  saveFinancesState();
  renderFinancePanel();
  setMode("event");
  beginEvent(round.trackId, deriveSeasonFieldSize(round.trackId), true);
});

$("season-skip-btn").addEventListener("click", () => {
  recordSkippedResult(seasonState);
  saveSeasonState();
  renderSeasonPanel();
});

$("season-new-btn").addEventListener("click", () => {
  seasonState = defaultSeasonState();
  saveSeasonState();
  renderSeasonPanel();
  renderTeamPanel();
});

// Enters a new round: applies its weather, and for qualifying pre-runs
// every AI entrant scheduled ahead of the player this session (see
// deriveRunningOrder), or for elimination resolves every pair that
// doesn't involve the player - the player's own pass is the only one
// deferred to a button click. Elimination rounds also draw this round's
// two lane variants (see generateLaneVariants) and, for every pair
// including the player's, let the higher seed pick - AI pairs use a
// simple "take the grippier lane" heuristic (pickBetterLane) since
// there's no player judgment to model there. A short survivor count gets
// one bye (pairBracketRound), which still runs a solo pass but always
// advances regardless of outcome.
function activateLadderRound() {
  const roundDef = ladderState.rounds[ladderState.roundIndex];
  applyConditions(roundDef.conditions);
  const player = ladderState.field.find(e => e.isPlayer);

  if (roundDef.phase === "qualifying") {
    const sessionIndex = roundDef.roundNumber - 1;
    const order = deriveRunningOrder(ladderState.field, sessionIndex, ladderState.seed + 100 + ladderState.roundIndex);
    ladderState.qOrder = order;
    const playerIdx = order.findIndex(e => e.isPlayer);
    for (let i = 0; i < playerIdx; i++) runQualifyingAttempt(order[i], sessionIndex, roundDef.conditions, false);
  } else {
    const survivors = ladderState.bracketPool.filter(e => !e.eliminated);
    const { pairs, bye } = pairBracketRound(survivors);
    // Kept per round index (not overwritten each round) so a past
    // elimination round's pairs/times stay browsable via the history
    // table instead of disappearing the moment the next round starts.
    const ed = {
      pairs, results: new Array(pairs.length).fill(null),
      bye, byeResult: null,
      lanes: generateLaneVariants(roundDef.conditions, ladderState.rng),
      playerPairIndex: null, playerOpponent: null, playerLaneChoice: null, opponentLaneChoice: null,
    };
    ladderState.elimRounds[ladderState.roundIndex] = ed;

    if (bye && !bye.isPlayer) {
      ed.byeResult = runSimulation({ ...bye.tune, ...roundDef.conditions });
    }

    pairs.forEach(([a, b], i) => {
      if (a === player || b === player) {
        ed.playerPairIndex = i;
        ed.playerOpponent = a === player ? b : a;
        if (player.qualPosition > ed.playerOpponent.qualPosition) {
          const oppLane = pickBetterLane(ed.lanes);
          ed.opponentLaneChoice = oppLane;
          ed.playerLaneChoice = oppLane === "A" ? "B" : "A";
        }
        return;
      }
      const higherSeed = a.qualPosition < b.qualPosition ? a : b;
      const lowerSeed = higherSeed === a ? b : a;
      const higherLane = pickBetterLane(ed.lanes);
      const lowerLane = higherLane === "A" ? "B" : "A";
      const resultHigher = runSimulation({ ...higherSeed.tune, ...ed.lanes[higherLane] });
      const resultLower = runSimulation({ ...lowerSeed.tune, ...ed.lanes[lowerLane] });
      const resultA = higherSeed === a ? resultHigher : resultLower;
      const resultB = higherSeed === a ? resultLower : resultHigher;
      const reactA = calcReactionTime(a.tune.driverAggressiveness, ladderState.rng);
      const reactB = calcReactionTime(b.tune.driverAggressiveness, ladderState.rng);
      const winner = resolveHeadToHead(reactA, resultA, reactB, resultB) === "A" ? a : b;
      const loser = winner === a ? b : a;
      loser.eliminated = true;
      loser.eliminatedRound = roundDef.roundNumber;
      ed.results[i] = { a, b, resultA, resultB, reactA, reactB, winner };
    });

    // A car that reaches eliminations still broken from qualifying (see
    // runPlayerQualifying - a mechanical failure there no longer force-
    // ends the event) can't line up at all: a genuine no-show, resolved
    // right here rather than waiting on a Run click that can't happen.
    // The one exception is the coincidental case where the bracket ALSO
    // handed them a bye this round (purely an odd-survivor-count thing,
    // unrelated to the car) - nothing was being contested there either
    // way, so they still advance without needing to run.
    if (!isCarRaceReady(garageConfig)) {
      if (bye && bye.isPlayer) {
        ladderState.playerHistory[ladderState.roundIndex] = { bye: true, carNotReady: true };
        renderBracketTable(roundDef);
        renderHistoryTable();
        saveEventState();
        const isFinalRound = roundDef.roundNumber === totalElimRoundsFor(ladderState.bracketSize);
        if (isFinalRound) {
          ladderState.playerOutcome = "champion";
          finishEvent(
            { qualified: true, champion: true, totalElimRounds: totalElimRoundsFor(ladderState.bracketSize) },
            `Kampioen! Je auto was niet race-klaar, maar de laatste ronde was toch een bye - automatisch door en daarmee kampioen (${ladderState.totalEntries} auto's).`
          );
        } else {
          advanceLadderRound();
        }
        return;
      }
      if (ed.playerPairIndex !== null) {
        const opponent = ed.playerOpponent;
        const opponentLane = pickBetterLane(ed.lanes);
        const opponentResult = runSimulation({ ...opponent.tune, ...ed.lanes[opponentLane] });
        const [pa, pb] = ed.pairs[ed.playerPairIndex];
        player.eliminated = true;
        player.eliminatedRound = roundDef.roundNumber;
        ed.results[ed.playerPairIndex] = {
          a: pa, b: pb,
          resultA: pa === player ? null : opponentResult,
          resultB: pb === player ? null : opponentResult,
          reactA: null, reactB: null,
          winner: opponent,
        };
        ladderState.playerHistory[ladderState.roundIndex] = { opponent, opponentResult, won: false, noShow: true };
        ladderState.playerOutcome = "eliminated";
        renderBracketTable(roundDef);
        renderHistoryTable();
        saveEventState();
        finishEvent(
          { qualified: true, champion: false, eliminatedRound: roundDef.roundNumber },
          `Niet race-klaar toen ${roundDef.label.toLowerCase()} begon (kapot onderdeel niet op tijd gerepareerd) - automatisch verloren van ${opponent.name} (${opponent.team}), geen kans om te rijden. Het evenement is voorbij voor je team.`
        );
        return;
      }
    }
  }
  viewingRoundIndex = null;
  renderLadderRoundUi();
}

// Pure re-display of the current round's state - safe to call repeatedly
// (e.g. switching back to the Evenement tab) since it runs no simulations.
function refreshLadderView() {
  const roundDef = ladderState.rounds[ladderState.roundIndex];
  applyConditions(roundDef.conditions);
  renderLadderRoundUi();
}

function renderLadderRoundUi() {
  const isHistorical = viewingRoundIndex !== null;
  // Once the event has concluded (win, loss, or DNQ), no round - not even
  // the one that was still "current" when it ended - can be run again.
  // Browsing history back to it must stay read-only, same as any other
  // past round, instead of re-showing run/skip/lane controls that would
  // otherwise re-simulate an already-decided round.
  const eventOver = ladderState.playerOutcome !== null;
  const readOnly = isHistorical || eventOver;
  const activeIndex = isHistorical ? viewingRoundIndex : ladderState.roundIndex;
  const roundDef = ladderState.rounds[activeIndex];
  $("event-round-label").style.display = "block";
  $("event-round-label").textContent = isHistorical
    ? `Bekijk ronde: ${roundDef.id} — ${roundDef.label} (afgerond)`
    : `Actieve ronde: ${roundDef.id} — ${roundDef.label}`;
  $("backToCurrentRoundBtn").style.display = isHistorical ? "block" : "none";
  const isQuali = roundDef.phase === "qualifying";
  $("quali-block").style.display = isQuali ? "block" : "none";
  $("elim-block").style.display = isQuali ? "none" : "block";
  $("skipQualBtn").style.display = !readOnly && isQuali ? "block" : "none";
  if (isQuali) {
    // A broken/fatal part from an earlier session can't be raced on - the
    // Run button hides until it's repaired, same gate the Testrun tab
    // already uses (isCarRaceReady), leaving Skip as the only way past
    // this session. See runPlayerQualifying: the time already banked from
    // an earlier clean run stays valid either way.
    const carNotReady = !readOnly && !isCarRaceReady(garageConfig);
    $("runRoundBtn").style.display = readOnly || carNotReady ? "none" : "block";
    $("quali-car-not-ready-note").style.display = carNotReady ? "block" : "none";
    $("lane-choice-block").style.display = "none";
    renderQualiTable(roundDef);
  } else {
    renderBracketTable(roundDef, activeIndex, readOnly);
  }
  renderHistoryTable();
}

// Browsing a completed round from the "Jouw rondes" table - read-only,
// no simulations run. Only rounds already in the past (index < the
// active round, or the whole event finished) are reachable this way.
function viewRound(i) {
  viewingRoundIndex = i;
  renderLadderRoundUi();
}
function backToCurrentRound() {
  viewingRoundIndex = null;
  renderLadderRoundUi();
}
$("backToCurrentRoundBtn").addEventListener("click", backToCurrentRound);

// The "Jouw rondes" history is the point of this table: every round's
// weather sits right next to what you actually did with it, so comparing
// a new round's conditions to a past one (to decide how to re-tune) is
// just reading down the columns - see the Evenement note text. Future
// rounds' weather stays hidden until they're current.
function renderHistoryTable() {
  $("history-table-body").innerHTML = ladderState.rounds.map((round, i) => {
    const isFuture = i > ladderState.roundIndex;
    const c = round.conditions;
    const condCells = isFuture
      ? `<td colspan="5" style="text-align:center;">nog onbekend</td>`
      : `<td>${c.airtempC}°C</td><td>${c.humidity}%</td><td>${c.baroInHg.toFixed(2)}</td><td>${c.trackTempC}°C</td><td>${c.gripSliderPct}%</td>`;
    const h = ladderState.playerHistory[i];
    const et60Txt = h && h.result && h.result.et60 ? h.result.et60.toFixed(3) : "--";
    const etTxt = h && h.result && h.result.finished ? h.result.et.toFixed(3) : "--";
    const mphTxt = h && h.result ? h.result.mph.toFixed(1) : "--";
    let statusTxt;
    if (isFuture) statusTxt = "--";
    else if (i === ladderState.roundIndex && !h) {
      const ed = round.phase === "elimination" ? ladderState.elimRounds[i] : null;
      statusTxt = ed && ed.playerOpponent ? `aan jou vs ${ed.playerOpponent.name}` : "actief";
    } else if (!h) statusTxt = "--";
    else if (h.skipped) statusTxt = "overgeslagen";
    else if (h.bye) statusTxt = "bye — automatisch door";
    else if (round.phase === "elimination" && h.opponent) statusTxt = `vs ${h.opponent.name}: ${h.won ? "gewonnen" : "verloren"} (${roundResultText(h.opponentResult)})`;
    else statusTxt = roundResultText(h.result);
    const cls = h ? "done" : (i === ladderState.roundIndex ? "current" : "future");
    // Any round with a recorded history entry (a run, a skip, or a bye)
    // is browsable read-only via viewRound - see the click handler below.
    const rowAttrs = h ? ` data-round-index="${i}" class="${cls} clickable" title="Klik om deze ronde te bekijken"` : ` class="${cls}"`;
    return `<tr${rowAttrs}><td>${round.id}</td>${condCells}<td>${et60Txt}</td><td>${etTxt}</td><td>${mphTxt}</td><td>${escapeHtml(statusTxt)}</td></tr>`;
  }).join("");
}
$("history-table-body").addEventListener("click", (e) => {
  const row = e.target.closest("tr[data-round-index]");
  if (row) viewRound(+row.dataset.roundIndex);
});

function renderQualiTable(roundDef) {
  const sessionIndex = roundDef.roundNumber - 1;
  const ranked = computeQualifyingLadder(ladderState.field, ladderState.bracketSize);
  $("quali-table-body").innerHTML = ranked.map(e => {
    const sessionResult = e.quals[sessionIndex];
    const sessionTxt = sessionResult ? roundResultText(sessionResult) : (e.isPlayer ? "aan jou" : "--");
    const statusTxt = e.bestEt === null ? "geen tijd" : (e.qualified ? "gekwalificeerd" : "buiten de bump");
    const cls = e.isPlayer ? "current" : (e.qualified ? "done" : "future");
    return `<tr class="${cls}"><td>${e.qualPosition ?? "--"}</td><td>${entrantLabel(e)}</td><td>${escapeHtml(e.team)}</td><td>${sessionTxt}</td><td>${e.bestEt ? e.bestEt.toFixed(3) : "--"}</td><td>${e.bestMph ? e.bestMph.toFixed(1) : "--"}</td><td>${statusTxt}</td></tr>`;
  }).join("");
}

function renderBracketTable(roundDef, roundIndex = ladderState.roundIndex, readOnly = false) {
  const player = ladderState.field.find(e => e.isPlayer);
  const ed = ladderState.elimRounds[roundIndex];
  const bye = ed.bye;

  // Lane choice is only a live decision while the player is genuinely the
  // higher seed and hasn't picked yet - otherwise it's already resolved
  // (opponent picked, or there's no opponent this round at all). Never a
  // live decision while browsing a past round, or after the event itself
  // has already ended (readOnly covers both).
  const playerNeedsLaneChoice = !readOnly && ed.playerOpponent && ed.playerLaneChoice === null
    && player.qualPosition < ed.playerOpponent.qualPosition;
  $("lane-choice-block").style.display = playerNeedsLaneChoice ? "block" : "none";
  if (!readOnly) $("runRoundBtn").style.display = playerNeedsLaneChoice ? "none" : "block";
  if (playerNeedsLaneChoice) {
    $("laneA-grip").textContent = ed.lanes.A.gripSliderPct.toFixed(0);
    $("laneA-track").textContent = ed.lanes.A.trackTempC.toFixed(0);
    $("laneB-grip").textContent = ed.lanes.B.gripSliderPct.toFixed(0);
    $("laneB-track").textContent = ed.lanes.B.trackTempC.toFixed(0);
  }

  if (bye && bye.isPlayer) {
    $("opponent-info").textContent = `Ronde ${roundDef.roundNumber}: bye - jij bent de best overgebleven auto zonder tegenstander deze ronde en gaat automatisch door, ongeacht je pass. Rijd 'm nog wel voor de tijd.`;
  } else if (bye) {
    $("opponent-info").textContent = `Ronde ${roundDef.roundNumber}: jij (seed ${player.qualPosition}) vs ${ed.playerOpponent.name} — ${ed.playerOpponent.team} (seed ${ed.playerOpponent.qualPosition}). ${entrantLabel(bye)} heeft deze ronde een bye.`;
  } else if (ed.playerOpponent) {
    const laneTxt = ed.playerLaneChoice ? ` — jij rijdt baan ${ed.playerLaneChoice}` : "";
    $("opponent-info").textContent = `Ronde ${roundDef.roundNumber}: jij (seed ${player.qualPosition}) vs ${ed.playerOpponent.name} — ${ed.playerOpponent.team} (seed ${ed.playerOpponent.qualPosition}, kwaltijd ${ed.playerOpponent.bestEt.toFixed(3)}s, "${ed.playerOpponent.archetype}")${laneTxt}`;
  }

  const rows = ed.pairs.map(([a, b], i) => {
    const res = ed.results[i];
    const involvesPlayer = a === player || b === player;
    const aTxt = res ? roundResultText(res.resultA) : "--";
    const bTxt = res ? roundResultText(res.resultB) : "--";
    const resultTxt = res ? `${entrantLabel(res.winner)} wint` : (involvesPlayer ? "aan jou" : "--");
    const cls = involvesPlayer ? "current" : (res ? "done" : "future");
    return `<tr class="${cls}"><td>${entrantLabel(a)}</td><td>${aTxt}</td><td>${entrantLabel(b)}</td><td>${bTxt}</td><td>${resultTxt}</td></tr>`;
  });
  if (bye) {
    const byeTxt = ed.byeResult ? roundResultText(ed.byeResult) : (bye.isPlayer ? "aan jou" : "--");
    const cls = bye.isPlayer ? "current" : "done";
    rows.push(`<tr class="${cls}"><td>${entrantLabel(bye)} (bye)</td><td>${byeTxt}</td><td>—</td><td>—</td><td>${entrantLabel(bye)} door</td></tr>`);
  }
  $("bracket-table-body").innerHTML = rows.join("");
}

function choosePlayerLane(lane) {
  ladderState.elimRounds[ladderState.roundIndex].playerLaneChoice = lane;
  saveEventState();
  renderBracketTable(ladderState.rounds[ladderState.roundIndex]);
}
$("chooseLaneA").addEventListener("click", () => choosePlayerLane("A"));
$("chooseLaneB").addEventListener("click", () => choosePlayerLane("B"));

function totalElimRoundsFor(bracketSize) {
  return Math.round(Math.log2(bracketSize));
}

function advanceLadderRound() {
  const finishedRoundDef = ladderState.rounds[ladderState.roundIndex];
  if (finishedRoundDef.phase === "qualifying" && finishedRoundDef.roundNumber === 4) {
    const ranked = computeQualifyingLadder(ladderState.field, ladderState.bracketSize);
    const player = ranked.find(e => e.isPlayer);
    if (!player.qualified) {
      ladderState.playerOutcome = "dnq";
      finishEvent({ qualified: false }, `Niet gekwalificeerd — je eindigde als P${player.qualPosition} van de ${ladderState.field.length}, de eliminatie ging tot en met P${ladderState.bracketSize}.`);
      return;
    }
    ladderState.bracketPool = ranked.filter(e => e.qualified).slice(0, ladderState.bracketSize);
  }
  ladderState.roundIndex++;
  activateLadderRound();
  saveEventState();
}

function renderFinalResult(text) {
  $("runRoundBtn").style.display = "none";
  $("skipQualBtn").style.display = "none";
  $("event-status").textContent = "Evenement afgerond.";
  $("event-result").style.display = "block";
  $("event-final-result").textContent = text;
  $("backToSeasonBtn").style.display = ladderState.isSeasonRound ? "block" : "none";
  updateEnvLock();
}

const FATAL_FAILURE_NOUN = { engine: "Motorblok", head: "Cilinderkop", blower: "Blower", clutch: "Koppeling", fuelPump: "Brandstofpomp" };

// Joins 1+ Dutch part nouns into a natural list ("Motorblok", "Motorblok
// en blower") for the failure messages below - a failure can now take out
// more than one part at once (see rollEnginePartsFailed).
function fatalPartsText(parts) {
  return parts.map((p) => FATAL_FAILURE_NOUN[p]).join(" en ");
}

// Both fatalParts (total loss) and brokenParts (still mounted, just needs
// an explicit repair - see finances.js's repairPartUnit) end THIS event
// the same way - no working unit for the rest of it - but mean different
// things for what the player has to do about it before the next one, so
// the end-of-event message spells out which is which rather than lumping
// them into one generic "kapot" list.
function unusablePartsClause(fatalParts, brokenParts) {
  const clauses = [];
  if (fatalParts.length) clauses.push(`${fatalPartsText(fatalParts)} total loss`);
  if (brokenParts.length) clauses.push(`${fatalPartsText(brokenParts)} kapot (reparatie nodig in Auto bouwen)`);
  return clauses.join(", ");
}

// How hard THIS run actually beat on each part, 0-1, for addRunWear's
// severity-scaled extra wear (garage.js) - engine/head/blower/fuelPump all
// share the worse of engineDamagePct (heat/lean, all the way to real motor
// failure) and foulDamagePct (rich fouling, caps out at a cylinder drop),
// since a failure on any of the three engine-side parts can come from
// either; the clutch gets its own already-computed bearingWear instead,
// same clutchDamage/CLUTCH_FAILURE_THRESHOLD clock its own failure risk
// and lockup-gain readouts already use.
function wearSeverityByPart(r) {
  const engineSeverity = Math.max(r.engineDamagePct, r.foulDamagePct, r.rodBearingDamagePct) / 100;
  const clutchSeverity = r.bearingWear / 100;
  return { engine: engineSeverity, head: engineSeverity, blower: engineSeverity, fuelPump: engineSeverity, clutch: clutchSeverity };
}

// Every actual player run during an event (qualifying pass, elimination
// pass, bye pass - not a skipped qualifying round, not a Testrun-tab
// run, which wears the car but never costs money or triggers a failure
// roll) costs run money, adds a bit of wear to every equipped part
// (addRunWear - the same physical-mileage clock a Testrun lap also
// turns), plus damage cost(s) on top if the motor side or koppeling let
// go. An "engine" failure doesn't always mean the block itself -
// rollEnginePartsFailed picks which of engine/head/blower (1 or 2 of
// them) actually took the hit, and chargePartFailure charges each
// independently on an escalating spare/broken/catastrophic-write-off
// ladder (see finances.js). Returns the part(s) left with no working unit
// for the REST of this event, split by why: fatalParts (total loss, needs
// a full replacement before racing that slot again) and brokenParts
// (still mounted, just needs an explicit, paid repair - see
// repairPartUnit) - both empty if the car survived clean.
function chargePlayerRun(r) {
  chargeRunCost(financesState);
  addRunWear(garageConfig, wearSeverityByPart(r));
  // A clutch pack that just aged out on run-count (not a failure roll,
  // see chargeClutchPackExhaustion) gets a spare swapped in right away if
  // one's on the trailer - otherwise the car would sit "not race-ready"
  // with a fresh pack sitting unused in inventory.
  chargeClutchPackExhaustion(financesState, garageConfig);
  const catastrophicMult = computeTeamEffects(teamConfig).teamCatastrophicMult;
  const fatalParts = [];
  const brokenParts = [];
  if (r.engineFailed) {
    const parts = rollEnginePartsFailed(r.engineFailCause, ladderState.rng);
    // A liquid-locked cylinder bending a rod, or a connecting-rod bearing
    // spinning from detonation, is almost never something a trackside
    // crew repairs - both are overwhelmingly a write-off, on top of
    // whatever the car chief's own catastrophicMult already says.
    const engineCatastrophicMult = catastrophicMult * ((r.engineFailCause === "hydrolock" || r.engineFailCause === "bearing") ? 2.5 : 1);
    parts.forEach((part) => {
      const outcome = chargePartFailure(financesState, garageConfig, part, ladderState.rng, engineCatastrophicMult);
      if (outcome === "fatal") fatalParts.push(part);
      else if (outcome === "broken") brokenParts.push(part);
    });
  }
  if (r.clutchFailed) {
    const outcome = chargePartFailure(financesState, garageConfig, "clutch", ladderState.rng, catastrophicMult);
    if (outcome === "fatal") fatalParts.push("clutch");
    else if (outcome === "broken") brokenParts.push("clutch");
  }
  saveFinancesState();
  saveGarageConfig();
  renderFinancePanel();
  return { fatalParts, brokenParts };
}

// The player's own event stops the moment they're out (a real elimination
// ladder doesn't wait around for them), which normally leaves whatever
// rounds come after that unresolved - only the pairs that actually involved
// or preceded the player got simulated. For season standings to mean
// anything, the REST of the bracket still needs a genuine result: who those
// remaining AI cars keep beating, and who ultimately wins the thing. This
// finishes that off silently (no UI, nothing the player watches) using the
// exact same pairing/lane/reaction-time logic the interactive rounds use,
// then returns whichever entrant is left standing (or null if the bracket
// never got underway at all, i.e. the player didn't even qualify AND no AI
// ever raced eliminations either - can't happen once qualifying computed a
// bracketPool, since qualifying always runs the WHOLE field regardless of
// who makes the cut).
function resolveRemainingBracket() {
  if (!ladderState.bracketPool) {
    if (!ladderState.field.some(e => e.qualified)) return null;
    const ranked = computeQualifyingLadder(ladderState.field, ladderState.bracketSize);
    ladderState.bracketPool = ranked.filter(e => e.qualified).slice(0, ladderState.bracketSize);
  }
  const elimRoundDefs = ladderState.rounds.filter(r => r.phase === "elimination");
  const roundsResolved = Object.keys(ladderState.elimRounds).length;
  let survivors = ladderState.bracketPool.filter(e => !e.eliminated && !e.isPlayer);
  for (const roundDef of elimRoundDefs.slice(roundsResolved)) {
    if (survivors.length <= 1) break;
    const { pairs } = pairBracketRound(survivors);
    const lanes = generateLaneVariants(roundDef.conditions, ladderState.rng);
    pairs.forEach(([a, b]) => {
      const higherSeed = a.qualPosition < b.qualPosition ? a : b;
      const lowerSeed = higherSeed === a ? b : a;
      const higherLane = pickBetterLane(lanes);
      const lowerLane = higherLane === "A" ? "B" : "A";
      const resultHigher = runSimulation({ ...higherSeed.tune, ...lanes[higherLane] });
      const resultLower = runSimulation({ ...lowerSeed.tune, ...lanes[lowerLane] });
      const resultA = higherSeed === a ? resultHigher : resultLower;
      const resultB = higherSeed === a ? resultLower : resultHigher;
      const reactA = calcReactionTime(a.tune.driverAggressiveness, ladderState.rng);
      const reactB = calcReactionTime(b.tune.driverAggressiveness, ladderState.rng);
      const winner = resolveHeadToHead(reactA, resultA, reactB, resultB) === "A" ? a : b;
      const loser = winner === a ? b : a;
      loser.eliminated = true;
      loser.eliminatedRound = roundDef.roundNumber;
    });
    survivors = ladderState.bracketPool.filter(e => !e.eliminated && !e.isPlayer);
  }
  return survivors.length === 1 ? survivors[0] : null;
}

// Every rival still in the field (qualified or not) earns the same
// NHRA-style points the player does, via the same pointsForOutcome formula -
// resolveRemainingBracket above is what makes eliminatedRound/champion
// honest for AI cars whose bracket run wasn't already fully played out by
// the time the player's own event ended.
function computeRivalPointsForEvent() {
  const champion = resolveRemainingBracket();
  const totalElimRounds = totalElimRoundsFor(ladderState.bracketSize);
  const points = {};
  ladderState.field.forEach((e) => {
    if (e.isPlayer) return;
    points[e.id] = pointsForOutcome({
      qualified: e.qualified,
      champion: e === champion,
      eliminatedRound: e.eliminatedRound,
      totalElimRounds,
      qualPosition: e.qualPosition,
    });
  });
  return points;
}

// Awards prize money for how the event ended, offers 1-2 sponsor deals
// (reusing the event's own seeded rng so a given event/seed is
// reproducible), then shows the final result text. A season round also
// banks its points here (qualPosition comes off the player's own field
// entry, since outcome itself doesn't carry it - see season.js's
// pointsForOutcome), tallies rival standings, and advances the season to
// its next round.
function finishEvent(outcome, text) {
  awardEventPrize(financesState, outcome);
  if (!financesState.sponsorOffers.length) {
    const teamEffects = computeTeamEffects(teamConfig);
    financesState.sponsorOffers = generateSponsorOffers(ladderState.rng, 2 + teamEffects.teamSponsorOfferCountBonus, teamEffects.teamSponsorOfferAmountMult);
  }
  ladderState.finalResultText = text;
  if (ladderState.isSeasonRound && seasonState.active) {
    const player = ladderState.field.find(e => e.isPlayer);
    recordAttendedResult(seasonState, { ...outcome, qualPosition: player.qualPosition });
    addRivalPoints(seasonState, computeRivalPointsForEvent());
    saveSeasonState();
  }
  saveFinancesState();
  saveEventState();
  renderFinancePanel();
  renderFinalResult(text);
}

// A qualifying-round mechanical failure no longer ends the event outright -
// whatever time was already banked (player.bestEt, updated the same way
// runQualifyingAttempt already does it for every AI entrant) still stands
// and still gets evaluated normally against the field once Q4 wraps up
// (see advanceLadderRound). A broken/fatal part just means THIS run - and
// any remaining quali round the car isn't fixed in time for - can't be
// attempted; renderLadderRoundUi hides the Run button (forcing a skip)
// whenever isCarRaceReady is false, so there's no way to keep racing on a
// car that's actually out.
function runPlayerQualifying(skip) {
  const roundDef = ladderState.rounds[ladderState.roundIndex];
  const sessionIndex = roundDef.roundNumber - 1;
  const player = ladderState.field.find(e => e.isPlayer);
  applyConditions(roundDef.conditions);
  if (!skip) {
    const r = runSimulation(readSettings());
    player.quals[sessionIndex] = r;
    // finished means a real photocell ET (crossed 1000ft) - that's true
    // even when engineFailed/clutchFailed is ALSO true, since either can
    // let go right at (or just past) the stripe and the car still coasts
    // across under a time that already counted. Only a run that never
    // actually finished (or was weight-illegal) has no legitimate ET to
    // bank - a mechanical failure earlier in the run already shows up as
    // a slower et anyway, never a flattering one.
    if (r.finished && !r.weightIllegal && (player.bestEt === null || r.et < player.bestEt)) { player.bestEt = r.et; player.bestMph = r.mph; }
    ladderState.playerHistory[ladderState.roundIndex] = { result: r };
    chargePlayerRun(r);
    // Rolled and shown same as any other run, but never folded into r.et/
    // bestEt above - qualifying position is ET alone, same as real NHRA.
    const rt = calcReactionTime(+$("aggro").value, ladderState.rng, computeTeamEffects(teamConfig).teamReactionMult);
    renderRunResult(r, rt);
  } else {
    player.quals[sessionIndex] = null;
    ladderState.playerHistory[ladderState.roundIndex] = { skipped: true };
  }
  const order = ladderState.qOrder;
  const playerIdx = order.findIndex(e => e.isPlayer);
  for (let i = playerIdx + 1; i < order.length; i++) runQualifyingAttempt(order[i], sessionIndex, roundDef.conditions, false);
  renderQualiTable(roundDef);
  renderHistoryTable();
  saveEventState();
  advanceLadderRound();
}

// A bye still runs a solo pass (for the record, same as a real single) but
// always advances - there's no opponent to lose to.
function runPlayerBye() {
  const roundDef = ladderState.rounds[ladderState.roundIndex];
  applyConditions(roundDef.conditions);
  const r = runSimulation(readSettings());
  ladderState.elimRounds[ladderState.roundIndex].byeResult = r;
  ladderState.playerHistory[ladderState.roundIndex] = { result: r, bye: true };
  const { fatalParts, brokenParts } = chargePlayerRun(r);
  const rt = calcReactionTime(+$("aggro").value, ladderState.rng, computeTeamEffects(teamConfig).teamReactionMult);
  renderRunResult(r, rt);
  renderBracketTable(roundDef);
  renderHistoryTable();
  const isFinalRound = roundDef.roundNumber === totalElimRoundsFor(ladderState.bracketSize);
  if (isFinalRound) {
    ladderState.playerOutcome = "champion";
    finishEvent(
      { qualified: true, champion: true, totalElimRounds: totalElimRoundsFor(ladderState.bracketSize) },
      `Kampioen! Je won de finale van dit evenement (bye in de laatste ronde) (${ladderState.totalEntries} auto's).`
    );
  } else if (fatalParts.length || brokenParts.length) {
    ladderState.playerOutcome = "eliminated";
    finishEvent(
      { qualified: true, champion: false, eliminatedRound: roundDef.roundNumber + 1 },
      `${unusablePartsClause(fatalParts, brokenParts)} — je kreeg deze ronde een bye, maar bent niet meer race-klaar. Het evenement is voorbij voor je team.`
    );
  } else {
    advanceLadderRound();
  }
}

function runPlayerElimination() {
  const roundDef = ladderState.rounds[ladderState.roundIndex];
  const ed = ladderState.elimRounds[ladderState.roundIndex];
  const [a, b] = ed.pairs[ed.playerPairIndex];
  const player = ladderState.field.find(e => e.isPlayer);
  const playerIsA = a === player;
  const opponent = ed.playerOpponent;

  // Lane choice picked earlier (or assigned, if the opponent had the
  // pick) decides which of this round's two lane variants each side runs.
  const playerLane = ed.playerLaneChoice || pickBetterLane(ed.lanes);
  const opponentLane = playerLane === "A" ? "B" : "A";
  applyConditions(ed.lanes[playerLane]);

  const rPlayer = runSimulation(readSettings());
  const rOpponent = runSimulation({ ...opponent.tune, ...ed.lanes[opponentLane] });
  const reactPlayer = calcReactionTime(+$("aggro").value, ladderState.rng, computeTeamEffects(teamConfig).teamReactionMult);
  const reactOpponent = calcReactionTime(opponent.tune.driverAggressiveness, ladderState.rng);

  const resultA = playerIsA ? rPlayer : rOpponent;
  const resultB = playerIsA ? rOpponent : rPlayer;
  const reactA = playerIsA ? reactPlayer : reactOpponent;
  const reactB = playerIsA ? reactOpponent : reactPlayer;
  const winner = resolveHeadToHead(reactA, resultA, reactB, resultB) === "A" ? a : b;
  const loser = winner === a ? b : a;
  loser.eliminated = true;
  loser.eliminatedRound = roundDef.roundNumber;
  ed.results[ed.playerPairIndex] = { a, b, resultA, resultB, reactA, reactB, winner };
  ladderState.playerHistory[ladderState.roundIndex] = { result: rPlayer, opponent, opponentResult: rOpponent, won: winner.isPlayer };

  const { fatalParts, brokenParts } = chargePlayerRun(rPlayer);
  renderRunResult(rPlayer, reactPlayer);
  renderBracketTable(roundDef);
  renderHistoryTable();

  const isFinalRound = roundDef.roundNumber === totalElimRoundsFor(ladderState.bracketSize);
  if (winner.isPlayer) {
    if (isFinalRound) {
      ladderState.playerOutcome = "champion";
      finishEvent(
        { qualified: true, champion: true, totalElimRounds: totalElimRoundsFor(ladderState.bracketSize) },
        `Kampioen! Je won de finale van dit evenement (${ladderState.totalEntries} auto's).`
      );
    } else if (fatalParts.length || brokenParts.length) {
      ladderState.playerOutcome = "eliminated";
      finishEvent(
        { qualified: true, champion: false, eliminatedRound: roundDef.roundNumber + 1 },
        `${unusablePartsClause(fatalParts, brokenParts)} — je won deze ronde nog wel, maar bent niet meer race-klaar. Het evenement is voorbij voor je team.`
      );
    } else {
      advanceLadderRound();
    }
  } else {
    ladderState.playerOutcome = "eliminated";
    const failureNote = (fatalParts.length || brokenParts.length)
      ? ` Bovendien: ${unusablePartsClause(fatalParts, brokenParts)}.`
      : "";
    const dqNote = rPlayer.weightIllegal
      ? ` Je auto woog ${Math.round(rPlayer.weightLb)} lbs, onder het minimum van ${WEIGHT_LB_MIN} lbs — automatisch verlies ongeacht de tijd.`
      : "";
    finishEvent(
      { qualified: true, champion: false, eliminatedRound: roundDef.roundNumber },
      `Uitgeschakeld in ${roundDef.label.toLowerCase()} door ${opponent.name} (${opponent.team}).${dqNote}${failureNote}`
    );
  }
}

$("runRoundBtn").addEventListener("click", () => {
  // Guards against re-running an already-decided round: this button
  // should always be hidden in that case (see renderLadderRoundUi), but
  // never trust display state alone for something that charges money and
  // mutates results.
  if (viewingRoundIndex !== null || ladderState.playerOutcome !== null) return;
  const roundDef = ladderState.rounds[ladderState.roundIndex];
  if (roundDef.phase === "qualifying") runPlayerQualifying(false);
  else if (ladderState.elimRounds[ladderState.roundIndex].bye?.isPlayer) runPlayerBye();
  else runPlayerElimination();
});
$("skipQualBtn").addEventListener("click", () => runPlayerQualifying(true));

// ---- Financiën: budget, transacties en sponsorvoorstellen. ----

function renderSponsorOffers() {
  const el = $("sponsor-offers");
  if (!financesState.sponsorOffers.length) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="sec-title" style="font-size:13px; border-top:none; padding-top:0; margin-top:16px;">Sponsorvoorstellen</div>` +
    financesState.sponsorOffers.map(o => `
      <div class="row" style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
        <span>${escapeHtml(o.name)} biedt €${o.amount.toLocaleString("nl-NL")}</span>
        <span style="display:flex; gap:6px;">
          <button class="secondary" style="margin:0; width:auto;" data-accept="${escapeHtml(o.id)}">Accepteren</button>
          <button class="secondary" style="margin:0; width:auto;" data-decline="${escapeHtml(o.id)}">Afwijzen</button>
        </span>
      </div>`).join("");
}

function renderFinanceTable() {
  $("finance-table-body").innerHTML = financesState.transactions.map(t => {
    const color = t.amount > 0 ? "var(--green)" : (t.amount < 0 ? "var(--red)" : "var(--muted)");
    const amtTxt = (t.amount > 0 ? "+" : "") + "€" + t.amount.toLocaleString("nl-NL");
    return `<tr><td>${escapeHtml(t.label)}</td><td style="color:${color};">${amtTxt}</td><td>€${t.balance.toLocaleString("nl-NL")}</td></tr>`;
  }).join("");
}

function renderFinancePanel() {
  $("fin-budget").textContent = "€" + financesState.budget.toLocaleString("nl-NL");
  $("fin-budget").style.color = financesState.budget < 0 ? "var(--red)" : "var(--text)";
  renderSponsorOffers();
  renderFinanceTable();
}

$("sponsor-offers").addEventListener("click", (e) => {
  const acceptId = e.target.dataset.accept;
  const declineId = e.target.dataset.decline;
  if (acceptId) {
    const offer = financesState.sponsorOffers.find(o => o.id === acceptId);
    if (offer) addTransaction(financesState, `Sponsorbijdrage — ${offer.name}`, offer.amount);
    financesState.sponsorOffers = financesState.sponsorOffers.filter(o => o.id !== acceptId);
    saveFinancesState();
    renderFinancePanel();
  } else if (declineId) {
    financesState.sponsorOffers = financesState.sponsorOffers.filter(o => o.id !== declineId);
    saveFinancesState();
    renderFinancePanel();
  }
});

// ---- Auto bouwen: motor/kop/blower/koppeling/brandstofpomp merken,
// chassis- en tankkeuzes. Elk van de vijf onderdelen (PARTS in garage.js)
// heeft een gemonteerde eenheid (brand + secondhand) en een eigen voorraad
// reserve-eenheden die best een ANDER merk of staat mogen zijn - dat is de
// hele clou van de voorraad-UI hieronder. Chassis (lengte + body) is een
// zesde, apart aangekocht onderdeel zonder merken - zie renderChassisSection
// hieronder. ----

const PART_LIST = Object.keys(PARTS);

function populateGarageSelects() {
  PART_LIST.forEach(part => {
    const optionsHtml = PARTS[part].brands.map(b => `<option value="${b.id}">${escapeHtml(b.name)} — €${b.priceNew.toLocaleString("nl-NL")}</option>`).join("");
    $(`g-${part}-spare-brand`).innerHTML = optionsHtml;
  });
  $("g-trailer-select").innerHTML = TRAILER_TYPES.map(t =>
    `<option value="${t.id}">${escapeHtml(t.name)} — €${t.priceNew.toLocaleString("nl-NL")}, ${t.spareCapacity} reserve-onderdelen</option>`
  ).join("");
  // Priced inline (not just "goedkoper"/"duurder" in prose) so the retrofit
  // cost of switching (see the g-blower-type change handler) is visible
  // right on the dropdown itself, not only after the fact in a transaction.
  $("g-blower-type").innerHTML = Object.entries(BLOWER_TYPES).map(([id, t]) =>
    `<option value="${id}">${escapeHtml(t.name)}${t.priceDelta > 0 ? ` (+€${t.priceDelta.toLocaleString("nl-NL")})` : ""}</option>`
  ).join("");
}

populateGarageSelects();
$("clutch-max-runs-note").textContent = CLUTCH_PACK_MAX_RUNS;

// Klikken op een onderdeel in de dragster-tekening springt naar (en licht
// even op) de bijbehorende sectie in het Auto bouwen-paneel.
document.querySelectorAll("#dragster-diagram .diagram-part").forEach(el => {
  el.addEventListener("click", () => {
    const section = $(el.dataset.target);
    if (!section) return;
    section.scrollIntoView({ behavior: "smooth", block: "center" });
    section.classList.remove("flash");
    void section.offsetWidth; // force reflow so a repeated click re-triggers the animation
    section.classList.add("flash");
    setTimeout(() => section.classList.remove("flash"), 1200);
  });
});

function applyGarageConfigToForm() {
  $("g-blower-type").value = garageConfig.blowerType;
  $("g-body-material").value = garageConfig.bodyMaterial;
  $("g-chassis-length").value = garageConfig.chassisLengthIn;
  $("g-chassis-length").disabled = garageConfig.chassisOwned;
  $("g-tank-size").value = garageConfig.tankSizeGal;
  $("g-tank-position").value = garageConfig.tankPosition;
  $("g-mudflaps").checked = garageConfig.mudflaps;
  $("g-engine-position").value = garageConfig.enginePositionIn;
  $("g-clutch-bearing").value = garageConfig.clutchBearingAdjSteps;
}

function readGarageConfigFromForm() {
  garageConfig.tankSizeGal = +$("g-tank-size").value;
  garageConfig.tankPosition = $("g-tank-position").value;
  garageConfig.mudflaps = $("g-mudflaps").checked;
  garageConfig.enginePositionIn = +$("g-engine-position").value;
  garageConfig.clutchBearingAdjSteps = +$("g-clutch-bearing").value;
}

// "3 mnd oud" / "2 jr 4 mnd oud" / "Nieuw" for ageMonths: 0 - shared by
// every place a unit's age needs to be shown to the player (equipped
// line, inventory table, market listings).
function formatAgeMonths(ageMonths) {
  if (!ageMonths) return "nieuw";
  if (ageMonths < 12) return `${ageMonths} mnd oud`;
  const years = Math.floor(ageMonths / 12);
  const months = ageMonths % 12;
  return months ? `${years} jr ${months} mnd oud` : `${years} jr oud`;
}

// Renders one part's spare inventory as a small table: brand, age, and a
// "Monteer" button to swap it in for whatever's currently equipped (which
// goes back into the inventory slot it came from, not discarded - see
// installUnit in garage.js). Visibility into "what do I actually own" is
// the direct ask: the equipped select above only ever shows ONE unit,
// this shows the rest, brand and all.
function renderPartInventoryList(part) {
  const inv = garageConfig[part + "Inventory"];
  const container = $(`g-${part}-inventory-list`);
  if (!inv.length) {
    container.innerHTML = `<p class="note" style="margin-top:0;">Geen reserve op voorraad.</p>`;
    return;
  }
  const rows = inv.map((unit, i) => {
    const brand = findBrand(PARTS[part].brands, unit.brandId);
    return `<tr><td>${escapeHtml(brand.name)}</td><td>${formatAgeMonths(unit.ageMonths)}</td><td>€${unitPrice(part, unit).toLocaleString("nl-NL")}</td>` +
      `<td><button class="secondary mini-btn" type="button" data-install-part="${part}" data-install-idx="${i}">Monteer</button></td>` +
      `<td><button class="secondary mini-btn" type="button" data-sell-spare-part="${part}" data-sell-spare-idx="${i}">Verkoop (+€${sellSpareUnitValue(part, unit).toLocaleString("nl-NL")})</button></td></tr>`;
  }).join("");
  container.innerHTML = `<table class="event-table"><thead><tr><th>Merk (reserve)</th><th>Leeftijd</th><th>Waarde</th><th></th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

// The used-parts market for this one part: whatever's currently listed
// (see garage.js's generateUsedMarket), each a specific brand at a
// specific age with its own price and reliability derived from that age -
// not a flat "tweedehands" checkbox next to the brand picker. A bought
// listing disappears from the table (see buyUsedListing) until the next
// event start refreshes the stock.
function renderPartMarketList(part) {
  const listings = marketState[part] || [];
  const container = $(`g-${part}-market-list`);
  if (!listings.length) {
    container.innerHTML = `<p class="note" style="margin-top:0;">Geen tweedehands aanbod op dit moment - de markt ververst bij het volgende evenement.</p>`;
    return;
  }
  const rows = listings.map(listing => {
    const brand = findBrand(PARTS[part].brands, listing.brandId);
    const price = unitPrice(part, listing);
    const relPct = Math.round(brand.reliabilityMult * usedReliabilityMult(listing.ageMonths) * 100);
    return `<tr><td>${escapeHtml(brand.name)}</td><td>${formatAgeMonths(listing.ageMonths)}</td><td>€${price.toLocaleString("nl-NL")}</td><td>${relPct}%</td>` +
      `<td><button class="secondary mini-btn" type="button" data-buy-listing-part="${part}" data-buy-listing-id="${escapeHtml(listing.id)}">Kopen</button></td></tr>`;
  }).join("");
  container.innerHTML = `<table class="event-table"><thead><tr><th>Merk</th><th>Leeftijd</th><th>Prijs</th><th>Betrouwbaarheid</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

// Per-part readonly "what's mounted" line, plus the buy button's label -
// "X kopen" for a first purchase (becomes equipped directly), "Reserve X
// kopen" once something's already mounted (goes to inventory instead,
// capacity permitting - see buyUnit in garage.js). Also renders the
// condition readout (estimatePartCondition - deliberately fuzzy, see
// garage.js) and, when the part is broken (markPartBroken - mounted but
// unusable until repaired), the repair note/button.
function renderPartEquippedStatus(part) {
  const owned = isPartOwned(garageConfig, part);
  const label = spareLabel(part);
  const capLabel = label[0].toUpperCase() + label.slice(1);
  const conditionEl = $(`g-${part}-condition`);
  const repairBtn = $(`g-repair-${part}`);
  const sellBtn = $(`g-sell-${part}`);
  if (owned) {
    const unit = equippedUnit(garageConfig, part);
    const brand = findBrand(PARTS[part].brands, unit.brandId);
    const runsTxt = part === "clutchPack" ? ` — ${garageConfig.clutchPackRunsUsed}/${CLUTCH_PACK_MAX_RUNS} runs op dit pakket.` : "";
    $(`g-${part}-equipped`).textContent = `Gemonteerd: ${brand.name} (${formatAgeMonths(unit.ageMonths)}).${runsTxt}`;
    const exhausted = part === "clutchPack" && isPackExhausted(garageConfig);
    const broken = isPartBroken(garageConfig, part);
    if (exhausted) {
      // Worn-out friction material isn't something the "Repareer" action
      // fixes (see isPartRepairable/CLUTCH_PACK_MAX_RUNS) - only a fresh
      // physical pack (spare, new build, or new-used listing) gets the car
      // raceable again, so no repair button here even if it's ALSO
      // currently heat-broken.
      conditionEl.innerHTML = `<span style="color:var(--red)">Koppelingsplaten versleten (${garageConfig.clutchPackRunsUsed}/${CLUTCH_PACK_MAX_RUNS} runs) — geen reparatie meer mogelijk, monteer een reserve of koop een nieuw(e) (tweedehands) pakket.</span>`;
      repairBtn.style.display = "none";
    } else if (broken) {
      conditionEl.innerHTML = `<span style="color:var(--red)">Kapot — niet meer inzetbaar tot reparatie.</span>`;
      const cost = Math.round(equippedPartPrice(garageConfig, part) * REPAIR_FRACTION[part]);
      repairBtn.style.display = "block";
      repairBtn.textContent = `${capLabel} repareren (~€${cost.toLocaleString("nl-NL")})`;
    } else {
      const c = estimatePartCondition(garageConfig[`${part}Wear`]);
      const color = c.cls === "ok" ? "var(--green)" : c.cls === "warn" ? "var(--amber)" : "var(--red)";
      conditionEl.innerHTML = `Conditie: <span style="color:${color}">${c.label} (~${c.rangeLow}-${c.rangeHigh}%)</span>`;
      repairBtn.style.display = "none";
    }
  } else {
    $(`g-${part}-equipped`).textContent = `Geen ${label} gemonteerd.`;
    conditionEl.textContent = "";
    repairBtn.style.display = "none";
  }
  // Sellable regardless of condition (broken, exhausted, or fine) - even
  // scrap is worth something, see finances.js's sellEquippedPart.
  if (owned) {
    sellBtn.style.display = "block";
    sellBtn.textContent = `${capLabel} verkopen (+€${sellEquippedUnitValue(garageConfig, part).toLocaleString("nl-NL")})`;
  } else {
    sellBtn.style.display = "none";
  }
  $(`g-buy-${part}-spare`).textContent = owned ? `Reserve ${label} kopen (nieuw)` : `${capLabel} kopen (nieuw)`;
}

// Chassis is bought, not dialed in for free (see garage.js's chassisOwned/
// buildNewChassis/buySecondhandChassis/buyNewBody): before it's owned, the
// length slider is a live draft for a custom build (still enabled, still
// gated to the NHRA range by its own min/max) and the build/market blocks
// show; once owned, the length is fixed for good (slider disabled) and only
// the body-swap block stays live - a new body can still be bought any time,
// on either a custom or secondhand chassis, without touching the length.
function renderChassisSection() {
  const owned = garageConfig.chassisOwned;
  $("g-chassis-length").disabled = owned;
  $("g-chassis-build-block").style.display = owned ? "none" : "block";
  $("g-chassis-owned-block").style.display = owned ? "block" : "none";

  if (owned) {
    $("g-chassis-equipped").textContent = `Chassis: ${garageConfig.chassisLengthIn}" — lengte ligt vast.`;
    $("g-sell-chassis").textContent = `Chassis verkopen (+€${sellChassisValue(garageConfig).toLocaleString("nl-NL")})`;
  } else {
    $("g-chassis-equipped").textContent = "Geen chassis gemonteerd — geen run of evenement mogelijk.";
    const bodyId = $("g-chassis-build-body").value;
    $("g-build-chassis").textContent = `Chassis laten bouwen (€${chassisBuildPrice(bodyId).toLocaleString("nl-NL")})`;
  }

  const listings = marketState.chassis || [];
  const marketContainer = $("g-chassis-market-list");
  if (owned) {
    marketContainer.innerHTML = "";
  } else if (!listings.length) {
    marketContainer.innerHTML = `<p class="note" style="margin-top:0;">Geen tweedehands aanbod op dit moment - de markt ververst bij het volgende evenement.</p>`;
  } else {
    const rows = listings.map(listing => {
      const price = chassisListingPrice(listing);
      const bodyName = BODY_MATERIALS[listing.bodyMaterial].name;
      return `<tr><td>${listing.lengthIn}"</td><td>${escapeHtml(bodyName)}</td><td>${formatAgeMonths(listing.ageMonths)}</td><td>€${price.toLocaleString("nl-NL")}</td>` +
        `<td><button class="secondary mini-btn" type="button" data-buy-chassis-listing="${escapeHtml(listing.id)}">Kopen</button></td></tr>`;
    }).join("");
    marketContainer.innerHTML = `<table class="event-table"><thead><tr><th>Lengte</th><th>Body</th><th>Leeftijd</th><th>Prijs</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  const bodyOwned = owned;
  const currentBodyName = BODY_MATERIALS[garageConfig.bodyMaterial].name;
  const selectedBody = $("g-body-material").value;
  $("g-buy-body").disabled = !bodyOwned;
  $("g-buy-body").textContent = selectedBody === garageConfig.bodyMaterial
    ? `Body is al ${currentBodyName.toLowerCase()}`
    : `Nieuwe body kopen (€${BODY_MATERIALS[selectedBody].priceNew.toLocaleString("nl-NL")})`;
}

function renderGarageSummary() {
  $("v-g-chassis-length").textContent = garageConfig.chassisLengthIn + '"';
  $("v-g-tank-size").textContent = garageConfig.tankSizeGal + " gal";
  $("v-g-engine-position").textContent = garageConfig.enginePositionIn;
  $("v-g-clutch-bearing").textContent = garageConfig.clutchBearingAdjSteps;
  PART_LIST.forEach(part => { renderPartEquippedStatus(part); renderPartInventoryList(part); renderPartMarketList(part); });
  renderChassisSection();

  if (garageConfig.trailerId) {
    const trailer = findBrand(TRAILER_TYPES, garageConfig.trailerId);
    $("g-trailer-equipped").textContent = `Trailer: ${trailer.name} — ${trailer.spareCapacity} reserve-onderdelen.`;
    $("g-buy-trailer").textContent = "Andere trailer kopen";
    $("g-sell-trailer").style.display = "block";
    $("g-sell-trailer").textContent = `Trailer verkopen (+€${sellTrailerValue(garageConfig).toLocaleString("nl-NL")})`;
  } else {
    $("g-trailer-equipped").textContent = "Geen trailer — geen evenement mogelijk, en geen ruimte voor reserve-onderdelen.";
    $("g-buy-trailer").textContent = "Trailer kopen";
    $("g-sell-trailer").style.display = "none";
  }
  const spareCount = totalSpareCount(garageConfig);
  const spareCap = trailerSpareCapacity(garageConfig);
  $("g-spare-capacity").textContent = `${spareCount}/${spareCap}`;
  $("g-spare-capacity").style.color = spareCount >= spareCap ? "var(--red)" : "var(--text)";

  $("garage-readiness-note").innerHTML = isCarRaceReady(garageConfig)
    ? `<span style="color:var(--green)">Klaar om te racen: chassis, motor, koppen, blower, koppeling, koppelingspakket, brandstofpomp en trailer zijn allemaal aanwezig en niets staat kapot.</span>`
    : `<span style="color:var(--red)">Nog niet klaar om te racen — koop hieronder wat ontbreekt (motor, koppen, blower, koppeling, koppelingspakket, brandstofpomp, trailer, chassis), en repareer eventueel kapotte onderdelen, voor je een run of evenement kunt starten.</span>`;

  $("g-build-value").textContent = "€" + totalBuildValue(garageConfig).toLocaleString("nl-NL");
  const effects = computeGarageEffects(garageConfig);
  $("g-tank-capacity-hint").textContent = `Bruikbare wedstrijdbrandstof: ${effects.garageTankUsableGal.toFixed(1)} gal (van de ${garageConfig.tankSizeGal} gal totaal - de rest is lijnen/aanzuigreserve). Een gemiddelde pass verbruikt grofweg 6-9 gal, afhankelijk van blower, nitro% en de brandstofcurve - te weinig marge en de motor loopt tijdens de run droog.`;
  const wd = Math.round(effects.garageWeightDeltaLb);
  $("g-weight-delta").textContent = (wd > 0 ? "+" : "") + wd + " lb";
  $("g-power-mult").textContent = Math.round(effects.garagePowerMult * 100) + "%";
  $("g-reliability-mult").textContent = Math.round((1 / effects.garageEngineDamageMult) * 100) + "%";
  $("g-clutch-reliability-mult").textContent = Math.round(computeClutchReliabilityMult(garageConfig) * 100) + "%";
  $("g-fuelpump-gpm").textContent = effects.garageFuelPumpGpm.toFixed(0) + " gpm";

  const ballastFrontLb = +$("ballfront").value;
  const ballastRearLb = +$("ballrear").value;
  const totalWeightLb = WEIGHT_LB_MIN + effects.garageWeightDeltaLb + ballastFrontLb + ballastRearLb;
  const dist = computeWeightDistribution(totalWeightLb, ballastFrontLb, ballastRearLb, garageConfig.enginePositionIn, effects.garageTankPositionShiftLb);
  $("g-total-weight").textContent = Math.round(totalWeightLb) + " lb";
  $("g-total-weight").style.color = totalWeightLb < WEIGHT_LB_MIN ? "var(--red)" : "var(--text)";
  $("g-front-weight").textContent = Math.round(dist.frontLb) + ` lb (${dist.frontPct.toFixed(0)}%)`;
  $("g-rear-weight").textContent = Math.round(dist.rearLb) + ` lb (${dist.rearPct.toFixed(0)}%)`;
  $("g-weight-legal-note").innerHTML = totalWeightLb < WEIGHT_LB_MIN
    ? `<span style="color:var(--red)">Ondergewicht: ${Math.round(WEIGHT_LB_MIN - totalWeightLb)} lb onder het minimum van ${WEIGHT_LB_MIN} lb — dit is een DQ tenzij je bijlegt met ballast of zwaardere onderdelen.</span>`
    : `Zit ${Math.round(totalWeightLb - WEIGHT_LB_MIN)} lb boven het minimumgewicht van ${WEIGHT_LB_MIN} lb (NHRA-reglement).`;
}

function renderGaragePanel() {
  applyGarageConfigToForm();
  renderGarageSummary();
}

const GARAGE_FORM_IDS = [
  "g-tank-size", "g-tank-position",
  "g-mudflaps", "g-engine-position",
  "g-clutch-bearing",
];
GARAGE_FORM_IDS.forEach(id => {
  $(id).addEventListener("input", () => {
    readGarageConfigFromForm();
    saveGarageConfig();
    renderGarageSummary();
  });
});
// Ballast lives on the Chassis/setup tune panel, not the garage form, but
// the weight-per-band readout above needs to react to it too.
["ballfront", "ballrear"].forEach(id => {
  $(id).addEventListener("input", renderGarageSummary);
});

// Blower type is a purchasable modification, not a free toggle (a setback
// blower's extra cost, see garage.js's BLOWER_TYPES, only means anything if
// switching to it actually charges the difference) - switching either
// direction costs the absolute difference between the two types' priceDelta,
// same budget gate as every other purchase, and reverts the select if the
// budget doesn't cover it.
$("g-blower-type").addEventListener("input", () => {
  const newType = $("g-blower-type").value;
  const oldType = garageConfig.blowerType;
  if (newType === oldType) return;
  const cost = Math.abs(BLOWER_TYPES[newType].priceDelta - BLOWER_TYPES[oldType].priceDelta);
  if (financesState.budget < cost) {
    $("garage-status").textContent = `Onvoldoende budget om over te schakelen naar ${BLOWER_TYPES[newType].name} (€${cost.toLocaleString("nl-NL")} nodig, €${financesState.budget.toLocaleString("nl-NL")} beschikbaar).`;
    $("g-blower-type").value = oldType;
    return;
  }
  if (cost > 0) addTransaction(financesState, `Blower omgebouwd naar ${BLOWER_TYPES[newType].name}`, -cost);
  garageConfig.blowerType = newType;
  saveFinancesState();
  saveGarageConfig();
  renderGarageSummary();
  renderFinancePanel();
  $("garage-status").textContent = cost > 0
    ? `Blower omgebouwd naar ${BLOWER_TYPES[newType].name} voor €${cost.toLocaleString("nl-NL")}.`
    : `Blower omgezet naar ${BLOWER_TYPES[newType].name}.`;
});

// Chassis length: a live draft for the custom build below until a chassis
// is actually bought (see renderChassisSection - the slider is disabled the
// moment garageConfig.chassisOwned is true, so this listener only ever
// fires pre-purchase).
$("g-chassis-length").addEventListener("input", () => {
  garageConfig.chassisLengthIn = +$("g-chassis-length").value;
  renderGarageSummary();
});

// Re-render on either selector change just to refresh the dependent price
// labels (build price depends on the chosen body, buy-body's label depends
// on whether the selection differs from what's currently mounted) - neither
// charges anything by itself, only the buttons below do.
$("g-chassis-build-body").addEventListener("input", renderGarageSummary);
$("g-body-material").addEventListener("input", renderGarageSummary);

$("g-build-chassis").addEventListener("click", () => {
  if (garageConfig.chassisOwned) return;
  const bodyId = $("g-chassis-build-body").value;
  const lengthIn = +$("g-chassis-length").value;
  const price = chassisBuildPrice(bodyId);
  if (financesState.budget < price) {
    $("garage-status").textContent = `Onvoldoende budget (€${price.toLocaleString("nl-NL")} nodig, €${financesState.budget.toLocaleString("nl-NL")} beschikbaar).`;
    return;
  }
  buildNewChassis(garageConfig, lengthIn, bodyId);
  addTransaction(financesState, `Chassis laten bouwen (${lengthIn}", ${BODY_MATERIALS[bodyId].name})`, -price);
  saveFinancesState();
  saveGarageConfig();
  renderGarageSummary();
  renderFinancePanel();
  $("garage-status").textContent = `Chassis gebouwd (${lengthIn}", ${BODY_MATERIALS[bodyId].name}) voor €${price.toLocaleString("nl-NL")}.`;
});

$("g-chassis-market-list").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-buy-chassis-listing]");
  if (!btn || garageConfig.chassisOwned) return;
  const listingId = btn.dataset.buyChassisListing;
  const listings = marketState.chassis || [];
  const idx = listings.findIndex(l => l.id === listingId);
  if (idx === -1) return;
  const listing = listings[idx];
  const price = chassisListingPrice(listing);
  if (financesState.budget < price) {
    $("garage-status").textContent = `Onvoldoende budget (€${price.toLocaleString("nl-NL")} nodig, €${financesState.budget.toLocaleString("nl-NL")} beschikbaar).`;
    return;
  }
  buySecondhandChassis(garageConfig, listing);
  addTransaction(financesState, `Chassis gekocht (tweedehands, ${listing.lengthIn}", ${BODY_MATERIALS[listing.bodyMaterial].name}, ${formatAgeMonths(listing.ageMonths)})`, -price);
  listings.splice(idx, 1);
  saveFinancesState();
  saveGarageConfig();
  saveMarketState();
  applyGarageConfigToForm();
  renderGarageSummary();
  renderFinancePanel();
  $("garage-status").textContent = `Chassis gekocht (tweedehands, ${listing.lengthIn}", ${BODY_MATERIALS[listing.bodyMaterial].name}) voor €${price.toLocaleString("nl-NL")}.`;
});

$("g-buy-body").addEventListener("click", () => {
  if (!garageConfig.chassisOwned) return;
  const bodyId = $("g-body-material").value;
  if (bodyId === garageConfig.bodyMaterial) return;
  const price = BODY_MATERIALS[bodyId].priceNew;
  if (financesState.budget < price) {
    $("garage-status").textContent = `Onvoldoende budget (€${price.toLocaleString("nl-NL")} nodig, €${financesState.budget.toLocaleString("nl-NL")} beschikbaar).`;
    return;
  }
  buyNewBody(garageConfig, bodyId);
  addTransaction(financesState, `Nieuwe body gekocht (${BODY_MATERIALS[bodyId].name})`, -price);
  saveFinancesState();
  saveGarageConfig();
  renderGarageSummary();
  renderFinancePanel();
  $("garage-status").textContent = `Nieuwe body (${BODY_MATERIALS[bodyId].name}) gekocht en gemonteerd voor €${price.toLocaleString("nl-NL")}.`;
});

$("g-sell-chassis").addEventListener("click", () => {
  if (!sellChassisUnitTransaction(financesState, garageConfig)) return;
  saveFinancesState();
  saveGarageConfig();
  renderGarageSummary();
  renderFinancePanel();
  $("garage-status").textContent = "Chassis verkocht.";
});

// "Monteer" and market "Kopen" buttons are both re-rendered on every
// summary refresh, so delegate their clicks from a stable ancestor
// instead of binding per-button.
$("garagePanel").addEventListener("click", (e) => {
  const installBtn = e.target.closest("[data-install-part]");
  if (installBtn) {
    const part = installBtn.dataset.installPart;
    const idx = +installBtn.dataset.installIdx;
    installUnit(garageConfig, part, idx);
    saveGarageConfig();
    applyGarageConfigToForm();
    renderGarageSummary();
    const label = spareLabel(part);
    $("garage-status").textContent = `${label[0].toUpperCase()}${label.slice(1)} gewisseld.`;
    return;
  }
  const buyListingBtn = e.target.closest("[data-buy-listing-part]");
  if (buyListingBtn) buyUsedListing(buyListingBtn.dataset.buyListingPart, buyListingBtn.dataset.buyListingId);
  const sellSpareBtn = e.target.closest("[data-sell-spare-part]");
  if (sellSpareBtn) {
    const part = sellSpareBtn.dataset.sellSparePart;
    const idx = +sellSpareBtn.dataset.sellSpareIdx;
    if (!sellSparePartUnit(financesState, garageConfig, part, idx)) return;
    saveFinancesState();
    saveGarageConfig();
    renderGarageSummary();
    renderFinancePanel();
    const label = spareLabel(part);
    $("garage-status").textContent = `Reserve ${label} verkocht.`;
  }
});

// Buys a brand-new unit of whatever brand is picked in that part's
// mini-form - always ageMonths: 0, full price, full reliability. A team
// that doesn't own this part yet gets it mounted directly (a first engine
// isn't a "spare" of nothing); otherwise it's a spare, capped by the
// trailer's capacity - see buyUnit in garage.js for which case applies
// and why. Buying a USED unit instead goes through the market listings
// below (buyUsedListing) - a used unit is a specific age the player picks
// from what's currently available, not a checkbox next to any brand.
function buyPart(part) {
  const unit = { brandId: $(`g-${part}-spare-brand`).value, ageMonths: 0 };
  const price = unitPrice(part, unit);
  const wasOwned = isPartOwned(garageConfig, part);
  if (wasOwned && totalSpareCount(garageConfig) >= trailerSpareCapacity(garageConfig)) {
    $("garage-status").textContent = trailerSpareCapacity(garageConfig) === 0
      ? `Geen trailer — koop er eerst een voor je reserve-onderdelen kunt meenemen.`
      : `Trailer vol (${totalSpareCount(garageConfig)}/${trailerSpareCapacity(garageConfig)} reserve-onderdelen) — koop een grotere trailer voor meer ruimte.`;
    return;
  }
  if (financesState.budget < price) {
    $("garage-status").textContent = `Onvoldoende budget (€${price.toLocaleString("nl-NL")} nodig, €${financesState.budget.toLocaleString("nl-NL")} beschikbaar).`;
    return;
  }
  const brandName = findBrand(PARTS[part].brands, unit.brandId).name;
  const outcome = buyUnit(garageConfig, part, unit);
  const label = spareLabel(part);
  addTransaction(financesState, `${wasOwned ? "Reserve " : ""}${label} gekocht (${brandName}, nieuw)`, -price);
  saveFinancesState();
  saveGarageConfig();
  renderGarageSummary();
  renderFinancePanel();
  $("garage-status").textContent = outcome === "equipped"
    ? `${label[0].toUpperCase()}${label.slice(1)} (${brandName}, nieuw) gekocht en gemonteerd voor €${price.toLocaleString("nl-NL")}.`
    : `Reserve ${label} (${brandName}, nieuw) gekocht voor €${price.toLocaleString("nl-NL")}.`;
}
PART_LIST.forEach(part => $(`g-buy-${part}-spare`).addEventListener("click", () => buyPart(part)));

// Explicit, player-initiated fix for a broken part (see finances.js's
// repairPartUnit - the only place a broken part ever gets un-broken now,
// no more automatic repair-on-failure). Pays the same repair cost the old
// auto-repair used, and resets the part's wear as part of the rebuild.
function repairPart(part) {
  const label = spareLabel(part);
  if (!repairPartUnit(financesState, garageConfig, part)) return;
  saveFinancesState();
  saveGarageConfig();
  renderGarageSummary();
  renderFinancePanel();
  $("garage-status").textContent = `${label[0].toUpperCase()}${label.slice(1)} gerepareerd — weer inzetbaar.`;
}
PART_LIST.forEach(part => $(`g-repair-${part}`).addEventListener("click", () => repairPart(part)));

// Sells the currently mounted unit (see finances.js's sellEquippedPart) -
// works regardless of condition, leaves the slot empty same as any other
// missing part (isCarRaceReady already covers that).
function sellPart(part) {
  const label = spareLabel(part);
  if (!sellEquippedPart(financesState, garageConfig, part)) return;
  saveFinancesState();
  saveGarageConfig();
  renderGarageSummary();
  renderFinancePanel();
  $("garage-status").textContent = `${label[0].toUpperCase()}${label.slice(1)} verkocht.`;
}
PART_LIST.forEach(part => $(`g-sell-${part}`).addEventListener("click", () => sellPart(part)));

// Buys a specific used listing off the market (see garage.js's
// generateUsedMarket) - same budget/capacity gates as a new purchase, but
// the unit's price and reliability come from its actual listed age
// (unitPrice/usedReliabilityMult), not a flat secondhand discount. The
// listing is removed from the market on purchase (it's sold, not an
// infinitely-repeatable offer) - the stock only comes back at the next
// event start (see the startEventBtn handler).
function buyUsedListing(part, listingId) {
  const listings = marketState[part] || [];
  const idx = listings.findIndex(l => l.id === listingId);
  if (idx === -1) return;
  const listing = listings[idx];
  const price = unitPrice(part, listing);
  const wasOwned = isPartOwned(garageConfig, part);
  if (wasOwned && totalSpareCount(garageConfig) >= trailerSpareCapacity(garageConfig)) {
    $("garage-status").textContent = trailerSpareCapacity(garageConfig) === 0
      ? `Geen trailer — koop er eerst een voor je reserve-onderdelen kunt meenemen.`
      : `Trailer vol (${totalSpareCount(garageConfig)}/${trailerSpareCapacity(garageConfig)} reserve-onderdelen) — koop een grotere trailer voor meer ruimte.`;
    return;
  }
  if (financesState.budget < price) {
    $("garage-status").textContent = `Onvoldoende budget (€${price.toLocaleString("nl-NL")} nodig, €${financesState.budget.toLocaleString("nl-NL")} beschikbaar).`;
    return;
  }
  const brandName = findBrand(PARTS[part].brands, listing.brandId).name;
  const ageTxt = formatAgeMonths(listing.ageMonths);
  const unit = { brandId: listing.brandId, ageMonths: listing.ageMonths };
  const outcome = buyAndEquipUnit(garageConfig, part, unit);
  const label = spareLabel(part);
  addTransaction(financesState, `${label} gekocht (${brandName}, tweedehands, ${ageTxt})${wasOwned ? " - gemonteerd, oude vervangen" : ""}`, -price);
  listings.splice(idx, 1);
  saveFinancesState();
  saveGarageConfig();
  saveMarketState();
  applyGarageConfigToForm();
  renderGarageSummary();
  renderFinancePanel();
  $("garage-status").textContent = outcome === "swapped"
    ? `${label[0].toUpperCase()}${label.slice(1)} (${brandName}, tweedehands, ${ageTxt}) gekocht en gemonteerd voor €${price.toLocaleString("nl-NL")} - het vorige onderdeel ging naar de reservevoorraad.`
    : `${label[0].toUpperCase()}${label.slice(1)} (${brandName}, tweedehands, ${ageTxt}) gekocht en gemonteerd voor €${price.toLocaleString("nl-NL")}.`;
}

$("g-buy-trailer").addEventListener("click", () => {
  const trailerId = $("g-trailer-select").value;
  const trailer = findBrand(TRAILER_TYPES, trailerId);
  if (financesState.budget < trailer.priceNew) {
    $("garage-status").textContent = `Onvoldoende budget (€${trailer.priceNew.toLocaleString("nl-NL")} nodig, €${financesState.budget.toLocaleString("nl-NL")} beschikbaar).`;
    return;
  }
  addTransaction(financesState, `Trailer gekocht (${trailer.name})`, -trailer.priceNew);
  garageConfig.trailerId = trailerId;
  saveFinancesState();
  saveGarageConfig();
  renderGarageSummary();
  renderFinancePanel();
  $("garage-status").textContent = `Trailer (${trailer.name}) gekocht voor €${trailer.priceNew.toLocaleString("nl-NL")}.`;
});

$("g-sell-trailer").addEventListener("click", () => {
  if (!sellTrailerUnitTransaction(financesState, garageConfig)) return;
  saveFinancesState();
  saveGarageConfig();
  renderGarageSummary();
  renderFinancePanel();
  $("garage-status").textContent = "Trailer verkocht.";
});

// ---- Team bouwen: rijder, car chief, sponsor-scout - dezelfde
// merk/prijs-catalogus-opzet als Auto bouwen (zie garage.js), maar dan
// mensen in plaats van onderdelen. Geen voorraadsysteem: er is op elk
// moment hooguit één iemand per rol aangenomen, direct te vervangen (geen
// ontslagvergoeding). In plaats van een aankoopprijs kost elke hire een
// terugkerend salaris per evenement (chargeTeamWages, samen met het
// inschrijfgeld) - een pay driver heeft een NEGATIEF salaris (brengt
// sponsorgeld mee in plaats van dat hij kost). ----

const TEAM_ROLE_LIST = Object.keys(TEAM_ROLES);

function populateTeamSelects() {
  TEAM_ROLE_LIST.forEach(role => {
    const optionsHtml = TEAM_ROLES[role].list.map(m => {
      const wageTxt = m.salaryPerEvent >= 0
        ? `€${m.salaryPerEvent.toLocaleString("nl-NL")}/evenement`
        : `brengt €${Math.abs(m.salaryPerEvent).toLocaleString("nl-NL")}/evenement mee`;
      return `<option value="${m.id}">${escapeHtml(m.name)} — ${wageTxt}</option>`;
    }).join("");
    $(`team-${role}-select`).innerHTML = optionsHtml;
  });
}
populateTeamSelects();
renderRijderTeamNote();

function renderRijderTeamNote() {
  const driverId = teamConfig.driverId;
  const el = $("rijder-team-note");
  if (!el) return;
  if (!driverId) {
    el.textContent = "Geen rijder aangenomen (zie Team bouwen) - de instellingen hierboven worden 1-op-1 uitgevoerd, geen extra ruis of vertraging.";
    return;
  }
  const driver = findTeamMember(TEAM_ROLES.driver.list, driverId);
  if (!driver) return;
  el.textContent = `Actieve rijder: ${driver.name} — reactietijd ×${driver.reactionMult.toFixed(2)}, autobeheersing ×${driver.carControlMult.toFixed(2)}, precisie/discipline ×${driver.disciplineMult.toFixed(2)}. Discipline onder de 1.0 laat 'm het "Gas dicht op"-punt hierboven met tot zo'n 300 ft missen (later van het gas, meer slijtage/risico) - hoe verder onder 1.0, hoe verder hij het mist.`;
}

function renderTeamPanel() {
  const effects = computeTeamEffects(teamConfig);
  TEAM_ROLE_LIST.forEach(role => {
    const roleDef = TEAM_ROLES[role];
    const id = teamConfig[role + "Id"];
    const member = id ? findTeamMember(roleDef.list, id) : null;
    const statusEl = $(`team-${role}-status`);
    if (member) {
      const wageTxt = member.salaryPerEvent >= 0
        ? `€${member.salaryPerEvent.toLocaleString("nl-NL")}/evenement`
        : `brengt €${Math.abs(member.salaryPerEvent).toLocaleString("nl-NL")}/evenement mee`;
      statusEl.textContent = `Aangenomen: ${member.name} (${wageTxt}).`;
    } else {
      statusEl.textContent = `Geen ${roleDef.label} aangenomen.`;
    }
    $(`team-${role}-fire`).style.display = member ? "block" : "none";
  });

  $("team-wages").textContent = (() => {
    const total = totalTeamWagesPerEvent(teamConfig);
    if (total === 0) return "€0/evenement (niemand aangenomen)";
    return total > 0
      ? `€${total.toLocaleString("nl-NL")}/evenement (van je budget)`
      : `+€${Math.abs(total).toLocaleString("nl-NL")}/evenement (netto sponsorinkomsten via pay driver(s))`;
  })();
  $("team-reaction-mult").textContent = `×${effects.teamReactionMult.toFixed(2)}`;
  $("team-carcontrol-mult").textContent = `×${effects.teamCarControlMult.toFixed(2)}`;
  $("team-discipline-mult").textContent = `×${effects.teamDisciplineMult.toFixed(2)}`;
  $("team-engine-damage-mult").textContent = `×${effects.teamEngineDamageMult.toFixed(2)}`;
  $("team-clutch-damage-mult").textContent = `×${effects.teamClutchDamageMult.toFixed(2)}`;
  $("team-catastrophic-mult").textContent = `×${effects.teamCatastrophicMult.toFixed(2)}`;
  $("team-scout-count").textContent = `+${effects.teamSponsorOfferCountBonus}`;
  $("team-scout-amount").textContent = `×${effects.teamSponsorOfferAmountMult.toFixed(2)}`;

  // A running season locks the driver in place (see season.js) - car chief
  // and sponsor-scout stay freely swappable, only the driver select/hire/
  // fire controls get disabled.
  const driverLocked = seasonState.active;
  $("team-driver-select").disabled = driverLocked;
  $("teamPanel").querySelector('[data-hire-role="driver"]').disabled = driverLocked;
  if (driverLocked) $("team-driver-fire").style.display = "none";
  $("team-driver-lock-note").style.display = driverLocked ? "block" : "none";
  if (driverLocked) $("team-driver-lock-note").textContent = `Vastgezet voor het lopende seizoen (ronde ${seasonState.roundIndex + 1}/${seasonState.calendar.length}) - pas weer wisselbaar na afloop van het seizoen.`;

  renderRijderTeamNote();
}

$("teamPanel").addEventListener("click", (e) => {
  const hireBtn = e.target.closest("[data-hire-role]");
  const fireBtn = e.target.closest("[data-fire-role]");
  if (hireBtn) {
    if (hireBtn.disabled) return;
    const role = hireBtn.dataset.hireRole;
    const id = $(`team-${role}-select`).value;
    hireTeamMember(teamConfig, role, id);
    saveTeamConfig();
    renderTeamPanel();
  } else if (fireBtn) {
    const role = fireBtn.dataset.fireRole;
    fireTeamMember(teamConfig, role);
    saveTeamConfig();
    renderTeamPanel();
  }
});

// ---- Spel exporteren/importeren: bundelt financiën, garage, team, setups
// en een eventueel actief evenement in één downloadbaar JSON-bestand - een
// expliciete back-up/overdracht bovenop de automatische lokale opslag
// hierboven (die alleen in DEZE browser blijft, en niet overdraagbaar is
// naar een andere machine). Download via <a download> werkt niet in elke
// context (bijv. binnen een sandboxed preview) - het modal met een
// kopieerbare textarea is dan het werkende alternatief. loadSetupsStore/
// saveSetupsStore komen pas verderop in dit bestand, maar zijn hier al
// bruikbaar: functiedeclaraties worden gehesen, en deze functies worden
// pas op een klik aangeroepen, ruim na module-load. ----

function collectFullSaveState() {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    finances: financesState,
    garage: garageConfig,
    team: teamConfig,
    market: marketState,
    event: serializeLadderState(ladderState),
    season: seasonState,
    setups: loadSetupsStore(),
  };
}

function applyFullSaveState(data) {
  financesState = { ...defaultFinancesState(), ...(data.finances || {}) };
  garageConfig = { ...defaultGarageConfig(), ...migrateGarageConfig(data.garage || {}) };
  teamConfig = { ...defaultTeamConfig(), ...(data.team || {}) };
  marketState = data.market || generateUsedMarket(Math.random);
  ladderState = data.event ? deserializeLadderState(data.event) : null;
  seasonState = { ...defaultSeasonState(), ...(data.season || {}) };
  if (data.setups) saveSetupsStore(data.setups);
  saveFinancesState();
  saveGarageConfig();
  saveTeamConfig();
  saveMarketState();
  saveEventState();
  saveSeasonState();
}

$("exportGameBtn").addEventListener("click", () => {
  const json = JSON.stringify(collectFullSaveState(), null, 2);
  $("exportModalText").value = json;
  $("exportModal").hidden = false;
  try {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `topfuel-save-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $("exportModalNote").textContent = "Bestand wordt gedownload. Lukt dat niet (bijv. in een preview-omgeving)? Kopieer de JSON hieronder handmatig.";
  } catch {
    $("exportModalNote").textContent = "Downloaden lukte niet in deze omgeving - kopieer de JSON hieronder handmatig.";
  }
});
$("exportModalCopy").addEventListener("click", () => {
  $("exportModalText").select();
  if (!navigator.clipboard) {
    $("exportModalNote").textContent = "Tekst is geselecteerd - gebruik Ctrl/Cmd+C om te kopiëren.";
    return;
  }
  navigator.clipboard.writeText($("exportModalText").value).then(
    () => { $("exportModalNote").textContent = "Gekopieerd naar klembord."; },
    () => { $("exportModalNote").textContent = "Automatisch kopiëren lukte niet - tekst is geselecteerd, gebruik Ctrl/Cmd+C."; }
  );
});
$("exportModalClose").addEventListener("click", () => { $("exportModal").hidden = true; });

$("importGameBtn").addEventListener("click", () => { $("importGameFile").click(); });
$("importGameFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      applyFullSaveState(data);
      $("io-status").textContent = "Spel geïmporteerd - pagina wordt herladen...";
      setTimeout(() => location.reload(), 600);
    } catch {
      $("io-status").textContent = "Kon het bestand niet lezen - is het een geldig topfuel-save.json bestand?";
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

// A fresh start: wipes budget, garage, team, market and any active event
// back to their defaults - not the saved tune setups (SETUPS_KEY), which
// are just dial experiments a player built up, not part of the "team"
// fiction, so there's no reason to lose them on a new game. Confirmation
// goes through an in-page modal (same pattern as the export modal) rather
// than window.confirm() - a sandboxed embed (e.g. the standalone artifact
// preview) commonly disallows native dialogs outright, where confirm()
// doesn't just look different, it silently returns false with nothing
// ever shown, so the button appears to do nothing at all.
$("newGameBtn").addEventListener("click", () => { $("newGameModal").hidden = false; });
$("newGameCancelBtn").addEventListener("click", () => { $("newGameModal").hidden = true; });
$("newGameConfirmBtn").addEventListener("click", () => {
  $("newGameModal").hidden = true;
  financesState = defaultFinancesState();
  garageConfig = defaultGarageConfig();
  teamConfig = defaultTeamConfig();
  marketState = generateUsedMarket(Math.random);
  ladderState = null;
  seasonState = defaultSeasonState();
  saveFinancesState();
  saveGarageConfig();
  saveTeamConfig();
  saveMarketState();
  saveEventState();
  saveSeasonState();
  location.reload();
});

// A restored event (see loadEventState above) needs the same "active event"
// panel state a freshly started one gets, plus the final-result banner if
// it had already concluded before the page was left/refreshed.
if (ladderState) {
  showEventActiveUI();
  if (ladderState.playerOutcome !== null) renderFinalResult(ladderState.finalResultText);
}

setMode("test");

// ---- Setup opslaan/laden: bewaart motor/koppeling/chassis/rijder (niet de
// omgevingscondities) lokaal in de browser onder een zelfgekozen naam. ----

const SETUPS_KEY = "topfuel-setups";
const SETUP_SLIDER_IDS = sliders.filter(id => !envSliderIds.includes(id));

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function loadSetupsStore() {
  try { return JSON.parse(localStorage.getItem(SETUPS_KEY) || "{}"); } catch { return {}; }
}
function saveSetupsStore(store) {
  try { localStorage.setItem(SETUPS_KEY, JSON.stringify(store)); } catch { /* private mode, storage full, etc - saving just silently no-ops */ }
}

function collectSetup() {
  const setup = {};
  SETUP_SLIDER_IDS.forEach(id => { setup[id] = $(id).value; });
  setup.watchft = $("watchft").value;
  return setup;
}
function applySetup(setup) {
  SETUP_SLIDER_IDS.forEach(id => {
    if (setup[id] === undefined) return;
    $(id).value = setup[id];
    $(id).dispatchEvent(new Event("input"));
  });
  if (setup.watchft !== undefined) $("watchft").value = setup.watchft;
}

function refreshSetupSelect() {
  const store = loadSetupsStore();
  const names = Object.keys(store).sort();
  const select = $("setupSelect");
  const current = select.value;
  select.innerHTML = '<option value="">— kies een setup —</option>' + names.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
  if (names.includes(current)) select.value = current;
}

$("saveSetupBtn").addEventListener("click", () => {
  const name = $("setupName").value.trim();
  if (!name) { $("setup-status").textContent = "Geef eerst een naam op voor je zet opslaat."; return; }
  const store = loadSetupsStore();
  store[name] = collectSetup();
  saveSetupsStore(store);
  refreshSetupSelect();
  $("setupSelect").value = name;
  $("setupName").value = "";
  $("setup-status").textContent = `Setup "${name}" opgeslagen.`;
});

$("loadSetupBtn").addEventListener("click", () => {
  const name = $("setupSelect").value;
  if (!name) { $("setup-status").textContent = "Kies eerst een setup uit de lijst."; return; }
  const store = loadSetupsStore();
  if (!store[name]) return;
  applySetup(store[name]);
  $("setup-status").textContent = `Setup "${name}" geladen.`;
});

$("deleteSetupBtn").addEventListener("click", () => {
  const name = $("setupSelect").value;
  if (!name) { $("setup-status").textContent = "Kies eerst een setup uit de lijst."; return; }
  const store = loadSetupsStore();
  delete store[name];
  saveSetupsStore(store);
  refreshSetupSelect();
  $("setup-status").textContent = `Setup "${name}" verwijderd.`;
});

refreshSetupSelect();

// ---- Inklapbare panelen: klik op de titel van een paneel om 'm dicht/open
// te klappen, zodat je alleen openzet wat je wil aanpassen. Onthoudt de
// stand per paneel lokaal, net als de opgeslagen setups hierboven. ----

const PANEL_COLLAPSE_KEY = "topfuel-panel-collapse";

function loadPanelCollapseState() {
  try { return JSON.parse(localStorage.getItem(PANEL_COLLAPSE_KEY) || "{}"); } catch { return {}; }
}
function savePanelCollapseState(state) {
  try { localStorage.setItem(PANEL_COLLAPSE_KEY, JSON.stringify(state)); } catch { /* private mode, storage full, etc - silently no-ops */ }
}

function setupCollapsiblePanels() {
  const state = loadPanelCollapseState();
  document.querySelectorAll(".panel.collapsible").forEach(panel => {
    const key = panel.dataset.collapseKey;
    if (state[key]) panel.classList.add("collapsed");
    panel.querySelector(".sec-title").addEventListener("click", () => {
      panel.classList.toggle("collapsed");
      state[key] = panel.classList.contains("collapsed");
      savePanelCollapseState(state);
    });
  });
}
setupCollapsiblePanels();
