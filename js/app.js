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
import { renderWealth } from './screens/wealth.js';
import { openLogPayment } from './ui/log-payment.js';
import { openQuickActions } from './ui/quick-actions.js';
import { makeEditors } from './ui/editors.js';
import { header } from './ui/layout.js';
import { resolveRoute } from './routes.js';
import { effectivePlan, mergeRobinhood } from './wealth.js';

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
  if (resolveRoute(location.hash).key === 'activity') render();
}

// Robinhood balances arrive in wealth/robinhood.json, written by a read-only Claude routine (daily, and on request).
// Refresh commits wealth/refresh-request.json, which starts the routine; we then watch for a newer snapshot.
const RH_FILE = 'wealth/robinhood.json', RH_REQUEST = 'wealth/refresh-request.json';
const robinhood = { status: 'idle', fetchedAt: '', error: '' };
const readJson = async path => { const f = await new GitHubFile({ ...state.config, path }).load(); return f ? JSON.parse(new TextDecoder().decode(f.bytes)) : null; };
async function loadRobinhood() {
  if (!state.config.token || robinhood.status === 'loading') return null;
  const wasRefreshing = robinhood.status === 'refreshing';
  if (!wasRefreshing) robinhood.status = 'loading';
  let snap = null;
  try { snap = await readJson(RH_FILE); } catch {
    if (!wasRefreshing) { robinhood.status = 'error'; if (['wealth', 'accounts'].includes(resolveRoute(location.hash).key)) render(); }
    return null;
  }
  robinhood.fetchedAt = snap?.fetchedAt || '';
  if (!wasRefreshing) robinhood.status = snap ? 'ready' : 'none';
  const m = mergeRobinhood(state.data.accounts, snap);
  if (m.changed) {
    state.data = normalize({ ...state.data, accounts: m.accounts });
    state.sync.commit(state.data, `Robinhood sync: ${money(+snap.totalValue || 0)}`);
  }
  if (m.changed || ['wealth', 'accounts', 'today'].includes(resolveRoute(location.hash).key)) render();
  return snap;
}
async function refreshRobinhood() {
  if (!state.config.token) { toast('Connect GitHub in Settings first.'); return; }
  if (robinhood.status === 'refreshing') return;
  const requestedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  robinhood.status = 'refreshing'; robinhood.error = ''; render();
  try {
    const f = new GitHubFile({ ...state.config, path: RH_REQUEST });
    const cur = await f.load();
    await f.save(new TextEncoder().encode(JSON.stringify({ requestedAt }, null, 2) + '\n'), cur?.sha || null, 'Robinhood refresh requested');
  } catch (e) { robinhood.status = 'error'; robinhood.error = e.message; render(); toast(e.message); return; }
  toast('Asked Claude to refresh Robinhood. This takes a minute or two.');
  for (let i = 0; i < 16; i++) { // about 5 minutes
    await new Promise(r => setTimeout(r, 20000));
    const snap = await loadRobinhood();
    if (snap?.fetchedAt && snap.fetchedAt >= requestedAt) { robinhood.status = 'ready'; render(); toast(`Robinhood updated: ${money(+snap.totalValue || 0)}`); return; }
  }
  robinhood.status = 'ready'; robinhood.error = 'No new Robinhood numbers yet. They’ll appear the next time you open the app.'; render();
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
  const accounts = [...(d.accounts || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(b.name));
  return { loans, payments: d.payments || [], scenarios: d.scenarios || [], plan: migratePlan(d.plan || {}), accounts };
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
  const ep = effectivePlan(state.data, start); // includes spare cash when the plan uses it
  return {
    results: { [st]: simulate(loans, { ...ep, strategy: st }, st, { start }), minimum: simulate(loans, ep, 'minimum', { start }) },
    moves: interestMoves(loans, ep, st, { start }),
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
  reloadData(); location.hash = '#today'; render(); loadRobinhood();
  toast(state.sync.status === STATUS.SAVED ? `Connected to ${cfg.owner}/${cfg.repo}` : syncInfo()[0]);
}

function download(name, bytes, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---------- screens ---------- */
const rhCtx = () => state.config.token ? { ...robinhood, onRefresh: refreshRobinhood } : null;
const SCREENS = {
  today: { render: v => {
    if (!state.data.loans.length) return emptyState(v, 'Today');
    const c = compute();
    if (state.config.token && checkins.status === 'idle') loadCheckins();
    return renderToday(v, {
      data: state.data, start, colorOf, ...c, save, hasHistory: (checkins.snapshots || []).length > 0,
      onApplyMove: m => save({ ...state.data, plan: applyMove(state.data.plan, m.apply, { start }) }, `Applied: ${m.title}`, `${m.title} applied`),
      onLogPayment: logPayment,
    });
  } },
  activity: { render: v => {
    if (state.config.token && (checkins.status === 'idle' || checkins.status === 'error')) loadCheckins();
    return renderHistory(v, { data: state.data, colorOf, onLogPayment: logPayment, onRemovePayment: removePayment, checkins: state.config.token ? checkins : { status: 'off' } });
  } },
  settings: { render: v => renderSettings(v, {
    config: state.config, sync: state.sync, onConnect: connect,
    onClose: () => { location.hash = `#${state.lastTab || 'today'}`; },
    onSyncNow: async () => { await state.sync.retry(); reloadData(); render(); },
    onForget: () => { const c = { ...state.config, token: '' }; state.config = c; saveConfig(c); state.sync.remote = null; state.sync.set(STATUS.LOCAL); render(); toast('Key removed from this device'); },
    onDownloadDb: () => download(`planner-${todayISO()}.sqlite`, exportBytes(state.sync.db), 'application/vnd.sqlite3'),
    onExportJson: () => download(`planner-${todayISO()}.json`, JSON.stringify({ app: 'loan-payoff', exportedAt: new Date().toISOString(), ...state.data }, null, 2), 'application/json'),
  }) },
  plan: { render: v => state.data.loans.length ? renderPlan(v, { data: state.data, start, colorOf, save }) : emptyState(v, 'Plan') },
  wealth: { render: v => renderWealth(v, { data: state.data, start, save, robinhood: rhCtx() }, 'wealth') },
  accounts: { render: v => renderWealth(v, { data: state.data, start, save, robinhood: rhCtx() }, 'accounts') },
  cashflow: { render: v => renderMoney(v, { data: state.data, start, save }) },
  loans: { render: v => { const c = compute(); return renderLoans(v, { data: state.data, result: c.results[c.strategy], start, colorOf, save, onLogPayment: logPayment }); } },
};

function emptyState(v, title) {
  const connected = !!state.config.token;
  v.innerHTML = `${header({ title })}
    <section class="card glass empty rise"><h2>${connected ? 'No loans in your planner yet' : 'Connect your planner'}</h2>
      <p>${connected ? 'Your data repo is connected but has no loans yet.' : 'Your loans, earnings and payments live in your private GitHub repo. Add your access key to load them on this device.'}</p>
      ${connected ? '' : '<a class="btn primary" href="#settings">Connect GitHub</a>'}</section>`;
}

function render() {
  const route = resolveRoute(location.hash);
  if (route.redirected) history.replaceState(null, '', `#${route.key}`);
  if (route.tab) state.lastTab = route.key;
  document.querySelectorAll('.side a.nav, .tabbar a').forEach(a => {
    const tab = a.getAttribute('href').slice(1);
    if (tab === (route.tab || route.key)) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.title = `${route.title} · Loan Payoff`;
  state.screen = SCREENS[route.key].render(view);
  paintSync();
}

/* ---------- boot ---------- */
addEventListener('hashchange', () => { render(); scrollTo(0, 0); });
let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => state.screen?.redraw?.(), 120); });
addEventListener('online', async () => { await state.sync?.retry(); reloadData(); render(); });
document.querySelector('[data-quick]').addEventListener('click', () => {
  const ed = makeEditors({ data: state.data, save, start });
  openQuickActions({
    log: state.data.loans.length ? logPayment : null,
    balance: () => ed.pickAccountToUpdate(),
    income: () => ed.editIncome(null), cost: () => ed.editCost(null), planned: () => ed.editPlanned(null), lump: () => ed.editLump(null),
  });
});
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
loadRobinhood();
