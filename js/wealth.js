// Wealth math: net worth, emergency fund, the recommended "best route" for loans, and the next-dollar ranking.
// Pure functions over { loans, plan, accounts }. These are rule-based comparisons with the reasoning shown, not personal advice.
import { ym, ymStr, ymLabel, nowYM, simulate, cashFlow, owedNow, STRATEGIES } from './engine.js';

export const SAVINGS_LUMP = 'Savings above your emergency fund';

// The cushion check: walk your bank cash forward month by month (income in; costs, planned one-time costs and the plan's
// loan payments out) and find the lowest point. Only cash that keeps that low point at or above the emergency fund is safe
// to put toward loans now. Rounded down to $50, never more than what's owed. Worked out live from your balances, so once
// you pay it and update your bank balance it drops to zero by itself.
export function cushion(data, start = nowYM()) {
  const plan = data.plan || {}, loans = data.loans || [];
  const ef = emergencyFund(data.accounts || [], plan, start);
  const base = { ...plan, useSpareCash: false };
  const st = STRATEGIES.some(s => s.id === plan.strategy) ? plan.strategy : 'avalanche';
  const r = simulate(loans, base, st, { start });
  const open = (plan.planned || []).filter(p => !p.paidOn && ym(p.month) != null);
  const overdue = open.filter(p => ym(p.month) < start);
  const horizon = Math.min(start + 36, Math.max(start + 12, ...open.map(p => ym(p.month) + 1)));
  let cash = ef.cash, low = { m: start - 1, cash }, shortTotal = 0;
  for (let m = start; m < horizon; m++) {
    const cf = cashFlow(base, m), row = r.rows.find(x => x.m === m);
    const loanOut = row ? Math.max(0, row.paid - row.lump) : 0; // stored one-time payments (refunds, gifts) bring their own money
    const out = cf.costs + cf.oneTime + (m === start ? overdue.reduce((s, p) => s + (+p.amount || 0), 0) : 0) + loanOut;
    shortTotal += Math.max(0, out - cf.income);
    cash += cf.income - out;
    if (cash < low.cash) low = { m, cash };
  }
  const owed = loans.reduce((s, l) => s + owedOf(l), 0);
  const room = Math.min(ef.cash, low.cash) - ef.target;
  const amount = room >= 100 ? Math.min(Math.floor(room / 50) * 50, Math.floor(owed)) : 0;
  const upcoming = open.filter(p => ym(p.month) < horizon).sort((a, b) => ym(a.month) - ym(b.month));
  return { amount, room, cash: ef.cash, target: ef.target, emergency: ef, low, horizon, upcoming, shortTotal,
    heldBack: Math.max(0, ef.surplus - amount) }; // cash above the emergency fund that's kept for what's coming
}
export const spareCash = (data, start = nowYM()) => cushion(data, start).amount;

