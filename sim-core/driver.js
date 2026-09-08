// Driver module: how the driver reacts when the tires go up in smoke
// (sustained excessive wheelspin) mid-run. A driver either "pedals" the
// car - a brief, repeated throttle lift to let the tires regain traction
// before getting back in it - or lifts off entirely and aborts the run,
// coasting the rest of the way on whatever speed the car already has.
// Aggressiveness (0-100) sets how long the driver tolerates sustained
// smoke before reacting at all, and how the reaction plays out: a more
// aggressive driver pedals through trouble; a more cautious one - or one
// who has already pedaled and it still isn't hooking up - gets off it
// for good.

const SMOKE_SLIP_THRESHOLD = 55; // slip% considered "in smoke", not just managed slip
const PEDAL_DURATION = 0.12; // s - length of a single throttle lift/reapply
const PEDAL_THROTTLE = 0.15; // fraction of commanded force kept during a pedal dip
const MAX_PEDALS_BEFORE_LIFT = 3; // even a determined driver gives up eventually
const LIFT_AGGRESSIVENESS_THRESHOLD = 35; // below this, the first reaction to smoke is a full lift

// How long (s) of continuous smoke the driver tolerates before reacting at
// all - a more aggressive driver waits longer, hoping the tires hook up on
// their own.
export function calcSmokeTolerance(aggressiveness) {
  return 0.10 + (aggressiveness / 100) * 0.35;
}

export function createDriverState() {
  return { smokeTime: 0, pedaling: false, pedalTimeLeft: 0, pedalCount: 0, lifted: false, liftTime: null };
}

// Called once per timestep with the PREVIOUS step's slip% (the driver
// reacts to what the car just did, not what it's about to do this instant -
// this also avoids a circular dependency, since this step's slip% depends
// on the throttle this function returns) and the car's current distance x
// (ft). watchUntilX caps how far into the run the driver is actively
// watching for smoke and reacting to it - past that point (but not before
// it, and not overriding an already-lifted or already-pedaling driver) the
// commanded throttle is left alone, as if the driver has settled in and is
// just holding what the tune gives him. Returns the throttle fraction
// (0-1) to apply to commanded engine force this step, and mutates
// driverState in place.
export function stepDriver(driverState, t, x, prevSlipPct, aggressiveness, watchUntilX, dt) {
  if (driverState.lifted) return 0;

  if (driverState.pedaling) {
    driverState.pedalTimeLeft -= dt;
    if (driverState.pedalTimeLeft <= 0) {
      driverState.pedaling = false;
      driverState.smokeTime = 0;
    }
    return PEDAL_THROTTLE;
  }

  if (x > watchUntilX) {
    driverState.smokeTime = 0;
    return 1;
  }

  if (prevSlipPct >= SMOKE_SLIP_THRESHOLD) {
    driverState.smokeTime += dt;
  } else {
    driverState.smokeTime = 0;
    return 1;
  }

  if (driverState.smokeTime < calcSmokeTolerance(aggressiveness)) return 1;

  // Patience exhausted for this bout of smoke: pedal through it, or give up.
  if (aggressiveness < LIFT_AGGRESSIVENESS_THRESHOLD || driverState.pedalCount >= MAX_PEDALS_BEFORE_LIFT) {
    driverState.lifted = true;
    driverState.liftTime = t;
    return 0;
  }

  driverState.pedaling = true;
  driverState.pedalTimeLeft = PEDAL_DURATION;
  driverState.pedalCount += 1;
  return PEDAL_THROTTLE;
}
