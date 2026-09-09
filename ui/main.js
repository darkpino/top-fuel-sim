import { calcDensityAltitude, calcPowerMult, calcGripCoeff } from "../sim-core/environment.js";
import { calcEngineFactors, calcMult, calcRecommendedNitro, calcIgnEff, IGNITION_CURVE_TIMES, IGNITION_RETARD_ARM_TIME, IGNITION_REDLINE_RPM } from "../sim-core/engine.js";
import { calcClutchReach } from "../sim-core/clutch.js";
import { calcOptimalPsi, calcPsiPenalty } from "../sim-core/tires.js";
import { runSimulation } from "../sim-core/run-simulator.js";
import { generateEventConditions } from "../sim-core/event.js";

function $(id) { return document.getElementById(id); }

const sliders = ["airtemp", "hum", "baro", "track", "grip", "blower", "fuel", "fuel1", "fuel2", "fuel3", "gasket", "ign1", "ign2", "ign3", "ign4", "ign5", "ign6", "s1t", "s1p", "s1speed", "s2t", "s2p", "s2speed", "s3t", "s3p", "s3speed", "fw", "tpsi", "wing", "fwing", "wbar", "ballfront", "ballrear", "aggro", "shutoff"];

function fmt(id, val) {
  switch (id) {
    case "airtemp": return val + "°C";
    case "hum": return val + "%";
    case "baro": return (val / 100).toFixed(2) + " inHg";
    case "track": return val + "°C";
    case "grip": return val + "%";
    case "blower": return val + "%";
    case "fuel": return val + "%";
    case "fuel1": case "fuel2": case "fuel3": return val + "%";
    case "gasket": return (val / 1000).toFixed(3) + '"';
    case "ign1": case "ign2": case "ign3": case "ign4": case "ign5": case "ign6": return val + "°";
    case "s1t": return (val / 100).toFixed(2) + "s";
    case "s1p": return val + "%";
    case "s2t": return (val / 100).toFixed(2) + "s";
    case "s2p": return val + "%";
    case "s3t": return (val / 100).toFixed(2) + "s";
    case "s3p": return val + "%";
    case "s1speed": case "s2speed": case "s3speed": return val + "%/s";
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
  };
}

