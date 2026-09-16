# Top Fuel Crew Chief Sim — Architectuur v0.1

## Visie
Een diepgaande simulatie waarin de speler als crew chief een Top Fuel dragster
voorbereidt en runt. Kern: elke run is de uitkomst van tientallen instelbare
variabelen die realistisch op elkaar inwerken. Uitbreidbaar naar events,
seizoenen en financiën, maar de kern-run-simulatie moet eerst kloppen.

## Ontwerpprincipe: modulaire subsystemen
Elk subsysteem is een losstaand rekenmodule met eigen inputs, interne state en
outputs. Modules communiceren via een gedeelde "RunContext" (omgeving +
voertuigstaat), niet rechtstreeks met elkaar. Dit maakt het mogelijk om
diepte toe te voegen aan één module zonder de rest te breken.

```
RunContext
├── Environment      (weer, baan)
├── Engine           (blower, injectors, ontsteking, verbranding)
├── Clutch           (platen, timer, warmte)
├── Drivetrain       (koppeling → wielen → grip)
├── Chassis          (flex, gewichtsverdeling, vleugel)
├── Tires            (omtrek, temperatuur, slijtage)
├── Driver           (reactie, shift/staging gedrag — later)
└── RunSimulator     (integreert alles over tijd → ET/MPH/trace)
```

## 1. Environment module
**Inputs (door speler of scenario bepaald):**
- Luchttemperatuur, luchtvochtigheid, luchtdruk → **density altitude** (berekend)
- Baan temperatuur (track temp), tijdstip van de dag
- Grip-niveau (functie van VHT-laag, aantal runs sinds re-prep, "water grains"/vocht in de lucht dat grip aantast)
- Wind (hoofd/zij, snelheid)

**Output:** een `EnvironmentState` object dat door Engine, Clutch en Tires
wordt gebruikt (density altitude beïnvloedt bijv. blower-overdrive-tuning;
grip beïnvloedt clutch-lockup-timing).

## 2. Engine module
**Inputs:**
- Blower overdrive % (hoeveel sneller de blower draait dan de krukas)
- Fuel percentage (nitro/methanol mix)
- Injector setup per cilinder (klepgrootte/hoeveelheid per cilinder, individueel afstelbaar — realistisch: crew chiefs stemmen dit per cilinder af op basis van vorige run se bougie/koppen-inspectie)
- Ontstekingstiming (magneto timing curve)
- Klepveer-instellingen (later, lagere prioriteit)

**Interne state (leidt tot post-run inspectie):**
- Cilinderdruk per cilinder (simplified)
- Bougiestaat per cilinder (kleur/erosie als proxy voor mengsel-kwaliteit)
- Lagerslijtage (functie van cumulatieve belasting × RPM × warmte)

**Output:** vermogenscurve (torque vs. RPM vs. tijd), plus inspectiedata voor
na de run.

## 3. Clutch module (de kern van Top Fuel tuning)
**Inputs:**
- Aantal platen (friction + steel), dikte per plaat
- Clutch timer: hoeveel stages, welke druk-toename per stage, timing van elke stage (in ms na launch)
- Vingerdruk / "weight on the fingers" (centrifugaal-gewicht dat de lockup-curve bepaalt)
- Springdruk (lever springs)

**Interne state:**
- Warmte-opbouw in de platen tijdens de run (beïnvloedt volgende run: platen die te heet worden slijten sneller / geven inconsistente lockup)
- Slijtage per run (aantal runs sinds vervanging)

**Interactie:** Clutch lockup-curve × Engine-torque × Grip (Environment) →
bepaalt wheel speed vs. ground speed (wheelspin-risico) via de Drivetrain-module.

## 4. Drivetrain / Traction module
**Inputs:** clutch-lockup-curve, motorvermogen, bandgrip, gewichtsverdeling (chassis)
**Berekent:** wheel slip, 60-foot time, wanneer/of er wheelspin optreedt,
hoe grip zich opbouwt naarmate de auto versnelt (typisch: meer downforce bij
hogere snelheid → minder spin later in de run).

