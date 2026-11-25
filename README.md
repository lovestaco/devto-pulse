# devto-pulse

A web dashboard for your [dev.to](https://dev.to) portfolio, built with Node.js and
PostgreSQL. It's a port of my terminal dashboard,
[devto_devdash](https://github.com/lovestaco/devto_devdash). It keeps a
snapshot of every article's views / reactions / comments on each sync, so it can
show growth over time, which the dev.to API alone can't.

## Pieces

| Process | Command | Purpose |
|---|---|---|
| Web | `npm start` | Express dashboard + JSON API, runs migrations on boot |
| Worker | `npm run worker` | Syncs dev.to every `SYNC_INTERVAL_MINUTES` |
| One-off | `npm run sync` / `npm run migrate` | Manual sync / migrations |

Single-service deploy: set `INPROCESS_SYNC=true` on the web process and skip the worker.

## Local

```bash
docker run -d --name devto-pulse-pg -e POSTGRES_USER=pulse -e POSTGRES_PASSWORD=pulse \
  -e POSTGRES_DB=pulse -p 127.0.0.1:55434:5432 postgres:16-alpine
cp .env.example .env      # set DEVTO_API_KEY
npm install
npm run dev:migrate && npm run dev:sync
npm run dev               # http://localhost:3000
```

## Env

`DEVTO_API_KEY`, `DATABASE_URL`, `PGSSL` (true for managed Postgres), `PORT`,
`SYNC_INTERVAL_MINUTES`, `INPROCESS_SYNC`, `DASHBOARD_USER` / `DASHBOARD_PASSWORD`
(optional basic auth; page views are private stats, so set these on a public deploy).

## API

`/healthz`, `/api/summary`, `/api/leaderboard?sort=likes|views|comments`,
`/api/trending?days=7`, `/api/history`, `/api/articles/:id/history`, `/api/runs`,
`POST /api/sync`.
