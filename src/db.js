import pg from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const useSsl = process.env.PGSSL === 'true';

// Managed Postgres (e.g. Seenode) often signs its certificate with a per-project
// CA. Recent `pg` versions treat `sslmode=require` in the URI as full
// verification, and URI SSL params override the `ssl` option below, so strip
// them and let PGSSL decide.
function connectionString() {
  if (!useSsl) return process.env.DATABASE_URL;
  const url = new URL(process.env.DATABASE_URL);
  for (const p of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat']) {
    url.searchParams.delete(p);
  }
  return url.toString();
}

export const pool = new pg.Pool({
  connectionString: connectionString(),
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.PG_POOL_MAX || 5),
  connectionTimeoutMillis: 10_000,
});

console.log(`[db] host=${new URL(process.env.DATABASE_URL).hostname} ssl=${useSsl}`);

export const query = (text, params) => pool.query(text, params);
