// Garage module: the car-build side of the finances system. Pure
// data/functions, no DOM access - a fictional parts catalog (engine
// blocks, cylinder heads, blowers) plus chassis-level build choices
// (body material, chassis length, fuel tank, clutch plate count, blower
// type, mudflaps, engine position), and the math that turns a build
// config into euros and into the small set of physics modifiers
// run-simulator.js accepts (weight, wheelie-risk equivalent, drag,
// clutch heat rate, traction, power, and how fast the engine accumulates
// heat/lean damage). Every brand carries a powerMult (better parts make
// more power) and a reliabilityMult (better parts tolerate more abuse
// before the engine lets go) alongside its price - the explicit
// "expensive parts are better AND more reliable, cheap parts are
// cheaper" tradeoff. A used unit knocks reliability down further based
// on how old it actually is (usedReliabilityMult) without touching power
// - a used part still makes the power it always did, it's just closer to
// the end of its life. Age is carried on the unit itself (ageMonths, 0 =
// bought new) rather than a flat secondhand flag, and used units come
// from a rotating market (generateUsedMarket) instead of a checkbox next
// to every brand - see USED_LISTINGS_PER_PART below.

// Reliability tiers are deliberately gentle (see garageEngineDamageMult
// below): the engine failure model is calibrated tight around the
// default tune (the whole point of that calibration - a real Top Fuel
// motor lives on a knife edge), so even a modest multiplier on the
// damage rate compounds fast over a run. A worst-case budget-everything-
// oldest-available-used build lands around 1.5x damage (survivable, but
// punishing and worth retuning conservatively for), not an unrecoverable
// 3-4x.
export const USED_AGE_MIN_MONTHS = 3;
export const USED_AGE_MAX_MONTHS = 60;
const USED_PRICE_MULT_AT_MIN_AGE = 0.90;
const USED_PRICE_MULT_FLOOR = 0.30;
const USED_RELIABILITY_MULT_AT_MIN_AGE = 0.97;
const USED_RELIABILITY_MULT_FLOOR = 0.80;

function usedAgeFraction(ageMonths) {
  return Math.max(0, Math.min(1, (ageMonths - USED_AGE_MIN_MONTHS) / (USED_AGE_MAX_MONTHS - USED_AGE_MIN_MONTHS)));
}
// A barely-used listing (near USED_AGE_MIN_MONTHS) is only a little
// cheaper than new; a well-worn one (near USED_AGE_MAX_MONTHS) is deeply
// discounted - real used-equipment depreciation, not a flat 55%-of-new
// regardless of condition.
export function usedPriceMult(ageMonths) {
  const f = usedAgeFraction(ageMonths);
  return USED_PRICE_MULT_AT_MIN_AGE + (USED_PRICE_MULT_FLOOR - USED_PRICE_MULT_AT_MIN_AGE) * f;
}
export function usedReliabilityMult(ageMonths) {
  const f = usedAgeFraction(ageMonths);
  return USED_RELIABILITY_MULT_AT_MIN_AGE + (USED_RELIABILITY_MULT_FLOOR - USED_RELIABILITY_MULT_AT_MIN_AGE) * f;
}

// The used-parts market: a handful of currently-available listings per
// ownable part, each a specific brand at a specific age (so two listings
// of the "same" brand can be very different buys). Regenerated wholesale
// by the caller (main.js, on every event start - see MARKET_KEY there) so
// the available stock actually turns over between events, not a fixed
// catalog sitting there forever.
export const USED_LISTINGS_PER_PART = 4;

export function generateUsedMarket(rng = Math.random) {
  const market = {};
  Object.keys(PARTS).forEach((part) => {
    const brands = PARTS[part].brands;
    market[part] = Array.from({ length: USED_LISTINGS_PER_PART }, (_, i) => {
      const brand = brands[Math.floor(rng() * brands.length)];
      const ageMonths = Math.round(USED_AGE_MIN_MONTHS + rng() * (USED_AGE_MAX_MONTHS - USED_AGE_MIN_MONTHS));
      return { id: `${part}-${Date.now()}-${i}-${Math.floor(rng() * 1e6)}`, brandId: brand.id, ageMonths };
    });
  });
  market.chassis = generateChassisMarket(rng);
  return market;
}

// weightDeltaLb follows the same "middle tier is the neutral baseline"
// shape as powerMult/reliabilityMult: the default brand (tier index 1,
// see defaultGarageConfig) sits at 0 so an untouched build still weighs
// exactly WEIGHT_LB. Cheaper parts are cast/heavier-duty and run positive
// (adds weight on top of the minimum); pricier billet/CNC parts trim
// material and run negative (helps claw back toward the minimum after
// other choices push a build over it) - the direct ask: worse parts make
// for a heavier car, not just a weaker/less reliable one.
// powerMult is scaled per part so the TOP brand tops out at exactly 1.00
// (buying the best no longer grants a bonus over the sim's calibrated
// baseline, it just stops costing you anything) and every cheaper tier is
// scaled down proportionally along with it, keeping the same relative
// spacing between tiers as before.
export const ENGINE_BRANDS = [
  { id: "ironclad", name: "Ironclad Racing", priceNew: 16000, powerMult: 0.94, reliabilityMult: 0.95, weightDeltaLb: 45 },
  { id: "nitroforge", name: "NitroForge", priceNew: 24000, powerMult: 0.96, reliabilityMult: 1.00, weightDeltaLb: 0 },
  { id: "apex", name: "Apex Billet", priceNew: 34000, powerMult: 0.98, reliabilityMult: 1.05, weightDeltaLb: -15 },
  { id: "vortan", name: "Vortan Dynamics", priceNew: 46000, powerMult: 1.00, reliabilityMult: 1.10, weightDeltaLb: -25 },
];

