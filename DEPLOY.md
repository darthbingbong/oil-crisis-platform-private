# Deploying the public site

Backend: **Render** (web service, `render.yaml`). Frontend: **Cloudflare Pages**. No secret is stored in this repository; keys are typed into each host's dashboard.

## Backend on Render

| Setting | Value |
|---|---|
| Source | this GitHub repository, branch `main` |
| Root directory | `backend` |
| Runtime / Python | Python, `PYTHON_VERSION=3.13.2` |
| Build command | `pip install -r requirements.txt` |
| Start command | `python -m uvicorn main:app --host 0.0.0.0 --port $PORT` |
| Health check path | `/api/v1/ping` |
| Plan | Free (with the keep-warm ping below) or Starter |

Environment variables (names only):

| Name | Value | Notes |
|---|---|---|
| `HOSTED_MODE` | `1` | turns on cache-only serving, rate limits, closed developer endpoints |
| `FRONTEND_ORIGIN` | the Cloudflare Pages address, e.g. `https://<name>.pages.dev` | no trailing slash; the only origin CORS allows |
| `EIA_API_KEY` | your EIA key | enter it in the dashboard only |
| `HOSTED_ENABLE_ANTHROPIC` | `0` | the Claude classifier is off for launch |

`render.yaml` sets `PYTHON_VERSION`, `HOSTED_MODE` and `HOSTED_ENABLE_ANTHROPIC`; the two keys marked `sync: false` (`FRONTEND_ORIGIN`, `EIA_API_KEY`) are asked for when the Blueprint is created.

### What happens at start-up
The disk on the free plan is wiped at every deploy and restart. About 3 seconds after start the server runs one refresh (EIA prices, then each route's GDELT headlines, one route at a time, at least 6 seconds apart), then repeats every `REFRESH_INTERVAL_HOURS` (default 24). Until it finishes, the site says plainly that it is showing the saved fallback data. A test covers this (`test_startup_refresh_refills_an_empty_cache_after_a_fresh_deploy`).

### Keep-warm ping (free plan)
A free Render service sleeps after about 15 minutes without traffic, and the daily refresh only runs while it is awake. `GET /api/v1/ping` returns `{"ok": true}` and calls nothing external. A free job on cron-job.org requests it every 10 minutes, which keeps the service up (and the daily refresh running). Setup:
1. Create a free account at cron-job.org and choose **Create cronjob**.
2. URL: `https://<your-service>.onrender.com/api/v1/ping`. Schedule: every 10 minutes. Request method GET.
3. Save, then check the job's history shows HTTP 200.

The free plan has a monthly limit of instance hours; one always-awake service fits inside it.

Measured cold start without the ping: see the section at the end of this file (filled in after the first deploy).

### Turning the Claude classifier on later
1. In the Render dashboard add `ANTHROPIC_API_KEY` (your key).
2. Change `HOSTED_ENABLE_ANTHROPIC` to `1` (or delete it; it defaults to on).
3. Optional limits: `CLAUDE_DAILY_CALL_CAP` (default 50) and `CLAUDE_MONTHLY_USD_CAP` (default 5); see `.env.example`.
4. Redeploy. Each headline is classified once and cached; over a cap it falls back to the rule-based classifier.

## Frontend on Cloudflare Pages

| Setting | Value |
|---|---|
| Source | this GitHub repository, branch `main` |
| Root directory | `frontend` |
| Framework preset | None (Vite) |
| Build command | `npm ci && npm run build` |
| Build output directory | `dist` |
| Environment variable | `NODE_VERSION` = `22` |
| Environment variable | `VITE_API_ORIGIN` = the Render address, e.g. `https://<name>.onrender.com` (no trailing slash) |

`VITE_API_ORIGIN` is read at build time, so changing it needs a new deploy. Pages serves `index.html` for unknown paths, so the in-app routes (`/results`) work on reload.

## Order of setup
Create both services, note both addresses, then put each address into the other service's variable (`FRONTEND_ORIGIN` on Render, `VITE_API_ORIGIN` on Pages) and redeploy both.
