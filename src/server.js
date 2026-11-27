import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pool, query } from './db.js';
import { migrate } from './migrate.js';
import { syncOnce, startSyncLoop } from './sync.js';

const app = express();
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

// Health check stays unauthenticated so the platform can probe it.
app.get('/healthz', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

// Optional basic auth: dev.to page views are private, so don't expose them by accident.
const { DASHBOARD_USER: user, DASHBOARD_PASSWORD: pass } = process.env;
if (user && pass) {
  const expected = Buffer.from(`${user}:${pass}`);
  app.use((req, res, next) => {
    const [scheme, encoded] = (req.headers.authorization || '').split(' ');
    const given = Buffer.from(scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString() : '');
    if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return next();
    res.set('WWW-Authenticate', 'Basic realm="devto-pulse"').status(401).send('Authentication required');
  });
}

app.use(express.static(publicDir));

const LATEST = `
  SELECT s.article_id, a.title, a.url, a.published_at, a.tags, s.views, s.reactions, s.comments
  FROM article_snapshots s JOIN articles a ON a.id = s.article_id
  WHERE s.sync_run_id = (SELECT id FROM sync_runs WHERE status = 'ok' ORDER BY id DESC LIMIT 1)`;

app.get('/api/summary', async (_req, res, next) => {
  try {
    const { rows: [totals] } = await query(`
      SELECT count(*)::int AS articles,
             coalesce(sum(views),0)::int AS views,
             coalesce(sum(reactions),0)::int AS reactions,
             coalesce(sum(comments),0)::int AS comments
      FROM (${LATEST}) l`);
    const { rows: [last] } = await query(
      `SELECT id, status, finished_at, articles_count, error FROM sync_runs ORDER BY id DESC LIMIT 1`);
    const { rows: [counts] } = await query(
      `SELECT count(*) FILTER (WHERE status = 'ok')::int AS ok_runs,
              min(started_at) FILTER (WHERE status = 'ok') AS first_ok
       FROM sync_runs`);
    res.json({ ...totals, lastRun: last || null, okRuns: counts.ok_runs, trackingSince: counts.first_ok });
  } catch (err) { next(err); }
});

const SORTS = { likes: 'reactions', views: 'views', comments: 'comments' };
app.get('/api/leaderboard', async (req, res, next) => {
  try {
    const col = SORTS[req.query.sort] || 'reactions';
    const limit = Math.min(Number(req.query.limit) || 10, 100);
    const { rows } = await query(`SELECT * FROM (${LATEST}) l ORDER BY ${col} DESC, title LIMIT $1`, [limit]);
    res.json(rows);
  } catch (err) { next(err); }
});

// Biggest gains inside the window: latest snapshot minus the earliest one in the window.
app.get('/api/trending', async (req, res, next) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 365);
    const limit = Math.min(Number(req.query.limit) || 10, 100);
    const { rows } = await query(`
      WITH win AS (
        SELECT s.* FROM article_snapshots s JOIN sync_runs r ON r.id = s.sync_run_id
        WHERE r.status = 'ok' AND s.taken_at >= now() - make_interval(days => $1)
      ),
      first AS (SELECT DISTINCT ON (article_id) * FROM win ORDER BY article_id, taken_at ASC),
      last  AS (SELECT DISTINCT ON (article_id) * FROM win ORDER BY article_id, taken_at DESC)
      SELECT a.id AS article_id, a.title, a.url,
             l.views, l.views - f.views AS views_gained,
             l.reactions - f.reactions AS reactions_gained,
             l.comments - f.comments AS comments_gained,
             f.taken_at AS since
      FROM last l JOIN first f USING (article_id) JOIN articles a ON a.id = l.article_id
      ORDER BY views_gained DESC, l.views DESC
      LIMIT $2`, [days, limit]);
    res.json(rows);
  } catch (err) { next(err); }
});

app.get('/api/history', async (_req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT r.id AS run_id, r.finished_at AS taken_at,
             sum(s.views)::int AS views, sum(s.reactions)::int AS reactions, sum(s.comments)::int AS comments
      FROM sync_runs r JOIN article_snapshots s ON s.sync_run_id = r.id
      WHERE r.status = 'ok' GROUP BY r.id ORDER BY r.id`);
    res.json(rows);
  } catch (err) { next(err); }
});

app.get('/api/articles/:id/history', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT taken_at, views, reactions, comments FROM article_snapshots
       WHERE article_id = $1 ORDER BY taken_at`, [req.params.id]);
    res.json(rows);
  } catch (err) { next(err); }
});

app.get('/api/runs', async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, started_at, finished_at, status, articles_count, error
       FROM sync_runs ORDER BY id DESC LIMIT 20`);
    res.json(rows);
  } catch (err) { next(err); }
});

let syncing = false;
app.post('/api/sync', async (_req, res) => {
  if (syncing) return res.status(409).json({ error: 'sync already running' });
  syncing = true;
  try {
    res.json(await syncOnce());
  } catch (err) {
    res.status(502).json({ error: err.message });
  } finally {
    syncing = false;
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'internal error' });
});

// Listen first so the platform's health check sees the process, then reach
// the database. A slow or misconfigured database shows up in the logs and in
// /healthz instead of as a silent "application start failed".
const port = Number(process.env.PORT || 3000);
const server = app.listen(port, '0.0.0.0', () => console.log(`[web] listening on 0.0.0.0:${port}`));
server.on('error', (err) => {
  console.error(`[web] cannot listen on :${port}: ${err.message}`);
  process.exit(1);
});

let stopLoop = () => {};
async function prepareDatabase() {
  for (let attempt = 1; ; attempt++) {
    try {
      console.log(`[db] connecting (attempt ${attempt})`);
      await migrate();
      console.log('[db] ready');
      if (process.env.INPROCESS_SYNC === 'true') stopLoop = startSyncLoop();
      return;
    } catch (err) {
      console.error(`[db] not ready: ${err.message}`);
      await new Promise((r) => setTimeout(r, Math.min(attempt * 5_000, 30_000)));
    }
  }
}
prepareDatabase();

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopLoop();
    server.close(() => pool.end().then(() => process.exit(0)));
  });
}
