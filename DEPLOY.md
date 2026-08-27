# Deploying TravelBrain AI

Frontend on Vercel, backend on Render.

## Why the backend cannot go on Vercel

Three things rule out a serverless runtime for the API:

1. **The MCP servers are stdio child processes.** `src/mcp_servers/config.py`
   launches `uvx --with "mcp<2" aviationstack-mcp` and
   `python weather_server.py` and talks to them over stdin/stdout. Vercel's
   runtime has a read-only filesystem outside `/tmp`, no `uv` binary, and
   tears the process down between invocations.
2. **A trip takes 30-60 seconds.** Five Groq calls plus four MCP round trips.
   Vercel caps Hobby functions at 60s.
3. **State is process-local.** The session credential store, the four
   `lru_cache`d singletons (LLM, checkpointer, compiled graph, MCP client) and
   the long-lived psycopg connection all assume one process that stays up.

Render runs a real container, so all three are fine.

## Architecture

```
  browser
     |
     v
  Vercel  (static frontend from dist/)
     |  /api/*  and  /health  are rewritten, server-side, to:
     v
  Render  travelbrain-api   (Docker: FastAPI + MCP subprocesses)
             |         |
             v         v
        Key Value    Postgres
        (cache)      (checkpoints)
```

The rewrite matters: the browser only ever sees the Vercel origin, so the
session cookie stays first-party and no CORS is involved. Vercel allows up to
120 seconds for a proxied response, which covers the 30-60s agent run.

## 1. Backend on Render

The repo has a `render.yaml` Blueprint.

1. Render dashboard -> **New** -> **Blueprint** -> select this repo.
2. It creates `travelbrain-api` (web, Docker) and `travelbrain-cache`
   (Key Value). `REDIS_URL` is wired automatically.
3. Fill in the variables marked `sync: false`:

   | Variable | Where from |
   |---|---|
   | `GROQ_API_KEY` | console.groq.com/keys |
   | `TAVILY_API_KEY` | app.tavily.com |
   | `AVIATIONSTACK_API_KEY` | aviationstack.com |
   | `OPENWEATHER_API_KEY` | openweathermap.org/api |
   | `DATABASE_URL` | your existing Render Postgres — use the **Internal** URL |

   Use the Internal Database URL when Postgres is in the same Render region:
   it avoids egress and is faster. To let the Blueprint create a database
   instead, uncomment the `fromDatabase` block and the `databases:` section
   in `render.yaml`.

4. Wait for the health check on `/health` to pass, then note the service URL,
   e.g. `https://travelbrain-api.onrender.com`.

Verify the MCP servers came up in the deployed container:

```
python -m src.mcp_servers.diagnostics
```

via Render's shell. All three should report OK.

### Plan choice

`render.yaml` asks for `starter`. On the free plan the service sleeps after
15 minutes idle and cold-starts in roughly 50 seconds; add a 30-60s agent run
and the first request after idle can exceed Vercel's 120s proxy timeout.

## 2. Frontend on Vercel

1. **Edit `vercel.json` first.** Both rewrite destinations point at
   `https://travelbrain-api.onrender.com` — replace that with your actual
   Render URL. Vercel does not expand environment variables inside
   `vercel.json`, so this has to be literal.
2. Import the repo in Vercel. It picks up `vercel.json`:
   - `buildCommand` runs `scripts/build-frontend.sh`, which copies only
     `frontend/` into `dist/`
   - `outputDirectory` is `dist/`
   - `/api/*` and `/health` proxy to Render
3. Deploy.

No environment variables are needed on Vercel. The API keys live on Render;
the frontend never sees them.

## Calling the Render API directly instead

If you skip the rewrite and point a frontend straight at the Render origin,
set `CORS_ORIGINS` on the backend:

```
CORS_ORIGINS=https://your-app.vercel.app
```

That enables `CORSMiddleware` with credentials, and switches the session
cookie to `SameSite=None; Secure` (a cross-site cookie requires both). Leave
it unset for the rewrite setup — it is not needed and only loosens things.

## Runtime credentials

Keys can also be entered per browser session in the app's Settings panel. They
are held in the API process's memory, keyed by an httpOnly cookie, and never
written to disk. They do not survive a restart or reach a second instance, so
for a real deployment set the keys as Render environment variables and treat
the Settings panel as a convenience.

## Local development

Unchanged:

```
docker compose up -d --build          # app + redis
APP_PORT=8001 docker compose up -d    # if 8000 is taken
```
