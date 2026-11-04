# 30-day outlook: what is validated and what is not

Written for M14 on 2026-11-04. The numbers below come from running `backend/phase1_analysis.py` **unmodified** from `backend/data/` (`cd backend\data ; ..\venv\Scripts\python.exe ..\phase1_analysis.py`) on that day, and from `backend/data/events.csv`.

## What the test measured

For each event the script takes the oil price **5 days before** the event date and **30 days after** it (`phase1_analysis.py` lines 62 to 63) and calls the percentage difference the event's "actual" 30-day move. The formula's prediction for the event is `supply_loss_pct / 0.15`. The error is `|formula - actual|` in percentage points.

| | Value |
|---|---|
| Events in the table | 24 (1973 to 2026) |
| Events used for the comparison | **21** daily-resolution events (3 annual-average events before 1986 excluded: not a clean 30-day window) |
| **Formula alone, mean absolute error (leave-one-out)** | **13.09 percentage points** |
| Formula plus a learned correction (ridge, alpha 1000) | 13.80 percentage points |
| Verdict printed by the script | "Model does not yet beat the baseline (by 0.71 points). At this many events, that can be a genuine tie rather than a failure." |
| Largest supply loss among the 21 events | **8%** (2026 US-Israel War on Iran: formula +53.3%, actual +57.8%; the 8% is itself a rough estimate, the event is still unfolding) |

## What this validates, in plain words

- **Validated:** the formula `price move over 30 days = supply loss / 0.15` is, on average, 13.09 percentage points away from what happened at 30 days, on 21 events whose supply loss was at most 8%. A fitted model did not do better.
- **Therefore the app shows exactly one price horizon: 30 days.** The headline number is `supply_loss_pct / 0.15`, with nothing added (no decay, no duration effect). Up to 8% supply loss it carries "± 13.09 pp" and the badge `VALIDATED 30 DAYS (≤ 8% supply loss)`. Above 8% it shows the same formula value with the badge `OUTSIDE VALIDATED RANGE`, no band, and the warning.
- **Not validated, so not shown:** any 1-week, 90-day, 180-day or 1-year price. The script also computed a 90-day price for each event, and the earlier Phase 1 summary recorded the 90-day formula error as **18.01 pp** (model 18.15), which is worse. Nothing about the days between day 0 and day 30 was measured either: the line drawn on the Results page is an **illustrative straight line** from 0 to the 30-day value.
- **Not validated:** how long a disruption lasts does not enter the formula. The old Results page drew the price held at its peak and then decaying with a half-life; that shape was an assumption that no test measured, and it has been removed (DECISIONS D33).
- **Small sample:** 21 events, 4 candidate features, several `supply_loss_pct` values are informed estimates, and the top of the range rests on one soft event.
