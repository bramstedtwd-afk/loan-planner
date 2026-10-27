// App shell: opens planner.sqlite (synced with the private data repo), runs the engine, routes between screens.
import { nowYM, migratePlan, simulate, interestMoves, applyMove, STRATEGIES } from './engine.js';
import { esc, ago, money, todayISO } from './format.js';
import { GitHubFile } from './store/github.js';
import { Sync, STATUS } from './store/sync.js';
import { exportBytes } from './store/db.js';
import { loadLocal } from './store/local.js';
import { renderToday } from './screens/today.js';
import { renderSettings } from './screens/settings.js';
import { renderHistory } from './screens/history.js';
import { renderPlan } from './screens/plan.js';
import { renderMoney } from './screens/money.js';
import { renderLoans } from './screens/loans.js';

const SYNC_PILL = '<a class="sync glass" href="#settings" data-sync><span class="dot"></span><span data-sync-text></span></a>';
import { openLogPayment } from './ui/log-payment.js';

const SQL_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/';
const CONFIG_KEY = 'loanPayoff.github.v1', DB_KEY = 'loanPayoff.db.v1';
const DEFAULT_CONFIG = { owner: 'bramstedtwd-afk', repo: 'loan-data', path: 'planner.sqlite', token: '' };

const view = document.getElementById('view');
const toastEl = document.querySelector('.toast');
const conflictEl = document.querySelector('[data-conflict]');
const start = nowYM();
const state = { data: null, screen: null, config: loadConfig(), sync: null };

// Monthly check-in snapshots live in snapshots.json next to planner.sqlite (written by the check-in workflow, read-only here).
const checkins = { status: 'idle', snapshots: [], issuesUrl: '' };
async function loadCheckins() {
  if (!state.config.token || checkins.status === 'loading' || checkins.status === 'ready') return;
  const { owner, repo } = state.config;
  checkins.status = 'loading'; checkins.issuesUrl = `https://github.com/${owner}/${repo}/issues?q=label%3Acheck-in`;
  try {
    const f = await new GitHubFile({ ...state.config, path: 'snapshots.json' }).load();
    checkins.snapshots = f ? (JSON.parse(new TextDecoder().decode(f.bytes)).snapshots || []) : [];
    checkins.status = 'ready';
  } catch { checkins.status = 'error'; }
  if (location.hash === '#history') render();
}

