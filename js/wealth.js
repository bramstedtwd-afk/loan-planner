// Wealth math: net worth, emergency fund, the recommended "best route" for loans, and the next-dollar ranking.
// Pure functions over { loans, plan, accounts }. These are rule-based comparisons with the reasoning shown, not personal advice.
import { ym, ymStr, ymLabel, nowYM, simulate, cashFlow, owedNow, STRATEGIES } from './engine.js';
import { ledger, monthSummary } from './tracker.js';

export const SAVINGS_LUMP = 'Savings above your emergency fund';

// ---------- stability: one projection drives the cushion, the cushion-first route, the safe extra and the verdict ----------
export const BAD_CASE = { income: 0.8, costs: 1.15 };
const HABIT_MONTHS = 3;
const clampRatio = x => Math.min(3, Math.max(0.3, x));
const validStrategy = plan => STRATEGIES.some(s => s.id === plan.strategy) ? plan.strategy : 'avalanche';
const banksOf = data => (data.accounts || []).filter(a => a.kind === 'bank');
const bankCash = data => banksOf(data).reduce((s, a) => s + (+a.balance || 0), 0);

// The cushion to protect in month m: a fixed starter fund while in school, then N months of costs after graduation
// (sized on the highest costs in the 12 months from then, so it still holds if costs go up).
export function cushionAt(plan, m) {
  const grad = ym(plan.gradMonth);
  if (grad != null && m <= grad) return { target: +plan.emergencyStarter || 1000, mode: 'starter', months: null, monthlyCosts: null };
  const months = +plan.emergencyMonths || 3, from = Math.max(m, grad != null ? grad + 1 : m);
  let monthlyCosts = 0;
  for (let k = from; k < from + 12; k++) monthlyCosts = Math.max(monthlyCosts, cashFlow(plan, k).costs);
  return { target: months * monthlyCosts, mode: 'months', months, monthlyCosts };
}

// Your real habits: the last few complete months you tracked, compared with the plan for those months.
// Each future month's planned income and costs are scaled by these ratios ("real averages replace the plan").
export function habits(data, start = nowYM()) {
  const tracked = ledger(data).map(e => e.date).filter(Boolean).concat((data.checkins || []).map(c => c.date)).sort()[0];
  const out = { months: 0, incomeRatio: 1, costsRatio: 1, actualIn: 0, actualOut: 0, plannedIn: 0, plannedOut: 0, window: [] };
  if (!tracked) return out;
  for (let m = start - HABIT_MONTHS; m < start; m++) {
    if (`${ymStr(m)}-01` < tracked) continue; // only months tracked from their first day
    const s = monthSummary(data, ymStr(m)), cf = cashFlow(data.plan || {}, m);
    out.window.push(ymStr(m)); out.months++;
    out.actualIn += s.in;
    out.actualOut += s.entries.filter(e => e.dir === 'out' && e.source === 'log').reduce((t, e) => t + e.amount, 0); // loan payments and planned costs are modeled on their own
    out.plannedIn += cf.income; out.plannedOut += cf.costs;
  }
  if (out.months) {
    if (out.plannedIn > 0) out.incomeRatio = clampRatio(out.actualIn / out.plannedIn);
    if (out.plannedOut > 0) out.costsRatio = clampRatio(out.actualOut / out.plannedOut);
  }
  return out;
}

