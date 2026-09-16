// Team module: the human side of the operation - driver, car chief,
// sponsor scout - alongside the parts catalog in garage.js. Pure
// data/functions, no DOM access, same brand-tiering pattern as garage.js
// (a roster of hireable candidates, each with a price and a set of
// multipliers that default to a neutral 1.0/0 baseline so an empty team
// reproduces exactly the pre-team physics/economy).
//
// Unlike parts, a hire isn't bought outright and mounted - it's a standing
// wage (salaryPerEvent), charged once per event alongside the entry fee
// (see finances.js's chargeTeamWages), and can be swapped for a different
// candidate at any time with no severance cost. A "pay driver" runs the
// real motorsport convention in reverse: instead of the team paying them,
// they bring sponsorship money of their own, so salaryPerEvent is
// negative - cheap (or better than free) in exchange for weaker, noisier
// driving. Most pay drivers are genuinely worse; a couple aren't, because
// that's also how it goes in real racing - money buys a seat, not always a
// bad one.

export const DRIVERS = [
  {
    id: "payflash", name: '"Flash" Dekker (pay driver)',
    salaryPerEvent: -1500,
    reactionMult: 0.85, carControlMult: 0.80, disciplineMult: 0.55,
  },
  {
    id: "paygem", name: "Tobias van Rijn (pay driver, verrassend goed)",
    salaryPerEvent: -3000,
    reactionMult: 1.02, carControlMult: 0.95, disciplineMult: 0.65,
  },
  {
    id: "rookie", name: "Sanne de Wit (rookie)",
    salaryPerEvent: 3000,
    reactionMult: 0.92, carControlMult: 0.90, disciplineMult: 0.85,
  },
  {
    id: "pro", name: "Mike Halvorsen (pro)",
    salaryPerEvent: 9000,
    reactionMult: 1.00, carControlMult: 1.00, disciplineMult: 1.00,
  },
  {
    id: "veteran", name: "Dale \"Steady\" Kowalski (veteran)",
    salaryPerEvent: 15000,
    reactionMult: 1.06, carControlMult: 1.08, disciplineMult: 1.10,
  },
  {
    id: "champion", name: "Rachel Voss (kampioen)",
    salaryPerEvent: 24000,
    reactionMult: 1.12, carControlMult: 1.12, disciplineMult: 1.15,
  },
];

// Car chief: keeps the build itself honest - correct torque specs, fresh
// fasteners, a clean assembly - independent of which part BRANDS are
// mounted (garage.js already prices that in). engineDamageMult/
// clutchDamageMult multiply directly into the SAME damage-rate multipliers
// computeGarageEffects produces, so a good chief makes a cheap build hold
// together noticeably longer without touching a single part's own rating.
// catastrophicMult scales CATASTROPHIC_CHANCE in finances.js - a careful
// assembly is less likely to fail in the un-fixable, take-something-else-
// with-it way, not just less likely to fail at all.
export const CAR_CHIEFS = [
  {
    id: "shadetree", name: "Cole \"Shadetree\" Briggs (budget)",
    salaryPerEvent: 2500,
    engineDamageMult: 1.15, clutchDamageMult: 1.15, catastrophicMult: 1.25,
  },
  {
    id: "solid", name: "Marisol Peña (degelijk)",
    salaryPerEvent: 7000,
    engineDamageMult: 1.00, clutchDamageMult: 1.00, catastrophicMult: 1.00,
  },
  {
    id: "sharp", name: "Owen Fairweather (scherp)",
    salaryPerEvent: 13000,
    engineDamageMult: 0.88, clutchDamageMult: 0.88, catastrophicMult: 0.80,
  },
  {
    id: "elite", name: "Dr. Priya Nandakumar (elite)",
    salaryPerEvent: 21000,
    engineDamageMult: 0.75, clutchDamageMult: 0.75, catastrophicMult: 0.60,
  },
];

// Sponsor scout: doesn't touch the car at all - just how many sponsor
// offers show up after an event (offerCountBonus, added to the base count
// generateSponsorOffers is called with) and how generous they are on
// average (offerAmountMult, scales the whole offer range). A better-
// connected scout gets more AND better offers, not just more.
export const SPONSOR_SCOUTS = [
  {
    id: "none-effective", name: "Jamie Ostrander (freelance)",
    salaryPerEvent: 1500,
    offerCountBonus: 0, offerAmountMult: 1.00,
  },
  {
    id: "networked", name: "Ines Carvalho (goed genetwerkt)",
    salaryPerEvent: 5000,
    offerCountBonus: 1, offerAmountMult: 1.20,
  },
  {
    id: "connected", name: "Big Tony Marchetti (dik verbonden)",
    salaryPerEvent: 11000,
    offerCountBonus: 2, offerAmountMult: 1.45,
  },
];

export const TEAM_ROLES = {
  driver: { list: DRIVERS, label: "rijder" },
  carChief: { list: CAR_CHIEFS, label: "car chief" },
  scout: { list: SPONSOR_SCOUTS, label: "sponsor-scout" },
};

export function findTeamMember(list, id) {
  return list.find((m) => m.id === id) || null;
}

// null everywhere: a new team starts with nobody hired, same "empty shop"
// convention as defaultGarageConfig - every multiplier below then falls
// back to its neutral 1.0/0 default and the team costs nothing, so an
// unhired team is an exact no-op against the pre-team simulation.
export function defaultTeamConfig() {
  return { driverId: null, carChiefId: null, scoutId: null };
}

export function hireTeamMember(config, role, id) {
  config[role + "Id"] = id;
}

export function fireTeamMember(config, role) {
  config[role + "Id"] = null;
}

// Turns a team config into the handful of modifiers the rest of the game
// accepts, all defaulting to a neutral no-op so an empty team reproduces
// exactly the pre-team behavior - same guarantee computeGarageEffects makes
// for an empty parts build.
export function computeTeamEffects(config) {
  const driver = config.driverId ? findTeamMember(DRIVERS, config.driverId) : null;
  const carChief = config.carChiefId ? findTeamMember(CAR_CHIEFS, config.carChiefId) : null;
  const scout = config.scoutId ? findTeamMember(SPONSOR_SCOUTS, config.scoutId) : null;

  return {
    teamReactionMult: driver ? driver.reactionMult : 1,
    teamCarControlMult: driver ? driver.carControlMult : 1,
    teamDisciplineMult: driver ? driver.disciplineMult : 1,
    teamEngineDamageMult: carChief ? carChief.engineDamageMult : 1,
    teamClutchDamageMult: carChief ? carChief.clutchDamageMult : 1,
    teamCatastrophicMult: carChief ? carChief.catastrophicMult : 1,
    teamSponsorOfferCountBonus: scout ? scout.offerCountBonus : 0,
    teamSponsorOfferAmountMult: scout ? scout.offerAmountMult : 1,
  };
}

export function totalTeamWagesPerEvent(config) {
  const driver = config.driverId ? findTeamMember(DRIVERS, config.driverId) : null;
  const carChief = config.carChiefId ? findTeamMember(CAR_CHIEFS, config.carChiefId) : null;
  const scout = config.scoutId ? findTeamMember(SPONSOR_SCOUTS, config.scoutId) : null;
  return (driver ? driver.salaryPerEvent : 0)
    + (carChief ? carChief.salaryPerEvent : 0)
    + (scout ? scout.salaryPerEvent : 0);
}