function loadConfig() { try { return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}') }; } catch { return { ...DEFAULT_CONFIG }; } }
function saveConfig(c) { try { localStorage.setItem(CONFIG_KEY, JSON.stringify(c)); } catch {} }
const cache = {
  get() { try { return JSON.parse(localStorage.getItem(DB_KEY) || 'null'); } catch { return null; } },
  set(v) { try { localStorage.setItem(DB_KEY, JSON.stringify(v)); } catch { toast('This browser is out of storage, so offline changes can’t be kept.'); } },
};

/* ---------- data ---------- */
function normalize(d) {
  const loans = [...(d.loans || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(b.name));
  return { loans, payments: d.payments || [], scenarios: d.scenarios || [], plan: migratePlan(d.plan || {}) };
}
const reloadData = () => { state.data = normalize(state.sync.data()); };

// The one way the app changes data: commit it (to the device now, to GitHub on the next pause) and offer Undo.
function save(next, message, toastMsg = message) {
  const prev = state.data;
  state.data = normalize(next);
  state.sync.commit(state.data, message);
  render();
  toast(toastMsg, () => { state.data = prev; state.sync.commit(prev, `Undid: ${message}`); render(); });
}

function compute() {
  const { loans, plan } = state.data;
  const st = STRATEGIES.some(s => s.id === plan.strategy) ? plan.strategy : 'avalanche';
  return {
    results: { [st]: simulate(loans, { ...plan, strategy: st }, st, { start }), minimum: simulate(loans, plan, 'minimum', { start }) },
    moves: interestMoves(loans, plan, st, { start }),
    strategyName: STRATEGIES.find(s => s.id === st).name, strategy: st,
  };
}
const colorOf = id => { const i = state.data.loans.findIndex(l => l.id === id); return i >= 0 && i < 8 ? `var(--s${i + 1})` : 'var(--s-other)'; };
const plannedThisMonth = () => { const c = compute(); return c.results[c.strategy].rows[0]?.pay || {}; };

/* ---------- sync status ---------- */
function syncInfo() {
  const s = state.sync;
  if (!s) return ['Loading…', 'pending'];
  switch (s.status) {
    case STATUS.SAVED: return [`Saved to GitHub · ${ago(s.savedAt)}`, ''];
    case STATUS.SAVING: return ['Saving…', 'saving'];
    case STATUS.PENDING: return ['Saving soon…', 'pending'];
    case STATUS.OFFLINE: return ['Offline · will save later', 'warn'];
    case STATUS.LOCAL: return ['Only on this device', 'warn'];
    case STATUS.CONFLICT: return ['Changed on another device', 'crit'];
    case STATUS.ERROR: return [s.error?.code === 'auth' ? 'Key not accepted · fix in Settings' : 'Couldn’t save · tap for details', 'crit'];
    default: return ['Loading…', 'pending'];
  }
}
function paintSync() {
  const [text, cls] = syncInfo();
  document.querySelectorAll('[data-sync]').forEach(el => { el.classList.remove('saving', 'pending', 'warn', 'crit'); if (cls) el.classList.add(cls); el.querySelector('[data-sync-text]').textContent = text; });
  conflictEl.hidden = state.sync?.status !== STATUS.CONFLICT;
}
setInterval(paintSync, 30000); // keep "x min ago" fresh

/* ---------- toast ---------- */
let toastTimer;
function toast(msg, undo) {
  toastEl.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button">Undo</button>' : ''}`;
  toastEl.hidden = false;
  if (undo) toastEl.querySelector('button').onclick = () => { toastEl.hidden = true; undo(); };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.hidden = true; }, 6000);
}

/* ---------- actions ---------- */
const logPayment = () => {
  if (!state.data.loans.length) { toast('Add your loans first.'); return; }
  openLogPayment({ data: state.data, planned: plannedThisMonth(), onSave: (next, message, msg) => save(next, message, msg) });
};

function removePayment(p) {
  const next = JSON.parse(JSON.stringify(state.data));
  next.payments = next.payments.filter(x => x.id !== p.id);
  next.loans = next.loans.map(l => l.id !== p.loanId ? l : { ...l, balance: Math.round(((+l.balance || 0) + (+p.principal || 0)) * 100) / 100, unpaid: Math.round(((+l.unpaid || 0) + (+p.interest || 0)) * 100) / 100 });
  save(next, `Removed ${money(p.amount, true)} payment from ${p.date}`, 'Payment removed');
}

async function connect(cfg) {
  const remote = new GitHubFile(cfg);
  await remote.check();
  state.config = cfg; saveConfig(cfg); checkins.status = 'idle';
  state.sync.remote = remote;
  await state.sync.start();
  reloadData(); location.hash = '#today'; render();
  toast(state.sync.status === STATUS.SAVED ? `Connected to ${cfg.owner}/${cfg.repo}` : syncInfo()[0]);
}