export const HEAD_BRANDS = [
  { id: "trailblazer", name: "Trailblazer Heads", priceNew: 9000, powerMult: 0.92, reliabilityMult: 0.97, weightDeltaLb: 25 },
  { id: "redlineflow", name: "Redline Flow", priceNew: 13000, powerMult: 0.94, reliabilityMult: 1.00, weightDeltaLb: 0 },
  { id: "apexheads", name: "Apex Billet Heads", priceNew: 18000, powerMult: 0.97, reliabilityMult: 1.03, weightDeltaLb: -10 },
  { id: "vortanheads", name: "Vortan CNC", priceNew: 24000, powerMult: 1.00, reliabilityMult: 1.06, weightDeltaLb: -18 },
];

export const BLOWER_BRANDS = [
  { id: "duneblast", name: "Duneblast Superchargers", priceNew: 11000, powerMult: 0.92, reliabilityMult: 0.97, weightDeltaLb: 20 },
  { id: "hurricane", name: "Hurricane Blower Co", priceNew: 15000, powerMult: 0.94, reliabilityMult: 1.00, weightDeltaLb: 0 },
  { id: "apexblower", name: "Apex Billet Blower", priceNew: 19000, powerMult: 0.97, reliabilityMult: 1.03, weightDeltaLb: -8 },
  { id: "vortanblower", name: "Vortan Rootstype", priceNew: 23000, powerMult: 1.00, reliabilityMult: 1.06, weightDeltaLb: -15 },
];

export const BODY_MATERIALS = {
  aluminium: { name: "Aluminium", priceNew: 4000, weightDeltaLb: 0 },
  carbon: { name: "Carbon", priceNew: 15000, weightDeltaLb: -70 },
};

// A nitro fuel pump is a positive-displacement gear pump driven directly
// off the blower (see engine.js's calcFuelFlowGpm) - its own rated
// capacity (ratedGpm) sets what "100% open" on the fuel curve actually
// delivers, same as engine.js's note there: 100% of a 90gpm pump is not
// the same fuel flow as 100% of a 120gpm one. ratedGpm is a fixed spec of
// the physical pump - age/wear only erode reliabilityMult (it fails more
// often as it gets older/more run-hours, never flows less on its own),
// same pattern as every other ownable part. The baseline tier
// (nitroline, tier index 1) is deliberately set to exactly 90gpm/1.00x -
// the same number engine.js used as a flat constant before this became a
// purchasable part - so a fresh default build reproduces the prior fuel-
// flow behavior exactly.
export const FUEL_PUMP_BRANDS = [
  { id: "streetflow", name: "StreetFlow Racing", priceNew: 3000, ratedGpm: 80, reliabilityMult: 0.95, weightDeltaLb: 3 },
  { id: "nitroline", name: "NitroLine Pumps", priceNew: 4500, ratedGpm: 90, reliabilityMult: 1.00, weightDeltaLb: 0 },
  { id: "apexflow", name: "Apex Billet Pump", priceNew: 6500, ratedGpm: 105, reliabilityMult: 1.04, weightDeltaLb: -2 },
  { id: "vortanpump", name: "Vortan High-Volume", priceNew: 9000, ratedGpm: 120, reliabilityMult: 1.08, weightDeltaLb: -4 },
];

// A purchasable, ownable part like the other three - same brand tiering
// (middle tier is the neutral default), plus the plate count baked into
// each model rather than picked separately: fewer plates means less total
// friction surface for the same torque, so each plate dissipates more and
// the assembly runs hotter under slip (the original direct ask, "5 platen
// wordt heter tijdens slippen en kan je dus minder lang laten slippen") -
// now just a property of the cheap end of the catalog instead of an
// independent dropdown.
// capacityMult: how much force the pack itself can actually hold before it
// starts slipping past whatever lf (lockup fraction) alone dictates - the
// direct ask for "als de motor te veel vermogen maakt t.o.v. de koppeling,
// rijdt hij door de koppeling heen." 1.0 (the baseline SteadyHold) makes
// this a complete no-op against LAUNCH_CAP itself (see run-simulator.js's
// clutchCapacityForce), so the existing calibration is untouched unless a
// tune's power actually exceeds what the chosen clutch can hold.
export const CLUTCH_BRANDS = [
  { id: "basicgrip5", name: "BasicGrip 5-plaats", priceNew: 4500, plates: 5, heatRateMult: 1.35, reliabilityMult: 0.93, weightDeltaLb: 8, capacityMult: 0.80 },
  { id: "steadyhold6", name: "SteadyHold 6-plaats", priceNew: 6500, plates: 6, heatRateMult: 1.0, reliabilityMult: 1.00, weightDeltaLb: 0, capacityMult: 1.00 },
  { id: "apexclutch6", name: "Apex Billet 6-plaats", priceNew: 9500, plates: 6, heatRateMult: 0.9, reliabilityMult: 1.06, weightDeltaLb: -6, capacityMult: 1.15 },
  { id: "vortanclutch6", name: "Vortan Carbon 6-plaats", priceNew: 13000, plates: 6, heatRateMult: 0.82, reliabilityMult: 1.12, weightDeltaLb: -12, capacityMult: 1.30 },
];

// Pack thickness (extra/fewer shims stacked into the mounted clutch, on
// top of whatever plate count its brand already carries above) and the
// throw-out bearing's own static position - a matched garage build choice,
// not a per-run tune slider, since it's a real mechanical adjustment the
// crew makes to the mounted unit rather than something dialed from the
// cockpit. Positive thickness eats into how far the fingers can physically
// sweep outward unless bearingAdjSteps compensates for it (see
// calcMaxFingerTravel in clutch.js) - both default to 0 (stock setup),
// a complete no-op, same guarantee as every other garage build knob.
export const CLUTCH_PACK_THICKNESS_MIN = -3;
export const CLUTCH_PACK_THICKNESS_MAX = 3;
export const CLUTCH_BEARING_ADJ_MIN = -3;
export const CLUTCH_BEARING_ADJ_MAX = 3;

