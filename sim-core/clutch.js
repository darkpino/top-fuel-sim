// Clutch module: stage timers -> bearing setpoint over time, and how far the
// bearing can actually reach given hydraulic travel speed. Pure functions,
// no DOM access.

// Each stage timer commands a new target for the bearing; it does not jump
// there, it travels toward it hydraulically (see stepBearingPos). Real
// telemetry (G-meter trace) shows the G-peak happening at FULL lockup, not
// at launch - launch gives a moderate plateau, there's often a dip as drag
// catches up before the next stage clamps harder, then a climb to the peak
// right as the clutch fully locks, followed by a decay as speed/drag take
// over. s3time is when full lockup (1.0) is commanded - that's the moment
// the peak G in real telemetry occurs.
export function activeSetpoint(t, stages) {
  const { s1time, s1pct, s2time, s2pct, s3time, s3pct } = stages;
  if (t < s1time) return s1pct;
  if (t < s2time) return s2pct;
  if (t < s3time) return s3pct;
  return 1.0;
}

// Finger-desired lockup: how far centrifugal force wants to push the
// fingers out, purely from finger weight (assumes launch RPM is reached and
// roughly held through the run - real cars do vary RPM, but that's a future
// refinement).
export function calcFingerDesired(fingerWeight) {
  return 0.30 + (fingerWeight / 100) * 0.70;
}

export function stepBearingPos(bearingPos, target, bearingSpeed, dt) {
  if (bearingPos < target) return Math.min(target, bearingPos + bearingSpeed * dt);
  if (bearingPos > target) return Math.max(target, bearingPos - bearingSpeed * dt);
  return bearingPos;
}

// Reachable lockup within a stage = however far the bearing can travel at
// bearingSpeed in the time available, capped by the setpoint itself. If the
// reachable value is below the setpoint, that setpoint is currently "dead" -
// raising it further won't do anything until you also give the bearing more
// time or more speed.
export function calcClutchReach(stages, bearingSpeed) {
  const { s1time, s1pct, s2time, s2pct, s3time, s3pct } = stages;
  let pos = 0.05;
  const reach1 = Math.min(s1pct, pos + bearingSpeed * s1time);
  pos = reach1;
  const reach2 = s2pct >= pos
    ? Math.min(s2pct, pos + bearingSpeed * (s2time - s1time))
    : Math.max(s2pct, pos - bearingSpeed * (s2time - s1time));
  pos = reach2;
  const reach3 = s3pct >= pos
    ? Math.min(s3pct, pos + bearingSpeed * (s3time - s2time))
    : Math.max(s3pct, pos - bearingSpeed * (s3time - s2time));
  return { reach1, reach2, reach3 };
}