function download(name, bytes, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---------- screens ---------- */
const SCREENS = {
  today: { title: 'Today', render: v => {
    if (!state.data.loans.length) return emptyState(v);
    const c = compute();
    return renderToday(v, {
      data: state.data, start, colorOf, ...c, syncLabel: syncInfo()[0],
      onApplyMove: m => save({ ...state.data, plan: applyMove(state.data.plan, m.apply, { start }) }, `Applied: ${m.title}`, `${m.title} applied`),
      onLogPayment: logPayment,
    });
  } },
  history: { title: 'History', render: v => {
    if (state.config.token && (checkins.status === 'idle' || checkins.status === 'error')) loadCheckins();
    return renderHistory(v, { data: state.data, colorOf, onLogPayment: logPayment, onRemovePayment: removePayment, checkins: state.config.token ? checkins : { status: 'off' } });
  } },
  settings: { title: 'Settings', render: v => renderSettings(v, {
    config: state.config, sync: state.sync, onConnect: connect,
    onSyncNow: async () => { await state.sync.retry(); reloadData(); render(); },
    onForget: () => { const c = { ...state.config, token: '' }; state.config = c; saveConfig(c); state.sync.remote = null; state.sync.set(STATUS.LOCAL); render(); toast('Key removed from this device'); },
    onDownloadDb: () => download(`planner-${todayISO()}.sqlite`, exportBytes(state.sync.db), 'application/vnd.sqlite3'),
    onExportJson: () => download(`planner-${todayISO()}.json`, JSON.stringify({ app: 'loan-payoff', exportedAt: new Date().toISOString(), ...state.data }, null, 2), 'application/json'),
  }) },
  plan: { title: 'Plan', render: v => state.data.loans.length ? renderPlan(v, { data: state.data, start, colorOf, save, syncPill: SYNC_PILL }) : emptyState(v) },
  money: { title: 'Money', render: v => renderMoney(v, { data: state.data, start, save, syncPill: SYNC_PILL }) },
  loans: { title: 'Loans', render: v => { const c = compute(); return renderLoans(v, { data: state.data, result: c.results[c.strategy], start, colorOf, save, syncPill: SYNC_PILL }); } },
};

function emptyState(v) {
  const connected = !!state.config.token;
  v.innerHTML = `<header class="topbar"><div><h1>Today</h1></div><a class="sync glass" href="#settings" data-sync><span class="dot"></span><span data-sync-text></span></a></header>
    <section class="card glass empty rise"><h2>${connected ? 'No loans in your planner yet' : 'Connect your planner'}</h2>
      <p>${connected ? 'Your data repo is connected but has no loans yet.' : 'Your loans, earnings and payments live in your private GitHub repo. Add your access key to load them on this device.'}</p>
      ${connected ? '' : '<a class="btn primary" href="#settings">Connect GitHub</a>'}</section>`;
}

function render() {
  const hash = location.hash.slice(1);
  const key = hash in SCREENS ? hash : 'today';
  const scr = SCREENS[key];
  document.querySelectorAll('.side a.nav, .tabbar a').forEach(a => {
    if (a.getAttribute('href') === `#${key}`) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.title = `${scr.title} · Loan Payoff`;
  state.screen = scr.render(view);
  paintSync();
}

/* ---------- boot ---------- */
addEventListener('hashchange', () => { render(); scrollTo(0, 0); });
let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => state.screen?.redraw?.(), 120); });
addEventListener('online', async () => { await state.sync?.retry(); reloadData(); render(); });
document.querySelector('[data-quick]').addEventListener('click', logPayment);
conflictEl.addEventListener('click', async e => {
  const b = e.target.closest('[data-resolve]'); if (!b) return;
  await state.sync.resolve(b.dataset.resolve); reloadData(); render();
  toast(b.dataset.resolve === 'theirs' ? 'Loaded the latest version from GitHub' : 'Saved this device’s version to GitHub');
});

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

view.innerHTML = '<section class="card glass empty"><h2>Opening your planner…</h2></section>';
const SQL = await initSqlJs({ locateFile: f => SQL_CDN + f });
const remote = state.config.token ? new GitHubFile(state.config) : null;
state.sync = new Sync({ SQL, remote, cache, onChange: () => paintSync() });
await state.sync.start();
state.data = normalize(state.sync.data());

// Development only: with nothing saved and no repo connected, start from a git-ignored local-data.json if one exists.
if (!state.data.loans.length && !remote && ['localhost', '127.0.0.1'].includes(location.hostname)) {
  const { data } = await loadLocal();
  if (data?.loans?.length) { state.data = normalize(data); state.sync.commit(state.data, 'Imported from local file'); }
}
render();