// Setback blowers move the supercharger's mass rearward and shorten the
// belt run - shorter belt path and a straighter shot into the intake
// give both a little more power AND (the direct ask) a motor that
// tolerates more heat before it lets go, at a retrofit cost over a
// conventional (in-line) mount.
export const BLOWER_TYPES = {
  conventional: { name: "Gewone blower", priceDelta: 0, tractionMult: 1.0, powerMult: 0.96, reliabilityMult: 1.0 },
  setback: { name: "Setback blower", priceDelta: 4000, tractionMult: 1.015, powerMult: 1.00, reliabilityMult: 1.08 },
};

// Fuel tank position: the tank's OWN weight (how much it's carrying over
// baseline, see TANK_WEIGHT_PER_GAL_LB below) shifts toward whichever axle
// it's mounted near, same signed convention as engine position further
// down (positive = toward the front/nose) - a forward tank helps keep the
// nose down, a rearward one works against it. Only a fraction of that
// weight actually counts as an axle shift (TANK_POSITION_SHIFT_FRACTION) -
// the tank isn't a point mass sitting right on one axle the way ballast is.
export const TANK_POSITIONS = {
  forward: { name: "Vooraan" },
  neutral: { name: "Midden" },
  rearward: { name: "Achteraan" },
};
const TANK_POSITION_SIGN = { forward: 1, neutral: 0, rearward: -1 };
const TANK_POSITION_SHIFT_FRACTION = 0.3;

export const CHASSIS_LENGTH_MIN_IN = 280;
export const CHASSIS_LENGTH_MAX_IN = 320;
export const CHASSIS_LENGTH_BASELINE_IN = 300;
export const CHASSIS_WEIGHT_PER_IN_LB = 3;
// A longer wheelbase is more wheelie-resistant on its own, independent of
// ballast/wing - the same vertical load at the same distance from the
// rear axle needs more torque to lift the nose the further back that
// axle sits relative to the CG, i.e. a longer chassis has more natural
// leverage against the same launch load. Modeled the same way real
// ballast/wing already are (a lb-equivalent feeding the shared
// wheelieRiskBallastEquivLb term in computeGarageEffects below) so a
// longer chassis genuinely earns back some ballast/wing/engine-position
// margin instead of needing just as much as a short one. Zero at the
// CHASSIS_LENGTH_BASELINE_IN default (300") - a complete no-op there.
export const CHASSIS_WHEELIE_RELIEF_LB_PER_IN = 6;

// The bare frame itself, before a body material (BODY_MATERIALS above) is
// even picked - a custom build ("zelf laten bouwen") pays this PLUS the
// chosen body's priceNew, and gets to choose both length (within the NHRA
// range above) and material; a secondhand chassis (CHASSIS_LISTINGS_COUNT
// listings below) is cheaper (same age-based discount as every other used
// part, see usedPriceMult) but its length was already fixed by whoever
// built it - only the body can still be swapped afterward, never the length.
// Kept low enough that a fresh team can still afford one legal car (cheapest
// tier of every driveline part + trailer + this, aluminium body) within the
// starting budget with some room left for an entry fee - see finances.js's
// STARTING_BUDGET. A pricier carbon custom build, or upgrading later, is
// still a real, deliberate investment on top of that floor.
export const CHASSIS_BUILD_PRICE = 10000;
export const CHASSIS_LISTINGS_COUNT = 3;
const BODY_MATERIAL_KEYS = Object.keys(BODY_MATERIALS);

export function chassisBuildPrice(bodyMaterial) {
  return CHASSIS_BUILD_PRICE + BODY_MATERIALS[bodyMaterial].priceNew;
}

export function generateChassisMarket(rng = Math.random) {
  return Array.from({ length: CHASSIS_LISTINGS_COUNT }, (_, i) => {
    const lengthIn = Math.round(CHASSIS_LENGTH_MIN_IN + rng() * (CHASSIS_LENGTH_MAX_IN - CHASSIS_LENGTH_MIN_IN));
    const bodyMaterial = BODY_MATERIAL_KEYS[Math.floor(rng() * BODY_MATERIAL_KEYS.length)];
    const ageMonths = Math.round(USED_AGE_MIN_MONTHS + rng() * (USED_AGE_MAX_MONTHS - USED_AGE_MIN_MONTHS));
    return { id: `chassis-${Date.now()}-${i}-${Math.floor(rng() * 1e6)}`, lengthIn, bodyMaterial, ageMonths };
  });
}

export function chassisListingPrice(listing) {
  return Math.round(chassisBuildPrice(listing.bodyMaterial) * usedPriceMult(listing.ageMonths));
}

// A custom build: the player's own length (already validated against the
// NHRA range by the slider itself) and initial body material choice. Sets
// chassisAgeMonths to 0 - a fresh build, no depreciation yet.
export function buildNewChassis(config, lengthIn, bodyMaterial) {
  config.chassisOwned = true;
  config.chassisLengthIn = lengthIn;
  config.bodyMaterial = bodyMaterial;
  config.chassisAgeMonths = 0;
}

// A secondhand listing (generateChassisMarket) - length and body come from
// the listing itself, not a player choice; the length is fixed forever
// from here on, same as a custom build's is once it's poured.
export function buySecondhandChassis(config, listing) {
  config.chassisOwned = true;
  config.chassisLengthIn = listing.lengthIn;
  config.bodyMaterial = listing.bodyMaterial;
  config.chassisAgeMonths = listing.ageMonths;
}

// The one thing that stays swappable after the chassis itself is settled -
// a new body shell bolted onto the existing (fixed-length) frame, at that
// material's full priceNew regardless of what was mounted before.
export function buyNewBody(config, bodyMaterial) {
  config.bodyMaterial = bodyMaterial;
}

