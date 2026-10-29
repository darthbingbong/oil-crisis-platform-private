# Browser checks (real Chromium, software WebGL)

These scripts drive the running app in a real browser and save screenshots. They are not part of the unit-test suites.

    cd frontend
    npm i --no-save playwright-core        # driver only; not a project dependency
    # needs Playwright's Chromium installed (npx playwright-core install chromium) and both servers running
    SHOT_DIR=../docs/m3_screenshots node e2e/routes_walkthrough.mjs

| Script | What it checks |
|---|---|
| `routes_walkthrough.mjs` | all routes drawn, hover tooltip (lane and pipeline), click, fly-to, route panel, "Simulate on this route" pre-fill |
| `panels_and_regressions.mjs` | pipeline = nameplate capacity, Druzhba n/a, no-importer message, extrapolation warning, frame rate with and without routes |
| `vessels.mjs` | M7: simulated vessels near Hormuz, click-to-select panel, Suez detour reroute (Alt-click keeps routes clickable), AIS toggle with no key |
| `vessels_ais_mock.mjs` | M7: AIS mode drawn from MOCK websocket frames (Playwright intercepts the socket): badge, panel with real fields, missing fields shown as "not reported" |
| `vessels_fps.mjs` | M7: fps with no routes, routes only (`?vessels=0`, DEV only) and routes + 2,000 vessels |
| `demo_run.mjs` | M9: one end-to-end run that follows `DEMO_SCRIPT.md` step by step (keyboard route open, Suez 20-day detour, KPI numbers, Hormuz warning, vessel reroute and panel, AIS limits) and asserts every number the script promises |
| `m8_walk.mjs` | M8: first-time-user walk at one viewport width (`W=1440 H=900` or `W=820 H=1180`) with objective audits: overflow, clipped text, tiny text, unnamed controls, keyboard focus |
| `honesty.mjs` | M8: SIMULATED, DAILY_CLOSE/OFFLINE_FALLBACK, MODEL BASELINE, 'not validated' and estimate tags show where they should; no stray LIVE or Predicted |
| `results_load.mjs` | M8: Results page load time on a dev server or a production preview |
| `existing_flows.mjs` | the original marker view and `/refineries/at-risk` flow still work |

They use the dev-only `window.__globe` bridge (`project`, `face`, `look`, `stats`) and `window.__vessels`, which is stripped from production builds.
Headless Chromium here renders WebGL on the CPU (SwiftShader), so frame rates are a lower bound for a real GPU.
