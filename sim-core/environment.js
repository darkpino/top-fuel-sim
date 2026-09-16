// Environment module: air and track conditions -> density altitude, power
// multiplier, and effective grip coefficient. Pure functions, no DOM access.

// fieldElevationFt is the track's actual physical elevation (Denver's
// ~5850ft vs Gainesville's ~50ft, see tracks.js) - separate from
// baroInHg, which is the day's WEATHER-driven altimeter setting
// (already sea-level-corrected, so it swings only a fraction of an inHg
// around 29.92 regardless of where the track sits). Both add distance
// from the surface: a high, hot, low-pressure day at Denver stacks all
// three into a much bigger density altitude than any one of them alone.
export function calcDensityAltitude(airtempC, humidity, baroInHg, fieldElevationFt = 0) {
  const airtempF = airtempC * 9 / 5 + 32;
  const pressureAltitude = (29.92 - baroInHg) * 1000 + fieldElevationFt;
  const da = pressureAltitude + 120 * (airtempF - 59) + humidity * 3;
  return Math.max(-3000, Math.min(15000, da));
}

export function calcPowerMult(densityAltitude) {
  const daClamped = Math.max(-3000, Math.min(13000, densityAltitude));
  return 1 - daClamped / 60000;
}

// Thinner air is also less air to shove out of the way - the same
// density altitude that costs the supercharged engine power (above)
// costs the car aerodynamic drag too, via the standard-atmosphere
// density-ratio approximation (troposphere). Multiplies the reference
// air density used for the drag term in run-simulator.js - 1.0 at
// standard sea-level conditions (densityAltitude = 0), falling below 1
// as density altitude rises (thinner air, less drag) and rising above 1
// as it falls (denser air, more drag).
export function calcAirDensityRatio(densityAltitude) {
  const daClamped = Math.max(-3000, Math.min(15000, densityAltitude));
  return Math.pow(1 - 6.8755e-6 * daClamped, 4.2561);
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
