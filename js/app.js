// App shell: loads data, runs the engine, routes between screens.
import { nowYM, migratePlan, simulate, interestMoves, applyMove, STRATEGIES } from './engine.js';
import { esc } from './format.js';
import { loadLocal, saveLocal } from './store/local.js';
import { renderToday } from './screens/today.js';

const view = document.getElementById('view');
const toastEl = document.querySelector('.toast');
const start = nowYM();
const state = { data: null, source: 'none', screen: null };

const SYNC = {
  dev: ['Local test data', 'local'],
  browser: ['Saved in this browser', 'local'],
  none: ['No data yet', 'local'],
};

function normalize(d) {
  const loans = [...(d.loans || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(b.name));
  return { loans, payments: d.payments || [], scenarios: d.scenarios || [], plan: migratePlan(d.plan || {}) };
}

function compute() {
  const { loans, plan } = state.data;
  const st = STRATEGIES.some(s => s.id === plan.strategy) ? plan.strategy : 'avalanche';
  plan.strategy = st;
  return {
    results: { [st]: simulate(loans, plan, st, { start }), minimum: simulate(loans, plan, 'minimum', { start }) },
    moves: interestMoves(loans, plan, st, { start }),
    strategyName: STRATEGIES.find(s => s.id === st).name,
  };
}

const colorOf = id => { const i = state.data.loans.findIndex(l => l.id === id); return i >= 0 && i < 8 ? `var(--s${i + 1})` : 'var(--s-other)'; };

let toastTimer;
function toast(msg, undo) {
  toastEl.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button">Undo</button>' : ''}`;
  toastEl.hidden = false;
  if (undo) toastEl.querySelector('button').onclick = () => { undo(); toastEl.hidden = true; };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.hidden = true; }, 5000);
}

function setPlan(plan) { state.data.plan = plan; saveLocal(state.data); state.source = 'browser'; render(); }

const SCREENS = {
  today: { title: 'Today', render: v => {
    if (!state.data?.loans.length) return emptyState(v);
    return renderToday(v, {
      data: state.data, start, colorOf, ...compute(),
      syncLabel: SYNC[state.source][0], syncClass: SYNC[state.source][1],
      onApplyMove: m => { const prev = state.data.plan; setPlan(applyMove(prev, m.apply, { start })); toast(`${m.title} applied`, () => setPlan(prev)); },
      onLogPayment: () => toast('Payment logging arrives with GitHub sync, the next step.'),
    });
  } },
  plan: { title: 'Plan' }, money: { title: 'Money' }, loans: { title: 'Loans' }, history: { title: 'History' },
};

function emptyState(v) {
  v.innerHTML = `<header class="topbar"><div><h1>Today</h1></div></header>
    <section class="card glass empty"><h2>Your plan starts here</h2><p>Once your private data repo is connected, your loans, earnings and payments load here.</p></section>`;
}

function placeholder(v, title) {
  v.innerHTML = `<header class="topbar"><div><h1>${esc(title)}</h1></div></header>
    <section class="card glass empty"><h2>${esc(title)} is being rebuilt</h2><p>This screen moves over from your current planner in the next steps. Until then, use the planner artifact for it.</p><a class="btn soft" href="#today">Back to Today</a></section>`;
}

function render() {
  const hash = location.hash.slice(1);
  const key = hash in SCREENS ? hash : 'today';
  const scr = SCREENS[key];
  document.querySelectorAll('.side a.nav, .tabbar a').forEach(a => {
    if (a.getAttribute('href') === `#${key}`) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.title = `${scr.title} · Loan Payoff`;
  document.querySelector('[data-sync-text]').textContent = SYNC[state.source][0];
  document.querySelector('[data-sync]').className = `sync ${SYNC[state.source][1]}`;
  state.screen = scr.render ? scr.render(view) : placeholder(view, scr.title);
}

addEventListener('hashchange', () => { render(); scrollTo(0, 0); });
let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => state.screen?.redraw?.(), 120); });
document.querySelector('[data-quick]').addEventListener('click', () => toast('Quick add (payments, income, costs) arrives with GitHub sync.'));

const { data, source } = await loadLocal();
state.data = data ? normalize(data) : { loans: [], payments: [], scenarios: [], plan: migratePlan({}) };
state.source = source;
render();