// Month-by-month bank cash: income in; costs, planned one-time costs, loan minimums and the plan's extra sends out.
// Cushion first: extra goes to loans only when every month in the look-ahead (12 months, or through the last planned
// cost) still keeps the cushion. Returns the months, the sends, and the lowest point against the cushion.
export function outlook(data, start = nowYM(), { bad = false, sends = null, lump = 0 } = {}) {
  const plan = data.plan || {}, loans = data.loans || [];
  const h = habits(data, start);
  const inMul = h.incomeRatio * (bad ? BAD_CASE.income : 1), costMul = h.costsRatio * (bad ? BAD_CASE.costs : 1);
  const mins = simulate(loans, { ...plan, budgets: null, extraMonthly: 0, lumps: [] }, 'minimum', { start });
  const open = (plan.planned || []).filter(p => !p.paidOn && ym(p.month) != null);
  const overdue = open.filter(p => ym(p.month) < start).reduce((s, p) => s + (+p.amount || 0), 0);
  const lastPlanned = Math.max(start, ...open.map(p => ym(p.month)));
  const end = Math.min(start + 240, Math.max(start + 13, lastPlanned + 2, (mins.payoffM ?? start + 240) + 2));
  const share = plan.share == null || plan.share === '' ? 100 : +plan.share;
  const cash0 = bankCash(data) - lump;
  const months = [];
  let base = cash0;
  for (let m = start; m < end; m++) {
    const cf = cashFlow(plan, m), row = mins.rows.find(x => x.m === m);
    const income = cf.income * inMul, costs = cf.costs * costMul, oneTime = cf.oneTime + (m === start ? overdue : 0), due = row ? row.paid : 0;
    const avail = Math.max(0, (income - costs - oneTime) * share / 100 - due) + Math.max(0, +plan.extraMonthly || 0);
    base += income - costs - oneTime - due; // cash if no extra is ever sent
    months.push({ m, income, costs, oneTime, mins: due, avail, cashIfSaved: base, target: cushionAt(plan, m).target });
  }
  // cushion-first sends, worked out on the normal case; the bad case reuses them to see what they'd do in a bad stretch
  const S = sends || {};
  const lastIdx = months.findIndex(y => y.m === lastPlanned);
  let sent = 0;
  for (let i = 0; i < months.length; i++) {
    const x = months[i];
    if (!sends) {
      const reach = Math.min(months.length, Math.max(i + 13, lastIdx + 1));
      let slack = Infinity;
      for (let k = i; k < reach; k++) slack = Math.min(slack, months[k].cashIfSaved - sent - months[k].target);
      x.send = Math.max(0, Math.min(x.avail, slack));
      S[ymStr(x.m)] = x.send;
    } else x.send = S[ymStr(x.m)] || 0;
    sent += x.send;
    x.cash = x.cashIfSaved - sent;
  }
  const horizonEnd = Math.max(start + 12, lastPlanned + 1);
  const view = months.filter(x => x.m < horizonEnd);
  const t0 = cushionAt(plan, start).target;
  const lowOf = key => {
    let low = { m: start - 1, cash: cash0, target: t0, slack: cash0 - t0 };
    for (const x of view) if (x[key] - x.target < low.slack) low = { m: x.m, cash: x[key], target: x.target, slack: x[key] - x.target };
    return low;
  };
  // low: with the sends; lowSaved: if you paused every extra payment (what the verdict and the safe extra use)
  return { months, view, sends: S, low: lowOf('cash'), lowSaved: lowOf('cashIfSaved'), habits: h, horizonEnd, bad,
    upcoming: open.filter(p => ym(p.month) < horizonEnd).sort((a, b) => ym(a.month) - ym(b.month)) };
}

