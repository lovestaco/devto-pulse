// Port of devto-stats/main.go's fetch logic: paginate /api/articles/me and
// retry 429s with linear backoff + jitter (dev.to rate-limits bursts).
const MAX_ATTEMPTS = 8;
const PER_PAGE = 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(apiKey, page) {
  const url = `https://dev.to/api/articles/me?per_page=${PER_PAGE}&page=${page}`;
  let lastErr;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) await sleep((attempt - 1) * 700 + Math.random() * 500);

    let res;
    try {
      res = await fetch(url, {
        headers: { 'api-key': apiKey, Accept: 'application/vnd.forem.api-v1+json' },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      lastErr = new Error(`calling dev.to API: ${err.message}`);
      continue;
    }

    if (res.status === 429) {
      lastErr = new Error(`dev.to API returned 429: ${(await res.text()).trim()}`);
      continue;
    }
    if (!res.ok) {
      throw new Error(`dev.to API returned ${res.status}: ${(await res.text()).trim()}`);
    }
    return res.json();
  }
  throw new Error(`giving up after ${MAX_ATTEMPTS} attempts: ${lastErr?.message}`);
}

export async function fetchAllArticles(apiKey) {
  const all = [];
  for (let page = 1; ; page++) {
    const batch = await fetchPage(apiKey, page);
    all.push(...batch);
    if (batch.length < PER_PAGE) break;
  }
  return all;
}
