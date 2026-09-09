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
// cheaper" tradeoff. Secondhand knocks reliability down further
// (SECONDHAND_RELIABILITY_MULT) without touching power - a used part
// still makes the power it always did, it's just closer to the end of
// its life.

// Reliability tiers are deliberately gentle (see garageEngineDamageMult
// below): the engine failure model is calibrated tight around the
// default tune (the whole point of that calibration - a real Top Fuel
// motor lives on a knife edge), so even a modest multiplier on the
// damage rate compounds fast over a run. A worst-case budget-everything-
// secondhand build lands around 1.5x damage (survivable, but punishing
// and worth retuning conservatively for), not an unrecoverable 3-4x.
export const SECONDHAND_PRICE_MULT = 0.55;
export const SECONDHAND_RELIABILITY_MULT = 0.9;

// weightDeltaLb follows the same "middle tier is the neutral baseline"
// shape as powerMult/reliabilityMult: the default brand (tier index 1,
// see defaultGarageConfig) sits at 0 so an untouched build still weighs
// exactly WEIGHT_LB. Cheaper parts are cast/heavier-duty and run positive
// (adds weight on top of the minimum); pricier billet/CNC parts trim
// material and run negative (helps claw back toward the minimum after
// other choices push a build over it) - the direct ask: worse parts make
// for a heavier car, not just a weaker/less reliable one.
export const ENGINE_BRANDS = [
  { id: "ironclad", name: "Ironclad Racing", priceNew: 16000, powerMult: 0.98, reliabilityMult: 0.95, weightDeltaLb: 45 },
  { id: "nitroforge", name: "NitroForge", priceNew: 24000, powerMult: 1.00, reliabilityMult: 1.00, weightDeltaLb: 0 },
  { id: "apex", name: "Apex Billet", priceNew: 34000, powerMult: 1.02, reliabilityMult: 1.05, weightDeltaLb: -15 },
  { id: "vortan", name: "Vortan Dynamics", priceNew: 46000, powerMult: 1.04, reliabilityMult: 1.10, weightDeltaLb: -25 },
];

export const HEAD_BRANDS = [
  { id: "trailblazer", name: "Trailblazer Heads", priceNew: 9000, powerMult: 0.97, reliabilityMult: 0.97, weightDeltaLb: 25 },
  { id: "redlineflow", name: "Redline Flow", priceNew: 13000, powerMult: 1.00, reliabilityMult: 1.00, weightDeltaLb: 0 },
  { id: "apexheads", name: "Apex Billet Heads", priceNew: 18000, powerMult: 1.03, reliabilityMult: 1.03, weightDeltaLb: -10 },
  { id: "vortanheads", name: "Vortan CNC", priceNew: 24000, powerMult: 1.06, reliabilityMult: 1.06, weightDeltaLb: -18 },
];

export const BLOWER_BRANDS = [
  { id: "duneblast", name: "Duneblast Superchargers", priceNew: 11000, powerMult: 0.97, reliabilityMult: 0.97, weightDeltaLb: 20 },
  { id: "hurricane", name: "Hurricane Blower Co", priceNew: 15000, powerMult: 1.00, reliabilityMult: 1.00, weightDeltaLb: 0 },
  { id: "apexblower", name: "Apex Billet Blower", priceNew: 19000, powerMult: 1.03, reliabilityMult: 1.03, weightDeltaLb: -8 },
  { id: "vortanblower", name: "Vortan Rootstype", priceNew: 23000, powerMult: 1.06, reliabilityMult: 1.06, weightDeltaLb: -15 },
];

export const BODY_MATERIALS = {
  aluminium: { name: "Aluminium", priceNew: 4000, weightDeltaLb: 0 },
  carbon: { name: "Carbon", priceNew: 15000, weightDeltaLb: -70 },
};