export const TANK_SIZE_MIN_GAL = 45;
export const TANK_SIZE_MAX_GAL = 75;
export const TANK_SIZE_BASELINE_GAL = 55;
export const TANK_WEIGHT_PER_GAL_LB = 7;

// Only a slice of the tank's rated size is usable race fuel once a pass
// actually starts burning through it (lines, deadhead volume, a reserve
// margin no crew chief runs right to the bottom of) - small enough that
// skimping on tank size for weight is a real gamble, not just flavor text:
// run out mid-pass and the engine goes instantly, violently lean (see
// garageTankUsableGal in run-simulator.js).
export const TANK_USABLE_FRACTION = 0.15;

export const ENGINE_POSITION_MIN_IN = -3;
export const ENGINE_POSITION_MAX_IN = 3;
export const ENGINE_POSITION_BALLAST_EQUIV_PER_IN = 8;

// A mudflap kit isn't just cosmetic - it's sheet material hung low behind
// the rear tires, so it adds a little downforce back there (cleaner airflow
// off the tires at speed) along with a little weight, at zero cost since
// it's just a build toggle, not a purchasable part.
export const MUDFLAPS_WEIGHT_LB = 11; // ~5 kg
export const MUDFLAPS_DOWNFORCE_MULT = 1.05;

// How you get the car AND the spares to the track at all. A fifth-wheel
// (the cheapest way into the sport - one truck, no separate CDL-class
// tow rig) only has so much deck/box space once the car itself is
// loaded, so it caps how many total spare units (summed across all four
// parts) the team can bring to an event - the direct ask: not much room
// for reserve parts back there. Bigger trailers cost more but scale that
// capacity up.
export const TRAILER_TYPES = [
  { id: "fifthwheel", name: "Fifth-wheel trailer (pickup)", priceNew: 9000, spareCapacity: 2 },
  { id: "boxtrailer", name: "Gesloten boxtrailer", priceNew: 22000, spareCapacity: 5 },
  { id: "semi", name: "Semi-oplegger (volledige pitopstelling)", priceNew: 55000, spareCapacity: 12 },
];

export function partPrice(brand, ageMonths = 0) {
  return Math.round(brand.priceNew * (ageMonths > 0 ? usedPriceMult(ageMonths) : 1));
}

export function findBrand(list, id) {
  return list.find((b) => b.id === id) || list[0];
}

// The four ownable, brand-tiered parts, each with an "equipped" unit
// (config.<part>BrandId / config.<part>AgeMonths) plus an inventory of
// spares (config.<part>Inventory - an array of { brandId, ageMonths }
// units, each possibly a DIFFERENT brand/age than the one currently
// mounted, or than each other). PARTS drives the generic inventory
// helpers below instead of writing near-identical per-part code four times.
export const PARTS = {
  engine: { brands: ENGINE_BRANDS, label: "motorblok" },
  head: { brands: HEAD_BRANDS, label: "cilinderkop" },
  blower: { brands: BLOWER_BRANDS, label: "blower" },
  clutch: { brands: CLUTCH_BRANDS, label: "koppeling" },
  fuelPump: { brands: FUEL_PUMP_BRANDS, label: "brandstofpomp" },
};

// A new team starts with an empty shop, not a free mid-tier car - every
// part (including the trailer that gets the car and its spares to the
// track at all) has to be bought before a single pass down the strip.
// null brandId/trailerId means "not owned yet"; findBrand's own fallback
// (list[0], the cheapest tier) keeps every price/weight/power/reliability
// calculation safe to call even before anything is purchased - see
// isCarRaceReady for the actual gate on running/racing.
export function defaultGarageConfig() {
  return {
    engineBrandId: null, engineAgeMonths: 0, engineWear: 0, engineBroken: false,
    headBrandId: null, headAgeMonths: 0, headWear: 0, headBroken: false,
    blowerBrandId: null, blowerAgeMonths: 0, blowerWear: 0, blowerBroken: false,
    blowerType: "conventional",
    clutchBrandId: null, clutchAgeMonths: 0, clutchWear: 0, clutchBroken: false,
    clutchPackThicknessSteps: 0, clutchBearingAdjSteps: 0,
    fuelPumpBrandId: null, fuelPumpAgeMonths: 0, fuelPumpWear: 0, fuelPumpBroken: false,
    chassisOwned: false,
    chassisAgeMonths: 0,
    bodyMaterial: "aluminium",
    chassisLengthIn: CHASSIS_LENGTH_BASELINE_IN,
    tankSizeGal: TANK_SIZE_BASELINE_GAL,
    tankPosition: "neutral",
    mudflaps: true,
    enginePositionIn: 0,
    trailerId: null,
    engineInventory: [],
    headInventory: [],
    blowerInventory: [],
    clutchInventory: [],
    fuelPumpInventory: [],
  };
}

// Migrates an older saved config (from before the used-parts market) onto
// the current shape: a flat engineSecondhand/headSecondhand/etc. boolean
// becomes an engineAgeMonths/headAgeMonths/etc. number (a representative
// mid-range age for "true", 0 for "false"/unset), and any inventory
// entries carrying the old { brandId, secondhand } shape get the same
// treatment. A no-op on an already-current config (nothing to migrate).
const LEGACY_SECONDHAND_AGE_MONTHS = Math.round((USED_AGE_MIN_MONTHS + USED_AGE_MAX_MONTHS) / 2);

function migrateUnit(unit) {
  if (!unit || unit.ageMonths !== undefined) return unit;
  const { secondhand, ...rest } = unit;
  return { ...rest, ageMonths: secondhand ? LEGACY_SECONDHAND_AGE_MONTHS : 0 };
}

