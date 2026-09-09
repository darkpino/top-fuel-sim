// Garage module: the car-build side of the finances system. Pure
// data/functions, no DOM access - a fictional parts catalog (engine
// blocks, cylinder heads, blowers) plus chassis-level build choices
// (body material, chassis length, fuel tank, clutch plate count, blower
// type, mudflaps, engine position), and the math that turns a build
// config into euros and into the small set of physics modifiers
// run-simulator.js accepts (weight, wheelie-risk equivalent, drag,
// clutch heat rate, traction). Brand/quality differences beyond price
// and the explicitly-requested clutch-heat mechanic are deliberately
// left flat for now - deeper reliability/performance differentiation
// between brands is a later pass, same as secondhand-part reliability.

export const SECONDHAND_PRICE_MULT = 0.55;

export const ENGINE_BRANDS = [
  { id: "ironclad", name: "Ironclad Racing", priceNew: 16000 },
  { id: "nitroforge", name: "NitroForge", priceNew: 24000 },
  { id: "apex", name: "Apex Billet", priceNew: 34000 },
  { id: "vortan", name: "Vortan Dynamics", priceNew: 46000 },
];

export const HEAD_BRANDS = [
  { id: "trailblazer", name: "Trailblazer Heads", priceNew: 9000 },
  { id: "redlineflow", name: "Redline Flow", priceNew: 13000 },
  { id: "apexheads", name: "Apex Billet Heads", priceNew: 18000 },
  { id: "vortanheads", name: "Vortan CNC", priceNew: 24000 },
];

export const BLOWER_BRANDS = [
  { id: "duneblast", name: "Duneblast Superchargers", priceNew: 11000 },
  { id: "hurricane", name: "Hurricane Blower Co", priceNew: 15000 },
  { id: "apexblower", name: "Apex Billet Blower", priceNew: 19000 },
  { id: "vortanblower", name: "Vortan Rootstype", priceNew: 23000 },
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
// belt run, which in practice gives a little better mechanical grip on
// the crank - modeled here as a small traction bump over a conventional
// (in-line) mount.
export const BLOWER_TYPES = {
  conventional: { name: "Gewone blower", tractionMult: 1.0 },
  setback: { name: "Setback blower", tractionMult: 1.015 },
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

  return {
    garageWeightDeltaLb: weightDeltaLb,
    garageWheelieRiskBallastEquivLb: wheelieRiskBallastEquivLb,
    garageDragCdaMult: config.mudflaps ? 1 : 0.99,
    garageClutchHeatRateMult: plates.heatRateMult,
    garageTractionMult: blowerType.tractionMult,
  };
}

export function totalBuildValue(config) {
  const engine = findBrand(ENGINE_BRANDS, config.engineBrandId);
  const head = findBrand(HEAD_BRANDS, config.headBrandId);
  const blower = findBrand(BLOWER_BRANDS, config.blowerBrandId);
  return partPrice(engine, config.engineSecondhand)
    + partPrice(head, config.headSecondhand)
    + partPrice(blower, config.blowerSecondhand)
    + BODY_MATERIALS[config.bodyMaterial].priceNew
    + CLUTCH_PLATE_OPTIONS[config.clutchPlates].priceNew;
}

export function equippedPartPrice(config, part) {
  if (part === "engine") return partPrice(findBrand(ENGINE_BRANDS, config.engineBrandId), config.engineSecondhand);
  if (part === "head") return partPrice(findBrand(HEAD_BRANDS, config.headBrandId), config.headSecondhand);
  if (part === "blower") return partPrice(findBrand(BLOWER_BRANDS, config.blowerBrandId), config.blowerSecondhand);
  return 0;
}

export function spareLabel(part) {
  return part === "engine" ? "motorblok" : part === "head" ? "cilinderkop" : "blower";
}
