// Finances module: budget, transactions, entry fees, run costs, prize
// money and sponsor offers. Pure data/functions, no DOM access - mirrors
// the pattern in sim-core/garage.js and sim-core/ladder.js. Repair costs
// scale with the price of the equipped part that failed (so a Vortan
// motor costs more to fix than an Ironclad one), and are waived (aside
// from consuming a spare) when the player is carrying a spare for that
// part - the direct payoff for having bought inventory ahead of time.

import { equippedPartPrice, consumeSpareOnFailure } from "./garage.js";

export const STARTING_BUDGET = 75000;
export const ENTRY_FEE = 2500;
export const RUN_COST = 850;
export const ENGINE_REPAIR_FRACTION = 0.35;
export const CLUTCH_REPAIR_FRACTION = 0.5;

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

export function chargeEngineFailure(state, garageConfig) {
  if (consumeSpareOnFailure(garageConfig, "engine")) {
    return addTransaction(state, "Motorschade — reservemotorblok gemonteerd", 0);
  }
  const cost = Math.round(equippedPartPrice(garageConfig, "engine") * ENGINE_REPAIR_FRACTION);
  return addTransaction(state, "Motorschade — reparatie", -cost);
}

export function chargeClutchFailure(state, garageConfig) {
  if (consumeSpareOnFailure(garageConfig, "clutch")) {
    return addTransaction(state, "Koppelingschade — reservekoppeling gemonteerd", 0);
  }
  const cost = Math.round(equippedPartPrice(garageConfig, "clutch") * CLUTCH_REPAIR_FRACTION);
  return addTransaction(state, "Koppelingschade — reparatie", -cost);
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

export function generateSponsorOffers(rng = Math.random, count = 2) {
  const pool = [...SPONSOR_NAMES];
  const offers = [];
  for (let i = 0; i < count && pool.length; i++) {
    const idx = Math.floor(rng() * pool.length);
    const name = pool.splice(idx, 1)[0];
    const amount = Math.round((4000 + rng() * 16000) / 100) * 100;
    offers.push({ id: `${name}-${Date.now()}-${i}`, name, amount });
  }
  return offers;
}