// A purchasable, ownable part like the other three - same brand tiering
// (middle tier is the neutral default), plus the plate count baked into
// each model rather than picked separately: fewer plates means less total
// friction surface for the same torque, so each plate dissipates more and
// the assembly runs hotter under slip (the original direct ask, "5 platen
// wordt heter tijdens slippen en kan je dus minder lang laten slippen") -
// now just a property of the cheap end of the catalog instead of an
// independent dropdown.
export const CLUTCH_BRANDS = [
  { id: "basicgrip5", name: "BasicGrip 5-plaats", priceNew: 4500, plates: 5, heatRateMult: 1.35, reliabilityMult: 0.93, weightDeltaLb: 8 },
  { id: "steadyhold6", name: "SteadyHold 6-plaats", priceNew: 6500, plates: 6, heatRateMult: 1.0, reliabilityMult: 1.00, weightDeltaLb: 0 },
  { id: "apexclutch6", name: "Apex Billet 6-plaats", priceNew: 9500, plates: 6, heatRateMult: 0.9, reliabilityMult: 1.06, weightDeltaLb: -6 },
  { id: "vortanclutch6", name: "Vortan Carbon 6-plaats", priceNew: 13000, plates: 6, heatRateMult: 0.82, reliabilityMult: 1.12, weightDeltaLb: -12 },
];

// Setback blowers move the supercharger's mass rearward and shorten the
// belt run - shorter belt path and a straighter shot into the intake
// give both a little more power AND (the direct ask) a motor that
// tolerates more heat before it lets go, at a retrofit cost over a
// conventional (in-line) mount.
export const BLOWER_TYPES = {
  conventional: { name: "Gewone blower", priceDelta: 0, tractionMult: 1.0, powerMult: 1.0, reliabilityMult: 1.0 },
  setback: { name: "Setback blower", priceDelta: 4000, tractionMult: 1.015, powerMult: 1.04, reliabilityMult: 1.08 },
};

// Fuel tank position acts like ballast placement for wheelie-risk
// purposes: a forward tank helps keep the nose down, a rearward one
// works against it.
export const TANK_POSITIONS = {
  forward: { name: "Vooraan", ballastEquivLb: 15 },
  neutral: { name: "Midden", ballastEquivLb: 0 },
  rearward: { name: "Achteraan", ballastEquivLb: -15 },
};

export const CHASSIS_LENGTH_MIN_IN = 280;
export const CHASSIS_LENGTH_MAX_IN = 320;
export const CHASSIS_LENGTH_BASELINE_IN = 300;
export const CHASSIS_WEIGHT_PER_IN_LB = 3;

export const TANK_SIZE_MIN_GAL = 45;
export const TANK_SIZE_MAX_GAL = 75;
export const TANK_SIZE_BASELINE_GAL = 55;
export const TANK_WEIGHT_PER_GAL_LB = 7;

export const ENGINE_POSITION_MIN_IN = -3;
export const ENGINE_POSITION_MAX_IN = 3;
export const ENGINE_POSITION_BALLAST_EQUIV_PER_IN = 8;

export function partPrice(brand, secondhand) {
  return Math.round(brand.priceNew * (secondhand ? SECONDHAND_PRICE_MULT : 1));
}

export function findBrand(list, id) {
  return list.find((b) => b.id === id) || list[0];
}

// The four ownable, brand-tiered parts, each with an "equipped" unit
// (config.<part>BrandId / config.<part>Secondhand) plus an inventory of
// spares (config.<part>Inventory - an array of { brandId, secondhand }
// units, each possibly a DIFFERENT brand/condition than the one currently
// mounted, or than each other). PARTS drives the generic inventory
// helpers below instead of writing near-identical per-part code four times.
export const PARTS = {
  engine: { brands: ENGINE_BRANDS, label: "motorblok" },
  head: { brands: HEAD_BRANDS, label: "cilinderkop" },
  blower: { brands: BLOWER_BRANDS, label: "blower" },
  clutch: { brands: CLUTCH_BRANDS, label: "koppeling" },
};

