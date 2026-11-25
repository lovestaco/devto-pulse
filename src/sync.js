import { pool } from './db.js';
import { fetchAllArticles } from './devto.js';

// Fetch every article once, upsert metadata, and record one snapshot per
// published article. Everything for a run lands in one transaction so a
// partial failure never leaves a half-written snapshot set.
export async function syncOnce() {
  const apiKey = process.env.DEVTO_API_KEY;
  if (!apiKey) throw new Error('DEVTO_API_KEY is not set');

  const { rows: [run] } = await pool.query(
    `INSERT INTO sync_runs DEFAULT VALUES RETURNING id, started_at`);

  try {
    const published = (await fetchAllArticles(apiKey)).filter((a) => a.published);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const a of published) {
        const tags = Array.isArray(a.tag_list) ? a.tag_list : String(a.tag_list || '').split(',').map((t) => t.trim()).filter(Boolean);
        await client.query(
          `INSERT INTO articles (id, title, url, published_at, tags, updated_at)
           VALUES ($1, $2, $3, $4, $5, now())
           ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, url = EXCLUDED.url,
             published_at = EXCLUDED.published_at, tags = EXCLUDED.tags, updated_at = now()`,
          [a.id, a.title, a.url, a.published_at, tags]);
        await client.query(
          `INSERT INTO article_snapshots (sync_run_id, article_id, views, reactions, comments)
           VALUES ($1, $2, $3, $4, $5)`,
          [run.id, a.id, a.page_views_count ?? 0, a.positive_reactions_count ?? 0, a.comments_count ?? 0]);
      }
      await client.query(
        `UPDATE sync_runs SET status = 'ok', finished_at = now(), articles_count = $2 WHERE id = $1`,
        [run.id, published.length]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    console.log(`[sync] run ${run.id}: ${published.length} published articles`);
    return { runId: run.id, articles: published.length };
  } catch (err) {
    await pool.query(
      `UPDATE sync_runs SET status = 'error', finished_at = now(), error = $2 WHERE id = $1`,
      [run.id, err.message]);
    console.error(`[sync] run ${run.id} failed: ${err.message}`);
    throw err;
  }
}

let timer;
export function startSyncLoop() {
  const minutes = Number(process.env.SYNC_INTERVAL_MINUTES || 180);
  const tick = () => syncOnce().catch(() => {}); // already logged + recorded in sync_runs
  tick();
  timer = setInterval(tick, minutes * 60_000);
  console.log(`[sync] loop every ${minutes} min`);
  return () => clearInterval(timer);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  syncOnce()
    .then(() => pool.end())
    .catch(() => process.exit(1));
}
