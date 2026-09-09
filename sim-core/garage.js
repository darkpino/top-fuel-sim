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

export const ENGINE_BRANDS = [
  { id: "ironclad", name: "Ironclad Racing", priceNew: 16000, powerMult: 0.98, reliabilityMult: 0.95 },
  { id: "nitroforge", name: "NitroForge", priceNew: 24000, powerMult: 1.00, reliabilityMult: 1.00 },
  { id: "apex", name: "Apex Billet", priceNew: 34000, powerMult: 1.02, reliabilityMult: 1.05 },
  { id: "vortan", name: "Vortan Dynamics", priceNew: 46000, powerMult: 1.04, reliabilityMult: 1.10 },
];

export const HEAD_BRANDS = [
  { id: "trailblazer", name: "Trailblazer Heads", priceNew: 9000, powerMult: 0.97, reliabilityMult: 0.97 },
  { id: "redlineflow", name: "Redline Flow", priceNew: 13000, powerMult: 1.00, reliabilityMult: 1.00 },
  { id: "apexheads", name: "Apex Billet Heads", priceNew: 18000, powerMult: 1.03, reliabilityMult: 1.03 },
  { id: "vortanheads", name: "Vortan CNC", priceNew: 24000, powerMult: 1.06, reliabilityMult: 1.06 },
];

export const BLOWER_BRANDS = [
  { id: "duneblast", name: "Duneblast Superchargers", priceNew: 11000, powerMult: 0.97, reliabilityMult: 0.97 },
  { id: "hurricane", name: "Hurricane Blower Co", priceNew: 15000, powerMult: 1.00, reliabilityMult: 1.00 },
  { id: "apexblower", name: "Apex Billet Blower", priceNew: 19000, powerMult: 1.03, reliabilityMult: 1.03 },
  { id: "vortanblower", name: "Vortan Rootstype", priceNew: 23000, powerMult: 1.06, reliabilityMult: 1.06 },
];

export const BODY_MATERIALS = {
  aluminium: { name: "Aluminium", priceNew: 4000, weightDeltaLb: 0 },
  carbon: { name: "Carbon", priceNew: 15000, weightDeltaLb: -70 },
};

// Real reason a slipper clutch runs hotter with fewer plates: less total
// friction surface for the same torque, so each plate dissipates more -
// the direct mechanic the user asked for ("5 platen wordt heter tijdens
// slippen en kan je dus minder lang laten slippen").
export const CLUTCH_PLATE_OPTIONS = {
  5: { name: "5-plaats", priceNew: 5000, heatRateMult: 1.35 },
  6: { name: "6-plaats", priceNew: 6500, heatRateMult: 1.0 },
};

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

export function defaultGarageConfig() {
  return {
    engineBrandId: ENGINE_BRANDS[1].id, engineSecondhand: false,
    headBrandId: HEAD_BRANDS[1].id, headSecondhand: false,
    blowerBrandId: BLOWER_BRANDS[1].id, blowerSecondhand: false,
    blowerType: "conventional",
    clutchPlates: 6,
    bodyMaterial: "aluminium",
    chassisLengthIn: CHASSIS_LENGTH_BASELINE_IN,
    tankSizeGal: TANK_SIZE_BASELINE_GAL,
    tankPosition: "neutral",
    mudflaps: true,
    enginePositionIn: 0,
    engineSpares: 1, headSpares: 1, blowerSpares: 1,
  };
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

// Turns a build config into the handful of physics modifiers
// run-simulator.js accepts, all defaulting to a neutral no-op so the
// baseline build reproduces exactly the pre-garage physics.
export function computeGarageEffects(config) {
  const body = BODY_MATERIALS[config.bodyMaterial];
  const plates = CLUTCH_PLATE_OPTIONS[config.clutchPlates];
  const blowerType = BLOWER_TYPES[config.blowerType];
  const tankPos = TANK_POSITIONS[config.tankPosition];

  const weightDeltaLb = body.weightDeltaLb
    + (config.chassisLengthIn - CHASSIS_LENGTH_BASELINE_IN) * CHASSIS_WEIGHT_PER_IN_LB
    + (config.tankSizeGal - TANK_SIZE_BASELINE_GAL) * TANK_WEIGHT_PER_GAL_LB;

  const wheelieRiskBallastEquivLb = tankPos.ballastEquivLb
    - config.enginePositionIn * ENGINE_POSITION_BALLAST_EQUIV_PER_IN;

  // Higher reliability means the engine should accumulate heat/lean
  // damage MORE SLOWLY, so the damage-rate multiplier run-simulator.js
  // applies is the inverse of the reliability figure shown to the player.
  const reliabilityMult = computeEngineReliabilityMult(config);

  return {
    garageWeightDeltaLb: weightDeltaLb,
    garageWheelieRiskBallastEquivLb: wheelieRiskBallastEquivLb,
    garageDragCdaMult: config.mudflaps ? 1 : 0.99,
    garageClutchHeatRateMult: plates.heatRateMult,
    garageTractionMult: blowerType.tractionMult,
    garagePowerMult: computeEnginePowerMult(config),
    garageEngineDamageMult: 1 / reliabilityMult,
  };
}

export function totalBuildValue(config) {
  const engine = findBrand(ENGINE_BRANDS, config.engineBrandId);
  const head = findBrand(HEAD_BRANDS, config.headBrandId);
  const blower = findBrand(BLOWER_BRANDS, config.blowerBrandId);
  return partPrice(engine, config.engineSecondhand)
    + partPrice(head, config.headSecondhand)
    + partPrice(blower, config.blowerSecondhand)
    + BLOWER_TYPES[config.blowerType].priceDelta
    + BODY_MATERIALS[config.bodyMaterial].priceNew
    + CLUTCH_PLATE_OPTIONS[config.clutchPlates].priceNew;
}

export function equippedPartPrice(config, part) {
  if (part === "engine") return partPrice(findBrand(ENGINE_BRANDS, config.engineBrandId), config.engineSecondhand);
  if (part === "head") return partPrice(findBrand(HEAD_BRANDS, config.headBrandId), config.headSecondhand);
  if (part === "blower") return partPrice(findBrand(BLOWER_BRANDS, config.blowerBrandId), config.blowerSecondhand) + BLOWER_TYPES[config.blowerType].priceDelta;
  return 0;
}

export function spareLabel(part) {
  return part === "engine" ? "motorblok" : part === "head" ? "cilinderkop" : "blower";
}
