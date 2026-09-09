// Event module: sequences a full NHRA-style event day - 4 qualifying
// rounds, then an elimination bracket - each round with its own generated
// weather, so a crew chief has to re-tune between rounds instead of
// running the same conditions every time. Pure data/functions, no DOM
// access. The actual field (AI opponents, the qualifying ladder, bracket
// pairing, reaction times) lives in sim-core/ladder.js - this module only
// owns the round SCHEDULE and its weather.
//
// Elimination round count is derived from bracketSize (log2 of it) rather
// than fixed at 4, since the ladder module lets the event field - and so
// the bracket - be smaller or larger than the classic 16 cars.

function elimRoundLabel(roundIndex, totalElimRounds, bracketSize) {
  const remaining = totalElimRounds - roundIndex + 1;
  if (remaining === 1) return `Eliminatie ${roundIndex} (finale)`;
  if (remaining === 2) return `Eliminatie ${roundIndex} (halve finale)`;
  if (remaining === 3) return `Eliminatie ${roundIndex} (kwartfinale)`;
  const carsThisRound = bracketSize / Math.pow(2, roundIndex - 1);
  return `Eliminatie ${roundIndex} (${carsThisRound} auto's)`;
}

export function buildRoundDefs(bracketSize) {
  const totalElimRounds = Math.round(Math.log2(bracketSize));
  const defs = [];
  for (let i = 1; i <= 4; i++) {
    defs.push({ id: `Q${i}`, label: `Kwalificatie ${i}`, phase: "qualifying", roundNumber: i });
  }
  for (let i = 1; i <= totalElimRounds; i++) {
    defs.push({ id: `E${i}`, label: elimRoundLabel(i, totalElimRounds, bracketSize), phase: "elimination", roundNumber: i });
  }
  return defs;
}

// mulberry32: small, fast, seedable PRNG - deterministic for a given seed
// so a specific event day can be reproduced (useful for debugging a
// particular round's conditions) instead of always being pure Math.random().
function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randRange(rng, min, max) {
  return min + rng() * (max - min);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// One day's rough weather arc, walked by dayFrac (0 = first round of the
// day, 1 = last): air and track temp peak mid-arc, humidity is the rough
// mirror (lowest when hottest), baro drifts gently, VHT/grip carries its
// own independent noise since that's track prep, not weather. Qualifying
// and eliminations each get their own day (see generateEventConditions),
// so a real event's two-day shape - quals one day, eliminations the next -
// comes through as two separate arcs rather than one long one.
//
// The day's actual RANGE - how hot/humid it gets, how much the asphalt
// runs above air temp - comes from the chosen track's climate profile
// (see tracks.js) instead of one fixed generic range: Denver's dry
// mountain air and Gainesville's humid heat are meant to feel like
// different events, not the same weather with a different backdrop.
// elevationFt is constant for the whole event (it's where the track
// physically sits, not something that changes round to round) - carried
// through on every round's conditions so run-simulator.js's density-
// altitude math (power AND drag, see environment.js) sees it.
function conditionsForDayFrac(rng, dayFrac, track) {
  const heatCurve = Math.sin(Math.PI * clamp(dayFrac, 0, 1)); // 0 at each end, 1 at midday
  const baseAirtemp = randRange(rng, track.airtempBaseMin, track.airtempBaseMax);
  const peakAirtemp = baseAirtemp + randRange(rng, track.airtempPeakDeltaMin, track.airtempPeakDeltaMax);
  const airtempC = Math.round(clamp(baseAirtemp + heatCurve * (peakAirtemp - baseAirtemp), 5, 45));
  const trackTempC = Math.round(clamp(airtempC + randRange(rng, track.trackTempDeltaMin, track.trackTempDeltaMax), 10, 65));
  const humidity = Math.round(clamp(randRange(rng, track.humidityMin, track.humidityMax) - heatCurve * randRange(rng, 5, 15), 5, 95));
  const baroInHg = +clamp(randRange(rng, 29.7, 30.1), 28.85, 30.15).toFixed(2);
  const gripSliderPct = Math.round(clamp(randRange(rng, 50, 85), 20, 95));
  return { airtempC, humidity, trackTempC, baroInHg, gripSliderPct, elevationFt: track.elevationFt };
}

// Generates the condition set for one event's rounds. Pass a seed to
// reproduce a specific day; omit it for a fresh random event. Qualifying
// (always 4 rounds) and elimination (however many buildRoundDefs gave it)
// each walk their OWN day arc, using their own round count as the divisor -
// they're independent days, not one long one, and elimination's arc
// shouldn't assume 4 rounds just because qualifying always does.
export function generateEventConditions(roundDefs, seed = Math.floor(Math.random() * 1e9), track) {
  const rng = mulberry32(seed);
  const maxRoundByPhase = {
    qualifying: 4,
    elimination: Math.max(...roundDefs.filter((r) => r.phase === "elimination").map((r) => r.roundNumber)),
  };
  return roundDefs.map((round) => {
    const maxRound = maxRoundByPhase[round.phase];
    const dayFrac = maxRound > 1 ? (round.roundNumber - 1) / (maxRound - 1) : 0;
    return { ...round, conditions: conditionsForDayFrac(rng, dayFrac, track) };
  });
}
