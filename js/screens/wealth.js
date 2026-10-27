// Wealth: what you have, what you owe, and where the next dollar should go.
// Overview (net worth, emergency fund, next dollar) and Accounts (balances you keep up to date). Cash flow lives in money.js.
import { netWorth, emergencyFund, nextDollar, cushion, ACCOUNT_KINDS } from '../wealth.js';
import { ym, ymLabel } from '../engine.js';
import { money, esc, ago, pct } from '../format.js';
import { header, subnav } from '../ui/layout.js';
import { makeEditors } from '../ui/editors.js';
import { formSheet } from '../ui/form-sheet.js';

export const WEALTH_TABS = [['wealth', 'Overview'], ['accounts', 'Accounts'], ['cashflow', 'Cash flow']];
const GROUP_ORDER = ['bank', 'brokerage', 'retirement', 'debt'];
const daysOld = d => d ? Math.floor((Date.now() - new Date(d + 'T12:00')) / 864e5) : null;

// The Robinhood line: when the routine last read your balances, and a button to ask for fresh numbers.
function rhStrip(rh) {
  if (!rh) return '';
  const busy = rh.status === 'refreshing';
  const when = rh.fetchedAt ? `Synced ${ago(rh.fetchedAt)}` : rh.status === 'loading' ? 'Checking…' : rh.status === 'error' ? 'Couldn’t check for new numbers' : 'Not synced yet';
  return `<div class="rh-strip"><div class="name"><b>Robinhood</b><small>${busy ? 'Claude is reading your balances (read-only)…' : esc(rh.error || when)}</small></div>
    <button class="btn soft" type="button" data-rh-refresh ${busy ? 'disabled' : ''}>${busy ? '<span class="spin" aria-hidden="true"></span>Refreshing' : 'Refresh'}</button></div>`;
}