// The one plain answer for this month: how much to send, where it comes from, and whether to keep or use savings.
export function monthAction(data, start = nowYM()) {
  const plan = data.plan || {}, loans = data.loans || [];
  const st = STRATEGIES.some(s => s.id === plan.strategy) ? plan.strategy : 'avalanche';
  const c = cushion(data, start), cf = cashFlow(plan, start);
  const r = simulate(loans, effectivePlan(data, start), st, { start }), row = r.rows[0];
  const hasBank = (data.accounts || []).some(a => a.kind === 'bank');
  const spareIn = plan.useSpareCash ? c.amount : 0;
  const pay = row?.paid || 0, mins = row?.minsDue || 0;
  const lump = row?.lump || 0; // includes the spare-cash payment when the plan uses it
  const fromIncome = Math.min(Math.max(0, pay - lump), Math.max(0, cf.left));
  const fromSavings = Math.max(0, pay - fromIncome - (lump - spareIn));
  const focus = row ? loans.filter(l => row.pay[l.id] > 0.005).sort((a, b) => row.pay[b.id] - row.pay[a.id])[0] : null;
  const due = c.upcoming.map(p => `${p.label} ${money(+p.amount)} in ${ymLabel(ym(p.month))}`);
  const keepWhy = c.upcoming.length ? `It’s set aside for ${due.join(', ')}.` : c.shortTotal > 1 ? `Months ahead where costs and payments run past income need about ${money(c.shortTotal)} of it.` : '';
  const out = { pay, fromIncome, fromSavings, mins, safe: c.amount, cushion: c, focusLoanId: focus?.id || null };

  if (!hasBank) return { ...out, kind: 'no-bank', title: pay ? `Send ${money(pay)} to your loans this month` : 'Nothing is due on your loans this month',
    detail: `${fromSavings > 0.5 ? `Only ${money(fromIncome)} is left after costs, so ${money(fromSavings)} of that would come from savings. ` : ''}Add your bank balance on Wealth so the app can check that against your emergency fund${(plan.planned || []).some(p => !p.paidOn) ? ' and your planned costs' : ''}.`, action: { label: 'Add balance', href: '#accounts' } };

  const lines = [];
  if (pay < 0.5) lines.push(`Nothing is due on your loans this month.`);
  else lines.push(`${money(fromIncome)} from this month’s income${fromIncome < mins - 0.5 ? ' (that’s short of the minimums)' : ''}${fromSavings > 0.5 ? ` plus ${money(fromSavings)} from savings` : ''}${focus && pay > mins + 0.5 ? `, with the extra going to ${focus.name}` : ''}.`);
  if (c.amount > 0 && plan.useSpareCash) {
    lines.push(`The ${money(c.amount)} from savings is safe: after it you still keep your ${money(c.target)} emergency fund${c.upcoming.length ? ` and everything planned (${due.join(', ')})` : ''}.`);
    return { ...out, kind: 'use-savings', title: `Send ${money(pay)} this month, ${money(c.amount)} of it from savings`, detail: lines.join(' '), action: { label: 'Log a payment', log: true } };
  }
  if (c.amount > 0) {
    lines.push(`You could also safely put ${money(c.amount)} of savings toward loans now and still keep your emergency fund${c.upcoming.length ? ` and what’s planned` : ''}.`);
    return { ...out, kind: 'can-use-savings', title: `Send ${money(pay)} this month; ${money(c.amount)} more is safe to add`, detail: lines.join(' '), action: { label: 'See the plan', href: '#plan' } };
  }
  // Short of the cushion even before any extra: pay only what's due and keep the rest of this month's income as savings.
  if (c.room < 0 && pay > mins + 0.5) {
    // Measure the gap without the plan's own extra from savings, since the advice is to stop that.
    const g = +plan.extraMonthly > 0 ? cushion({ ...data, plan: { ...plan, extraMonthly: 0 } }, start) : c;
    const gap = Math.max(0, -g.room), keep = Math.max(0, fromIncome - mins), months = keep > 0.5 && gap > 0 ? Math.ceil(gap / keep) : null;
    const why = gap > 0
      ? `${g.upcoming.length ? `After ${due.join(', ')}, your` : 'Your'} cash would drop to about ${money(Math.max(0, g.low.cash))} in ${ymLabel(g.low.m)}, ${money(gap)} below your ${money(c.target)} emergency fund.`
      : `Your plan’s extra would pull your cash below your ${money(c.target)} emergency fund${c.upcoming.length ? ` once ${due.join(', ')} is paid` : ''}.`;
    return { ...out, kind: 'over', comfy: mins, keep,
      title: mins > 0.5 ? `Send just the ${money(mins)} due this month${keep > 0.5 ? ` and save ${money(keep)}` : ''}` : `Don’t send extra this month${keep > 0.5 ? `; save the ${money(keep)}` : ''}`,
      detail: `${why} ${keep > 0.5 ? `Keeping this month’s ${money(keep)} in savings instead of paying extra rebuilds that cushion${months ? `; at this pace it takes about ${months} month${months === 1 ? '' : 's'}` : ''}. ` : ''}${fromSavings > 0.5 ? `Your plan also takes ${money(fromSavings)} a month from savings for extra payments, which would make the gap bigger. ` : ''}Extra loan payments make sense again once the cushion is covered. To make the plan match, lower “Send to loans” in Wealth → Cash flow or the extra on the Plan tab.`,
      action: { label: 'Adjust the plan', href: '#cashflow' } };
  }
  if (fromSavings > 0.5) lines.push(`Taking that from savings is fine: your cash still covers your ${money(c.target)} emergency fund${c.upcoming.length ? ` and ${due.join(', ')}` : ''}.`);
  else if (c.heldBack >= 100) lines.push(`Keep your savings for now. You have ${money(c.heldBack)} above your emergency fund, and it’s spoken for. ${keepWhy}`);
  else if (c.cash < c.target) lines.push(`Keep your savings: your ${money(c.cash)} is still building toward the ${money(c.target)} emergency fund.`);
  else lines.push('Keep your savings where they are; there’s nothing extra to spare yet.');
  return { ...out, kind: fromSavings > 0.5 ? 'savings-ok' : 'keep',
    title: pay < 0.5 ? 'Keep your savings this month' : fromSavings > 0.5 ? `Send ${money(pay)} this month, ${money(fromSavings)} of it from savings` : `Send ${money(pay)} this month and keep your savings`,
    detail: lines.join(' '), action: pay > 0.5 ? { label: 'Log a payment', log: true } : null };
}

// The plan as the simulator should see it: with "use spare cash" on, today's spare cash goes in this month as a one-time payment.
export function effectivePlan(data, start = nowYM()) {
  const plan = data.plan || {};
  if (!plan.useSpareCash) return plan;
  const amt = spareCash(data, start);
  return amt ? { ...plan, lumps: [...(plan.lumps || []), { month: ymStr(start), label: SAVINGS_LUMP, amount: amt }] } : plan;
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

// The cushion is sized on the highest monthly costs in the next 12 months, so it still holds if costs go up.
export function emergencyFund(accounts = [], plan = {}, start = nowYM()) {
  const months = +plan.emergencyMonths || 3;
  let monthlyCosts = 0;
  for (let m = start; m < start + 12; m++) monthlyCosts = Math.max(monthlyCosts, cashFlow(plan, m).costs);
  const cash = netWorth(accounts).cash, target = months * monthlyCosts;
  return { months, monthlyCosts, target, cash, gap: Math.max(0, target - cash), surplus: Math.max(0, cash - target),
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
    key: 'emergency', title: `Emergency fund: ${ef.months} months of costs`,
    detail: ef.monthlyCosts ? `${money(ef.cash)} of ${money(ef.target)} (${ef.months} × ${money(ef.monthlyCosts)}). Keep it in savings so a surprise doesn’t become new debt.` : 'Add your monthly costs to size this.',
    amount: ef.gap, done: ef.funded && ef.monthlyCosts > 0,
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
