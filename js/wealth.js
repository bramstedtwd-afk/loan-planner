// Wealth math: net worth, emergency fund, the recommended "best route" for loans, and the next-dollar ranking.
// Pure functions over { loans, plan, accounts }. These are rule-based comparisons with the reasoning shown, not personal advice.
import { ym, ymStr, ymLabel, nowYM, simulate, cashFlow, STRATEGIES } from './engine.js';

export const SAVINGS_LUMP = 'Savings above your emergency fund';

// Bank cash above the emergency fund, rounded down to $50 and never more than what's owed. Worked out live from your balances,
// so once you pay it and update your bank balance it drops to zero by itself.
export function spareCash(data, start = nowYM()) {
  const ef = emergencyFund(data.accounts || [], data.plan || {}, start);
  const owed = (data.loans || []).reduce((s, l) => s + owedOf(l), 0);
  return ef.surplus >= 100 ? Math.min(Math.floor(ef.surplus / 50) * 50, Math.floor(owed)) : 0;
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

const money = n => (n < -0.004 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
const owedOf = l => (+l.balance || 0) + (+l.unpaid || 0);
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
