"""
Phase 1 (consolidated): builds the crisis-event -> price-move dataset,
compares a formula baseline against a properly-scaled, tuned model that
predicts the formula's CORRECTION rather than the raw price change, and
prints which factors the model leans on most.

This version folds in every fix found through Phase 1 testing:
    1. Annual-resolution events (pre-1986) are excluded from the model
       comparison -- they measure something different (year-average price,
       not a clean 30-day window) and were confirmed to distort results.
    2. Features are STANDARDIZED before training (Ridge penalizes large-
       range features unfairly if left on raw, mismatched scales).
    3. RidgeCV automatically searches for the best regularization strength
       instead of guessing one value.
    4. The model predicts the CORRECTION to the formula (actual - formula),
       not the raw price change -- this is an easier target to learn from
       few examples.

Inputs (place alongside this script):
    - oil_daily_prices.csv   (date, wti, brent)          -- from EIA
    - crude-oil-prices.csv   (Entity, Code, Year, price)  -- from OWID
    - events.csv              (your hand-built crisis table)
"""

import pandas as pd
import numpy as np
from sklearn.linear_model import RidgeCV
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import LeaveOneOut, cross_val_predict
from sklearn.metrics import mean_absolute_error

DAILY_PRICE_PATH = "oil_daily_prices.csv"
ANNUAL_PRICE_PATH = "crude-oil-prices.csv"
EVENTS_PATH = "events.csv"
ELASTICITY = 0.15  # short-run price elasticity of demand assumption
FEATURE_COLS = ["supply_loss_pct", "conflict_intensity", "detour_days", "demand_change_pct"]

# ---------------------------------------------------------------------------
# 1. Load price series
# ---------------------------------------------------------------------------
daily = pd.read_csv(DAILY_PRICE_PATH, parse_dates=["date"]).sort_values("date")

annual = pd.read_csv(ANNUAL_PRICE_PATH)
annual = annual[annual["Entity"] == "World"][["Year", annual.columns[-1]]]
annual.columns = ["year", "price"]

events = pd.read_csv(EVENTS_PATH, parse_dates=["event_date"])


# ---------------------------------------------------------------------------
# 2. Join events to real price data
# ---------------------------------------------------------------------------
def nearest_daily_price(target_date, series="wti"):
    """Nearest available trading day price on/after target_date.
    Skips rows where the price itself is NaN (EIA leaves market-holiday
    rows in the file with a blank price instead of omitting them)."""
    candidates = daily[(daily["date"] >= target_date) & daily[series].notna()]
    return candidates.iloc[0][series] if not candidates.empty else np.nan


def daily_event_prices(event_date):
    before = nearest_daily_price(event_date - pd.Timedelta(days=5))
    after_30 = nearest_daily_price(event_date + pd.Timedelta(days=30))
    after_90 = nearest_daily_price(event_date + pd.Timedelta(days=90))
    return before, after_30, after_90


def annual_event_prices(event_date):
    year = event_date.year
    b = annual[annual["year"] == year - 1]["price"]
    a30 = annual[annual["year"] == year]["price"]
    a90 = annual[annual["year"] == year + 1]["price"]
    return ((b.values[0] if len(b) else np.nan),
             (a30.values[0] if len(a30) else np.nan),
             (a90.values[0] if len(a90) else np.nan))


rows = []
for _, ev in events.iterrows():
    if ev["resolution"] == "daily":
        before, after_30, after_90 = daily_event_prices(ev["event_date"])
    else:
        before, after_30, after_90 = annual_event_prices(ev["event_date"])
    rows.append({**ev.to_dict(), "price_before": before,
                 "price_after_30d": after_30, "price_after_90d": after_90})

df = pd.DataFrame(rows).dropna(subset=["price_before", "price_after_30d"])
df["actual_pct"] = (df.price_after_30d - df.price_before) / df.price_before * 100
df["formula_pct"] = df.supply_loss_pct / ELASTICITY
df["correction"] = df.actual_pct - df.formula_pct

print(f"=== Full events table ({len(df)} events, all resolutions) ===")
print(df[["name", "resolution", "actual_pct", "formula_pct"]].to_string(index=False))

# ---------------------------------------------------------------------------
# 3. Restrict to daily-resolution events for the model comparison
#    (confirmed during Phase 1 testing: mixing in annual-resolution events
#    distorts the comparison, since "30-day change" means something
#    different for them)
# ---------------------------------------------------------------------------
daily_only = df[df["resolution"] == "daily"].copy()
print(f"\nUsing {len(daily_only)} daily-resolution events for model comparison "
      f"(excluded {len(df) - len(daily_only)} annual-resolution events)")

X = daily_only[FEATURE_COLS]
y_correction = daily_only["correction"]

baseline_mae = mean_absolute_error(daily_only["actual_pct"], daily_only["formula_pct"])

# ---------------------------------------------------------------------------
# 4. Scale features, then train + validate with Leave-One-Out
# ---------------------------------------------------------------------------
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)

model = RidgeCV(alphas=[0.01, 0.1, 1.0, 10.0, 100.0, 1000.0])
predicted_correction = cross_val_predict(model, X_scaled, y_correction, cv=LeaveOneOut())
final_prediction = daily_only["formula_pct"].values + predicted_correction
model_mae = mean_absolute_error(daily_only["actual_pct"], final_prediction)

print(f"\nFormula-only baseline MAE:            {baseline_mae:.2f} percentage points")
print(f"Formula + learned correction MAE:     {model_mae:.2f} percentage points")

# ---------------------------------------------------------------------------
# 5. Fit on everything to see which factors the model leans on
#    (not cross-validated -- this is for interpretation, not evaluation)
# ---------------------------------------------------------------------------
model.fit(X_scaled, y_correction)
importance = pd.Series(model.coef_, index=FEATURE_COLS).sort_values(key=abs, ascending=False)
print(f"\nBest alpha chosen: {model.alpha_}")
print("\nWhich factors most explain the formula's mistakes:")
print(importance)

# ---------------------------------------------------------------------------
# 6. Verdict
# ---------------------------------------------------------------------------
print("\n=== Verdict ===")
if model_mae < baseline_mae:
    print("Model beats the formula baseline -- worth proceeding to Phase 2.")
else:
    gap = model_mae - baseline_mae
    print(f"Model does not yet beat the baseline (by {gap:.2f} points).")
    print("At this many events, that can be a genuine tie rather than a failure.")
    print("Next steps: keep adding events, or try predicting 90-day changes,")
    print("which usually behave more smoothly than 30-day changes.")