export function renderWealth(view, ctx, sub) {
  const { data, start, save, robinhood: rh } = ctx;
  const wireRh = () => view.querySelector('[data-rh-refresh]')?.addEventListener('click', () => rh.onRefresh());
  const accounts = data.accounts || [];
  const ed = makeEditors({ data, save, start });
  const nw = netWorth(accounts, data.loans);
  const top = `${header({ title: 'Wealth' })}${subnav(WEALTH_TABS, sub, 'Wealth views')}`;

  if (sub === 'accounts') {
    view.innerHTML = `${top}
      ${GROUP_ORDER.map(kind => {
        const list = accounts.map((a, i) => ({ a, i })).filter(x => x.a.kind === kind);
        const total = list.reduce((s, x) => s + (+x.a.balance || 0), 0);
        return `<section class="card glass rise">
          <div class="card-h"><h2>${ACCOUNT_KINDS[kind].label}</h2>${list.length ? `<span class="muted small num">${kind === 'debt' ? '−' : ''}${money(total)}</span>` : ''}</div>
          ${kind === 'brokerage' ? rhStrip(rh) : ''}
          <div class="rows">${list.map(({ a, i }) => {
            const old = daysOld(a.updatedAt), stale = old != null && old > 30;
            const prev = (a.history || []).slice(-2, -1)[0], d = prev ? (+a.balance || 0) - prev.balance : 0;
            return `<div class="row acct"><button class="name" type="button" data-update="${i}"><b>${esc(a.name)}${a.source === 'robinhood' ? '<span class="tag fed">Synced</span>' : ''}</b>
                <small>${esc(a.institution || ACCOUNT_KINDS[a.kind].label)} · <span style="${stale ? 'color:var(--warn)' : ''}">${a.updatedAt ? `updated ${ago(a.updatedAt + 'T12:00')}` : 'not updated yet'}</span>${a.kind === 'debt' && +a.rate ? ` · ${pct(a.rate)}` : ''}</small></button>
              <div class="right"><span class="amt num">${a.kind === 'debt' ? '−' : ''}${money(+a.balance || 0)}</span>${Math.abs(d) >= 1 ? `<small class="num" style="color:${(d > 0) !== (a.kind === 'debt') ? 'var(--good)' : 'var(--crit)'}">${d > 0 ? '↑' : '↓'} ${money(Math.abs(d))}</small>` : ''}</div>
              <button class="btn soft edit" type="button" data-edit-acct="${i}">Edit</button></div>`;
          }).join('') || `<p class="muted small" style="margin:0">${{ bank: 'Checking and savings. This is the cash your emergency fund and lump sums come from.', brokerage: rh ? 'Tap Refresh to pull your Robinhood accounts in, or add another brokerage by hand.' : 'Robinhood or any brokerage. Connect GitHub in Settings to sync Robinhood.', retirement: 'Roth IRA, 401(k) and similar. Counted in net worth, never used for loans.', debt: 'Credit cards, car loans, anything besides student loans.' }[kind]}</p>`}</div>
          <div class="add-row"><button class="btn soft" type="button" data-add="${kind}">+ Add ${ACCOUNT_KINDS[kind].label.toLowerCase()}</button></div>
        </section>`;
      }).join('')}
      <section class="card glass rise"><a class="row" href="#loans" style="text-decoration:none;border:0;padding:0"><div class="name"><b>Student loans</b><small>Managed on the Loans tab</small></div><span class="amt num">−${money(nw.studentLoans)}</span></a></section>`;
    view.querySelectorAll('[data-update]').forEach(b => b.addEventListener('click', () => ed.updateBalance(+b.dataset.update)));
    view.querySelectorAll('[data-edit-acct]').forEach(b => b.addEventListener('click', () => ed.editAccount(+b.dataset.editAcct)));
    view.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => ed.editAccount(null, b.dataset.add)));
    wireRh();
    return {};
  }

  // Overview
  const ef = emergencyFund(accounts, data.plan, start);
  const cu = cushion(data, start);
  const steps = nextDollar(data, { start });
  const plan = data.plan;
  const assetsParts = [['Cash', nw.cash, 'var(--s3)'], ['Investing', nw.investments, 'var(--s1)'], ['Retirement', nw.retirement, 'var(--s7)']].filter(x => x[1] > 0.5);
  const debtParts = [['Student loans', nw.studentLoans, 'var(--s2)'], ['Other debt', nw.otherDebt, 'var(--s8)']].filter(x => x[1] > 0.5);
  const scale = Math.max(nw.assets, nw.debts, 1);
  const barRow = (label, parts, total) => `<div class="nw-row"><span class="nw-l">${label}</span><div class="nw-bar">${parts.map(([n, v, c]) => `<i style="width:${(v / scale * 100).toFixed(2)}%;background:${c}" title="${n}: ${money(v)}"></i>`).join('')}</div><b class="num">${money(total)}</b></div>`;
  const efPct = ef.target > 0 ? Math.min(1, ef.cash / ef.target) : 0;
  const STATUS = { done: ['Done', 'done'], now: ['Now', 'now'], next: ['Next', 'next'], later: ['Later', 'later'] };

  view.innerHTML = `${top}
    <section class="hero rise" aria-label="Net worth">
      <div class="k"><span>Net worth</span><span class="chip">${accounts.length ? `${accounts.length} account${accounts.length === 1 ? '' : 's'}` : 'Add accounts'}</span></div>
      <div class="when num">${money(nw.net)}</div>
      <p class="sub">${money(nw.assets)} in assets · ${money(nw.debts)} owed</p>
      <div class="nw">${barRow('Have', assetsParts, nw.assets)}${barRow('Owe', debtParts, nw.debts)}</div>
      <div class="nw-key">${[...assetsParts, ...debtParts].map(([n, v, c]) => `<span><i style="background:${c}"></i>${n} ${money(v)}</span>`).join('')}</div>
    </section>
    ${rh ? `<section class="card glass rise">${rhStrip(rh)}</section>` : ''}
    ${accounts.length ? '' : `<section class="card glass rise"><div class="card-h"><h2>Start with your bank balance</h2></div><p class="muted small" style="margin:0 0 12px">Your checking and savings decide your emergency fund and how much cash the Plan can put toward loans. Investing and retirement accounts count toward net worth.</p><div class="add-row"><button class="btn primary" type="button" data-add="bank">Add bank account</button><button class="btn soft" type="button" data-add="brokerage">Add investing</button><button class="btn soft" type="button" data-add="retirement">Add retirement</button></div></section>`}
    <div class="board">
      <div class="col">
        <section class="card glass rise">
          <div class="card-h"><h2>Emergency fund</h2><span class="badge ${ef.funded && ef.monthlyCosts ? '' : 'warn'}">${ef.funded && ef.monthlyCosts ? 'Covered' : `${money(ef.gap)} to go`}</span></div>
          <div class="meter"><i style="width:${(efPct * 100).toFixed(1)}%"></i></div>
          <div class="meter-l"><span><b class="num">${money(ef.cash)}</b> cash</span><span>goal <b class="num">${money(ef.target)}</b></span></div>
          <p class="muted small" style="margin:10px 0 0">${ef.monthlyCosts ? `${ef.months} months × ${money(ef.monthlyCosts)} of costs. ${ef.runwayMonths != null ? `Your cash covers about <b>${ef.runwayMonths.toFixed(1)} months</b> of costs.` : ''}${cu.heldBack >= 100 ? ` <b>${money(cu.heldBack)}</b> above the goal is kept for ${cu.upcoming.length ? cu.upcoming.map(p => `${esc(p.label)} (${ymLabel(ym(p.month))})`).join(', ') : 'months where costs run past income'}.` : ''}${cu.amount >= 100 ? ` <b>${money(cu.amount)}</b> is safe to put toward loans${plan.useSpareCash ? ' and goes in this month as part of your plan.' : '; see the Plan tab.'}` : ''}` : 'Add your monthly costs in Cash flow to size this.'}</p>
        </section>
        <section class="card glass rise">
          <div class="card-h"><h2>Assumptions</h2><button class="btn soft" type="button" data-assume style="height:34px;font-size:13px">Edit</button></div>
          <div class="kv"><span>Emergency fund</span><b>${plan.emergencyMonths} months of costs</b></div>
          <div class="kv"><span>Assumed investing return</span><b>${pct(plan.assumedReturn)} a year</b></div>
          <div class="kv"><span>Employer retirement match</span><b>${plan.employerMatch?.percent ? `${pct(plan.employerMatch.percent)} of pay` : 'Not set yet'}</b></div>
        </section>
      </div>
      <div class="col">
        <section class="card glass rise">
          <div class="card-h"><h2>Where the next dollar goes</h2><span class="muted small">In order</span></div>
          <ol class="steps">${steps.map(s => `<li class="${STATUS[s.status][1]}"><span class="st">${STATUS[s.status][0]}</span><div><b>${esc(s.title)}</b><small>${esc(s.detail)}</small></div></li>`).join('')}</ol>
          <p class="section-note">Standard rules applied to your numbers, with the reasons shown. They aren’t personal financial advice; you make the call.</p>
        </section>
      </div>
    </div>`;

  view.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => ed.editAccount(null, b.dataset.add)));
  wireRh();
  view.querySelector('[data-assume]').addEventListener('click', () => formSheet({
    title: 'Assumptions',
    intro: 'These shape the emergency-fund goal and the next-dollar order.',
    fields: [
      { name: 'emergencyMonths', label: 'Emergency fund', type: 'segmented', value: String(plan.emergencyMonths), options: [['1', '1 month'], ['3', '3 months'], ['6', '6 months']] },
      { name: 'assumedReturn', label: 'Assumed investing return', hint: 'per year, before inflation', type: 'number', value: plan.assumedReturn, suffix: '%', min: 0, max: 15, step: 0.5, required: true, half: true },
      { name: 'match', label: 'Employer match', hint: 'blank = none / not yet', type: 'number', value: plan.employerMatch?.percent || '', suffix: '% of pay', min: 0, max: 20, step: 0.5, half: true },
    ],
    submitLabel: 'Save',
    onSubmit: v => save({ ...data, plan: { ...plan, emergencyMonths: +v.emergencyMonths, assumedReturn: +v.assumedReturn, employerMatch: +v.match > 0 ? { percent: +v.match } : null } },
      `Assumptions: ${v.emergencyMonths}-month emergency fund, ${v.assumedReturn}% return${+v.match > 0 ? `, ${v.match}% match` : ''}`, 'Assumptions saved'),
  }));
  return {};
}
