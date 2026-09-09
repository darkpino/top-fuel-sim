// Ladder module: AI qualification + elimination bracket. Pure functions
// (plus calls into runSimulation for actual pass times), no DOM access.
//
// Architecture choice: AI opponents are not a separate statistical model -
// each one gets a real settings object (an "archetype" tune plus some
// per-driver jitter so nobody in the field is a carbon copy) and is run
// through the exact same runSimulation() the player uses. That's what
// makes "who's ahead of me this session" and the qualifying ladder itself
// mean anything: everyone in a given round faces the same generated
// weather, same physics, same failure modes - a hot track or a bad tune
// hurts the field exactly the way it hurts the player.

import { runSimulation } from "./run-simulator.js";

function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

const FIRST_NAMES = [
  "Jax", "Dutch", "Mace", "Rowdy", "Tex", "Boone", "Cruz", "Wyatt", "Diesel", "Ripley",
  "Sierra", "Harlow", "Nova", "Blaze", "Raye", "Kestrel", "Marlowe", "Sonny", "Rocket", "Chevy",
  "Axel", "Dash", "Cash", "Storm", "Journey", "Rebel", "Maverick", "Scout", "Talon", "Wren",
  "Foster", "Knox",
];
const LAST_NAMES = [
  "Kessler", "Vance", "Marsh", "Delgado", "Whitfield", "Cade", "Larkin", "Boyer", "Strand", "Halvorsen",
  "Reyes", "Sutter", "Fontaine", "Brix", "Calloway", "Duvall", "Ashworth", "Torrance", "Quill", "Redfern",
  "Osei", "Vasko", "Brennan", "Ilic", "Marchetti", "Okafor", "Lindqvist", "Pham", "Solano", "Krieger",
];
const TEAM_NAMES = [
  "Sagebrush Motorsports", "Ironclad Racing", "Blackwater Fuel Dynamics", "Redline Nitro Team", "Highwire Racing",
  "Southern Cross Dragsters", "Overdrive Motorsports", "Copperhead Racing", "Vantage Point Racing", "Nightfall Fuel Team",
  "Ridgeline Dragsters", "Crossfire Racing", "Bonneville Bound Racing", "Hollow Point Motorsports", "Steel Talon Racing",
  "Cinderblock Racing", "Wildcat Nitro", "Prairie Fire Racing", "Deadline Motorsports", "Straightaway Dynamics",
  "Long Shadow Racing", "Anvil Head Motorsports", "Tumbleweed Fuel Team", "Fault Line Dragsters", "Broken Arrow Racing",
];

