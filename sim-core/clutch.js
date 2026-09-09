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
// over. Stage 6's target IS the ceiling for the rest of the run - it does
// NOT keep climbing to 100% on its own after s6time. Set it to 100% for a
// normal full-lockup finish (the peak G in real telemetry happens right as
// that's reached); leave it lower to deliberately keep the clutch slipping
// for the whole run - protects the tires from a traction ceiling the tune
// can't otherwise reach, at the cost of cooking the clutch itself.
export function activeSetpoint(t, stages) {
  for (const n of STAGE_NUMBERS) {
    if (t < stages[`s${n}time`]) return stages[`s${n}pct`];
  }
  return stages.s6pct;
}

// Finger-desired lockup: how far centrifugal force wants to push the
// fingers out, purely from finger weight (assumes launch RPM is reached and
// roughly held through the run - real cars do vary RPM, but that's a future
// refinement).
export function calcFingerDesired(fingerWeight) {
  return 0.30 + (fingerWeight / 100) * 0.70;
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

export function stepBearingPos(bearingPos, target, bearingSpeed, dt) {
  if (bearingPos < target) return Math.min(target, bearingPos + bearingSpeed * dt);
  if (bearingPos > target) return Math.max(target, bearingPos - bearingSpeed * dt);
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
// that stage's speed in the time available, capped by the setpoint itself.
// If the reachable value is below the setpoint, that setpoint is currently
// "dead" - raising it further won't do anything until you also give the
// bearing more time or more speed. Returns { reach1..reach6 }.
export function calcClutchReach(stages) {
  let pos = 0.05;
  let prevTime = 0;
  const reach = {};
  for (const n of STAGE_NUMBERS) {
    const time = stages[`s${n}time`];
    const pct = stages[`s${n}pct`];
    const speed = stages[`s${n}speed`];
    const dt = time - prevTime;
    pos = pct >= pos ? Math.min(pct, pos + speed * dt) : Math.max(pct, pos - speed * dt);
    reach[`reach${n}`] = pos;
    prevTime = time;
  }
  return reach;
}
