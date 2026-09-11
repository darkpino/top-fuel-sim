// Finances module: budget, transactions, entry fees, run costs, prize
// money and sponsor offers. Pure data/functions, no DOM access - mirrors
// the pattern in sim-core/garage.js and sim-core/ladder.js. Repair costs
// scale with the price of the equipped part that failed (so a Vortan
// motor costs more to fix than an Ironclad one).

import { equippedPartPrice, consumeSpareOnFailure, unequipPart, spareLabel, markPartBroken, isPartBroken, clearPartBroken } from "./garage.js";

export const STARTING_BUDGET = 75000;
export const ENTRY_FEE = 2500;
export const RUN_COST = 850;

// Repair cost (no spare on hand) as a fraction of the equipped part's
// price - a full bottom-end rebuild (engine) or a clutch pack (labor-
// intensive, has to come apart every time regardless of what failed) run
// higher than a head or blower swap.
export const REPAIR_FRACTION = { engine: 0.35, head: 0.3, blower: 0.3, clutch: 0.5 };

// Even with a spare on the trailer, a crew still has to pull the dead
// part and mount the spare between rounds - real labor, on the clock.
// Small next to a full repair, but no longer zero: carrying spares stays
// clearly the right call, it just isn't a free one anymore.
export const SPARE_SWAP_LABOR_FRACTION = 0.08;

// Some failures are too violent to fix at the track at all - not just an
// expensive rebuild, but something a spare can't paper over either (a
// blower explosion that takes the manifold and wiring with it, a rod
// through the block that wrecks the oiling system). On this roll the
// equipped part is a genuine write-off: unmounted outright regardless of
// what's sitting in the trailer, and the team can't finish THIS event on
// that part - a spare (if any) is still there to hand-install before the
// next one, see garage.js's unequipPart/installUnit.
export const CATASTROPHIC_CHANCE = 0.15;
export const CATASTROPHIC_FEE_FRACTION = 0.12;

export const SPONSOR_NAMES = [
  "Redline Energy", "Apex Fuels", "Thunderbolt Batteries", "Ironhide Tools",
  "Momentum Finance Group", "Blaze Nitro Additives", "Vertex Racing Wear",
  "Highline Transport", "Northstar Insurance", "Coyote Brake Systems",
  "Pit Lane Media", "Overdrive Sponsorship Network",
];

export function defaultFinancesState() {
  return { budget: STARTING_BUDGET, transactions: [], sponsorOffers: [] };
}

export function addTransaction(state, label, amount) {
  state.budget += amount;
  state.transactions.unshift({ label, amount, balance: state.budget });
  if (state.transactions.length > 40) state.transactions.length = 40;
  return state;
}

export function chargeEntryFee(state) {
  return addTransaction(state, "Inschrijfgeld evenement", -ENTRY_FEE);
}

export function chargeRunCost(state, label = "Run kosten (brandstof, crew)") {
  return addTransaction(state, label, -RUN_COST);
}

// Team wages (see team.js's totalTeamWagesPerEvent) are charged once per
// event, same timing as the entry fee - a pay driver's negative salary
// means this can also be a net CREDIT, sponsorship money coming in through
// the driver rather than going out.
export function chargeTeamWages(state, totalWagesPerEvent) {
  if (totalWagesPerEvent === 0) return state;
  const label = totalWagesPerEvent > 0 ? "Teamsalarissen" : "Sponsorbijdrage pay driver(s)";
  return addTransaction(state, label, -totalWagesPerEvent);
}

// Real nitro engine failures are rarely a clean single-part event - an
// over-driven blower running hot can let go on its own or take the short
// block with it; a lean burn-down just as often shows up as a holed
// piston or a burnt head as "the engine" in the abstract. cause comes
// straight from run-simulator.js's engineFailCause ("heat", "lean", or
// "hydrolock") - heat-side failures skew toward the blower, lean-side
// skew toward the heads, hydrolock is overwhelmingly a bent-rod/short-
// block event (a liquid-locked cylinder hits the crank and rod, not the
// heads or the blower), and any of the three can (SECONDARY_FAILURE_CHANCE)
// take a second part with it. Returns 1 or 2 part names from {engine,
// head, blower}; the actual charge for each happens separately via
// chargePartFailure so a spare (or lack of one) is checked per part,
// independently.
const ENGINE_SIDE_PARTS = ["engine", "head", "blower"];
const SECONDARY_FAILURE_CHANCE = 0.25;

export function rollEnginePartsFailed(cause, rng = Math.random) {
  const primary = cause === "heat"
    ? (rng() < 0.6 ? "blower" : "engine")
    : cause === "hydrolock"
    ? (rng() < 0.85 ? "engine" : "head")
    : (rng() < 0.55 ? "head" : "engine");
  const parts = [primary];
  if (rng() < SECONDARY_FAILURE_CHANCE) {
    const rest = ENGINE_SIDE_PARTS.filter((p) => p !== primary);
    parts.push(rest[Math.floor(rng() * rest.length)]);
  }
  return parts;
}

