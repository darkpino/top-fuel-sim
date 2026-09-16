// Clutch module: stage timers -> bearing setpoint over time, and how far the
// bearing can actually reach given hydraulic travel speed. Pure functions,
// no DOM access.

// Six stages (not the original three) so a tune can shape a genuinely
// gradual curve instead of two sharp corners - real clutch timers step
// through many more than 3 points, and the old 3-stage model's jump from
// one setpoint straight to a much lower or higher one (with only that
// stage's own speed to get there) read as a near-vertical line on the
// trace. More, smaller steps let each transition be gentler while still
// reaching the same overall shape.
const STAGE_NUMBERS = [1, 2, 3, 4, 5, 6];

// Each stage timer commands a new target for the bearing; it does not jump
// there, it travels toward it hydraulically (see stepBearingPos). Real
// telemetry (G-meter trace) shows the G-peak happening at FULL lockup, not
// at launch - launch gives a moderate plateau, there's often a dip as drag
// catches up before the next stage clamps harder, then a climb to the peak
// right as the clutch fully locks, followed by a decay as speed/drag take
// over. That dip does NOT come from the bearing retracting, though - see
// stepBearingPos, it mechanically can't. It comes from the power-based
// force ceiling naturally falling as speed rises (run-simulator.js) while
// lockup itself holds roughly flat for a stage or two. Stage 6's target IS
// the ceiling for the rest of the run - it does NOT keep climbing to 100%
// on its own after s6time. Set it to 100% for a normal full-lockup finish
// (the peak G in real telemetry happens right as that's reached); leave it
// lower to deliberately keep the clutch slipping for the whole run -
// protects the tires from a traction ceiling the tune can't otherwise
// reach, at the cost of cooking the clutch itself.
export function activeSetpoint(t, stages) {
  for (const n of STAGE_NUMBERS) {
    if (t < stages[`s${n}time`]) return stages[`s${n}pct`];
  }
  return stages.s6pct;
}

// Finger-desired lockup: how far centrifugal force wants to push the
// fingers out (assumes launch RPM is reached and roughly held through the
// run - real cars do vary RPM, but that's a future refinement).
//
// Used to be a hard deterministic ceiling scaling linearly with
// fingerWeight (0.30 at zero weight, 1.00 at full) - meaning at low
// weight, full lockup wasn't just unlikely, it was LITERALLY impossible
// no matter how the rest of the run went. Real fingers don't work that
// way: less weight makes the assembly less aggressive (lower expected
// reach) AND less consistent (more scatter pass to pass), but it never
// rules out a fully-locked run outright, just makes one less likely.
//
// Modeled here as a blend between that old deterministic ceiling (still
// the exact result at fingerWeight 100 - base=1 zeroes out the random
// term entirely, so the calibrated default tune and every 100-weight AI
// archetype stay byte-identical to before) and a uniform random draw
// between FINGER_RANDOM_FLOOR and 1.0, whose share of the blend grows as
// fingerWeight drops. At weight 0 the result is governed entirely by that
// draw: MORE OFTEN than not it falls well short of a full lockup (that's
// the whole point - less weight genuinely is less aggressive on average),
// but "sometimes it just fully locks anyway" needs to be a real, visible
// outcome across a handful of runs, not a one-in-forty fluke - an earlier
// version skewed the draw so hard toward the floor (Math.pow(rng(), 2.5))
// that a full lockup was too rare to ever actually show up in play,
// reading as "it just never locks" even though it was never literally
// impossible. Plain rng() (no skew) plus a higher floor fixes that.
// Rolled once per run (call site is outside the per-tick loop), not
// per-tick - a given pass has one consistent mechanical ceiling throughout,
// not fingers whose reach fluctuates tick to tick.
const FINGER_RANDOM_FLOOR = 0.35;

export function calcFingerDesired(fingerWeight, rng = Math.random) {
  const base = fingerWeight / 100;
  const randomDraw = FINGER_RANDOM_FLOOR + (1 - FINGER_RANDOM_FLOOR) * rng();
  return base + (1 - base) * randomDraw;
}