export function defaultGarageConfig() {
  return {
    engineBrandId: ENGINE_BRANDS[1].id, engineSecondhand: false,
    headBrandId: HEAD_BRANDS[1].id, headSecondhand: false,
    blowerBrandId: BLOWER_BRANDS[1].id, blowerSecondhand: false,
    blowerType: "conventional",
    clutchBrandId: CLUTCH_BRANDS[1].id, clutchSecondhand: false,
    bodyMaterial: "aluminium",
    chassisLengthIn: CHASSIS_LENGTH_BASELINE_IN,
    tankSizeGal: TANK_SIZE_BASELINE_GAL,
    tankPosition: "neutral",
    mudflaps: true,
    enginePositionIn: 0,
    // One starting spare per part, matching the default-equipped brand -
    // keeps a fresh team's starting position identical to the old flat
    // "1 spare" counts this replaces.
    engineInventory: [{ brandId: ENGINE_BRANDS[1].id, secondhand: false }],
    headInventory: [{ brandId: HEAD_BRANDS[1].id, secondhand: false }],
    blowerInventory: [{ brandId: BLOWER_BRANDS[1].id, secondhand: false }],
    clutchInventory: [{ brandId: CLUTCH_BRANDS[1].id, secondhand: false }],
  };
}

export function equippedUnit(config, part) {
  return { brandId: config[part + "BrandId"], secondhand: config[part + "Secondhand"] };
}

function setEquippedUnit(config, part, unit) {
  config[part + "BrandId"] = unit.brandId;
  config[part + "Secondhand"] = unit.secondhand;
}

export function unitPrice(part, unit) {
  return partPrice(findBrand(PARTS[part].brands, unit.brandId), unit.secondhand);
}

// Player-initiated swap: mount inventory[index] and return whatever was
// equipped before it back into inventory (it isn't broken, just parked).
export function installUnit(config, part, index) {
  const inv = config[part + "Inventory"];
  const incoming = inv[index];
  if (!incoming) return;
  const outgoing = equippedUnit(config, part);
  inv.splice(index, 1, outgoing);
  setEquippedUnit(config, part, incoming);
}

// Failure-triggered swap: mount the next available spare (discarding the
// failed part - it's scrapped, not returned to inventory) and report
// whether one was available at all. Called from finances.js's
// chargeEngineFailure/chargeClutchFailure.
export function consumeSpareOnFailure(config, part) {
  const inv = config[part + "Inventory"];
  if (!inv.length) return false;
  setEquippedUnit(config, part, inv.shift());
  return true;
}

// A part's own reliability tier, knocked down further if it's secondhand
// - a used part still makes full power, it's just more fragile.
function partReliabilityMult(brand, secondhand) {
  return brand.reliabilityMult * (secondhand ? SECONDHAND_RELIABILITY_MULT : 1);
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
  return partReliabilityMult(engine, config.engineSecondhand)
    * partReliabilityMult(head, config.headSecondhand)
    * partReliabilityMult(blower, config.blowerSecondhand)
    * blowerType.reliabilityMult;
}

// The clutch's own reliability tier - tracked separately from the engine's
// (it fails on its own heat-damage clock, see CLUTCH_DAMAGE_RATE in
// run-simulator.js), same secondhand knock-down as the other three parts.
export function computeClutchReliabilityMult(config) {
  const clutch = findBrand(CLUTCH_BRANDS, config.clutchBrandId);
  return partReliabilityMult(clutch, config.clutchSecondhand);
}

// Turns a build config into the handful of physics modifiers
// run-simulator.js accepts, all defaulting to a neutral no-op so the
// baseline build reproduces exactly the pre-garage physics.
export function computeGarageEffects(config) {
  const engine = findBrand(ENGINE_BRANDS, config.engineBrandId);
  const head = findBrand(HEAD_BRANDS, config.headBrandId);
  const blower = findBrand(BLOWER_BRANDS, config.blowerBrandId);
  const clutch = findBrand(CLUTCH_BRANDS, config.clutchBrandId);
  const body = BODY_MATERIALS[config.bodyMaterial];
  const blowerType = BLOWER_TYPES[config.blowerType];
  const tankPos = TANK_POSITIONS[config.tankPosition];

  const weightDeltaLb = body.weightDeltaLb
    + engine.weightDeltaLb + head.weightDeltaLb + blower.weightDeltaLb + clutch.weightDeltaLb
    + (config.chassisLengthIn - CHASSIS_LENGTH_BASELINE_IN) * CHASSIS_WEIGHT_PER_IN_LB
    + (config.tankSizeGal - TANK_SIZE_BASELINE_GAL) * TANK_WEIGHT_PER_GAL_LB;

  const wheelieRiskBallastEquivLb = tankPos.ballastEquivLb
    - config.enginePositionIn * ENGINE_POSITION_BALLAST_EQUIV_PER_IN;

  // Higher reliability means the engine (or clutch) should accumulate
  // damage MORE SLOWLY, so the damage-rate multiplier run-simulator.js
  // applies is the inverse of the reliability figure shown to the player.
  const reliabilityMult = computeEngineReliabilityMult(config);
  const clutchReliabilityMult = computeClutchReliabilityMult(config);

  return {
    garageWeightDeltaLb: weightDeltaLb,
    garageWheelieRiskBallastEquivLb: wheelieRiskBallastEquivLb,
    garageDragCdaMult: config.mudflaps ? 1 : 0.99,
    garageClutchHeatRateMult: clutch.heatRateMult,
    garageClutchDamageMult: 1 / clutchReliabilityMult,
    garageTractionMult: blowerType.tractionMult,
    garagePowerMult: computeEnginePowerMult(config),
    garageEngineDamageMult: 1 / reliabilityMult,
  };
}