// Each case assumes you'd pause extra payments when money gets tight (only what's due keeps going out).
// Stable: even a bad stretch (income −20%, costs +15%) keeps the cushion. Watch: only a normal stretch does.
// Tight: even a normal stretch falls short. The safe extra is savings you can put toward loans now and still be Stable.
export function stability(data, start = nowYM()) {
  const plan = data.plan || {}, loans = data.loans || [];
  const hasBank = banksOf(data).length > 0;
  const badBefore = outlook(data, start, { bad: true });
  const owed = loans.reduce((s, l) => s + owedOf(l), 0);
  const room = badBefore.lowSaved.slack;
  const safe = hasBank && room >= 100 ? Math.min(Math.floor(room / 50) * 50, Math.floor(owed)) : 0;
  const lump = plan.useSpareCash ? safe : 0;
  const b = lump ? outlook(data, start, { bad: true, lump }) : badBefore;
  // Future months are projected on the normal case, but this month's extra must also be safe in a bad stretch.
  const S = { ...outlook(data, start, { lump }).sends }, k0 = ymStr(start);
  S[k0] = Math.min(S[k0] || 0, b.sends[k0] || 0);
  const n = outlook(data, start, { lump, sends: S });
  const normal = n;
  const level = !hasBank ? null : b.lowSaved.slack >= -0.5 ? 'stable' : n.lowSaved.slack >= -0.5 ? 'watch' : 'tight';
  const cash = bankCash(data);
  const nowCosts = normal.months[0] ? normal.months[0].costs : cashFlow(plan, start).costs;
  const backstop = (data.accounts || []).filter(a => a.kind === 'brokerage').reduce((s, a) => s + (+a.balance || 0), 0);
  const ef = cushionAt(plan, start);
  return { level, hasBank, cash, target: ef.target, cushion: ef, normal: n, bad: b, safe, room, lumpInPlan: lump, owed,
    runwayMonths: nowCosts > 0 ? cash / nowCosts : null, backstop, habits: normal.habits };
}

// The summary the screens use: what's safe now, what's held back, and what it's held for.
export function cushion(data, start = nowYM()) {
  const st = stability(data, start), o = st.normal;
  const shortTotal = o.view.reduce((s, x) => s + Math.max(0, x.costs + x.oneTime + x.mins - x.income), 0);
  return { amount: st.safe, room: st.room, cash: st.cash, target: st.target, low: st.bad.lowSaved, horizon: o.horizonEnd, upcoming: o.upcoming, shortTotal,
    heldBack: Math.max(0, st.cash - st.target - st.safe), level: st.level, stability: st };
}
export const spareCash = (data, start = nowYM()) => stability(data, start).safe;

// The plan as the simulator sees it. With a bank balance known, extra goes to loans cushion-first (each month only what
// the cushion can spare), and with "use spare cash" on, today's safe extra goes in this month as a one-time payment.
export function effectivePlan(data, start = nowYM()) {
  const plan = data.plan || {};
  if (!banksOf(data).length) return plan;
  const st = stability(data, start);
  const budgets = Object.fromEntries(st.normal.months.map(x => [ymStr(x.m), x.mins + x.send]));
  const p = { ...plan, budgets, extraMonthly: 0 };
  return st.lumpInPlan ? { ...p, lumps: [...(plan.lumps || []), { month: ymStr(start), label: SAVINGS_LUMP, amount: st.lumpInPlan }] } : p;
}