function updateClutchReachHint() {
  const stages = readClutchStages();
  const { reach1, reach2, reach3 } = calcClutchReach(stages);

  function fmtReach(setpoint, reached) {
    const dead = Math.abs(reached - setpoint) > 0.02;
    const pct = Math.round(reached * 100);
    return dead ? `${pct}% <span style="color:var(--red)">(setpoint ${Math.round(setpoint * 100)}% niet gehaald - te weinig tijd/snelheid)</span>` : `${pct}%`;
  }
  $("clutch-reach-hint").innerHTML = `Haalbare lockup per stage: S1 ${fmtReach(stages.s1pct, reach1)} · S2 ${fmtReach(stages.s2pct, reach2)} · S3 ${fmtReach(stages.s3pct, reach3)}`;
}
["s1t", "s1p", "s1speed", "s2t", "s2p", "s2speed", "s3t", "s3p", "s3speed"].forEach(id => {
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
  const fuel1Pct = +$("fuel1").value;
  const gasketThou = +$("gasket").value;
  const ignition = +$("ign1").value; // launch-point ignition, for this one-off "at launch" estimate
  const tirePsi = +$("tpsi").value / 10;

  const da = calcDensityAltitude(airtempC, humidity, baroInHg);
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
  // Displayed purely as a kN-flavored readout (2600-3400 span), rescaled
  // from the internal grip coefficient (0.6-6.6) after temp/tire penalties -
  // this is the OUTCOME of VHT% + track temp + tire pressure, not an input.
  const gripKN = Math.round(2600 + Math.max(0, Math.min(1, (gripEstimate - 0.6) / 6.0)) * 800);
  gripHint.textContent = `Effectieve grip: ${gripKN} kN (${tempQuality})`;
}
["airtemp", "hum", "baro", "track", "grip", "blower", "fuel", "fuel1", "gasket", "ign1", "tpsi"].forEach(id => {
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
  return {
    airtempC: +$("airtemp").value,
    humidity: +$("hum").value,
    baroInHg: +$("baro").value / 100,
    trackTempC: +$("track").value,
    gripSliderPct: +$("grip").value,
    blowerOD: +$("blower").value,
    fuelPct: +$("fuel").value,
    fuel1Pct: +$("fuel1").value,
    fuel2Pct: +$("fuel2").value,
    fuel3Pct: +$("fuel3").value,
    gasketThou: +$("gasket").value,
    ignitionCurve: ["ign1", "ign2", "ign3", "ign4", "ign5", "ign6"].map(id => +$(id).value),
    ...readClutchStages(),
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
  };
}

function renderRunResult(r) {
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
    flags += r.engineFailCause === "lean"
      ? `<div class="flag">Motor kapot na ${r.engineFailTime.toFixed(2)}s — te mager onder belasting, de brandstofcurve hield het toerental niet bij. Zet stage 2 (lockup) verder open.</div>`
      : `<div class="flag">Motor kapot na ${r.engineFailTime.toFixed(2)}s — de combinatie van blower, compressie en nitro% was te heet om vol te houden.</div>`;
  }
  else if (r.clutchFailed) flags += `<div class="flag">Koppeling kapot na ${r.clutchFailTime.toFixed(2)}s — te lang te ver teruggehouden onder te veel vermogen. Dat beschermde de banden, maar de koppeling zelf hield het niet vol. Geef 'm iets meer lockup, of neem er genoegen mee dat dit 'm kost.</div>`;
  else if (r.driverLifted && r.driverLiftReason === "shutoff" && !r.finished) flags += `<div class="flag">Rijder heeft het ingestelde afschakelpunt bereikt op ${r.driverLiftTime.toFixed(2)}s en is van het gas gegaan — geplande shutoff, geen paniek. De auto heeft de 1000 ft niet op momentum gehaald.</div>`;
  else if (r.driverLifted && !r.finished) flags += `<div class="flag">Rijder is van het gas gegaan na aanhoudende bandenrook op ${r.driverLiftTime.toFixed(2)}s — run afgebroken. Verhoog de rijder-agressiviteit als hij vaker moet doorpedalen, of pak de tune aan voor minder wielspin.</div>`;
  else if (!r.finished) flags += `<div class="flag">Auto bereikte de 1000 ft niet binnen ${r.et.toFixed(1)}s — te weinig grip/vermogen om op snelheid te komen. Draai bij.</div>`;
  else if (r.driverLifted && r.driverLiftReason === "shutoff") flags += `<div class="flag">Rijder is op het ingestelde afschakelpunt (${r.driverLiftTime.toFixed(2)}s) van het gas gegaan — geplande shutoff, de auto heeft de 1000 ft alsnog op momentum gehaald.</div>`;
  else if (r.driverLifted) flags += `<div class="flag">Rijder is na aanhoudende bandenrook op ${r.driverLiftTime.toFixed(2)}s van het gas gegaan, maar de auto heeft de 1000 ft alsnog op momentum gehaald.</div>`;
  if (r.clutchWearLockupGainPct > 3 && !r.clutchFailed) flags += `<div class="flag">Koppelingsslijtage heeft de lockup tijdens deze run zo'n ${r.clutchWearLockupGainPct.toFixed(0)} procentpunt verder laten locken dan ingesteld — de vingers konden door slijtage van het lager verder naar buiten. Bij nog meer slip op deze tune wordt de koppeling geleidelijk agressiever dan bedoeld.</div>`;
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
  if (r.anySpin && !r.engineFailed) flags += `<div class="flag">Wielenspin gedetecteerd tijdens de run — motorvermogen overschreed de beschikbare grip.</div>`;
  if (r.detonationRisk && !r.engineFailed) flags += `<div class="flag">Detonatierisico: hoge compressie + hoog nitropercentage + veel voorontsteking is een gevaarlijke combinatie.</div>`;
  spinFlag.innerHTML = flags;

  const ch = r.clutchHeat;
  if (r.clutchFailed) {
    $("i-clutch").textContent = `kapot @ ${r.clutchFailTime.toFixed(2)}s`;
    $("i-clutch").className = "status bad";
  } else {
    const chCls = statusClass(ch, 45, 70);
    $("i-clutch").textContent = ch.toFixed(0) + "/100 " + (chCls === "ok" ? "(optimaal)" : chCls === "warn" ? "(warm)" : "(oververhit)");
    $("i-clutch").className = "status " + chCls;
  }

  const slipCls = statusClass(r.avgSlipPct, 15, 30);
  $("i-slip").textContent = r.avgSlipPct.toFixed(1) + "% gem.";
  $("i-slip").className = "status " + slipCls;

  let plugTxt, plugCls;
  if (r.plugBalance > 0.08) { plugTxt = "rijk mengsel"; plugCls = "warn"; }
  else if (r.plugBalance < -0.08) { plugTxt = "mager mengsel"; plugCls = "bad"; }
  else { plugTxt = "optimaal"; plugCls = "ok"; }
  $("i-plugs").textContent = plugTxt;
  $("i-plugs").className = "status " + plugCls;

  const bw = r.bearingWear;
  const bwCls = statusClass(bw, 40, 70);
  $("i-bearing").textContent = bw.toFixed(0) + "% slijtage";
  $("i-bearing").className = "status " + bwCls;

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

  const retardCls = statusClass(r.peakIgnitionRetard, 8, 15);
  $("i-retard").textContent = r.peakIgnitionRetard > 0.1 ? `${r.peakIgnitionRetard.toFixed(1)}° teruggetrokken` : "niet geactiveerd";
  $("i-retard").className = "status " + (r.peakIgnitionRetard > 0.1 ? retardCls : "ok");

  $("i-weight").textContent = `${Math.round(r.weightLb).toLocaleString("nl-NL")} lb`;
  $("i-weight").className = "status ok";
}

$("runBtn").addEventListener("click", () => {
  renderRunResult(runSimulation(readSettings()));
});

// ---- Evenement: 4 kwalificatie- + 4 eliminatierondes, elk met eigen
// gegenereerde omstandigheden. Geen tegenstander/AI-tijden, ladder of
// bracket-koppeling nog - zie sim-core/event.js voor waarom dat een latere
// laag bovenop deze rondestructuur wordt, niet een herbouw ervan. ----

const envSliderIds = ["airtemp", "hum", "baro", "track", "grip"];
let currentMode = "test";
let eventRounds = null; // array from generateEventConditions(), or null when no event is active
let eventRoundIndex = 0; // index of the round that's next up / active
let eventResults = []; // parallel array; eventResults[i] set once round i has been run
const EVENT_IDLE_STATUS = "Nog geen evenement gestart. 4 kwalificatierondes, daarna 4 eliminatierondes, elk met eigen (gesimuleerde) weersomstandigheden — jij tunet elke ronde opnieuw. Nog geen tegenstander/AI-tijden, kwalificatieladder of bracket-koppeling: dat komt later boven op deze rondestructuur.";

function eventInProgress() {
  return eventRounds !== null && eventRoundIndex < eventRounds.length;
}

function updateEnvLock() {
  const locked = currentMode === "event" && eventInProgress();
  envSliderIds.forEach(id => { $(id).disabled = locked; });
  $("event-env-note").style.display = locked ? "block" : "none";
}

function setMode(mode) {
  currentMode = mode;
  $("tabTest").classList.toggle("active", mode === "test");
  $("tabEvent").classList.toggle("active", mode === "event");
  $("eventPanel").style.display = mode === "event" ? "block" : "none";
  $("runBtn").style.display = mode === "event" ? "none" : "block";
  updateEnvLock();
  if (mode === "event" && eventInProgress()) activateRound();
}
$("tabTest").addEventListener("click", () => setMode("test"));
$("tabEvent").addEventListener("click", () => setMode("event"));

function applyConditions(cond) {
  $("airtemp").value = cond.airtempC;
  $("hum").value = cond.humidity;
  $("baro").value = Math.round(cond.baroInHg * 100);
  $("track").value = cond.trackTempC;
  $("grip").value = cond.gripSliderPct;
  envSliderIds.forEach(id => $(id).dispatchEvent(new Event("input")));
}

function roundResultText(result) {
  if (!result) return "--";
  if (result.finished) return `${result.et.toFixed(3)}s @ ${result.mph.toFixed(1)} mph`;
  if (result.engineFailed) return "motor kapot";
  if (result.clutchFailed) return "koppeling kapot";
  return "DNF";
}

// The table is the point of this feature: past rounds' weather sits right
// next to their times, and the active round's own weather is highlighted
// in the same columns, so a comparison is just reading across a row -
// this is what lets a re-tune between rounds actually be informed instead
// of guesswork. Future rounds' weather stays hidden (a crew chief doesn't
// know it in advance either), even though it's already generated.
function renderEventTable() {
  $("event-table-body").innerHTML = eventRounds.map((round, i) => {
    const result = eventResults[i];
    const isCurrent = i === eventRoundIndex && !result;
    const isFuture = i > eventRoundIndex;
    const cls = result ? "done" : (isCurrent ? "current" : "future");
    const c = round.conditions;
    const condCells = isFuture
      ? `<td colspan="5" style="text-align:center;">nog onbekend</td>`
      : `<td>${c.airtempC}°C</td><td>${c.humidity}%</td><td>${c.baroInHg.toFixed(2)}</td><td>${c.trackTempC}°C</td><td>${c.gripSliderPct}%</td>`;
    const et60Txt = result && result.et60 ? result.et60.toFixed(3) : "--";
    const etTxt = result && result.finished ? result.et.toFixed(3) : "--";
    const mphTxt = result ? result.mph.toFixed(1) : "--";
    const statusTxt = result ? roundResultText(result) : (isCurrent ? "actief" : "--");
    return `<tr class="${cls}"><td>${round.id}</td>${condCells}<td>${et60Txt}</td><td>${etTxt}</td><td>${mphTxt}</td><td>${statusTxt}</td></tr>`;
  }).join("");
}

function activateRound() {
  const round = eventRounds[eventRoundIndex];
  $("event-round-label").style.display = "block";
  $("event-round-label").textContent = `Actieve ronde: ${round.id} — ${round.label}. Vergelijk de tabel hierboven met eerdere rondes om je tune bij te stellen.`;
  applyConditions(round.conditions);
  renderEventTable();
}

$("startEventBtn").addEventListener("click", () => {
  eventRounds = generateEventConditions();
  eventResults = [];
  eventRoundIndex = 0;
  $("event-status").textContent = "Evenement bezig — tune je auto voor elke ronde en druk op \"Run deze ronde\".";
  $("event-table").style.display = "table";
  $("startEventBtn").style.display = "none";
  $("runRoundBtn").style.display = "block";
  $("newEventBtn").style.display = "block";
  activateRound();
  updateEnvLock();
});

$("runRoundBtn").addEventListener("click", () => {
  if (!eventRounds || eventRoundIndex >= eventRounds.length) return;
  applyConditions(eventRounds[eventRoundIndex].conditions);
  const r = runSimulation(readSettings());
  eventResults[eventRoundIndex] = r;
  renderRunResult(r);
  eventRoundIndex++;
  if (eventRoundIndex >= eventRounds.length) {
    renderEventTable();
    $("event-status").textContent = "Evenement compleet — alle 4 kwalificatie- en 4 eliminatierondes gereden.";
    $("event-round-label").style.display = "none";
    $("runRoundBtn").style.display = "none";
    updateEnvLock();
  } else {
    $("event-status").textContent = eventRoundIndex === 4
      ? "Kwalificatie compleet — eliminaties beginnen."
      : "Volgende ronde klaar om getuned te worden.";
    activateRound();
  }
});

$("newEventBtn").addEventListener("click", () => {
  eventRounds = null;
  eventResults = [];
  eventRoundIndex = 0;
  $("event-status").textContent = EVENT_IDLE_STATUS;
  $("event-table").style.display = "none";
  $("event-round-label").style.display = "none";
  $("startEventBtn").style.display = "block";
  $("runRoundBtn").style.display = "none";
  $("newEventBtn").style.display = "none";
  updateEnvLock();
});

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