// The OTHER half of finger weight's effect, and arguably the more visible
// one: lighter fingers generate less centrifugal force at a given RPM, so
// they push the bearing out toward each stage's target more SLOWLY, not
// just to a lower eventual ceiling (calcFingerDesired above). Without this,
// weight only ever showed up as a late-stage cap - the clutch came in at
// the exact same rate through every earlier stage no matter how light the
// fingers were, which isn't how a real centrifugal clutch behaves: less
// weight makes it visibly softer/lazier from the very first stage, not
// just eventually short of full lock. Applied as a flat multiplier on
// activeSpeed's per-stage bearing speed (see run-simulator.js), so a light
// build takes noticeably longer to catch up to whatever the tune's stage
// timer is asking for at any given instant, not only at the end.
// FINGER_SPEED_MULT_FLOOR=0.4 at fingerWeight 0 (still a real, if lazy,
// clutch - never fully inert) scaling straight up to exactly 1.0 (a
// complete no-op) at fingerWeight 100, so the calibrated default tune and
// every 100-weight AI archetype see byte-identical bearing speed to before.
const FINGER_SPEED_MULT_FLOOR = 0.4;

export function calcFingerSpeedMult(fingerWeight) {
  const base = fingerWeight / 100;
  return FINGER_SPEED_MULT_FLOOR + (1 - FINGER_SPEED_MULT_FLOOR) * base;
}

const WEAR_LOCKUP_GAIN = 1.0;

// As the pack wears from slip, the friction material thins and the
// mechanical gap between the fingers and the bearing grows - the fingers
// can now travel further than a fresh pack would allow, raising the
// lockup ceiling beyond what was dialed in. This is what makes clutch
// damage dangerous beyond the eventual failure it also causes: hold a
// tune with sustained slip and the effective clutch quietly gets more
// aggressive than intended, right when the tune was counting on it NOT
// to - a tune that started out safely under the traction ceiling can
// creep past it as the run goes on.
export function calcWornFingerDesired(baseFingerDesired, clutchDamage) {
  return Math.min(1.0, baseFingerDesired + clutchDamage * WEAR_LOCKUP_GAIN);
}

// The bearing is a one-way ratchet: centrifugal force and the timer's
// hydraulic/pneumatic pressure only ever push it toward MORE lockup, never
// less, within a run. A stage whose target is below the bearing's current
// position doesn't pull it back - it just can't add anything until a
// later stage's target rises above where the bearing already sits (a
// real "pedal back" on a genuine centrifugal clutch means the driver
// backing off the throttle so less torque needs transmitting, not the
// bearing itself retracting - that's a driver/tune interaction the sim
// already covers elsewhere, not something this position tracker does).
export function stepBearingPos(bearingPos, target, bearingSpeed, dt) {
  if (bearingPos < target) return Math.min(target, bearingPos + bearingSpeed * dt);
  return bearingPos;
}

// Each timer stage has its own hydraulic bleed rate on a real clutch
// timer, not just its own target/timing - so the bearing travels calmly at
// a different speed per stage rather than snapping to each new setpoint.
// The stage-6 rate continues to govern the final approach to full lockup
// (t >= s6time), since no separate "stage 7" target/timing exists.
export function activeSpeed(t, stages) {
  for (const n of STAGE_NUMBERS) {
    if (t < stages[`s${n}time`]) return stages[`s${n}speed`];
  }
  return stages.s6speed;
}

// Reachable lockup within a stage = however far the bearing can travel at
// that stage's speed in the time available, capped by the setpoint itself
// - and, same as stepBearingPos, never LESS than what an earlier stage
// already reached. If the reachable value is below the setpoint, that
// setpoint is currently "dead" - raising it further won't do anything
// until you also give the bearing more time or more speed. If a stage's
// setpoint is below what's already been reached, it's "dead" the other
// way: nothing to catch up to, the bearing just holds. Returns
// { reach1..reach6 }.
export function calcClutchReach(stages) {
  let pos = 0.05;
  let prevTime = 0;
  const reach = {};
  for (const n of STAGE_NUMBERS) {
    const time = stages[`s${n}time`];
    const pct = stages[`s${n}pct`];
    const speed = stages[`s${n}speed`];
    const dt = time - prevTime;
    if (pct > pos) pos = Math.min(pct, pos + speed * dt);
    reach[`reach${n}`] = pos;
    prevTime = time;
  }
  return reach;
}
