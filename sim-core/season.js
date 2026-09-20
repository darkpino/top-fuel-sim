// Season module: a full points-chase across multiple events, layered on
// top of the existing single-event ladder/finance machinery (see event.js
// and ladder.js, which actually RUN each race - this module only owns the
// calendar, the team's home base/travel cost, and the points standings).
//
// Unlike a typical career mode, the CALENDAR isn't generated for the
// player - they build it themselves, picking a track for each round (the
// same track can be picked more than once), then decide event-by-event
// whether to actually attend (travel costs money and can't be undone;
// skipping costs nothing but earns no points that round either). Pure
// data/functions, no DOM access, same pattern as garage.js/team.js.

import { findTrack, TRACKS } from "./tracks.js";

export const SEASON_MIN_RACES = 4;

// The rival roster needs to cover the AI half of the biggest field any
// track can draw (see tracks.js's seasonFieldMax) - Indianapolis' 25 is
// currently the ceiling, so a pool of 24 always has enough named rivals to
// fill out even that round without ever needing to top up with anonymous
// one-off opponents.
export const RIVAL_POOL_SIZE = Math.max(...TRACKS.map((t) => t.seasonFieldMax)) - 1;

// How many cars actually show up to qualify at a given round - drawn
// fresh each time the player attends (same "not decided until you show
// up" spirit as that round's weather/opponents, also only generated at
// attend-time), from that specific TRACK's own seasonFieldMin/Max rather
// than a single fixed number for every venue. Keeps the player from
// having to reconfigure a field size every round while still making
// Indianapolis pack the show and a smaller market like Epping run thin,
// same as the real tour.
export function deriveSeasonFieldSize(trackId, rng = Math.random) {
  const track = findTrack(trackId);
  const span = track.seasonFieldMax - track.seasonFieldMin;
  return track.seasonFieldMin + Math.floor(rng() * (span + 1));
}

// NHRA Top Fuel-style points: every eliminator round survived is worth
// more of the total than qualifying alone, with a smaller bonus for a
// strong qualifying position so a bad elimination draw still isn't worth
// zero. Not the real tour's exact point values (those change by season
// and event tier) - close enough in shape to feel like a real points
// chase: winning the final is worth far more than a first-round exit.
const ROUND_WIN_POINTS = 20;
const CHAMPION_BONUS = 20;
const QUALIFYING_BONUS_BY_POSITION = [10, 8, 6, 5, 4, 3, 2, 1]; // top 8 qualifying spots only

export function qualifyingPointsForPosition(pos) {
  return pos >= 1 && pos <= QUALIFYING_BONUS_BY_POSITION.length ? QUALIFYING_BONUS_BY_POSITION[pos - 1] : 0;
}

// outcome: the same shape finances.js's awardEventPrize takes ({
// qualified, eliminatedRound, totalElimRounds, champion }), plus
// qualPosition (not needed by awardEventPrize, only by the qualifying
// bonus here) - the caller reads that off the player's field entry itself.
export function pointsForOutcome(outcome) {
  if (!outcome.qualified) return 0;
  const roundsWon = outcome.champion ? outcome.totalElimRounds : Math.max(0, outcome.eliminatedRound - 1);
  const roundPoints = roundsWon * ROUND_WIN_POINTS + (outcome.champion ? CHAMPION_BONUS : 0);
  return roundPoints + qualifyingPointsForPosition(outcome.qualPosition);
}

// null/empty everywhere: no season in progress is an inert, no-op state -
// same "empty shop" convention as defaultGarageConfig/defaultTeamConfig.
export function defaultSeasonState() {
  return {
    calendar: [], // [{ trackId }] - player-built, order matters, duplicates allowed
    baseTrackId: null, // team home base, reuses a TRACKS id for its coordinates
    active: false,
    roundIndex: 0, // index into calendar of the next round to decide on
    results: [], // one slot per calendar round once started: { trackId, attended, points, outcome? } | null
    totalPoints: 0,
    rivalPool: [], // [{ id, name, team, archetype }] - fixed for the season, drawn once in startSeason
    rivalPoints: {}, // rivalPool id -> cumulative season points, only rivals who've actually raced appear
  };
}

// Merges one event's rival points (id -> points earned THIS round) into the
// season's running totals - a rival not in the map yet (never raced before,
// or this is their first attended round) starts from 0.
export function addRivalPoints(season, pointsById) {
  for (const [id, points] of Object.entries(pointsById)) {
    season.rivalPoints[id] = (season.rivalPoints[id] || 0) + points;
  }
}

// Player + every rival who has raced at least once, ranked by points
// (descending, ties broken by whoever's listed first - stable sort).
// playerName/playerTeam let the caller supply the same labels shown
// elsewhere in the UI instead of season.js hardcoding "Jij".
export function seasonStandings(season, playerName, playerTeam) {
  const rows = [{ id: "player", name: playerName, team: playerTeam, points: season.totalPoints, isPlayer: true }];
  for (const rival of season.rivalPool) {
    if (!(rival.id in season.rivalPoints)) continue;
    rows.push({ id: rival.id, name: rival.name, team: rival.team, points: season.rivalPoints[rival.id], isPlayer: false });
  }
  return rows.sort((a, b) => b.points - a.points);
}

export function addRaceToCalendar(season, trackId) {
  season.calendar.push({ trackId });
}

export function removeRaceFromCalendar(season, index) {
  season.calendar.splice(index, 1);
}

export function startSeason(season) {
  season.active = true;
  season.roundIndex = 0;
  season.results = new Array(season.calendar.length).fill(null);
  season.totalPoints = 0;
}

function advanceSeasonRound(season) {
  season.roundIndex++;
  if (season.roundIndex >= season.calendar.length) season.active = false; // calendar exhausted - season over
}

// outcome must already carry qualPosition (see pointsForOutcome above).
export function recordAttendedResult(season, outcome) {
  const points = pointsForOutcome(outcome);
  season.results[season.roundIndex] = { trackId: season.calendar[season.roundIndex].trackId, attended: true, points, outcome };
  season.totalPoints += points;
  advanceSeasonRound(season);
}

export function recordSkippedResult(season) {
  season.results[season.roundIndex] = { trackId: season.calendar[season.roundIndex].trackId, attended: false, points: 0 };
  advanceSeasonRound(season);
}

// The round the player still needs to decide on (attend or skip), or null
// once the season is inactive (not yet started, or already finished).
export function currentSeasonRound(season) {
  if (!season.active || season.roundIndex >= season.calendar.length) return null;
  return { index: season.roundIndex, trackId: season.calendar[season.roundIndex].trackId };
}

// Haversine great-circle distance in miles - not a real driving distance
// (no roads), but good enough for a "further = pricier" travel-cost feel
// without needing a routing service.
function distanceMiles(a, b) {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// Flat per-event fee (loading/unloading the rig, crew per diem, basic
// logistics) plus a per-mile hauling cost - a cross-country haul (~2500mi,
// e.g. Seattle to Gainesville) lands around €4,000; a next-door race a few
// hundred miles out costs a few hundred euros, closer to nothing.
const TRAVEL_BASE_FEE = 300;
const TRAVEL_COST_PER_MILE = 1.5;

export function travelMilesFor(baseTrackId, trackId) {
  if (!baseTrackId) return null;
  return Math.round(distanceMiles(findTrack(baseTrackId), findTrack(trackId)));
}

export function travelCostFor(baseTrackId, trackId) {
  const miles = travelMilesFor(baseTrackId, trackId);
  return miles === null ? null : Math.round(TRAVEL_BASE_FEE + miles * TRAVEL_COST_PER_MILE);
}
