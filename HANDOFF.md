# Handoff: Top Fuel Crew Chief Sim → Claude Code / GitHub

## Context voor Claude Code
Dit project is tot nu toe ontwikkeld in een Claude Project (chat), waarbij de
volledige simulatie in één zelfstandig HTML-bestand (`run_sim_prototype.html`,
v0.22) staat. De fysica is uitvoerig getest en herhaaldelijk gekalibreerd
tegen echte NHRA-tijdkaarten en telemetrie (G-force traces, driveshaft/engine
RPM-curves) die de eigenaar heeft aangeleverd. Dit document + het architectuur-
document (`ARCHITECTURE.md`) + het prototype zelf zijn de volledige context.

**Belangrijk voor Claude Code: verander de fysica-constanten NIET zomaar.**
Ze zijn het resultaat van meerdere kalibratierondes tegen echte data. Bij de
refactor gaat het puur om het herstructureren van de code (scheiden van UI en
simulatielogica), niet om het herschrijven van de natuurkunde.

## Wat er nu al werkt (in run_sim_prototype.html)
- **Environment**: density altitude uit luchttemp/vochtigheid/luchtdruk;
  baantemperatuur met een inverted-U grip-curve (sweet spot ~24°C/75°F,
  asymmetrisch — kouder valt sneller terug dan warmer); VHT/baanprep% als
  input, effectieve grip (kN, schaal 2600-3400) als berekende uitkomst.
- **Engine**: blower overdrive (met afnemende meeropbrengst + oplopend
  detonatierisico), nitro%, brandstoftoevoer, koppakking/compressie,
  ontstekingstiming. Nitro% en brandstoftoevoer hebben het grootste
  vermogensbereik; blower en koppakking een kleiner, gelijk bereik.
  Live "geschat piekvermogen" (basis 12.000 pk) als informatief kanaal.
- **Clutch**: vingers (centrifugaal, gewenste lockup) vs. koppelingslager
  (harde bovengrens per stage, beweegt hydraulisch met instelbare snelheid
  naar het actieve setpoint — geen sprong). Stage-percentages hoeven niet
  oplopend te zijn (een dip is realistisch). Na stage 3 volgt altijd volledige
  lockup (100%) — dat moment geeft de piek-G in echte telemetrie, niet de
  launch. Temperatuur-feedback (warmere koppeling = agressiever) en een live
  "haalbare lockup per stage"-indicator (tijd × snelheid vs. setpoint).
- **Motor-integriteit**: continu risico-model (blower/compressie/nitro →
  hitte-risico); aanhoudend te hoog risico leidt tot echte motorschade
  (DNF) binnen een realistische tijdspanne, niet alleen een cosmetische
  waarschuwing.
- **Uitvoer**: 60ft/330ft/660ft/1000ft-tijden, trap-snelheid, wheelspin-
  detectie met progressieve "bandenrook"-straf, wheel-speed vs. ground-speed
  telemetriegrafiek (met lagerpositie én effectieve lockup als aparte lijnen).

## Kalibratie-ijkpunten (niet zomaar wijzigen zonder reden)
- Echte tijdkaart (Rapisarda Racing, gedeeld door eigenaar): RT .088,
  60ft .827, 330ft 2.126, 660ft 3.015, 1000ft 3.763, trap 322.42 mph.
- G-force telemetrie: piek-G (~5.5G) ligt bij volledige koppelings-lockup
  (rond t≈2.1-2.3s), NIET bij de launch. Launch geeft ~4G, met een dip naar
  ~3.3G rond t≈1.0-1.1s voordat de koppeling verder dichtklapt.
- Onze sim haalt met een scherpe maar realistische tune: 60ft ~0.95-1.0s,
  660ft ~3.0s, 1000ft-ET ~3.7-3.9s @ 330-340 mph. 60ft blijft ~0.15s trager
  dan de echte tijdkaart — bekende, nog openstaande afwijking.

## Gewenste mappenstructuur
```
/sim-core/        <- pure functies, GEEN DOM-toegang: engine.js, clutch.js,
                      tires.js, environment.js, run-simulator.js
/ui/              <- de huidige race-UI (sliders, grafiek, resultatenpaneel),
                      importeert en gebruikt sim-core
/season/          <- (nog te bouwen) team, kalender, financiën, AI-tegenstander
/data/            <- opslag (voorlopig localStorage of JSON, later evt. backend)
ARCHITECTURE.md    <- blijft in de root, is het naslagwerk voor het domeinmodel
```

## Eerste taak voor Claude Code
1. Lees `ARCHITECTURE.md` en `run_sim_prototype.html` volledig door.
2. Extraheer de simulatielogica (alles in `runSimulation()` en de helper-
   functies zoals `calcDensityAltitude`, `calcPowerMult`, `calcEngineMult`,
   `bearingCap`/`activeSetpoint`, etc.) naar losse, pure JS-modules onder
   `/sim-core/`. Deze modules mogen GEEN `document.getElementById` of andere
   DOM-aanroepen bevatten — puur input (een settings-object) → output (een
   resultaat-object met trace, splits, etc.).
3. Herbouw `/ui/` zodat het dezelfde sliders/grafiek/resultatenweergave heeft
   als nu, maar de berekening delegeert aan `/sim-core/`.
4. Zorg dat het resultaat lokaal draait (bijv. via een simpele Vite- of
   parcel-setup, of desnoods nog steeds losse HTML/JS zonder build-stap —
   wat het makkelijkst te onderhouden is, mag je zelf voorstellen).
5. Commit in kleine, logische stappen (bijv. eerst `environment.js`, dan
   `engine.js`, dan `clutch.js`, dan de UI-koppeling) zodat er een leesbare
   git-historie ontstaat, niet één megacommit.
6. Voeg een korte `README.md` toe met uitleg hoe je het project lokaal (of
   via Claude Code op het web) opnieuw opstart, en verwijs naar
   `ARCHITECTURE.md` voor het domeinmodel.

Laat de exacte getallen/constanten (LAUNCH_CAP, POWER_HP, grip-formules,
detonatie-drempels, etc.) ongewijzigd tijdens deze refactor — dit is een
structuurwijziging, geen fysica-wijziging.
