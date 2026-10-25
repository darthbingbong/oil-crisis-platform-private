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
| `existing_flows.mjs` | the original marker view and `/refineries/at-risk` flow still work |

They use the dev-only `window.__globe` bridge (`project`, `face`, `look`, `stats`) and `window.__vessels`, which is stripped from production builds.
Headless Chromium here renders WebGL on the CPU (SwiftShader), so frame rates are a lower bound for a real GPU.