export function migrateGarageConfig(config) {
  // A save from before the chassis became a purchasable part: it already
  // had a bodyMaterial/chassisLengthIn (previously free build-spec dials),
  // so treat that as an already-paid-for chassis rather than suddenly
  // stranding an existing team without one.
  if (config.chassisOwned === undefined) config.chassisOwned = true;
  if (config.chassisAgeMonths === undefined) config.chassisAgeMonths = 0;
  Object.keys(PARTS).forEach((part) => {
    const secondhandKey = part + "Secondhand";
    const ageKey = part + "AgeMonths";
    if (config[ageKey] === undefined && config[secondhandKey] !== undefined) {
      config[ageKey] = config[secondhandKey] ? LEGACY_SECONDHAND_AGE_MONTHS : 0;
    }
    delete config[secondhandKey];
    const invKey = part + "Inventory";
    if (Array.isArray(config[invKey])) config[invKey] = config[invKey].map(migrateUnit);
    // A save from before per-run wear/broken tracking existed - the
    // equipped unit was already out there racing, but 0/false (as-new,
    // not broken) is the only sane default: there's no history to recover
    // wear from, and defaulting to "broken" would strand an old save on a
    // part that was working fine.
    const wearKey = part + "Wear";
    if (config[wearKey] === undefined) config[wearKey] = 0;
    const brokenKey = part + "Broken";
    if (config[brokenKey] === undefined) config[brokenKey] = false;
  });
  return config;
}

export function isPartOwned(config, part) {
  return !!config[part + "BrandId"];
}

// Total spares across all four parts, checked against the trailer's
// capacity - no trailer at all means no room for spares (or the car
// itself), so capacity is 0 until one's bought.
export function totalSpareCount(config) {
  return Object.keys(PARTS).reduce((sum, part) => sum + config[part + "Inventory"].length, 0);
}

export function trailerSpareCapacity(config) {
  if (!config.trailerId) return 0;
  return findBrand(TRAILER_TYPES, config.trailerId).spareCapacity;
}

// The minimum to actually show up and make a pass: all four driveline
// parts mounted, none of them currently broken (see markPartBroken -
// mounted but not safe to run until repaired), plus a trailer to get the
// car there and a chassis to bolt it all to. Tank/mudflaps/engine position
// stay free build SPECS, not ownable parts - only chassis length/body are
// gated behind an actual purchase (buildNewChassis/buySecondhandChassis).
export function isCarRaceReady(config) {
  return Object.keys(PARTS).every((part) => isPartOwned(config, part) && !isPartBroken(config, part))
    && !!config.trailerId && !!config.chassisOwned;
}

export function equippedUnit(config, part) {
  return { brandId: config[part + "BrandId"], ageMonths: config[part + "AgeMonths"] };
}

// Mounting ANY unit - a spare, a fresh purchase, a swap - always means a
// physically different part than whatever was there before, so wear and
// broken always reset here: they describe the specific unit currently
// bolted in, not the slot. A spare that gets swapped back OUT to
// inventory (installUnit) loses its own wear history this way too - spare
// units in inventory don't carry a wear number at all, only ageMonths -
// an accepted simplification, since spares by definition haven't been run
// since they were last serviced.
function setEquippedUnit(config, part, unit) {
  config[part + "BrandId"] = unit.brandId;
  config[part + "AgeMonths"] = unit.ageMonths;
  config[part + "Wear"] = 0;
  config[part + "Broken"] = false;
}

export function unitPrice(part, unit) {
  return partPrice(findBrand(PARTS[part].brands, unit.brandId), unit.ageMonths);
}

// Player-initiated swap: mount inventory[index] and return whatever was
// equipped before it back into inventory - UNLESS it's currently broken
// (markPartBroken), in which case there's nothing good to park: a blown
// unit doesn't go back on the shelf as if it were a working spare, it's
// scrapped, same as a spare consumed by consumeSpareOnFailure. Swapping
// away from a broken part is a legitimate way to keep racing on it (a
// team with a spare handy doesn't have to wait on a repair), it just
// doesn't get to keep the broken unit around for free the way parking a
// healthy one does.
export function installUnit(config, part, index) {
  const inv = config[part + "Inventory"];
  const incoming = inv[index];
  if (!incoming) return;
  const outgoing = equippedUnit(config, part);
  const outgoingBroken = isPartBroken(config, part);
  inv.splice(index, 1, ...(outgoingBroken ? [] : [outgoing]));
  setEquippedUnit(config, part, incoming);
}

// Failure-triggered swap: mount the next available spare (discarding the
// failed part - it's scrapped, not returned to inventory) and report
// whether one was available at all. Called from finances.js's
// chargePartFailure.
export function consumeSpareOnFailure(config, part) {
  const inv = config[part + "Inventory"];
  if (!inv.length) return false;
  setEquippedUnit(config, part, inv.shift());
  return true;
}

// A catastrophic failure (see finances.js's chargePartFailure) - the
// equipped unit is a write-off, full stop, not something even a spare on
// the trailer can fix trackside. Unlike consumeSpareOnFailure this never
// touches inventory: any spare stays put, ready to be mounted by hand
// (installUnit) before the next event, but not this one.
export function unequipPart(config, part) {
  setEquippedUnit(config, part, { brandId: null, ageMonths: 0 });
}

// How much a part's OWN reliability erodes just from being run, on top of
// its brand tier and (if bought used) its calendar age - real parts don't
// stay at day-one condition forever, and a crew that never rebuilds
// anything should feel that, not just the discrete failure rolls the
// physics already carry. Deliberately gentle per run (see the wear-to-
// reliability mapping below, and the comment on WEAR_RELIABILITY_FLOOR_
// MULT) - this is a slow background drift, not a second failure system.
const WEAR_PER_RUN_PCT = 1.5;

