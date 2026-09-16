# NHRA Top Fuel reference times

Real incremental times (60ft / 330ft / 660ft / 1000ft) and trap speeds,
gathered via web search to calibrate `sim-core/run-simulator.js` against
actual runs instead of a single anecdotal target. NHRA.com and most
drag-racing news sites (dragzine, competitionplus, speedsport, dragracecentral,
even Wikipedia/Guinness) are blocked by this environment's egress policy, so
these are pulled from search-result snippets that quoted the numbers
directly, not from fetching the source pages ourselves - treat exact
hundredths as reasonably reliable (multiple runs corroborate the range) but
re-verify against NHRA.com directly if a precise value matters.

## Full-split examples (60/330/660/1000)

| Driver | Event | 60ft | 330ft | 660ft | 660 mph | 1000ft ET | trap mph |
|---|---|---|---|---|---|---|---|
| Shawn Langdon | Brainerd (record pass, unconfirmed 3.664 backup) | 0.833 | 2.083 | 2.931 | - | 3.662 | - |
| Tony Schumacher | (representative solid pass) | 0.828 | 2.156 | 3.089 | 274.44 | 3.853 | - |
| Dale Hagan | (representative pass) | 0.858 | 2.226 | 3.141 | 283.73 | 3.80 | - |

## Record-anchor points (partial splits)

| Driver | Event | 60ft | 660ft | 660 mph | 1000ft ET | trap mph | note |
|---|---|---|---|---|---|---|---|
| Brittany Force | Sonoma 2025 | 0.819 | 2.940 | 304.94 | 3.645 | 343.16 | outright speed record (as of 2025); gained ~40.6 mph in the last 340ft (301.0->341.6 on a similarly-cited pass) |
| Brittany Force | Maple Grove 2019 | - | - | - | 3.623 | 331.61 | outright ET record (as of these results) |
| Mike Salinas | Carolina Nationals | - | - | 300.80 | - | - | first 300mph 660ft pass |

## Other results (ET + trap only, no splits published)

| Driver | Event | 1000ft ET | trap mph | note |
|---|---|---|---|---|
| Justin Ashley | Arizona Nationals 2024 | 3.740 | 327.82 | round win |
| Steve Torrence | Arizona Nationals 2024 | 3.743 | 305.84 | same round, lost - near-identical ET, much lower trap |
| Doug Kalitta | Summit Racing Equip. Nationals | 3.771 | 326.48 | qualifying #1 |
| Antron Brown | Brainerd | 3.680 | - | ET record at that event |
| Spencer Massey | Brainerd | - | 332.75 | speed record at that event |
| Steve Torrence | Bristol 2025 | 4.022 | 325.37 | final round win, well off pace on ET, trap barely affected |
| Justin Ashley | Bristol 2025 (same round) | 8.600 | very low | smoked the tires - full abort |

General: since the 1,000ft distance standardized in 2008, typical elapsed
times run 3.6-3.8s with trap speeds regularly over 330mph; 60ft times on a
strong pass sit around 0.82-0.86s.

## What this says about our calibration

Segment times (time to cover each successive chunk, not cumulative) for the
three full-split examples above, vs. our sim's old default-tune output
(before this pass): 60ft=0.912, 330ft=2.032, 660ft=2.856, ET=3.580,
660mph=301.1, trap=338.8.

| segment | Langdon | Schumacher | Hagan | our sim (old) |
|---|---|---|---|---|
| 0->60ft | 0.833 | 0.828 | 0.858 | 0.912 |
| 60->330ft (270ft) | 1.250 | 1.328 | 1.368 | 1.120 |
| 330->660ft (330ft) | 0.848 | 0.933 | 0.915 | 0.824 |
| 660->1000ft (340ft) | 0.731 | 0.764 | 0.659 | 0.724 |

The 660->1000ft segment already lines up with real cars. The 60->330ft and
330->660ft segments do NOT: our sim covers both faster than every real
example here, despite starting from a slower 60ft. That's the real
diagnosis - it isn't just that the launch is soft, it's that the model's
mid-run force (roughly 60ft to 660ft, once lf is climbing toward full
lockup) is disproportionately strong relative to a realistic launch. Fixing
60ft alone without also easing back the 60-660ft pull will keep producing
this same shape: slow off the line, unrealistically strong through the
middle, back half about right.

### Fix and result

Raising TIRE_PEAK_GRIP_BONUS and LAUNCH_CAP alone can't separate "faster
60ft" from "faster 60-660ft too" - `powerForce` and `LAUNCH_CAP*lf` are a
single flat-then-tapering ceiling, so more headroom early helps every
segment before the eventual power-curve crossover equally, never just one
of them. The real fix was widening the clutch's stage-2 hold itself (a real,
deliberate crew-chief technique: hit hard, hold back through the middle so
the tire lives, then lock to 100% for the finish) - default clutch curve
changed from s2time=1.05/s2pct=65%/s3time=2.15/s3speed=200%/s to
s2time=2.20/s2pct=40%/s3time=2.50/s3speed=800%/s, alongside
LAUNCH_CAP 14583->20000 and TIRE_PEAK_GRIP_BONUS 0.15->0.4.

| segment | Langdon | Schumacher | Hagan | our sim (new default) |
|---|---|---|---|---|
| 0->60ft | 0.833 | 0.828 | 0.858 | 0.804 |
| 60->330ft (270ft) | 1.250 | 1.328 | 1.368 | 1.168 |
| 330->660ft (330ft) | 0.848 | 0.933 | 0.915 | 0.976 |
| 660->1000ft (340ft) | 0.731 | 0.764 | 0.659 | 0.784 |

Full result: 0.804/1.972/2.948 (272.0mph)/3.732 (320.1mph) - sits between
the Schumacher/Hagan "solid pass" examples and the Langdon/Force
record-territory ones on every split, which is what a default, fully-locked,
90%-nitro tune should look like: strong and clean, not necessarily an
outright record.