// The one plain answer for this month, built on the verdict: how much to send, whether extra is safe, and why.
export function monthAction(data, start = nowYM()) {
  const plan = data.plan || {}, loans = data.loans || [];
  const st = stability(data, start), o = st.normal, now = o.months[0];
  const r = simulate(loans, effectivePlan(data, start), validStrategy(plan), { start }), row = r.rows[0];
  const pay = row?.paid || 0, mins = row?.minsDue || 0;
  // where extra would go: the loan your strategy sends a one-time payment to
  const attack = validStrategy(plan) === 'minimum' ? 'avalanche' : validStrategy(plan);
  const probe = simulate(loans, { ...plan, budgets: { [ymStr(start)]: 0 }, extraMonthly: 0, lumps: [{ month: ymStr(start), amount: 1 }] }, attack, { start });
  const extraOn = id => (probe.rows[0]?.pay[id] || 0) - Math.min(probe.loans.find(l => l.id === id)?.min || 0, probe.init[id] || 0);
  const target = loans.filter(l => extraOn(l.id) > 0.5).sort((a, b) => extraOn(b.id) - extraOn(a.id))[0] || null;
  const due = o.upcoming.map(p => `${p.label} ${money(+p.amount)} in ${ymLabel(ym(p.month))}`);
  const left = now ? now.income - now.costs - now.oneTime : 0, kept = now ? Math.max(0, now.avail - now.send) : 0;
  const out = { pay, mins, safe: st.safe, level: st.level, stability: st, focusLoanId: target?.id || null, kept };

  if (!st.hasBank) return { ...out, kind: 'no-bank', title: pay ? `Send ${money(pay)} to your loans this month` : 'Nothing is due on your loans this month',
    detail: `Add your bank balance on Wealth so the app can check your cushion${(plan.planned || []).some(p => !p.paidOn) ? ' and your planned costs' : ''} before suggesting anything extra.`, action: { label: 'Add balance', href: '#accounts' } };

  const sendLine = pay < 0.5 ? 'Nothing is due on your loans this month.' : `Send ${money(pay)} this month${mins > 0.5 ? ` (${money(mins)} is due)` : ''}.`;
  const keepLine = kept > 0.5 ? ` Keep ${money(kept)} of the ${money(Math.max(0, left))} left over in savings${due.length ? ` for ${due.join(', ')}` : ''} so your ${money(st.target)} cushion holds.` : '';
  if (st.level === 'stable' && st.safe > 0 && !plan.useSpareCash) return { ...out, kind: 'safe-extra',
    title: `Safe to pay ${money(st.safe)} extra on ${target?.name || 'your loans'}`,
    detail: `${sendLine} On top of that, ${money(st.safe)} of savings is safe: even in a bad stretch (income −20%, costs +15%) you keep your ${money(st.target)} cushion${due.length ? ` and cover ${due.join(', ')}` : ''} through ${ymLabel(o.horizonEnd - 1)}.`,
    action: { label: `Pay ${money(st.safe)} extra`, prefill: { loanId: target?.id, amount: st.safe } } };
  if (st.level === 'stable') return { ...out, kind: 'stable', title: pay > 0.5 ? `Send ${money(pay)} this month` : 'Nothing to send this month',
    detail: `${sendLine}${st.lumpInPlan ? ` ${money(st.lumpInPlan)} of it is savings you can safely spare.` : ''}${keepLine} Even in a bad stretch you stay above your cushion.`,
    action: pay > 0.5 ? { label: 'Log a payment', log: true } : null };
  const badLow = st.bad.lowSaved;
  if (st.level === 'watch') return { ...out, kind: 'watch', title: pay > 0.5 ? `Send ${money(pay)} and keep the rest` : 'Keep your savings this month',
    detail: `${sendLine}${keepLine} No extra yet: in a bad stretch (income −20%, costs +15%) your cash would dip to ${money(Math.max(0, badLow.cash))} in ${ymLabel(badLow.m)}, ${money(-badLow.slack)} under your cushion.`,
    action: pay > 0.5 ? { label: 'Log a payment', log: true } : null };
  const nLow = st.normal.lowSaved;
  return { ...out, kind: 'tight', title: mins > 0.5 ? `Send just the ${money(mins)} due and save the rest` : 'Don’t send extra; save what’s left',
    detail: `Even as planned, your cash drops to ${money(Math.max(0, nLow.cash))} in ${ymLabel(nLow.m)}, ${money(-nLow.slack)} under your ${money(st.target)} cushion${due.length ? `, after ${due.join(', ')}` : ''}. Keep every spare dollar in savings until that’s covered.`,
    action: mins > 0.5 ? { label: 'Log a payment', log: true } : { label: 'See cash flow', href: '#cashflow' } };
}

export const ACCOUNT_KINDS = {
  bank: { label: 'Bank cash', short: 'Cash' },
  brokerage: { label: 'Investing', short: 'Investing' },
  retirement: { label: 'Retirement', short: 'Retirement' },
  debt: { label: 'Other debt', short: 'Debt' },
};

