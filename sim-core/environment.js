// Environment module: air and track conditions -> density altitude, power
// multiplier, and effective grip coefficient. Pure functions, no DOM access.

export function calcDensityAltitude(airtempC, humidity, baroInHg) {
  const airtempF = airtempC * 9 / 5 + 32;
  const pressureAltitude = (29.92 - baroInHg) * 1000;
  const da = pressureAltitude + 120 * (airtempF - 59) + humidity * 3;
  return Math.max(-3000, Math.min(10000, da));
}

export function calcPowerMult(densityAltitude) {
  const daClamped = Math.max(-3000, Math.min(8000, densityAltitude));
  return 1 - daClamped / 60000;
}

const OPTIMAL_TRACK_TEMP_C = 24;

// Track temp vs grip is a real inverted-U, not a simple "hotter = worse":
// below ~70F (21C) traction drops off fast (compound doesn't activate, dew
// risk); 70-90F (21-32C) is the sweet spot most crew chiefs cite; above
// ~100-115F (38-46C) the traction compound gets "gooey" and grip falls off
// again, though more gradually than the cold-side drop.
export function calcTrackHeatPenalty(trackTempC) {
  const trackTempDiff = trackTempC - OPTIMAL_TRACK_TEMP_C;
  return trackTempDiff < 0
    ? 0.031 * trackTempDiff * trackTempDiff
    : 0.0025 * trackTempDiff * trackTempDiff;
}

export function calcGripCoeff({ gripSliderPct, trackTempC, psiPenalty }) {
  const trackHeatPenalty = calcTrackHeatPenalty(trackTempC);
  const gripFraction = gripSliderPct / 100;
  return Math.max(0.6, (0.9 + gripFraction * 5.7) - trackHeatPenalty - psiPenalty);
}