// On top of that flat baseline, a run that actually beat on a part hard -
// ran hot, lean, or fouled toward a cylinder drop; a clutch worked deep
// into its own failure clock - leaves more of a mark than a clean one, so
// the persistent condition readout (garage.js's estimatePartCondition)
// isn't stuck showing "als nieuw" the run right after a cylinder just
// dropped. severityByPart (0-1 per part, e.g. run-simulator.js's
// engineDamagePct/foulDamagePct or bearingWear normalized to 0-1) scales
// this extra chunk; 0 (the default, and what a clean run's severity
// naturally works out to) reproduces the exact old flat-1.5% behavior.
const WEAR_SEVERITY_EXTRA_PCT = 8;

// Every actual pass down the strip - a Testrun-tab lap included, not just
// a paid qualifying/elimination run - puts real hours on the engine,
// heads, blower and clutch simultaneously (they're either all in the car
// racing or none of them are), so a single run adds wear to every
// equipped unit at once - the flat baseline always, plus each part's own
// severity share on top. A part with no unit equipped is simply skipped
// (isPartOwned guards it) - nothing to wear on an empty mount.
export function addRunWear(config, severityByPart = {}) {
  Object.keys(PARTS).forEach((part) => {
    if (!isPartOwned(config, part)) return;
    const severity = Math.max(0, Math.min(1, severityByPart[part] || 0));
    config[part + "Wear"] = Math.min(100, (config[part + "Wear"] || 0) + WEAR_PER_RUN_PCT + severity * WEAR_SEVERITY_EXTRA_PCT);
  });
}

// At 100% worn, a part's OWN reliability contribution is knocked down to
// this floor - deliberately gentler than the used-market age floor
// (USED_RELIABILITY_MULT_FLOOR, 0.80): wear stacks with age AND across up
// to three parts at once in computeEngineReliabilityMult (engine * head *
// blower all wearing together), so a floor as steep as age's own would
// compound into an unplayable multiplier for a team that just races
// without ever rebuilding. 0.90 per part still means something real once
// several parts are all worn together (three parts at max wear multiply
// to ~0.73, roughly the same order of magnitude as the "worst-case
// budget-everything-oldest-available-used build lands around 1.5x
// damage" ballpark noted above computeEngineReliabilityMult) without
// being punishing on its own.
const WEAR_RELIABILITY_FLOOR_MULT = 0.90;

function partWearReliabilityMult(wearPct) {
  const frac = Math.max(0, Math.min(100, wearPct || 0)) / 100;
  return 1 - frac * (1 - WEAR_RELIABILITY_FLOOR_MULT);
}

export function isPartBroken(config, part) {
  return !!config[part + "Broken"];
}

// Set when a non-catastrophic failure has no spare to swap in (see
// finances.js's chargePartFailure) - the part stays mounted (it's not a
// write-off) but isn't safe to run again until it's actually repaired.
// Deliberately does NOT touch money or wear itself - chargePartFailure
// only marks the fact that it broke; repairPartUnit below is the one
// place that actually charges for and clears a repair, kept separate so
// "it broke" and "it got fixed" stay two distinct, explicit steps instead
// of a failure silently paying for its own fix.
export function markPartBroken(config, part) {
  config[part + "Broken"] = true;
}

// The only way a broken part becomes usable again - a genuine rebuild, so
// it also resets wear to 0 along with clearing the broken flag (same
// "fresh unit" logic setEquippedUnit uses, just without actually
// swapping which physical unit is mounted). Called from finances.js's
// repairPartUnit once the repair fee is actually charged.
export function clearPartBroken(config, part) {
  config[part + "Broken"] = false;
  config[part + "Wear"] = 0;
}

// A player-facing condition read - deliberately NOT the raw wear number.
// A fixed spread of noise around the true value, re-rolled every time
// it's read (the UI calls this on every render), so the garage panel
// gives a rough sense of a part's health - trending down, roughly in this
// bracket - without ever pinning down an exact number the player could
// count down to zero. That mirrors how a real crew chief actually judges
// it: mileage, sound, a little intuition, never a lab-precise reading.
const CONDITION_NOISE_PTS = 12;
const CONDITION_BUCKETS = [
  { min: 85, label: "als nieuw", cls: "ok" },
  { min: 65, label: "ingelopen", cls: "ok" },
  { min: 45, label: "gebruikssporen", cls: "warn" },
  { min: 25, label: "verouderd", cls: "warn" },
  { min: -Infinity, label: "zorgelijk", cls: "bad" },
];

export function estimatePartCondition(wearPct, rng = Math.random) {
  const trueHealth = 100 - Math.max(0, Math.min(100, wearPct || 0));
  const shown = Math.max(0, Math.min(100, trueHealth + (rng() * 2 - 1) * CONDITION_NOISE_PTS));
  const rangeLow = Math.max(0, Math.round((shown - CONDITION_NOISE_PTS) / 5) * 5);
  const rangeHigh = Math.min(100, Math.round((shown + CONDITION_NOISE_PTS) / 5) * 5);
  const bucket = CONDITION_BUCKETS.find((b) => shown >= b.min);
  return { label: bucket.label, cls: bucket.cls, rangeLow, rangeHigh };
}

// A purchase of a part the team doesn't have yet becomes the equipped
// unit directly - a first engine isn't a "spare" of nothing. Once
// something's already mounted, a further purchase is a spare, gated by
// the trailer's capacity (buyOutcome: "equipped", "spare", or
// "no-capacity" if the trailer can't fit another one - the caller is
// expected to check trailerSpareCapacity itself before charging money,
// this is the data-side enforcement backing that check).
export function buyUnit(config, part, unit) {
  if (!isPartOwned(config, part)) {
    setEquippedUnit(config, part, unit);
    return "equipped";
  }
  if (totalSpareCount(config) >= trailerSpareCapacity(config)) return "no-capacity";
  config[part + "Inventory"].push(unit);
  return "spare";
}

