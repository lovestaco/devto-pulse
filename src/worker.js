// Long-running background worker: migrate, then sync on an interval.
// Deploy this as a separate Seenode worker service (start command: npm run worker).
import { migrate } from './migrate.js';
import { startSyncLoop } from './sync.js';
import { pool } from './db.js';

await migrate();
const stop = startSyncLoop();

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    stop();
    await pool.end();
    process.exit(0);
  });
}