// The one place a broken part gets RECORDED - engine, head, blower or
// clutch alike. Three outcomes, in escalating cost and consequence:
//  - a spare on hand: swap-labor fee only (SPARE_SWAP_LABOR_FRACTION),
//    keeps racing on the spare right away
//  - no spare: the part stays mounted but is marked broken (see garage.js's
//    markPartBroken) - NOT usable again, this event or any other, until
//    the player explicitly pays to fix it (repairPartUnit below). No
//    money changes hands here for that branch - repairing is a separate,
//    player-initiated step, not something a failure quietly pays for
//    itself.
//  - catastrophic (rolled independently of spare availability): the part
//    is a write-off, unmounted on the spot, regardless of any spare
// Returns "spared", "broken", or "fatal" (no working unit of this part
// for the rest of THIS event, either way - see garage.js's isCarRaceReady).
export function chargePartFailure(state, garageConfig, part, rng = Math.random, catastrophicMult = 1) {
  const label = spareLabel(part);
  const cap = label.charAt(0).toUpperCase() + label.slice(1);
  const priceBefore = equippedPartPrice(garageConfig, part);
  if (rng() < CATASTROPHIC_CHANCE * catastrophicMult) {
    unequipPart(garageConfig, part);
    const fee = Math.round(priceBefore * CATASTROPHIC_FEE_FRACTION);
    addTransaction(state, `${cap} total loss — onherstelbaar aan de baan, moet voor het volgende evenement vervangen worden`, -fee);
    return "fatal";
  }
  if (consumeSpareOnFailure(garageConfig, part)) {
    const fee = Math.round(priceBefore * SPARE_SWAP_LABOR_FRACTION);
    addTransaction(state, `${cap}schade — reserve gemonteerd (montagekosten)`, -fee);
    return "spared";
  }
  markPartBroken(garageConfig, part);
  addTransaction(state, `${cap}schade — kapot, nog niet gerepareerd (zie Auto bouwen)`, 0);
  return "broken";
}

// The explicit, player-initiated fix for a broken part (garage.js's
// markPartBroken) - unlike the old behavior, a failure no longer pays for
// its own repair as a side effect; this is the only place that actually
// happens, and only when the player triggers it (the garage panel's
// "Repareer" action). Same cost as the old auto-repair (REPAIR_FRACTION),
// just moved to when the player actually asks for it - and it also
// resets the part's accumulated wear (clearPartBroken), a genuine rebuild
// rather than a patch. No-op (returns false, charges nothing) if the part
// isn't actually broken, so a stray call can't double-charge.
export function repairPartUnit(state, garageConfig, part) {
  if (!isPartBroken(garageConfig, part)) return false;
  const label = spareLabel(part);
  const cap = label.charAt(0).toUpperCase() + label.slice(1);
  const cost = Math.round(equippedPartPrice(garageConfig, part) * REPAIR_FRACTION[part]);
  clearPartBroken(garageConfig, part);
  addTransaction(state, `${cap}schade — reparatie`, -cost);
  return true;
}

function prizeForRoundsWon(roundsWon, champion) {
  const base = 3000 * Math.pow(1.8, roundsWon);
  return Math.round(champion ? base * 1.6 : base);
}

// outcome: { qualified, eliminatedRound (1-indexed round the player lost
// in, or null if never eliminated), totalElimRounds, champion }
export function awardEventPrize(state, outcome) {
  if (!outcome.qualified) return addTransaction(state, "Niet gekwalificeerd — geen prijzengeld", 0);
  const roundsWon = outcome.champion ? outcome.totalElimRounds : Math.max(0, outcome.eliminatedRound - 1);
  const amount = prizeForRoundsWon(roundsWon, outcome.champion);
  const label = outcome.champion
    ? "Prijzengeld — kampioen"
    : `Prijzengeld — uitgeschakeld in eliminatieronde ${outcome.eliminatedRound}`;
  return addTransaction(state, label, amount);
}

export function generateSponsorOffers(rng = Math.random, count = 2, amountMult = 1) {
  const pool = [...SPONSOR_NAMES];
  const offers = [];
  for (let i = 0; i < count && pool.length; i++) {
    const idx = Math.floor(rng() * pool.length);
    const name = pool.splice(idx, 1)[0];
    const amount = Math.round(((4000 + rng() * 16000) * amountMult) / 100) * 100;
    offers.push({ id: `${name}-${Date.now()}-${i}`, name, amount });
  }
  return offers;
}