// Archetypes: distinct crew-chief "philosophies," not a difficulty slider -
// each is a complete, independently-tunable settings object (everything
// runSimulation() needs except environment). Per-driver jitter (see
// jitterTune) keeps two cars sharing an archetype from running identically.
const AI_ARCHETYPES = [
  {
    name: "Balanced Pro",
    tune: {
      blowerOD: 50, fuelPct: 90, fuel1Pct: 72, fuel2Pct: 90, fuel3Pct: 85, gasketThou: 38,
      ignitionCurve: [62, 58, 53, 47, 43, 39],
      s1time: 0.85, s1pct: 0.80, s1speed: 7.0, s2time: 2.2, s2pct: 0.42, s2speed: 2.0, s3time: 2.5, s3pct: 1.0, s3speed: 8.0,
      fingerWeight: 100, tirePsi: 7.5, wingAngle: 0, frontWingPct: 55, wheelieBarHeightIn: 2.5, ballastFrontLb: 20, ballastRearLb: 0,
      driverAggressiveness: 70, driverWatchUntilFt: 660, driverShutoffFt: 1000,
    },
  },
  {
    name: "Aggressive Gambler",
    tune: {
      blowerOD: 60, fuelPct: 90, fuel1Pct: 78, fuel2Pct: 95, fuel3Pct: 90, gasketThou: 30,
      ignitionCurve: [65, 62, 58, 52, 46, 42],
      s1time: 0.75, s1pct: 0.85, s1speed: 7.5, s2time: 2.1, s2pct: 0.45, s2speed: 2.2, s3time: 2.4, s3pct: 1.0, s3speed: 8.5,
      fingerWeight: 100, tirePsi: 7.2, wingAngle: 0.5, frontWingPct: 45, wheelieBarHeightIn: 2.8, ballastFrontLb: 0, ballastRearLb: 0,
      driverAggressiveness: 90, driverWatchUntilFt: 1000, driverShutoffFt: 1000,
    },
  },
  {
    name: "Conservative Veteran",
    tune: {
      blowerOD: 44, fuelPct: 88, fuel1Pct: 68, fuel2Pct: 85, fuel3Pct: 80, gasketThou: 42,
      ignitionCurve: [58, 55, 50, 45, 41, 37],
      s1time: 0.90, s1pct: 0.75, s1speed: 6.5, s2time: 2.3, s2pct: 0.38, s2speed: 1.8, s3time: 2.6, s3pct: 0.98, s3speed: 7.5,
      fingerWeight: 95, tirePsi: 7.6, wingAngle: -0.5, frontWingPct: 60, wheelieBarHeightIn: 2.2, ballastFrontLb: 40, ballastRearLb: 20,
      driverAggressiveness: 50, driverWatchUntilFt: 660, driverShutoffFt: 1000,
    },
  },
  {
    name: "Budget Team",
    tune: {
      blowerOD: 34, fuelPct: 85, fuel1Pct: 65, fuel2Pct: 80, fuel3Pct: 76, gasketThou: 48,
      ignitionCurve: [55, 52, 48, 44, 40, 36],
      s1time: 0.88, s1pct: 0.72, s1speed: 6.0, s2time: 2.25, s2pct: 0.40, s2speed: 1.8, s3time: 2.55, s3pct: 0.95, s3speed: 7.0,
      fingerWeight: 90, tirePsi: 7.5, wingAngle: 0, frontWingPct: 50, wheelieBarHeightIn: 2.5, ballastFrontLb: 0, ballastRearLb: 0,
      driverAggressiveness: 65, driverWatchUntilFt: 660, driverShutoffFt: 1000,
    },
  },
  {
    name: "Clutch Specialist",
    tune: {
      blowerOD: 52, fuelPct: 90, fuel1Pct: 74, fuel2Pct: 92, fuel3Pct: 87, gasketThou: 36,
      ignitionCurve: [61, 57, 52, 46, 42, 38],
      s1time: 0.80, s1pct: 0.82, s1speed: 8.0, s2time: 2.15, s2pct: 0.44, s2speed: 2.5, s3time: 2.45, s3pct: 1.0, s3speed: 9.0,
      fingerWeight: 100, tirePsi: 7.4, wingAngle: 0, frontWingPct: 55, wheelieBarHeightIn: 2.4, ballastFrontLb: 10, ballastRearLb: 0,
      driverAggressiveness: 75, driverWatchUntilFt: 1000, driverShutoffFt: 1000,
    },
  },
  {
    name: "Wildcard Rookie",
    tune: {
      blowerOD: 58, fuelPct: 91, fuel1Pct: 76, fuel2Pct: 88, fuel3Pct: 82, gasketThou: 33,
      ignitionCurve: [64, 60, 55, 49, 44, 40],
      s1time: 0.70, s1pct: 0.88, s1speed: 8.5, s2time: 2.05, s2pct: 0.50, s2speed: 2.8, s3time: 2.35, s3pct: 1.0, s3speed: 9.5,
      fingerWeight: 100, tirePsi: 7.0, wingAngle: 0.5, frontWingPct: 40, wheelieBarHeightIn: 3.0, ballastFrontLb: 0, ballastRearLb: 0,
      driverAggressiveness: 85, driverWatchUntilFt: 1000, driverShutoffFt: 1000,
    },
  },
];

