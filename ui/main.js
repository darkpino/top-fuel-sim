import { calcDensityAltitude, calcPowerMult, calcGripCoeff } from "../sim-core/environment.js";
import { calcEngineFactors, calcMult, calcRecommendedNitro } from "../sim-core/engine.js";
import { calcClutchReach } from "../sim-core/clutch.js";
import { calcOptimalPsi, calcPsiPenalty } from "../sim-core/tires.js";
import { runSimulation } from "../sim-core/run-simulator.js";

function $(id) { return document.getElementById(id); }

const sliders = ["airtemp", "hum", "baro", "track", "grip", "blower", "fuel", "fuel1", "fuel2", "fuel3", "gasket", "ign", "s1t", "s1p", "s1speed", "s2t", "s2p", "s2speed", "s3t", "s3p", "s3speed", "fw", "tpsi", "wing", "aggro"];

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
    case "ign": return val + "°";
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
    case "aggro": return val;
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
  const ignition = +$("ign").value;
  const tirePsi = +$("tpsi").value / 10;

  const da = calcDensityAltitude(airtempC, humidity, baroInHg);
  const powerMultNow = calcPowerMult(da);
  const { fuelFactor, blowerFactor, ignEff, compressionFactor } = calcEngineFactors({ blowerOD, fuelPct, gasketThou, ignition });
  const { mult } = calcMult({ fuelFactor, fuelVolPct: fuel1Pct, blowerFactor, ignEff, compressionFactor, powerMult: powerMultNow });
  $("power-hint").textContent = `Geschat piekvermogen bij launch: ${Math.round(12000 * mult).toLocaleString("nl-NL")} pk (basis 12.000 pk bij standaard lucht, voor eigen koppeling/grip-verlies; verandert tijdens de run met de brandstofcurve)`;

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
["airtemp", "hum", "baro", "track", "grip", "blower", "fuel", "fuel1", "gasket", "ign", "tpsi"].forEach(id => {
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

function drawFuelChart(trace) {
  const W = 640, H = 140, padL = 42, padR = 12, padT = 10, padB = 22;
  const maxGpm = Math.max(...trace.map(p => p.fuel_gpm), 10) * 1.1;
  const maxT = trace[trace.length - 1].t;
  function xs(t) { return padL + (t / maxT) * (W - padL - padR); }
  function ys(gpm) { return H - padB - (gpm / maxGpm) * (H - padT - padB); }

  const linePoints = trace.map(p => `${xs(p.t).toFixed(1)},${ys(p.fuel_gpm).toFixed(1)}`).join(" L ");
  const fuelPath = "M " + linePoints;
  const areaPath = `M ${xs(0).toFixed(1)},${ys(0).toFixed(1)} L ${linePoints} L ${xs(maxT).toFixed(1)},${ys(0).toFixed(1)} Z`;

  let gridLines = "";
  for (let i = 0; i <= 2; i++) {
    const yy = padT + i * (H - padT - padB) / 2;
    const val = Math.round(maxGpm - i * maxGpm / 2);
    gridLines += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="#2c333b" stroke-width="1"/>`;
    gridLines += `<text x="${padL - 6}" y="${yy + 4}" text-anchor="end" font-size="10" fill="#8b939b" font-family="ui-monospace,monospace">${val}</text>`;
  }

  const svg = `
    ${gridLines}
    <line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="#2c333b" stroke-width="1"/>
    <path d="${areaPath}" fill="#5ec8d8" opacity="0.15" stroke="none"/>
    <path d="${fuelPath}" fill="none" stroke="#5ec8d8" stroke-width="2"/>
  `;
  $("fuelChart").setAttribute("viewBox", `0 0 ${W} ${H}`);
  $("fuelChart").innerHTML = svg;
}

function drawRpmChart(trace) {
  const W = 640, H = 140, padL = 42, padR = 12, padT = 10, padB = 22;
  const rpms = trace.map(p => p.rpm);
  const minRpm = Math.min(...rpms) * 0.97;
  const maxRpm = Math.max(...rpms) * 1.03;
  const maxT = trace[trace.length - 1].t;
  function xs(t) { return padL + (t / maxT) * (W - padL - padR); }
  function ys(rpm) { return H - padB - ((rpm - minRpm) / (maxRpm - minRpm)) * (H - padT - padB); }

  const rpmPath = "M " + trace.map(p => `${xs(p.t).toFixed(1)},${ys(p.rpm).toFixed(1)}`).join(" L ");

  let gridLines = "";
  for (let i = 0; i <= 2; i++) {
    const yy = padT + i * (H - padT - padB) / 2;
    const val = Math.round(maxRpm - i * (maxRpm - minRpm) / 2);
    gridLines += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="#2c333b" stroke-width="1"/>`;
    gridLines += `<text x="${padL - 6}" y="${yy + 4}" text-anchor="end" font-size="10" fill="#8b939b" font-family="ui-monospace,monospace">${val}</text>`;
  }

  const svg = `
    ${gridLines}
    <line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="#2c333b" stroke-width="1"/>
    <path d="${rpmPath}" fill="none" stroke="#b98ee0" stroke-width="2"/>
  `;
  $("rpmChart").setAttribute("viewBox", `0 0 ${W} ${H}`);
  $("rpmChart").innerHTML = svg;
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
    ignition: +$("ign").value,
    ...readClutchStages(),
    fingerWeight: +$("fw").value,
    tirePsi: +$("tpsi").value / 10,
    wingAngle: +$("wing").value / 10,
    driverAggressiveness: +$("aggro").value,
    driverWatchUntilFt: +$("watchft").value,
  };
}

$("runBtn").addEventListener("click", () => {
  const r = runSimulation(readSettings());
  $("placeholder").style.display = "none";
  $("resultsContent").style.display = "block";
  $("inspPanel").style.display = "block";

  $("r-60").textContent = r.et60 ? r.et60.toFixed(3) + "s" : "n.v.t.";
  $("r-330").textContent = r.et330 ? r.et330.toFixed(3) + "s" : "n.v.t.";
  $("r-660").textContent = r.et660 ? r.et660.toFixed(3) + "s" : "n.v.t.";
  $("r-660mph").textContent = r.mph660 ? r.mph660.toFixed(1) + " mph" : "n.v.t.";
  $("r-et").textContent = r.finished ? r.et.toFixed(3) + "s" : (r.engineFailed ? "MOTOR" : (r.clutchFailed ? "KOPPELING" : (r.driverLifted ? "LIFT" : "DNF")));
  $("r-et").style.color = r.finished ? "var(--text)" : "var(--red)";
  $("r-mph").textContent = r.mph.toFixed(1) + " mph";

  drawChart(r.trace, [
    { label: "60'", t: r.et60 },
    { label: "330'", t: r.et330 },
    { label: "660'", t: r.et660 },
    { label: r.finished ? "1000'" : null, t: r.finished ? r.et : null },
  ]);
  drawFuelChart(r.trace);
  drawRpmChart(r.trace);

  const spinFlag = $("spinFlag");
  let flags = "";
  if (r.engineFailed) {
    flags += r.engineFailCause === "lean"
      ? `<div class="flag">Motor kapot na ${r.engineFailTime.toFixed(2)}s — te mager onder belasting, de brandstofcurve hield het toerental niet bij. Zet stage 2 (lockup) verder open.</div>`
      : `<div class="flag">Motor kapot na ${r.engineFailTime.toFixed(2)}s — de combinatie van blower, compressie en nitro% was te heet om vol te houden.</div>`;
  }
  else if (r.clutchFailed) flags += `<div class="flag">Koppeling kapot na ${r.clutchFailTime.toFixed(2)}s — te lang te ver teruggehouden onder te veel vermogen. Dat beschermde de banden, maar de koppeling zelf hield het niet vol. Geef 'm iets meer lockup, of neem er genoegen mee dat dit 'm kost.</div>`;
  else if (r.driverLifted && !r.finished) flags += `<div class="flag">Rijder is van het gas gegaan na aanhoudende bandenrook op ${r.driverLiftTime.toFixed(2)}s — run afgebroken. Verhoog de rijder-agressiviteit als hij vaker moet doorpedalen, of pak de tune aan voor minder wielspin.</div>`;
  else if (!r.finished) flags += `<div class="flag">Auto bereikte de 1000 ft niet binnen ${r.et.toFixed(1)}s — te weinig grip/vermogen om op snelheid te komen. Draai bij.</div>`;
  else if (r.driverLifted) flags += `<div class="flag">Rijder is na aanhoudende bandenrook op ${r.driverLiftTime.toFixed(2)}s van het gas gegaan, maar de auto heeft de 1000 ft alsnog op momentum gehaald.</div>`;
  if (r.cylindersDropped) {
    if (r.cylinderDropCause === "rich") flags += `<div class="flag">Cilinder(s) verzopen na ${r.cylinderDropTime.toFixed(2)}s — de brandstofcurve stond op dat moment te rijk voor het toerental. Kost vermogen, maar de motor overleeft het.</div>`;
    else if (r.cylinderDropCause === "lean") flags += `<div class="flag">Cilinder(s) beginnen te missen na ${r.cylinderDropTime.toFixed(2)}s — te mager onder belasting, de brandstofcurve hield het toerental niet bij. Bij aanhouden loopt dit uit op motorschade.</div>`;
    else flags += `<div class="flag">Cilinder(s) beginnen te missen na ${r.cylinderDropTime.toFixed(2)}s — de combinatie van blower, compressie en nitro% liep te heet. Bij aanhouden loopt dit uit op motorschade.</div>`;
  }
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
  if (r.driverLifted) { driverTxt = `gas los @ ${r.driverLiftTime.toFixed(2)}s`; driverCls = "bad"; }
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
});
