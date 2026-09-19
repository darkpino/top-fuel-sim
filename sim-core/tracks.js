// Tracks module: a small, hand-picked set of real NHRA national-event
// venues, each carrying a distinct elevation and climate profile instead
// of every event happening at the same generic sea-level track. Pure
// data, no DOM access - event.js turns a chosen track into actual
// per-round conditions (see conditionsForDayFrac), and run-simulator.js
// (via environment.js) turns elevationFt into real density-altitude
// effects on both power AND drag.
//
// 11 of the ~20 real national-event venues, picked for climate/altitude
// spread rather than completeness: a high-altitude mountain track
// (Denver), two low-humidity deserts (Vegas, Phoenix), four humid/hot
// venues (Gainesville, Houston, Charlotte, Indianapolis), a cool damp one
// (Seattle), and three more temperate ones (Pomona, Epping, Chicago).
// Indianapolis (Lucas Oil Raceway) is the U.S. Nationals - the sport's
// biggest and oldest national event, run over Labor Day weekend, so late-
// summer Midwest heat and humidity rather than a mild spring/fall day.
//
// airtempBaseMin/Max and airtempPeakDeltaMin/Max together set that
// track's day-arc (see conditionsForDayFrac): the day starts somewhere
// in the base range and climbs by the peak-delta range toward midday.
// trackTempDeltaMin/Max is how much hotter the asphalt runs than the
// air - bigger under direct desert sun (Vegas, Phoenix, Denver) than
// under humid haze (Gainesville, Houston) or Pacific Northwest cloud
// cover (Seattle).
//
// lat/lon are approximate venue coordinates, used only by season.js to
// compute great-circle travel distance/cost from the team's home base -
// not precise enough for anything beyond that rough mileage estimate.
export const TRACKS = [
  {
    id: "pomona", name: "Auto Club Raceway (Pomona, CA)", elevationFt: 850,
    lat: 34.06, lon: -117.75,
    airtempBaseMin: 14, airtempBaseMax: 20, airtempPeakDeltaMin: 6, airtempPeakDeltaMax: 12,
    humidityMin: 30, humidityMax: 55, trackTempDeltaMin: 10, trackTempDeltaMax: 20,
  },
  {
    id: "gainesville", name: "Gainesville Raceway (Gainesville, FL)", elevationFt: 50,
    lat: 29.65, lon: -82.32,
    airtempBaseMin: 20, airtempBaseMax: 26, airtempPeakDeltaMin: 6, airtempPeakDeltaMax: 12,
    humidityMin: 60, humidityMax: 85, trackTempDeltaMin: 8, trackTempDeltaMax: 15,
  },
  {
    id: "houston", name: "Houston Raceway Park (Baytown, TX)", elevationFt: 40,
    lat: 29.74, lon: -94.98,
    airtempBaseMin: 21, airtempBaseMax: 27, airtempPeakDeltaMin: 6, airtempPeakDeltaMax: 11,
    humidityMin: 55, humidityMax: 82, trackTempDeltaMin: 8, trackTempDeltaMax: 16,
  },
  {
    id: "charlotte", name: "zMAX Dragway (Concord, NC)", elevationFt: 750,
    lat: 35.36, lon: -80.64,
    airtempBaseMin: 15, airtempBaseMax: 22, airtempPeakDeltaMin: 7, airtempPeakDeltaMax: 13,
    humidityMin: 50, humidityMax: 75, trackTempDeltaMin: 9, trackTempDeltaMax: 18,
  },
  {
    id: "epping", name: "New England Dragway (Epping, NH)", elevationFt: 150,
    lat: 43.03, lon: -71.07,
    airtempBaseMin: 10, airtempBaseMax: 17, airtempPeakDeltaMin: 5, airtempPeakDeltaMax: 11,
    humidityMin: 45, humidityMax: 70, trackTempDeltaMin: 8, trackTempDeltaMax: 16,
  },
  {
    id: "denver", name: "Bandimere Speedway (Morrison, CO)", elevationFt: 5850,
    lat: 39.65, lon: -105.19,
    airtempBaseMin: 13, airtempBaseMax: 21, airtempPeakDeltaMin: 8, airtempPeakDeltaMax: 16,
    humidityMin: 12, humidityMax: 32, trackTempDeltaMin: 12, trackTempDeltaMax: 24,
  },
  {
    id: "lasvegas", name: "The Strip at LVMS (Las Vegas, NV)", elevationFt: 1600,
    lat: 36.17, lon: -115.14,
    airtempBaseMin: 20, airtempBaseMax: 30, airtempPeakDeltaMin: 8, airtempPeakDeltaMax: 16,
    humidityMin: 6, humidityMax: 22, trackTempDeltaMin: 15, trackTempDeltaMax: 28,
  },
  {
    id: "chicago", name: "Route 66 Raceway (Joliet, IL)", elevationFt: 600,
    lat: 41.52, lon: -88.07,
    airtempBaseMin: 12, airtempBaseMax: 19, airtempPeakDeltaMin: 6, airtempPeakDeltaMax: 12,
    humidityMin: 45, humidityMax: 70, trackTempDeltaMin: 9, trackTempDeltaMax: 17,
  },
  {
    id: "indianapolis", name: "Lucas Oil Raceway (Indianapolis, IN)", elevationFt: 800,
    lat: 39.79, lon: -86.13,
    airtempBaseMin: 16, airtempBaseMax: 23, airtempPeakDeltaMin: 7, airtempPeakDeltaMax: 13,
    humidityMin: 55, humidityMax: 78, trackTempDeltaMin: 9, trackTempDeltaMax: 18,
  },
  {
    id: "seattle", name: "Pacific Raceways (Kent, WA)", elevationFt: 500,
    lat: 47.38, lon: -122.24,
    airtempBaseMin: 9, airtempBaseMax: 15, airtempPeakDeltaMin: 4, airtempPeakDeltaMax: 9,
    humidityMin: 55, humidityMax: 80, trackTempDeltaMin: 6, trackTempDeltaMax: 13,
  },
  {
    id: "phoenix", name: "Wild Horse Pass (Chandler, AZ)", elevationFt: 1200,
    lat: 33.30, lon: -111.84,
    airtempBaseMin: 23, airtempBaseMax: 32, airtempPeakDeltaMin: 8, airtempPeakDeltaMax: 15,
    humidityMin: 5, humidityMax: 20, trackTempDeltaMin: 16, trackTempDeltaMax: 30,
  },
];

export function findTrack(id) {
  return TRACKS.find((t) => t.id === id) || TRACKS[0];
}
