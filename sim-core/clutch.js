// Clutch module: stage timers -> bearing setpoint over time, and how far the
// bearing can actually reach given hydraulic travel speed. Pure functions,
// no DOM access.

// Each stage timer commands a new target for the bearing; it does not jump
// there, it travels toward it hydraulically (see stepBearingPos). Real
// telemetry (G-meter trace) shows the G-peak happening at FULL lockup, not
// at launch - launch gives a moderate plateau, there's often a dip as drag
// catches up before the next stage clamps harder, then a climb to the peak
// right as the clutch fully locks, followed by a decay as speed/drag take
// over. Stage 3's target IS the ceiling for the rest of the run - it does
// NOT keep climbing to 100% on its own after s3time. Set it to 100% for a
// normal full-lockup finish (the peak G in real telemetry happens right as
// that's reached); leave it lower to deliberately keep the clutch slipping
// for the whole run - protects the tires from a traction ceiling the tune
// can't otherwise reach, at the cost of cooking the clutch itself.
export function activeSetpoint(t, stages) {
  const { s1time, s1pct, s2time, s2pct, s3time, s3pct } = stages;
  if (t < s1time) return s1pct;
  if (t < s2time) return s2pct;
  return s3pct;
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
// The stage-3 rate continues to govern the final approach to full lockup
// (t >= s3time), since no separate "stage 4" target/timing exists.
export function activeSpeed(t, stages) {
  const { s1time, s2time, s3time, s1speed, s2speed, s3speed } = stages;
  if (t < s1time) return s1speed;
  if (t < s2time) return s2speed;
  return s3speed;
}

// Reachable lockup within a stage = however far the bearing can travel at
// that stage's speed in the time available, capped by the setpoint itself.
// If the reachable value is below the setpoint, that setpoint is currently
// "dead" - raising it further won't do anything until you also give the
// bearing more time or more speed.
export function calcClutchReach(stages) {
  const { s1time, s1pct, s1speed, s2time, s2pct, s2speed, s3time, s3pct, s3speed } = stages;
  let pos = 0.05;
  const reach1 = Math.min(s1pct, pos + s1speed * s1time);
  pos = reach1;
  const reach2 = s2pct >= pos
    ? Math.min(s2pct, pos + s2speed * (s2time - s1time))
    : Math.max(s2pct, pos - s2speed * (s2time - s1time));
  pos = reach2;
  const reach3 = s3pct >= pos
    ? Math.min(s3pct, pos + s3speed * (s3time - s2time))
    : Math.max(s3pct, pos - s3speed * (s3time - s2time));
  return { reach1, reach2, reach3 };
}