export function totalBuildValue(config) {
  const engine = findBrand(ENGINE_BRANDS, config.engineBrandId);
  const head = findBrand(HEAD_BRANDS, config.headBrandId);
  const blower = findBrand(BLOWER_BRANDS, config.blowerBrandId);
  const clutch = findBrand(CLUTCH_BRANDS, config.clutchBrandId);
  return partPrice(engine, config.engineSecondhand)
    + partPrice(head, config.headSecondhand)
    + partPrice(blower, config.blowerSecondhand)
    + BLOWER_TYPES[config.blowerType].priceDelta
    + BODY_MATERIALS[config.bodyMaterial].priceNew
    + partPrice(clutch, config.clutchSecondhand);
}

export function equippedPartPrice(config, part) {
  if (part === "engine") return partPrice(findBrand(ENGINE_BRANDS, config.engineBrandId), config.engineSecondhand);
  if (part === "head") return partPrice(findBrand(HEAD_BRANDS, config.headBrandId), config.headSecondhand);
  if (part === "blower") return partPrice(findBrand(BLOWER_BRANDS, config.blowerBrandId), config.blowerSecondhand) + BLOWER_TYPES[config.blowerType].priceDelta;
  if (part === "clutch") return partPrice(findBrand(CLUTCH_BRANDS, config.clutchBrandId), config.clutchSecondhand);
  return 0;
}

export function spareLabel(part) {
  return PARTS[part].label;
}

// Static front/rear split for the per-axle weight readout. A rear-engine
// dragster carries very little of its static weight up front (long
// chassis, engine/blower/driver all sitting well aft of center) - this is
// the bare-chassis baseline before ballast and engine-position choices
// shift it. Ballast lands 100% on whichever axle it's mounted at,
// straight from ballastFrontLb/ballastRearLb; the engine itself moving
// fore/aft (enginePositionIn, same signed convention as the wheelie-risk
// ballast-equivalent above - positive is rearward) shifts a slice of its
// own mass across axles too, on top of the ballast the player dials in
// directly. Purely a display breakdown for the garage UI - the actual
// launch physics already account for ballast/engine position through
// weightLb and the wheelie-risk ballast-equivalent; this doesn't feed
// back into run-simulator.js.
const BASE_FRONT_WEIGHT_FRACTION = 0.17;
const ENGINE_POSITION_WEIGHT_SHIFT_PER_IN = 12;

export function computeWeightDistribution(totalWeightLb, ballastFrontLb, ballastRearLb, enginePositionIn) {
  const bareWeightLb = totalWeightLb - ballastFrontLb - ballastRearLb;
  const frontLb = bareWeightLb * BASE_FRONT_WEIGHT_FRACTION
    - enginePositionIn * ENGINE_POSITION_WEIGHT_SHIFT_PER_IN
    + ballastFrontLb;
  const rearLb = totalWeightLb - frontLb;
  return {
    frontLb, rearLb,
    frontPct: (frontLb / totalWeightLb) * 100,
    rearPct: (rearLb / totalWeightLb) * 100,
  };
}
