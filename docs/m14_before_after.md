# M14 before and after (from the API, `backend/tools/m14_examples.py`)

Raw captures: `docs/m14_before.json` (taken from the code at commit `2032556`, before M14) and `docs/m14_after.json` (after). Same inputs, same in-process backend, no network.

## The decay question

The price headline was **already exactly the plain formula**: `price_impact_pct = supply_loss_pct / 0.15` (`services/calc_engine.py: price_impact_pct`, used by `report.py` as `price` and by `POST /simulate` as `predicted_pct`). Worked example, Suez 20-day detour: supply loss 4.3134% / 0.15 = **+28.7557%**, shown as +28.8%.

What was **not** the plain formula was the path around it: `price_trajectory` held that value for the disruption's duration and then decayed it with a half-life (an assumption, half the duration clamped to 7 to 60 days) over 180 days. That did two harmful things:

1. It drew days 31 to 180, which nothing validated (the Phase 1 90-day error was 18.01 pp).
2. For a disruption shorter than 30 days the chart's own day-30 value disagreed with the headline: a 10-day Suez detour showed a headline of +28.8% and a chart that read **+4.0% at day 30**.

## Before and after

| Example | Item | Before | After |
|---|---|---|---|
| **Suez, 20-day detour, 60-day disruption** | headline (KPI `price_impact_pct`) | +28.7557% | +28.7557% (unchanged) |
| | band | ± 13.09 pp | ± 13.09 pp, drawn at day 30 only |
| | validation badge | none | `VALIDATED 30 DAYS (≤ 8% supply loss)` |
| | price path points / days drawn | 181 points, days 0 to 180 | 31 points, days 0 to 30 |
| | value at day 30 / at the last day drawn | +28.7557% / +1.7972% (day 180) | +28.7557% / +28.7557% (day 30) |
| | half-life field | 30 d | removed |
| **Hormuz blockade, 100% blocked, 30 days** | headline | +103.2591% | +103.2591% (unchanged) |
| | band | not shown (outside the range) | not shown (unchanged) |
| | validation badge | none (warning only) | `OUTSIDE VALIDATED RANGE` |
| | price path points / days drawn | 181, days 0 to 180 | 31, days 0 to 30 |
| | value at day 30 / last day | +103.2591% / +0.1008% (day 180) | +103.2591% / +103.2591% (day 30) |
| | half-life field | 15 d | removed |
| **Suez 20-day detour, 10-day disruption** | headline | +28.7557% | +28.7557% (unchanged) |
| | chart value at day 30 | **+3.9686%** (disagreed with the headline) | **+28.7557%** (same as the 60-day case) |
| | half-life | 7 d | removed |

The Results page, the WTI card and the summaries use the same outside-range rule as before (above 8% supply loss) and the same ± 13.09 pp.

## Follow-up (same day): one marker, no path

The straight line of the table above was itself a path the formula does not give, so it was replaced by a single day-30 marker with its error bar (`trajectory` is now a one-element list: day 30). The barrels series ends with the disruption length entered (Suez 60-day: days 0 to 60; before M14: always 180 days). See DECISIONS D34.

## API fields

- **Removed:** `sections.price.chart.half_life_days`, `sections.price.numbers.half_life_days`; trajectory days 31 to 180.
- **Kept (old names, same meaning):** `kpis.price_impact_pct`, `kpis.price_band_pp`, `kpis.outside_validated_range`, `kpis.validated_note`, `sections.price.numbers.peak_pct` (now equal to the 30-day move), `sections.price.chart.trajectory[]` with `day`, `pct`, `low`, `high`, `beyond_validated` (now ONE point, day 30, carrying `low` and `high`), `validated_price_ceiling_pct`, `validated_reference`. No backward-compatibility snapshot test covers the report endpoint, so nothing was kept only to satisfy a test; the old names stay because the Results page and the e2e scripts read them.
- **Added (additive):** `kpis.price_horizon_days` (30), `kpis.validation_badge`, `sections.price.numbers.horizon_days`, `numbers.move_30d_pct`, `numbers.validation_badge`, `chart.horizon_days`.
- **Unchanged on purpose:** `POST /simulate` returns the same `predicted_price_change_pct` and the same `explanation` text (its snapshot tests pin the wording, and the text states no horizon); the dashboard label now says "over 30 days".
- **Not price estimates:** the barrels-displaced series and `cumulative_bbl` now end with the disruption length entered (D34); the EV horizons of 1, 3 and 5 years are labelled "if the displacement lasted this long (arithmetic, not a forecast)"; the economy section's IMF scaling is labelled "sourced estimate".