// Folds a Robinhood snapshot (wealth/robinhood.json, written by the cloud routine) into the account list.
// One Synced account per Robinhood account, keyed by its last 4 digits; IRAs count as retirement. Names you change are kept.
// Returns { accounts, changed } so the app only saves when the snapshot brought something new.
export const RH_PREFIX = 'rh-';
export function mergeRobinhood(accounts = [], snap) {
  if (!snap || snap.source !== 'robinhood' || !Array.isArray(snap.accounts) || !snap.fetchedAt) return { accounts, changed: false };
  const date = String(snap.fetchedAt).slice(0, 10);
  let changed = false;
  const next = accounts.map(a => ({ ...a }));
  snap.accounts.forEach((s, i) => {
    const last4 = String(s.last4 || '').slice(-4);
    if (!last4) return;
    const id = RH_PREFIX + last4, balance = Math.round((+s.totalValue || 0) * 100) / 100;
    const kind = s.retirement ? 'retirement' : 'brokerage';
    const ex = next.find(a => a.id === id);
    if (ex && (ex.updatedAt > date || (ex.updatedAt === date && +ex.balance === balance && ex.kind === kind))) return; // nothing new
    const history = [...((ex?.history) || []).filter(h => h.date !== date), { date, balance }].sort((x, y) => x.date.localeCompare(y.date));
    const label = s.retirement ? (/roth/i.test(s.type) ? 'Roth IRA' : 'IRA') : 'Investing';
    const acct = { ...(ex || { name: `Robinhood ${label} ··${last4}`, institution: 'Robinhood', notes: '', rate: 0, minPayment: 0, order: 100 + i }),
      id, kind, balance, source: 'robinhood', updatedAt: date, history };
    if (ex) Object.assign(ex, acct); else next.push(acct);
    changed = true;
  });
  return { accounts: next, changed };
}