function jitterTune(base, rng) {
  const jit = (v, pct) => v * (1 + (rng() * 2 - 1) * pct);
  return {
    ...base,
    blowerOD: clamp(jit(base.blowerOD, 0.06), 20, 70),
    fuel1Pct: clamp(jit(base.fuel1Pct, 0.05), 40, 100),
    fuel2Pct: clamp(jit(base.fuel2Pct, 0.05), 40, 100),
    fuel3Pct: clamp(jit(base.fuel3Pct, 0.05), 40, 100),
    gasketThou: clamp(Math.round(jit(base.gasketThou, 0.06)), 25, 60),
    ignitionCurve: base.ignitionCurve.map((v) => clamp(jit(v, 0.04), 20, 75)),
    driverAggressiveness: clamp(Math.round(jit(base.driverAggressiveness, 0.08)), 0, 100),
  };
}

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Generates the AI half of the field (the player is added separately by
// the caller, since only the player has a UI-driven tune). Names are drawn
// without replacement so nobody in one event shares a full name.
export function generateAiField(count, seed) {
  const rng = mulberry32(seed);
  const firstNames = shuffle(FIRST_NAMES, rng);
  const lastNames = shuffle(LAST_NAMES, rng);
  const teamNames = shuffle(TEAM_NAMES, rng);
  const entrants = [];
  for (let i = 0; i < count; i++) {
    const archetype = AI_ARCHETYPES[Math.floor(rng() * AI_ARCHETYPES.length)];
    entrants.push({
      id: `ai${i}`,
      name: `${firstNames[i % firstNames.length]} ${lastNames[i % lastNames.length]}`,
      team: teamNames[i % teamNames.length],
      archetype: archetype.name,
      tune: jitterTune(archetype.tune, rng),
      isPlayer: false,
      quals: [null, null, null, null],
      bestEt: null,
      bestMph: null,
      qualPosition: null,
      qualified: false,
      eliminated: false,
      eliminatedRound: null,
    });
  }
  return entrants;
}

// Q1 has no prior standings to order by, so it's shuffled. From Q2 on, the
// field runs worst-current-time-first, best-last - "if you were quick last
// round, you run later in the session."
export function deriveRunningOrder(entrants, sessionIndex, seed) {
  if (sessionIndex === 0) {
    return shuffle(entrants, mulberry32(seed));
  }
  return [...entrants].sort((a, b) => (b.bestEt ?? Infinity) - (a.bestEt ?? Infinity));
}

// Runs one entrant's qualifying attempt for this session and records it.
// skip=true just leaves their existing best (or lack of one) untouched -
// the "sla deze ronde over" option.
export function runQualifyingAttempt(entrant, sessionIndex, conditions, skip) {
  if (skip) {
    entrant.quals[sessionIndex] = null;
    return null;
  }
  const settings = { ...entrant.tune, ...conditions };
  const result = runSimulation(settings);
  entrant.quals[sessionIndex] = result;
  if (result.finished && (entrant.bestEt === null || result.et < entrant.bestEt)) {
    entrant.bestEt = result.et;
    entrant.bestMph = result.mph;
  }
  return result;
}

// Ranks the whole field by best qualifying ET (ascending - no time is
// worst) and marks the top `bracketSize` as qualified. Mutates and
// returns the entrants in ranked order.
export function computeQualifyingLadder(entrants, bracketSize) {
  const ranked = [...entrants].sort((a, b) => (a.bestEt ?? Infinity) - (b.bestEt ?? Infinity));
  ranked.forEach((e, i) => {
    e.qualPosition = i + 1;
    e.qualified = e.bestEt !== null && i < bracketSize;
  });
  return ranked;
}

// Largest power of two that both fits the field and doesn't exceed
// maxBracket. The bracket is sized off total ENTRIES at event start, but
// only entrants who actually post a valid qualifying time fill it - a car
// that DNFs all 4 sessions never qualifies even if there'd be room, which
// can leave a round with an odd number of survivors. See pairBracketRound
// for how that's handled (a bye), rather than assuming it away.
export function deriveBracketSize(totalEntries, maxBracket) {
  let size = 1;
  while (size * 2 <= totalEntries && size * 2 <= maxBracket) size *= 2;
  return size;
}

// Standard NHRA ladder pairing: best seed vs worst seed, working inward.
// Call again each round on that round's survivors (still ordered by their
// ORIGINAL qualifying seed) rather than re-seeding - a real eliminator
// ladder is fixed at qualifying, not redrawn round to round.
// An odd survivor count (a qualifier's opponent already lost the field
// via DNF, not via a real pairing) gives the single best remaining seed a
// bye - real NHRA practice when a round comes up short a car - returned
// separately from pairs rather than self-paired.
export function pairBracketRound(survivorsBySeed) {
  const list = [...survivorsBySeed];
  const bye = list.length % 2 === 1 ? list.shift() : null;
  const n = list.length;
  const pairs = [];
  for (let i = 0; i < n / 2; i++) {
    pairs.push([list[i], list[n - 1 - i]]);
  }
  return { pairs, bye };
}

// Lane choice: real tracks are never perfectly identical side to side, so
// each elimination round gets two lane variants (small grip/track-temp
// deltas off that round's base conditions) that persist for the whole
// round - the same two physical lanes every pair uses, not a fresh draw
// per pair. The better-qualified driver in each pair picks; this is a
// genuine (if modest) strategic choice, not cosmetic.
export function generateLaneVariants(baseConditions, rng) {
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const gripDelta = (rng() * 2 - 1) * 6;
  const trackDelta = (rng() * 2 - 1) * 3;
  return {
    A: { ...baseConditions, gripSliderPct: clamp(baseConditions.gripSliderPct + gripDelta, 20, 100), trackTempC: clamp(baseConditions.trackTempC + trackDelta, 15, 65) },
    B: { ...baseConditions, gripSliderPct: clamp(baseConditions.gripSliderPct - gripDelta, 20, 100), trackTempC: clamp(baseConditions.trackTempC - trackDelta, 15, 65) },
  };
}

// Simple AI heuristic for lane choice: take the grippier lane. Used both
// for AI-vs-AI pairs and to tell the player which lane is left when their
// opponent (not them) has the pick.
export function pickBetterLane(lanes) {
  return lanes.A.gripSliderPct >= lanes.B.gripSliderPct ? "A" : "B";
}

// Real Top Fuel reaction times run roughly 0.000-0.150s off a pro tree;
// more aggressive drivers cut it closer to zero on average (faster) but
// with more spread - meaning a real chance of leaving before green
// (negative reaction = red light = automatic loss, see resolveHeadToHead).
// This is deliberately the ONLY new "randomness" tied to aggressiveness -
// it reuses the existing slider rather than adding a separate one.
export function calcReactionTime(driverAggressiveness, rng) {
  const meanReaction = 0.12 - (driverAggressiveness / 100) * 0.08;
  const stdDev = 0.02 + (driverAggressiveness / 100) * 0.03;
  const u1 = Math.max(1e-9, rng());
  const u2 = rng();
  const gaussian = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return meanReaction + gaussian * stdDev;
}

// Determines the winner of a head-to-head pass. A red light (negative
// reaction) is an automatic loss regardless of ET - the real NHRA rule -
// unless both drivers red light, in which case whoever left LESS early
// still takes it. Otherwise it's reaction + ET ("package time") from the
// green light, the actual thing a finish-line win light is judging. A car
// that doesn't finish loses to one that does; if neither finishes,
// whoever covered more distance wins.
export function resolveHeadToHead(reactionA, resultA, reactionB, resultB) {
  const foulA = reactionA < 0;
  const foulB = reactionB < 0;
  if (foulA && foulB) return reactionA > reactionB ? "A" : "B";
  if (foulA) return "B";
  if (foulB) return "A";
  if (resultA.finished && resultB.finished) {
    return reactionA + resultA.et <= reactionB + resultB.et ? "A" : "B";
  }
  if (resultA.finished) return "A";
  if (resultB.finished) return "B";
  const distA = resultA.trace.length ? resultA.trace[resultA.trace.length - 1].x : 0;
  const distB = resultB.trace.length ? resultB.trace[resultB.trace.length - 1].x : 0;
  return distA >= distB ? "A" : "B";
}

export { AI_ARCHETYPES, mulberry32 };
