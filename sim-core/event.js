// Event module: sequences a full NHRA-style event day - 4 qualifying
// rounds, then 4 elimination rounds - each with its own generated weather,
// so a crew chief has to re-tune between rounds instead of running the
// same conditions eight times. Pure data/functions, no DOM access.
//
// What this does NOT do yet, on purpose: no opponent/AI times, no
// qualifying ladder (ranking by best Q run), no elimination bracket
// pairing. Those all need a "field" of other cars to be meaningful, which
// doesn't exist yet. The round metadata below (phase, roundNumber)
// already carries what that will need, so adding it later is layering on
// top of this, not reshaping it.

export const ROUND_DEFS = [
  { id: "Q1", label: "Kwalificatie 1", phase: "qualifying", roundNumber: 1 },
  { id: "Q2", label: "Kwalificatie 2", phase: "qualifying", roundNumber: 2 },
  { id: "Q3", label: "Kwalificatie 3", phase: "qualifying", roundNumber: 3 },
  { id: "Q4", label: "Kwalificatie 4", phase: "qualifying", roundNumber: 4 },
  { id: "E1", label: "Eliminatie 1 (16 auto's)", phase: "elimination", roundNumber: 1 },
  { id: "E2", label: "Eliminatie 2 (kwartfinale)", phase: "elimination", roundNumber: 2 },
  { id: "E3", label: "Eliminatie 3 (halve finale)", phase: "elimination", roundNumber: 3 },
  { id: "E4", label: "Eliminatie 4 (finale)", phase: "elimination", roundNumber: 4 },
];

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
function conditionsForDayFrac(rng, dayFrac) {
  const heatCurve = Math.sin(Math.PI * clamp(dayFrac, 0, 1)); // 0 at each end, 1 at midday
  const baseAirtemp = randRange(rng, 18, 26);
  const peakAirtemp = baseAirtemp + randRange(rng, 8, 16);
  const airtempC = Math.round(clamp(baseAirtemp + heatCurve * (peakAirtemp - baseAirtemp), 12, 42));
  const trackTempC = Math.round(clamp(airtempC + randRange(rng, 8, 22), 18, 60));
  const humidity = Math.round(clamp(randRange(rng, 45, 75) - heatCurve * randRange(rng, 15, 30), 10, 90));
  const baroInHg = +clamp(randRange(rng, 29.7, 30.1), 28.85, 30.15).toFixed(2);
  const gripSliderPct = Math.round(clamp(randRange(rng, 50, 85), 20, 95));
  return { airtempC, humidity, trackTempC, baroInHg, gripSliderPct };
}

// Generates the full 8-round condition set for one event. Pass a seed to
// reproduce a specific day; omit it for a fresh random event.
export function generateEventConditions(seed = Math.floor(Math.random() * 1e9)) {
  const rng = mulberry32(seed);
  return ROUND_DEFS.map((round) => {
    const dayFrac = (round.roundNumber - 1) / (ROUND_DEFS.length / 2 - 1);
    return { ...round, conditions: conditionsForDayFrac(rng, dayFrac) };
  });
}