// A used-market purchase (see generateUsedMarket) is a specific listing
// the player is choosing right now - the natural read is "swap this in,"
// not "stash it in the trailer" the way a routine "buy new" restock is.
// So unlike buyUnit, this mounts the bought unit directly even when the
// part is already owned, returning the previously-equipped unit to
// inventory (not discarding it - same "parked, not scrapped" idea as
// installUnit) rather than adding the NEW unit as a spare. Still gated by
// trailer capacity, since the displaced outgoing unit still needs a slot.
export function buyAndEquipUnit(config, part, unit) {
  if (!isPartOwned(config, part)) {
    setEquippedUnit(config, part, unit);
    return "equipped";
  }
  if (totalSpareCount(config) >= trailerSpareCapacity(config)) return "no-capacity";
  const outgoing = equippedUnit(config, part);
  const outgoingBroken = isPartBroken(config, part);
  setEquippedUnit(config, part, unit);
  // A broken outgoing unit is scrapped, not parked - same reasoning as
  // installUnit above.
  if (!outgoingBroken) config[part + "Inventory"].push(outgoing);
  return "swapped";
}

// A part's own reliability tier, knocked down further by how old it is if
// it's a used unit (usedReliabilityMult - a used part still makes full
// power, it's just more fragile) AND by how many runs it's actually seen
// since it was last fresh (partWearReliabilityMult) - two independent,
// stacking sources of "this isn't a day-one part anymore."
function partReliabilityMult(brand, ageMonths = 0, wearPct = 0) {
  return brand.reliabilityMult * (ageMonths > 0 ? usedReliabilityMult(ageMonths) : 1) * partWearReliabilityMult(wearPct);
}

// Combined power and reliability across the three parts that make up
// "the motor" (block, heads, blower) plus the blower's mounting type.
// Both start at 1.0 for the all-baseline-brand, conventional-blower
// build, same neutral-default guarantee as the rest of computeGarageEffects.
export function computeEnginePowerMult(config) {
  const engine = findBrand(ENGINE_BRANDS, config.engineBrandId);
  const head = findBrand(HEAD_BRANDS, config.headBrandId);
  const blower = findBrand(BLOWER_BRANDS, config.blowerBrandId);
  const blowerType = BLOWER_TYPES[config.blowerType];
  return engine.powerMult * head.powerMult * blower.powerMult * blowerType.powerMult;
}

export function computeEngineReliabilityMult(config) {
  const engine = findBrand(ENGINE_BRANDS, config.engineBrandId);
  const head = findBrand(HEAD_BRANDS, config.headBrandId);
  const blower = findBrand(BLOWER_BRANDS, config.blowerBrandId);
  const blowerType = BLOWER_TYPES[config.blowerType];
  const fuelPump = findBrand(FUEL_PUMP_BRANDS, config.fuelPumpBrandId);
  return partReliabilityMult(engine, config.engineAgeMonths, config.engineWear)
    * partReliabilityMult(head, config.headAgeMonths, config.headWear)
    * partReliabilityMult(blower, config.blowerAgeMonths, config.blowerWear)
    * partReliabilityMult(fuelPump, config.fuelPumpAgeMonths, config.fuelPumpWear)
    * blowerType.reliabilityMult;
}

// The clutch's own reliability tier - tracked separately from the engine's
// (it fails on its own heat-damage clock, see CLUTCH_DAMAGE_RATE in
// run-simulator.js), same age- and wear-based knock-down as the other
// three parts.
export function computeClutchReliabilityMult(config) {
  const clutch = findBrand(CLUTCH_BRANDS, config.clutchBrandId);
  return partReliabilityMult(clutch, config.clutchAgeMonths, config.clutchWear);
}

// Turns a build config into the handful of physics modifiers
// run-simulator.js accepts, all defaulting to a neutral no-op so the
// baseline build reproduces exactly the pre-garage physics.
export function computeGarageEffects(config) {
  const engine = findBrand(ENGINE_BRANDS, config.engineBrandId);
  const head = findBrand(HEAD_BRANDS, config.headBrandId);
  const blower = findBrand(BLOWER_BRANDS, config.blowerBrandId);
  const clutch = findBrand(CLUTCH_BRANDS, config.clutchBrandId);
  const fuelPump = findBrand(FUEL_PUMP_BRANDS, config.fuelPumpBrandId);
  const body = BODY_MATERIALS[config.bodyMaterial];
  const blowerType = BLOWER_TYPES[config.blowerType];

  const weightDeltaLb = body.weightDeltaLb
    + engine.weightDeltaLb + head.weightDeltaLb + blower.weightDeltaLb + clutch.weightDeltaLb + fuelPump.weightDeltaLb
    + (config.chassisLengthIn - CHASSIS_LENGTH_BASELINE_IN) * CHASSIS_WEIGHT_PER_IN_LB
    + (config.tankSizeGal - TANK_SIZE_BASELINE_GAL) * TANK_WEIGHT_PER_GAL_LB
    + (config.mudflaps ? MUDFLAPS_WEIGHT_LB : 0);

  const tankWeightDeltaLb = (config.tankSizeGal - TANK_SIZE_BASELINE_GAL) * TANK_WEIGHT_PER_GAL_LB;
  const tankPositionShiftLb = tankWeightDeltaLb * TANK_POSITION_SIGN[config.tankPosition] * TANK_POSITION_SHIFT_FRACTION;
  const wheelieRiskBallastEquivLb = tankPositionShiftLb
    - config.enginePositionIn * ENGINE_POSITION_BALLAST_EQUIV_PER_IN
    + (config.chassisLengthIn - CHASSIS_LENGTH_BASELINE_IN) * CHASSIS_WHEELIE_RELIEF_LB_PER_IN;
  // The other side of the same weight shift the wheelie-risk term above
  // already tracks: more weight actually sitting on the rear (driven)
  // wheels is more launch traction, not just less wheelie risk - a real
  // rear-engine dragster's grip comes overwhelmingly from what's over the
  // back axle. Same inputs, same ENGINE_POSITION_WEIGHT_SHIFT_PER_IN rate
  // computeWeightDistribution's display breakdown already uses (so the
  // "Achter (2 banden)" readout and this stay numerically consistent),
  // opposite sign from the wheelie term since more rear weight is LESS
  // wheelie risk but MORE grip. Zero at enginePositionIn=0/tank neutral -
  // a complete no-op for the default build, same guarantee as every other
  // garage effect here.
  const rearWeightShiftLb = config.enginePositionIn * ENGINE_POSITION_WEIGHT_SHIFT_PER_IN - tankPositionShiftLb;

  // Higher reliability means the engine (or clutch) should accumulate
  // damage MORE SLOWLY, so the damage-rate multiplier run-simulator.js
  // applies is the inverse of the reliability figure shown to the player.
  const reliabilityMult = computeEngineReliabilityMult(config);
  const clutchReliabilityMult = computeClutchReliabilityMult(config);

  return {
    garageWeightDeltaLb: weightDeltaLb,
    garageWheelieRiskBallastEquivLb: wheelieRiskBallastEquivLb,
    garageRearWeightShiftLb: rearWeightShiftLb,
    garageTankPositionShiftLb: tankPositionShiftLb,
    garageTankUsableGal: config.tankSizeGal * TANK_USABLE_FRACTION,
    garageDragCdaMult: config.mudflaps ? 1 : 0.99,
    garageDownforceMult: config.mudflaps ? MUDFLAPS_DOWNFORCE_MULT : 1,
    garageClutchHeatRateMult: clutch.heatRateMult,
    garageClutchDamageMult: 1 / clutchReliabilityMult,
    garageClutchCapacityMult: clutch.capacityMult,
    garageClutchPackThicknessSteps: config.clutchPackThicknessSteps,
    garageClutchBearingAdjSteps: config.clutchBearingAdjSteps,
    garageTractionMult: blowerType.tractionMult,
    garagePowerMult: computeEnginePowerMult(config),
    garageEngineDamageMult: 1 / reliabilityMult,
    garageFuelPumpGpm: fuelPump.ratedGpm,
  };
}

