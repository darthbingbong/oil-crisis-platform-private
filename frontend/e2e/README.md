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
| `existing_flows.mjs` | the original marker view and `/refineries/at-risk` flow still work |

They use the dev-only `window.__globe` bridge (`project`, `face`, `stats`), which is stripped from production builds.
Headless Chromium here renders WebGL on the CPU (SwiftShader), so frame rates are a lower bound for a real GPU.