## 5. Chassis module
**Inputs:**
- Motorpositie (voor/achter in de frame — beïnvloedt gewichtsverdeling en wheelie-neiging)
- Rijderpositie (zwaartepunt)
- Chassis flex (stijfheid instelling — beïnvloedt hoe energie van de launch wordt overgebracht)
- Vleugelinstelling (hoek, positie) → downforce vs. drag, front-end lift

**Output:** gewichtsverdeling over tijd, downforce-curve, wheelie-risico-indicator.

## 6. Tires module
**Inputs:** bandomtrek (nieuw vs. gebruikt — groeit de band bij hitte/snelheid?), bandtemperatuur, bandslijtage-historie
**Output:** effectieve rolomtrek tijdens de run (beïnvloedt eindsnelheid-berekening en gearing-effect), grip-coëfficiënt gecombineerd met baan-grip.

## 7. RunSimulator (integratie)
Discrete tijdstap-simulatie (bv. elke 10ms) over ~4000-5000 ft:
1. Bereken motorvermogen op dit tijdstip (Engine + Clutch lockup-fractie)
2. Bereken beschikbare grip (Tires × Environment × Chassis-downforce op dit moment)
3. Bepaal of vermogen > grip → wheelspin, anders → acceleratie
4. Update snelheid, positie, RPM
5. Log alles → wheel speed trace, ET-splits (60ft, 330, 660, 1000, finish)

**Output na run:** ET, MPH, 60-foot, volledige trace-grafiek, plus
"inspectie-data" (bougies, lagers, koppelingsplaten-slijtage/warmte) die de
speler gebruikt om de volgende run bij te stellen.

## Data & telemetrie
Geen toegang tot echte tuning-sheets, maar wel tot publieke telemetrie-vormen
(NHRA broadcast graphics, wheel-speed traces in interviews/docu's). Deze
gebruiken we om de **vorm** van de output te kalibreren (hoe een goede run
eruitziet vs. een tire-shake of blower-explosie), niet om exacte
coëfficiënten over te nemen. Coëfficiënten zijn "artistic license" maar intern
consistent.

## Fasering (voorstel)
1. **v0 — Core run engine**: Environment (simpel) + Engine + Clutch + RunSimulator. Eén run, met grafiek en resultaat.
2. **v1 — Feedbackloop**: post-run inspectie (bougies, lagers, platen) → speler past volgende run aan.
3. **v2 — Diepte**: Chassis, Tires, per-cilinder injector tuning, warmte-modellen over meerdere runs.
4. **v3 — Meta-laag**: events, kwalificatie/eliminatie-rondes, seizoen, financiën/sponsoring, team/crew-management.

## Openstaande ontwerpvragen
- Hoeveel "raw" wil je de UI (rauwe getallen als crew chief) vs. gestileerde dashboards?
- Willen we een enkele speler-tegen-de-klok modus, of ook AI-tegenstanders (andere teams) voor events?
- Random events (mechanisch falen, "blower explosion", track conditions die veranderen tussen runs) — hoeveel RNG vs. puur deterministisch op basis van instellingen?

## Later op te pakken — team-module (v3)
- **Rijder houdt de auto "in de groove"**: hoe goed de rijder de auto op de
  gegroefde lijn van de baan houdt, is een eigen vaardigheid/factor. Rijdt
  de auto uit de groove, dan verliest hij eerder grip en gaat de auto
  sneller "up in smoke" (vergelijkbaar met het bestaande bandenrook-/
  pedal-systeem in driver.js, maar dan getriggerd door baanpositie i.p.v.
  alleen slip%). Hoort bij de rijder-eigenschappen die de team-module gaat
  uitbreiden (naast agressiviteit), nog niet geïmplementeerd.
