# Top Fuel Crew Chief Sim

Zie `ARCHITECTURE.md` voor het volledige domeinmodel en de langetermijnvisie
(events, seizoen, financiën). Dit document beschrijft alleen hoe je de
huidige v0 run-simulatie lokaal (of via Claude Code op het web) opnieuw
opstart.

## Structuur

```
/sim-core/   Pure simulatielogica, geen DOM-toegang.
             environment.js, engine.js, clutch.js, tires.js,
             run-simulator.js (integreert de rest tot één runSimulation()).
/ui/         De race-UI (sliders, telemetriegrafiek, resultatenpaneel).
             Importeert sim-core/ als ES-modules; bevat zelf geen fysica.
ARCHITECTURE.md          Domeinmodel / naslagwerk.
run_sim_prototype.html   Origineel zelfstandig prototype (v0.22), blijft
                         staan als referentie voor de kalibratie-geschiedenis.
```

Geen build-stap nodig: `/ui/main.js` gebruikt native ES-module `import`s
rechtstreeks naar `/sim-core/*.js`.

## Lokaal draaien

Browsers blokkeren ES-module `import` vanaf `file://`, dus start een simpele
statische server **vanaf de repo-root** (niet vanaf `/ui/`, anders kan
`main.js` niet bij `../sim-core/*.js`):

```bash
python3 -m http.server 8000
# of: npx serve .
```

Open daarna `http://localhost:8000/ui/index.html`.

## Sim-core gebruiken zonder UI

```js
import { runSimulation } from "./sim-core/run-simulator.js";

const result = runSimulation({
  airtempC: 30, humidity: 40, baroInHg: 29.90, trackTempC: 28, gripSliderPct: 70,
  blowerOD: 48, fuelPct: 90, fuelVolPct: 70, gasketThou: 40, ignition: 40,
  s1time: 0.10, s1pct: 0.90, s2time: 1.00, s2pct: 0.65, s3time: 2.15, s3pct: 0.90,
  fingerWeight: 100, bearingSpeed: 2.0, tirePsi: 7.5, wingAngle: 0.0,
});
// result.et60, result.et330, result.et660, result.et, result.mph, result.trace, ...
```

## Belangrijk

De fysica-constanten (`LAUNCH_CAP`, `POWER_HP`, grip-formules,
detonatie-drempels, etc.) zijn het resultaat van meerdere kalibratierondes
tegen echte NHRA-tijdkaarten en telemetrie — zie `HANDOFF.md` en de
kalibratie-ijkpunten in `ARCHITECTURE.md`/`HANDOFF.md`. Wijzig ze niet zonder
reden; deze refactor was puur structureel (UI vs. simulatielogica scheiden),
geen fysica-wijziging.