const money = n => (n < -0.004 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
const owedOf = l => owedNow(l);
const pctTxt = r => `${(+r).toFixed(2).replace(/\.?0+$/, '')}%`;

export function netWorth(accounts = [], loans = []) {
  const sum = k => accounts.filter(a => a.kind === k).reduce((s, a) => s + (+a.balance || 0), 0);
  const cash = sum('bank'), investments = sum('brokerage'), retirement = sum('retirement'), otherDebt = sum('debt');
  const studentLoans = loans.reduce((s, l) => s + owedOf(l), 0);
  const assets = cash + investments + retirement, debts = otherDebt + studentLoans;
  return { cash, investments, retirement, otherDebt, studentLoans, assets, debts, net: assets - debts };
}

// The emergency fund right now: a fixed starter while in school, then N months of costs (see cushionAt).
export function emergencyFund(accounts = [], plan = {}, start = nowYM()) {
  const c = cushionAt(plan, start);
  let monthlyCosts = 0;
  for (let m = start; m < start + 12; m++) monthlyCosts = Math.max(monthlyCosts, cashFlow(plan, m).costs);
  const cash = netWorth(accounts).cash, target = c.target;
  return { months: c.months ?? (+plan.emergencyMonths || 3), mode: c.mode, monthlyCosts, target, cash, gap: Math.max(0, target - cash), surplus: Math.max(0, cash - target),
    runwayMonths: monthlyCosts > 0 ? cash / monthlyCosts : null, funded: cash >= target };
}

const TIE_PREFERENCE = ['private', 'avalanche', 'snowball', 'custom']; // on equal cost, keep federal loans (and their protections) longest
const firstPayoff = (res, loans) => {
  const live = res.loans.filter(l => l.paidOff != null && l.paidOff >= res.start).sort((a, b) => a.paidOff - b.paidOff)[0];
  return live ? { month: live.paidOff, name: loans.find(x => x.id === live.id)?.name || live.name } : null;
};

// The recommended route: which order, how much each month (what's left after costs), and how much cash to put in now.
export function recommendRoute(data, { start = nowYM() } = {}) {
  const loans = data.loans || [], plan = data.plan || {}, accounts = data.accounts || [];
  const ef = emergencyFund(accounts, plan, start);
  const lumpNow = spareCash(data, start);
  const base = { ...plan, share: 100, extraMonthly: 0, useSpareCash: true };
  const ids = ['avalanche', 'private', 'snowball', ...((plan.customOrder || []).length ? ['custom'] : []), 'minimum'];
  const results = Object.fromEntries(ids.map(id => [id, simulate(loans, effectivePlan({ ...data, plan: { ...base, strategy: id } }, start), id, { start })]));
  const ranked = ids.filter(id => id !== 'minimum' && results[id].done)
    .sort((a, b) => (results[a].totalInterest - results[b].totalInterest > 1 ? 1 : results[b].totalInterest - results[a].totalInterest > 1 ? -1 : 0)
      || TIE_PREFERENCE.indexOf(a) - TIE_PREFERENCE.indexOf(b));
  const best = ranked[0] || 'avalanche', r = results[best];
  const cf = cashFlow(plan, start);
  const monthly = Math.max(0, cf.income - cf.costs);
  const current = simulate(loans, effectivePlan(data, start), STRATEGIES.some(s => s.id === plan.strategy) ? plan.strategy : 'avalanche', { start });
  const currentNow = current.rows[0]?.paid || 0;
  const relyOnSavings = currentNow > Math.max(monthly, current.rows[0]?.minsDue || 0) + lumpsIn(effectivePlan(data, start), start) + 1;

  // where the money goes first: the loan getting the most this month beyond its minimum
  const row = r.rows[0];
  const focus = row ? loans.filter(l => row.pay[l.id] > 0.005).sort((a, b) => row.pay[b.id] - row.pay[a.id])[0] : null;
  const order = row ? orderOfAttack(r, loans) : [];

  const bestFirst = firstPayoff(r, loans);
  const name = id => STRATEGIES.find(s => s.id === id)?.name || id;
  const alternatives = ids.filter(id => id !== best).map(id => {
    const x = results[id], d = x.totalInterest - r.totalInterest, dm = (x.months ?? 480) - (r.months ?? 480);
    const cost = d > 1 ? `Costs ${money(d)} more in interest${dm > 0 ? ` and finishes ${dm} month${dm > 1 ? 's' : ''} later` : ''}.` : d < -1 ? `Saves ${money(-d)} in interest.` : 'Costs the same here.';
    let why;
    if (id === 'avalanche') why = 'Always sends extra money to the highest interest rate.';
    else if (id === 'private') why = 'Clears private loans first, so your federal loans, with income-driven repayment, deferment and forgiveness options, stay around longest.';
    else if (id === 'snowball') {
      const f = firstPayoff(x, loans);
      why = f && bestFirst && f.month < bestFirst.month
        ? `Pick this if quick wins keep you going: ${f.name} is fully paid off by ${ymLabel(f.month)} instead of ${ymLabel(bestFirst.month)}.`
        : 'Pays the smallest balance first for quick wins. With your loans it doesn’t finish any loan sooner.';
    } else if (id === 'custom') why = 'Your own order, for a reason the math can’t see, like clearing a variable rate first.';
    else {
      const free = Math.max(0, (r.rows[1]?.paid ?? r.rows[0]?.paid ?? 0) - (x.rows[1]?.paid ?? x.rows[0]?.paid ?? 0));
      why = `Pays only what’s due, keeping about ${money(free)} a month free for other goals.${x.done ? ` Done ${ymLabel(x.payoffM)}.` : ' Never fully paid off within 40 years.'}`;
    }
    return { id, name: name(id), result: x, deltaInterest: d, deltaMonths: dm, why, cost };
  });

  return {
    best, name: name(best), result: r, results, alternatives, plan: { ...base, strategy: best },
    monthly, lumpNow, emergency: ef, focusLoanId: focus?.id || null, order,
    current, savedVsCurrent: current.totalInterest - r.totalInterest, monthsVsCurrent: (current.months ?? 480) - (r.months ?? 480),
    relyOnSavings, currentMonthly: currentNow,
  };
}

const lumpsIn = (plan, m) => (plan.lumps || []).filter(l => l.month === ymStr(m)).reduce((s, l) => s + (+l.amount || 0), 0);

// Loans in the order they get paid off under a result, for "1. X first, 2. Y next…".
function orderOfAttack(res, loans) {
  return res.loans.filter(l => l.paidOff != null && l.paidOff >= res.start).sort((a, b) => a.paidOff - b.paidOff)
    .map(l => ({ id: l.id, name: loans.find(x => x.id === l.id)?.name || l.name, paidOff: l.paidOff }));
}

// Where the next dollar goes, by standard rules. Each step says why; the first unfinished one is "now".
export function nextDollar(data, { start = nowYM() } = {}) {
  const loans = data.loans || [], plan = data.plan || {}, accounts = data.accounts || [];
  const ef = emergencyFund(accounts, plan, start);
  const ret = +plan.assumedReturn || 6;
  const steps = [];
  steps.push({
    key: 'emergency', title: ef.mode === 'starter' ? `Starter emergency fund: ${money(ef.target)} while in school` : `Emergency fund: ${ef.months} months of costs`,
    detail: ef.funded && stability(data, start).normal.lowSaved.slack < -0.5 ? `Covered today (${money(ef.cash)} of ${money(ef.target)}), but costs ahead pull it under in ${ymLabel(stability(data, start).normal.lowSaved.m)}. Rebuild it before paying extra.`
      : ef.mode === 'starter' ? `${money(ef.cash)} of ${money(ef.target)}. After graduation it grows to ${ef.months} months of costs. Keep it in savings so a surprise doesn’t become new debt.`
      : ef.monthlyCosts ? `${money(ef.cash)} of ${money(ef.target)} (${ef.months} × ${money(ef.monthlyCosts)}). Keep it in savings so a surprise doesn’t become new debt.` : 'Add your monthly costs to size this.',
    amount: ef.gap, done: ef.funded && (ef.mode === 'starter' || ef.monthlyCosts > 0) && stability(data, start).normal.lowSaved.slack >= -0.5,
  });
  const hotDebt = accounts.filter(a => a.kind === 'debt' && +a.balance > 0 && +a.rate >= 8).sort((a, b) => +b.rate - +a.rate);
  for (const a of hotDebt) steps.push({ key: `debt-${a.id}`, title: `Pay off ${a.name} (${pctTxt(a.rate)})`, detail: `High-rate debt costs more than investing is likely to earn. ${money(+a.balance)} left.`, amount: +a.balance, done: false });
  const m = plan.employerMatch;
  steps.push(m && +m.percent > 0
    ? { key: 'match', title: `Get your full employer match (${pctTxt(m.percent)} of pay)`, detail: 'Matched money is an instant return no loan payoff can beat.', done: false }
    : { key: 'match', title: 'Employer retirement match', detail: 'When a job offers a match, contribute enough to get all of it. Add it in Wealth settings once you know.', done: false, later: true });
  const above = loans.filter(l => owedOf(l) > 0.005 && +l.rate > ret).sort((a, b) => +b.rate - +a.rate);
  if (above.length) steps.push({
    key: 'loans', title: `Extra on loans above ${pctTxt(ret)}`,
    detail: `${above.map(l => `${l.name} (${pctTxt(l.rate)})`).join(', ')}. Paying these is a guaranteed return at their rate; your assumed investing return is ${pctTxt(ret)} and isn’t guaranteed.`,
    amount: above.reduce((s, l) => s + owedOf(l), 0), done: false,
  });
  const below = loans.filter(l => owedOf(l) > 0.005 && +l.rate <= ret);
  steps.push({
    key: 'invest', title: 'Invest for the long term',
    detail: below.length ? `Loans at or below ${pctTxt(ret)} (${below.map(l => l.name).join(', ')}) are close to what investing may earn, so minimums are enough there.` : `Once loans above ${pctTxt(ret)} are gone, extra money is expected to grow more invested, with ups and downs.`,
    done: false,
  });
  let nowSet = false;
  for (const s of steps) { s.status = s.done ? 'done' : s.later ? 'later' : !nowSet ? (nowSet = true, 'now') : 'next'; }
  return steps;
}
