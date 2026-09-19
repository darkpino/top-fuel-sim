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

// getState/setState let a save system snapshot exactly where a given rng
// stream is (not just its original seed) and restore it later - without
// this, reloading a saved event would replay the SAME sequence of "random"
// outcomes from the top instead of continuing from where the event actually
// was, silently desyncing a resumed event from the one that was saved.
function mulberry32(seed) {
  let s = seed | 0;
  const fn = function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  fn.getState = () => s;
  fn.setState = (v) => { s = v | 0; };
  return fn;
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
//
// Every tune below is deliberately close to the player's own default -
// each field (power tune AND clutch curve) sits at only 30% of its
// original distance from default. That's not timidity: the model is
// sensitive enough near the calibration point that the OLD, full-strength
// spread compounded (blower+nitro+lockup all a bit hotter at once) into
// archetypes that could post sub-3.4s under nothing more than ordinary
// luck - well past the real ~3.6s wall no NHRA run has ever crossed.
// Personality still reads clearly in the achievable ET spread (see
// docs/nhra-reference-times.md) - Wildcard Rookie and Aggressive Gambler
// still qualify quicker than Budget Team - it just no longer requires
// breaking the sport's own physics to do it.
const AI_ARCHETYPES = [
  {
    name: "Balanced Pro",
    tune: {
      blowerOD: 48.6, fuelPct: 90,
      fuel1time: 0.8, fuel1pct: 70.6, fuel2time: 1.25, fuel2pct: 78.36, fuel3time: 1.75, fuel3pct: 90,
      fuel4time: 2.95, fuel4pct: 90, fuel5time: 3.6, fuel5pct: 87.5, fuel6time: 4.2, fuel6pct: 85,
      gasketThou: 39,
      ignitionCurve: [62, 58, 52.3, 46.3, 42.3, 38.3],
      s1time: 0.8, s1pct: 0.65, s1speed: 5.0, s2time: 1.25, s2pct: 0.67, s2speed: 0.2, s3time: 1.75, s3pct: 0.69, s3speed: 0.1,
      s4time: 2.2, s4pct: 0.73, s4speed: 0.2, s5time: 2.6, s5pct: 0.85, s5speed: 0.8, s6time: 2.95, s6pct: 1.0, s6speed: 1.6,
      fingerWeight: 100, tirePsi: 7.5, wingAngle: 0, frontWingPct: 55, wheelieBarHeightIn: 2.5, ballastFrontLb: 20, ballastRearLb: 0,
      driverAggressiveness: 70, driverWatchUntilFt: 660, driverShutoffFt: 1000,
    },
  },
  {
    name: "Aggressive Gambler",
    tune: {
      blowerOD: 51.6, fuelPct: 90,
      fuel1time: 0.8, fuel1pct: 72.4, fuel2time: 1.25, fuel2pct: 80.04, fuel3time: 1.75, fuel3pct: 91.5,
      fuel4time: 2.95, fuel4pct: 91.5, fuel5time: 3.6, fuel5pct: 89, fuel6time: 4.2, fuel6pct: 86.5,
      gasketThou: 37,
      ignitionCurve: [62.9, 59.2, 53.8, 47.8, 43.2, 39.2],
      s1time: 0.772, s1pct: 0.658, s1speed: 5.107, s2time: 1.206, s2pct: 0.678, s2speed: 0.204, s3time: 1.688, s3pct: 0.698, s3speed: 0.102,
      s4time: 2.122, s4pct: 0.738, s4speed: 0.204, s5time: 2.508, s5pct: 0.857, s5speed: 0.817, s6time: 2.846, s6pct: 1.0, s6speed: 1.634,
      fingerWeight: 100, tirePsi: 7.2, wingAngle: 0.5, frontWingPct: 45, wheelieBarHeightIn: 2.8, ballastFrontLb: 0, ballastRearLb: 0,
      driverAggressiveness: 76, driverWatchUntilFt: 1000, driverShutoffFt: 1000,
    },
  },
  {
    name: "Conservative Veteran",
    tune: {
      blowerOD: 46.8, fuelPct: 88,
      fuel1time: 0.8, fuel1pct: 69.4, fuel2time: 1.25, fuel2pct: 77.04, fuel3time: 1.75, fuel3pct: 88.5,
      fuel4time: 2.95, fuel4pct: 88.5, fuel5time: 3.6, fuel5pct: 86, fuel6time: 4.2, fuel6pct: 83.5,
      gasketThou: 41,
      ignitionCurve: [60.8, 57.1, 51.4, 45.7, 41.7, 37.7],
      s1time: 0.814, s1pct: 0.643, s1speed: 4.893, s2time: 1.272, s2pct: 0.663, s2speed: 0.196, s3time: 1.781, s3pct: 0.683, s3speed: 0.098,
      s4time: 2.239, s4pct: 0.722, s4speed: 0.196, s5time: 2.646, s5pct: 0.843, s5speed: 0.783, s6time: 3.002, s6pct: 0.994, s6speed: 1.566,
      fingerWeight: 95, tirePsi: 7.6, wingAngle: -0.5, frontWingPct: 60, wheelieBarHeightIn: 2.2, ballastFrontLb: 40, ballastRearLb: 20,
      driverAggressiveness: 64, driverWatchUntilFt: 660, driverShutoffFt: 1000,
    },
  },
  {
    name: "Budget Team",
    tune: {
      blowerOD: 43.8, fuelPct: 85,
      fuel1time: 0.8, fuel1pct: 68.5, fuel2time: 1.25, fuel2pct: 75.9, fuel3time: 1.75, fuel3pct: 87,
      fuel4time: 2.95, fuel4pct: 87, fuel5time: 3.6, fuel5pct: 84.65, fuel6time: 4.2, fuel6pct: 82.3,
      gasketThou: 42,
      ignitionCurve: [59.9, 56.2, 50.8, 45.4, 41.4, 37.4],
      s1time: 0.808, s1pct: 0.638, s1speed: 4.786, s2time: 1.263, s2pct: 0.658, s2speed: 0.191, s3time: 1.769, s3pct: 0.678, s3speed: 0.096,
      s4time: 2.223, s4pct: 0.718, s4speed: 0.191, s5time: 2.628, s5pct: 0.838, s5speed: 0.766, s6time: 2.981, s6pct: 0.985, s6speed: 1.531,
      fingerWeight: 90, tirePsi: 7.5, wingAngle: 0, frontWingPct: 50, wheelieBarHeightIn: 2.5, ballastFrontLb: 0, ballastRearLb: 0,
      driverAggressiveness: 69, driverWatchUntilFt: 660, driverShutoffFt: 1000,
    },
  },
  {
    name: "Clutch Specialist",
    tune: {
      blowerOD: 49.2, fuelPct: 90,
      fuel1time: 0.8, fuel1pct: 71.2, fuel2time: 1.25, fuel2pct: 78.96, fuel3time: 1.75, fuel3pct: 90.6,
      fuel4time: 2.95, fuel4pct: 90.6, fuel5time: 3.6, fuel5pct: 88.1, fuel6time: 4.2, fuel6pct: 85.6,
      gasketThou: 39,
      ignitionCurve: [61.7, 57.7, 52, 46, 42, 38],
      s1time: 0.786, s1pct: 0.653, s1speed: 5.214, s2time: 1.228, s2pct: 0.673, s2speed: 0.209, s3time: 1.719, s3pct: 0.693, s3speed: 0.104,
      s4time: 2.161, s4pct: 0.733, s4speed: 0.209, s5time: 2.554, s5pct: 0.853, s5speed: 0.834, s6time: 2.898, s6pct: 1.0, s6speed: 1.669,
      fingerWeight: 100, tirePsi: 7.4, wingAngle: 0, frontWingPct: 55, wheelieBarHeightIn: 2.4, ballastFrontLb: 10, ballastRearLb: 0,
      driverAggressiveness: 72, driverWatchUntilFt: 1000, driverShutoffFt: 1000,
    },
  },
  {
    name: "Wildcard Rookie",
    tune: {
      blowerOD: 51, fuelPct: 91,
      fuel1time: 0.8, fuel1pct: 71.8, fuel2time: 1.25, fuel2pct: 78.84, fuel3time: 1.75, fuel3pct: 89.4,
      fuel4time: 2.95, fuel4pct: 89.4, fuel5time: 3.6, fuel5pct: 86.75, fuel6time: 4.2, fuel6pct: 84.1,
      gasketThou: 38,
      ignitionCurve: [62.6, 58.6, 52.9, 46.9, 42.6, 38.6],
      s1time: 0.758, s1pct: 0.662, s1speed: 5.321, s2time: 1.184, s2pct: 0.682, s2speed: 0.213, s3time: 1.657, s3pct: 0.702, s3speed: 0.106,
      s4time: 2.084, s4pct: 0.742, s4speed: 0.213, s5time: 2.462, s5pct: 0.862, s5speed: 0.851, s6time: 2.794, s6pct: 1.0, s6speed: 1.703,
      fingerWeight: 100, tirePsi: 7.0, wingAngle: 0.5, frontWingPct: 40, wheelieBarHeightIn: 3.0, ballastFrontLb: 0, ballastRearLb: 0,
      driverAggressiveness: 75, driverWatchUntilFt: 1000, driverShutoffFt: 1000,
    },
  },
];

// Reliability, not raw pace: the player's own garage/team choices feed
// garageEngineDamageMult/garageClutchDamageMult into runSimulation (>1 =
// damage builds up faster, <1 = slower - see garage.js/team.js), but AI
// opponents never went through any equivalent of that system at all - they
// always ran the exact neutral 1.0 default, on every archetype, every car.
// Combined with the archetype tunes themselves being deliberately mild
// (see AI_ARCHETYPES above), that's the reason AI opponents essentially
// never smoke an engine or lose a cylinder: nothing about them ever put
// real risk on the table in the first place. This gives each archetype a
// baseline "how well-prepared is this team" reliability profile, then
// jitters it per car (same pattern as jitterTune below) so two cars on the
// same archetype aren't equally reliable either. Budget Team runs
// meaningfully hotter risk than Conservative Veteran, matching what their
// names already imply about the tunes themselves.
// spread is deliberately wider than a simple shifted mean would need on
// its own - a "risky" archetype isn't just uniformly worse every single
// run, it's more VARIABLE: usually fine, occasionally a real problem. The
// archetype tunes themselves already run hotter/cooler (Aggressive Gambler
// and Wildcard Rookie push blower/nitro harder than Conservative Veteran,
// see AI_ARCHETYPES above), which is why they need less of a reliability
// swing to ever reach the failure thresholds - this is what actually
// closes the gap, not the mean alone.
const AI_RELIABILITY = {
  "Balanced Pro": { engineDamageMult: 1.4, clutchDamageMult: 1.0, spread: 0.45 },
  "Aggressive Gambler": { engineDamageMult: 2.4, clutchDamageMult: 1.3, spread: 0.75 },
  "Conservative Veteran": { engineDamageMult: 1.0, clutchDamageMult: 0.8, spread: 0.25 },
  "Budget Team": { engineDamageMult: 4.2, clutchDamageMult: 1.5, spread: 0.9 },
  "Clutch Specialist": { engineDamageMult: 1.4, clutchDamageMult: 0.7, spread: 0.4 },
  "Wildcard Rookie": { engineDamageMult: 2.35, clutchDamageMult: 1.4, spread: 0.75 },
};

function jitterReliability(archetypeName, rng) {
  const base = AI_RELIABILITY[archetypeName] || { engineDamageMult: 1, clutchDamageMult: 1, spread: 0.2 };
  const jit = (v) => Math.max(0.6, Math.min(6, v * (1 + (rng() * 2 - 1) * base.spread)));
  return {
    garageEngineDamageMult: jit(base.engineDamageMult),
    garageClutchDamageMult: jit(base.clutchDamageMult),
  };
}

// Race-day variance, not tuning skill - kept small (was up to 6-8%, now
// 1.5-2.5%) for the same reason the archetype spread above got pulled
// in: this model is sensitive enough near the calibration point that
// even "random luck" at the old magnitude could push an already-decent
// tune past the sport's real-world ET floor.
//
// The clutch curve (s1..s6 time/pct) and fingerWeight were originally left
// UNjittered - only the archetype's own baked-in curve varied them, and
// several cars in a field share an archetype. That meant every car on a
// given archetype ran an identical clutch curve, the single biggest lever
// on ET, so qualifying often showed a cluster of cars running suspiciously
// close to the same time. Jittering the curve too (same small magnitude
// as everything else here) means no two cars - even same-archetype ones -
// ever share an exactly identical tune.
function jitterTune(base, rng) {
  const jit = (v, pct) => v * (1 + (rng() * 2 - 1) * pct);
  return {
    ...base,
    blowerOD: clamp(jit(base.blowerOD, 0.02), 20, 70),
    fuel1pct: clamp(jit(base.fuel1pct, 0.015), 40, 100),
    fuel2pct: clamp(jit(base.fuel2pct, 0.015), 40, 100),
    fuel3pct: clamp(jit(base.fuel3pct, 0.015), 40, 100),
    fuel4pct: clamp(jit(base.fuel4pct, 0.015), 40, 100),
    fuel5pct: clamp(jit(base.fuel5pct, 0.015), 40, 100),
    fuel6pct: clamp(jit(base.fuel6pct, 0.015), 40, 100),
    gasketThou: clamp(Math.round(jit(base.gasketThou, 0.02)), 25, 60),
    ignitionCurve: base.ignitionCurve.map((v) => clamp(jit(v, 0.015), 20, 75)),
    driverAggressiveness: clamp(Math.round(jit(base.driverAggressiveness, 0.025)), 0, 100),
    s1time: clamp(jit(base.s1time, 0.008), 0, 1.0),
    s2time: clamp(jit(base.s2time, 0.008), 0.5, 1.5),
    s3time: clamp(jit(base.s3time, 0.008), 1.0, 2.0),
    s4time: clamp(jit(base.s4time, 0.008), 1.5, 2.5),
    s5time: clamp(jit(base.s5time, 0.008), 1.8, 3.0),
    s6time: clamp(jit(base.s6time, 0.008), 2.0, 3.5),
    s1pct: clamp(jit(base.s1pct, 0.008), 0.1, 0.9),
    s2pct: clamp(jit(base.s2pct, 0.008), 0.1, 0.9),
    s3pct: clamp(jit(base.s3pct, 0.008), 0.1, 0.95),
    s4pct: clamp(jit(base.s4pct, 0.008), 0.1, 0.97),
    s5pct: clamp(jit(base.s5pct, 0.008), 0.1, 0.99),
    // Stage 6 (full-lockup ceiling) is the single biggest lever on ET of
    // any of these - kept to the tightest jitter of the curve so this
    // diversity pass can't reopen the "well under the sport's real ET
    // floor" outlier the earlier calibration pass fixed.
    s6pct: clamp(jit(base.s6pct, 0.004), 0.1, 1.0),
    fingerWeight: clamp(Math.round(jit(base.fingerWeight, 0.008)), 0, 100),
    // Chassis-level fields: previously identical across every car sharing
    // an archetype (only the powertrain/fuel/ignition side was jittered).
    // Modest effect on ET on their own (grip/wheelie-risk, not raw power),
    // which is exactly why they're useful here - variety without pushing
    // the pace envelope.
    tirePsi: clamp(jit(base.tirePsi, 0.03), 6.0, 9.0),
    // Additive, not multiplicative: several archetypes sit at exactly 0
    // (no wing trim / no ballast) - a multiplicative jitter on zero stays
    // zero forever, which would leave those archetypes' cars undiversified.
    wingAngle: clamp(base.wingAngle + (rng() * 2 - 1) * 0.15, -2, 1),
    frontWingPct: clamp(Math.round(jit(base.frontWingPct, 0.06)), 0, 100),
    wheelieBarHeightIn: clamp(jit(base.wheelieBarHeightIn, 0.04), 0.5, 4.0),
    ballastFrontLb: clamp(Math.round(base.ballastFrontLb + (rng() * 2 - 1) * 15), 0, 250),
    ballastRearLb: clamp(Math.round(base.ballastRearLb + (rng() * 2 - 1) * 10), 0, 150),
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
      tune: { ...jitterTune(archetype.tune, rng), ...jitterReliability(archetype.name, rng) },
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
  // finished means a real photocell ET (crossed 1000ft) - see the same
  // note in ui/main.js's runPlayerQualifying, which this mirrors for AI
  // entrants: engineFailed/clutchFailed can both still be true on a run
  // that finished (a late failure right at the stripe), and that ET is
  // exactly as real as any other.
  if (result.finished && !result.weightIllegal && (entrant.bestEt === null || result.et < entrant.bestEt)) {
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
    A: { ...baseConditions, gripSliderPct: clamp(baseConditions.gripSliderPct + gripDelta, 15, 100), trackTempC: clamp(baseConditions.trackTempC + trackDelta, 15, 65) },
    B: { ...baseConditions, gripSliderPct: clamp(baseConditions.gripSliderPct - gripDelta, 15, 100), trackTempC: clamp(baseConditions.trackTempC - trackDelta, 15, 65) },
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
// reactionMult is a second, independent axis on top of that: WHO is behind
// the wheel, not how hard you've told them to push. A quicker, more
// consistent driver (mult > 1) shrinks BOTH the mean and the spread by the
// same factor - faster on average AND less likely to produce an outlier
// (red light) at either end; 1.0 (no hired driver, or a neutral one) is an
// exact no-op reproducing the original formula.
export function calcReactionTime(driverAggressiveness, rng, reactionMult = 1) {
  const meanReaction = (0.12 - (driverAggressiveness / 100) * 0.08) / reactionMult;
  const stdDev = (0.02 + (driverAggressiveness / 100) * 0.03) / reactionMult;
  const u1 = Math.max(1e-9, rng());
  const u2 = rng();
  const gaussian = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return meanReaction + gaussian * stdDev;
}

// Determines the winner of a head-to-head pass. A red light (negative
// reaction) is an automatic loss regardless of ET - the real NHRA rule -
// unless both drivers red light, in which case whoever left LESS early
// still takes it. An underweight car is the same kind of automatic loss,
// just caught after the run instead of at the tree - checked second so a
// red light (which ends the race before the run even happens) still takes
// priority over a scale DQ discovered afterward. Otherwise it's reaction +
// ET ("package time") from the green light, the actual thing a
// finish-line win light is judging. A car that doesn't finish loses to
// one that does; if neither finishes, whoever covered more distance wins.
export function resolveHeadToHead(reactionA, resultA, reactionB, resultB) {
  const foulA = reactionA < 0;
  const foulB = reactionB < 0;
  if (foulA && foulB) return reactionA > reactionB ? "A" : "B";
  if (foulA) return "B";
  if (foulB) return "A";
  // Only a lone DQ is an automatic loss - if both cars are underweight,
  // neither gets the "opponent DQ'd" freebie and it falls through to the
  // normal comparison below, same as a real double-DQ pass.
  if (resultA.weightIllegal && !resultB.weightIllegal) return "B";
  if (resultB.weightIllegal && !resultA.weightIllegal) return "A";
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