// Unlike equippedPartPrice (which needs a real price even for an unowned
// part, to quote a repair/replacement cost), an unowned part contributes
// nothing here - this is what the team has actually put money into, not
// what a hypothetical fallback part would cost.
export function totalBuildValue(config) {
  const partsTotal = Object.keys(PARTS).reduce((sum, part) => {
    if (!isPartOwned(config, part)) return sum;
    return sum + partPrice(findBrand(PARTS[part].brands, config[part + "BrandId"]), config[part + "AgeMonths"]);
  }, 0);
  const trailerTotal = config.trailerId ? findBrand(TRAILER_TYPES, config.trailerId).priceNew : 0;
  const chassisTotal = config.chassisOwned
    ? Math.round(chassisBuildPrice(config.bodyMaterial) * (config.chassisAgeMonths > 0 ? usedPriceMult(config.chassisAgeMonths) : 1))
    : 0;
  return partsTotal
    + (config.blowerBrandId ? BLOWER_TYPES[config.blowerType].priceDelta : 0)
    + chassisTotal
    + trailerTotal;
}

export function equippedPartPrice(config, part) {
  if (part === "engine") return partPrice(findBrand(ENGINE_BRANDS, config.engineBrandId), config.engineAgeMonths);
  if (part === "head") return partPrice(findBrand(HEAD_BRANDS, config.headBrandId), config.headAgeMonths);
  if (part === "blower") return partPrice(findBrand(BLOWER_BRANDS, config.blowerBrandId), config.blowerAgeMonths) + BLOWER_TYPES[config.blowerType].priceDelta;
  if (part === "clutch") return partPrice(findBrand(CLUTCH_BRANDS, config.clutchBrandId), config.clutchAgeMonths);
  if (part === "fuelPump") return partPrice(findBrand(FUEL_PUMP_BRANDS, config.fuelPumpBrandId), config.fuelPumpAgeMonths);
  return 0;
}

export function spareLabel(part) {
  return PARTS[part].label;
}

// Static front/rear split for the per-axle weight readout. A rear-engine
// dragster carries very little of its static weight up front (long
// chassis, engine/blower/driver all sitting well aft of center) - this is
// the bare-chassis baseline before ballast, engine-position and tank-
// position choices shift it. Ballast lands 100% on whichever axle it's
// mounted at, straight from ballastFrontLb/ballastRearLb; the engine
// itself moving fore/aft (enginePositionIn, same signed convention as the
// wheelie-risk ballast-equivalent above - positive is rearward) shifts a
// slice of its own mass across axles too, and the tank's own weight-over-
// baseline shifts the same way toward wherever it's mounted
// (tankPositionShiftLb, positive = toward the front - see
// computeGarageEffects). Purely a display breakdown for the garage UI -
// the actual launch physics already account for all of this through
// weightLb and the wheelie-risk ballast-equivalent; this doesn't feed
// back into run-simulator.js.
const BASE_FRONT_WEIGHT_FRACTION = 0.17;
const ENGINE_POSITION_WEIGHT_SHIFT_PER_IN = 12;

export function computeWeightDistribution(totalWeightLb, ballastFrontLb, ballastRearLb, enginePositionIn, tankPositionShiftLb = 0) {
  const bareWeightLb = totalWeightLb - ballastFrontLb - ballastRearLb;
  const frontLb = bareWeightLb * BASE_FRONT_WEIGHT_FRACTION
    - enginePositionIn * ENGINE_POSITION_WEIGHT_SHIFT_PER_IN
    + tankPositionShiftLb
    + ballastFrontLb;
  const rearLb = totalWeightLb - frontLb;
  return {
    frontLb, rearLb,
    frontPct: (frontLb / totalWeightLb) * 100,
    rearPct: (rearLb / totalWeightLb) * 100,
  };
}
