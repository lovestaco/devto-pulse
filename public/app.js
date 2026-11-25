const $ = (sel) => document.querySelector(sel);
const fmt = new Intl.NumberFormat();
const when = (ts) => (ts ? new Date(ts).toLocaleString() : '—');

async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
  return body;
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

function renderTable(table, headers, rows, emptyText) {
  table.replaceChildren();
  if (!rows.length) {
    table.append(el('tr', {}, el('td', { className: 'empty', colSpan: headers.length }, emptyText)));
    return;
  }
  table.append(el('tr', {}, ...headers.map(([label, cls]) => el('th', { className: cls || '' }, label))));
  for (const cells of rows) table.append(el('tr', {}, ...cells));
}

function titleCell(row) {
  const btn = el('button', { className: 'link-btn', type: 'button', title: 'Show history' }, 'history');
  btn.addEventListener('click', () => showArticle(row.article_id, row.title));
  return el('td', {}, el('a', { href: row.url, target: '_blank', rel: 'noopener' }, row.title), ' ', btn);
}

const charts = {};
function lineChart(id, labels, data, label) {
  charts[id]?.destroy();
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--accent').trim();
  const grid = css.getPropertyValue('--border').trim();
  const text = css.getPropertyValue('--muted').trim();
  charts[id] = new Chart(document.getElementById(id), {
    type: 'line',
    data: { labels, datasets: [{ label, data, borderColor: accent, backgroundColor: accent + '22',
                                 fill: true, tension: .25, pointRadius: data.length > 40 ? 0 : 3 }] },
    options: {
      maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { color: text, maxTicksLimit: 8 }, grid: { color: grid } },
                y: { ticks: { color: text }, grid: { color: grid } } },
    },
  });
}

let history = [];
function drawHistory() {
  const metric = $('#metric').value;
  lineChart('history-chart', history.map((h) => new Date(h.taken_at).toLocaleString()),
            history.map((h) => h[metric]), metric);
  $('#history-hint').textContent = history.length < 2
    ? 'Only one snapshot so far. The chart fills in as the worker keeps syncing.'
    : `${history.length} snapshots`;
}

async function loadSummary() {
  const s = await api('/api/summary');
  const cards = [
    ['Published articles', s.articles], ['Total views', s.views],
    ['Reactions', s.reactions], ['Comments', s.comments], ['Snapshots', s.okRuns],
  ];
  $('#cards').replaceChildren(...cards.map(([label, v]) =>
    el('div', { className: 'card' }, el('div', { className: 'label' }, label),
       el('div', { className: 'value' }, fmt.format(v ?? 0)))));
  const last = s.lastRun;
  $('#status').textContent = last
    ? `Last sync ${when(last.finished_at)} (${last.status})${s.trackingSince ? ` · tracking since ${when(s.trackingSince)}` : ''}`
    : 'No syncs yet. Click "Sync now".';
}

async function loadBoards() {
  for (const [sort, key, label] of [['likes', 'reactions', 'Likes'], ['views', 'views', 'Views'], ['comments', 'comments', 'Comments']]) {
    const rows = await api(`/api/leaderboard?sort=${sort}`);
    renderTable($(`#board-${sort}`), [['#', 'rank'], ['Article'], [label, 'num']],
      rows.map((r, i) => [el('td', { className: 'rank' }, i + 1), titleCell(r), el('td', { className: 'num' }, fmt.format(r[key]))]),
      'No data yet');
  }
}

async function loadTrending() {
  const rows = await api(`/api/trending?days=${$('#days').value}`);
  const span = (n) => el('span', { className: n > 0 ? 'up' : '' }, n > 0 ? `+${fmt.format(n)}` : fmt.format(n));
  renderTable($('#trending'), [['#', 'rank'], ['Article'], ['Views gained', 'num'], ['Reactions', 'num'], ['Comments', 'num'], ['Total views', 'num']],
    rows.map((r, i) => [el('td', { className: 'rank' }, i + 1), titleCell(r),
      el('td', { className: 'num' }, span(r.views_gained)), el('td', { className: 'num' }, span(r.reactions_gained)),
      el('td', { className: 'num' }, span(r.comments_gained)), el('td', { className: 'num' }, fmt.format(r.views))]),
    'Needs at least two snapshots in this window');
}

async function loadRuns() {
  const rows = await api('/api/runs');
  renderTable($('#runs'), [['Run'], ['Started'], ['Status'], ['Articles', 'num'], ['Error']],
    rows.map((r) => [el('td', {}, `#${r.id}`), el('td', {}, when(r.started_at)),
      el('td', { className: r.status }, r.status), el('td', { className: 'num' }, r.articles_count ?? '—'),
      el('td', { className: 'muted' }, r.error || '')]),
    'No runs yet');
}

async function showArticle(id, title) {
  const rows = await api(`/api/articles/${id}/history`);
  $('#article-panel').hidden = false;
  $('#article-title').textContent = title;
  lineChart('article-chart', rows.map((r) => new Date(r.taken_at).toLocaleString()), rows.map((r) => r.views), 'views');
  $('#article-panel').scrollIntoView({ behavior: 'smooth' });
}

async function loadAll() {
  try {
    history = await api('/api/history');
    await Promise.all([loadSummary(), loadBoards(), loadTrending(), loadRuns()]);
    drawHistory();
  } catch (err) {
    $('#status').textContent = `Error: ${err.message}`;
  }
}

$('#metric').addEventListener('change', drawHistory);
$('#days').addEventListener('change', () => loadTrending().catch(console.error));
$('#article-close').addEventListener('click', () => { $('#article-panel').hidden = true; });
$('#sync-btn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true; btn.textContent = 'Syncing…';
  try { await api('/api/sync', { method: 'POST' }); await loadAll(); }
  catch (err) { $('#status').textContent = `Sync failed: ${err.message}`; }
  finally { btn.disabled = false; btn.textContent = 'Sync now'; }
});

loadAll();
