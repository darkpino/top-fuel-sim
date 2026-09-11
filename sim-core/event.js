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
// mirror (lowest when hottest), baro drifts gently. Qualifying and
// eliminations each get their own day (see generateEventConditions), so a
// real event's two-day shape - quals one day, eliminations the next -
// comes through as two separate arcs rather than one long one. Grip is
// NOT drawn here - see the note above generateEventConditions on why it
// gets its own whole-weekend model instead of per-day noise.
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
  return { airtempC, humidity, trackTempC, baroInHg, elevationFt: track.elevationFt };
}

// Grip/VHT, unlike the weather above, isn't independent noise per round -
// a real strip's grip is mostly ONE property of the whole weekend (how
// much rubber is down, what the track prep crew did overnight, whether it
// rained), that then drifts a little round to round as more rubber goes
// down. So it gets its own model, walked once across every round of the
// WHOLE event (qualifying through the final elimination, not reset per
// day like the heat arc above): a wide per-event starting point - GRIP_BASE_MIN..MAX -
// so different events genuinely start from different places (a soft,
// just-prepped surface vs. one that's already seen traffic), a gentle
// GRIP_TREND_GAIN climb across the rounds as rubber builds up, and a
// small GRIP_ROUND_NOISE jitter on top so back-to-back rounds stay close
// together instead of resampling the whole range every time. On top of
// the base, RAIN_SHOCK_CHANCE occasionally knocks a whole event's
// starting point down hard (rain the night before a session, a cold
// front) - that's a one-off hit to where the WEEKEND started, not
// something that fixes itself round to round the way normal jitter does.
const GRIP_BASE_MIN = 35;
const GRIP_BASE_MAX = 80;
const GRIP_TREND_GAIN = 18; // gripSliderPct points gained from the first round to the last
const GRIP_ROUND_NOISE = 4; // +/- gripSliderPct jitter around the trend line, per round
const RAIN_SHOCK_CHANCE = 0.15;
const RAIN_SHOCK_MIN = 15;
const RAIN_SHOCK_MAX = 30;

function rollEventGripBase(rng) {
  let base = randRange(rng, GRIP_BASE_MIN, GRIP_BASE_MAX);
  if (rng() < RAIN_SHOCK_CHANCE) {
    base = clamp(base - randRange(rng, RAIN_SHOCK_MIN, RAIN_SHOCK_MAX), 15, 100);
  }
  return base;
}

// Generates the condition set for one event's rounds. Pass a seed to
// reproduce a specific day; omit it for a fresh random event. Qualifying
// (always 4 rounds) and elimination (however many buildRoundDefs gave it)
// each walk their OWN day arc for weather, using their own round count as
// the divisor - they're independent days, not one long one, and
// elimination's arc shouldn't assume 4 rounds just because qualifying
// always does. Grip instead walks ALL of roundDefs as one continuous
// weekend (see rollEventGripBase above) - qualifying's rubber doesn't
// disappear overnight before eliminations.
export function generateEventConditions(roundDefs, seed = Math.floor(Math.random() * 1e9), track) {
  const rng = mulberry32(seed);
  const maxRoundByPhase = {
    qualifying: 4,
    elimination: Math.max(...roundDefs.filter((r) => r.phase === "elimination").map((r) => r.roundNumber)),
  };
  const eventGripBase = rollEventGripBase(rng);
  return roundDefs.map((round, i) => {
    const maxRound = maxRoundByPhase[round.phase];
    const dayFrac = maxRound > 1 ? (round.roundNumber - 1) / (maxRound - 1) : 0;
    const weekendFrac = roundDefs.length > 1 ? i / (roundDefs.length - 1) : 0;
    const gripSliderPct = Math.round(clamp(
      eventGripBase + weekendFrac * GRIP_TREND_GAIN + randRange(rng, -GRIP_ROUND_NOISE, GRIP_ROUND_NOISE),
      15, 98
    ));
    return { ...round, conditions: { ...conditionsForDayFrac(rng, dayFrac, track), gripSliderPct } };
  });
}
