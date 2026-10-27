// Payoff engine: pure functions only (no DOM, no storage), so it runs the same in the browser, in Node tests and in GitHub Actions.
// Months are integers: year * 12 + monthIndex (Jan = 0). "YYYY-MM" strings convert with ym() / ymStr().

export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WEEKS_PER_MONTH = 52 / 12;
export const SCHEMA_VERSION = 1;

export const ym = s => { if (!s) return null; const [y, m] = String(s).split('-').map(Number); return y * 12 + (m - 1); };
export const ymStr = i => `${Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`;
export const ymLabel = i => `${MON[i % 12]} ${Math.floor(i / 12)}`;
export const nowYM = (d = new Date()) => d.getFullYear() * 12 + d.getMonth();
export const isFed = k => String(k).startsWith('fed');

export const KINDS = {
  fed_sub: { label: 'Federal · Direct Subsidized', short: 'Fed · Sub' },
  fed_unsub: { label: 'Federal · Direct Unsubsidized', short: 'Fed · Unsub' },
  fed_plus: { label: 'Federal · Grad / Parent PLUS', short: 'Fed · PLUS' },
  fed_other: { label: 'Federal · Other (Perkins, etc.)', short: 'Fed' },
  private: { label: 'Private', short: 'Private' },
};

export const STRATEGIES = [
  { id: 'avalanche', name: 'Avalanche', desc: 'Every extra dollar goes to the loan with the highest interest rate. This is almost always the cheapest route.' },
  { id: 'snowball', name: 'Snowball', desc: 'Every extra dollar goes to the smallest balance first. You knock out whole loans sooner, usually at a higher total cost.' },
  { id: 'private', name: 'Private first', desc: 'Clear private loans first (highest rate first), then federal. Federal loans keep income-driven plans, deferment and forgiveness options longer.' },
  { id: 'custom', name: 'Custom order', desc: 'You choose which loan gets extra money first.' },
  { id: 'minimum', name: 'Minimums only', desc: 'Pay only what is due each month. The baseline everything is measured against.' },
];

export const defaultPlan = () => ({ strategy: 'avalanche', autopay: false, extraMonthly: 0, gradMonth: '', share: 100, refi: { on: false, rate: 5.5 }, customOrder: [], incomes: [], expenses: [], lumps: [] });

// Older plans stored weekly "phases" (income + expenses + share); convert them to income sources and monthly costs.
export function migratePlan(p) {
  p = { ...defaultPlan(), ...p };
  if (Array.isArray(p.phases)) {
    if (p.phases.length && !(p.incomes || []).length && !(p.expenses || []).length) {
      const ph = [...p.phases].sort((a, b) => ym(a.start) - ym(b.start));
      const endOf = (x, i) => x.end || (ph[i + 1] ? ymStr(ym(ph[i + 1].start) - 1) : '');
      p.incomes = ph.map((x, i) => ({ label: x.label || 'Job', kind: 'full', amount: x.income, per: 'week', start: x.start, end: endOf(x, i) }));
      p.expenses = ph.filter(x => +x.expenses).map(x => ({ label: (x.label || 'Costs') + ' costs', amount: Math.round(x.expenses * 52 / 12), start: x.start, end: endOf(x, ph.indexOf(x)) }));
      if (ph[0].share != null && ph[0].share !== '') p.share = +ph[0].share;
    }
    delete p.phases;
  }
  return p;
}

export function amort(P, r, n) { if (P <= 0) return 0; const i = r / 12; return i === 0 ? P / n : P * i / (1 - Math.pow(1 + i, -n)); }

export const toMonthly = s => (+s.amount || 0) * (s.per === 'week' ? WEEKS_PER_MONTH : 1);
export const activeIn = (s, m) => ym(s.start) != null && ym(s.start) <= m && (ym(s.end) == null || m <= ym(s.end));

// Everything coming in and going out in month m; what's left times the loan share is the loan budget.
export function cashFlow(plan, m) {
  const inc = (plan.incomes || []).filter(s => activeIn(s, m));
  const exp = (plan.expenses || []).filter(s => activeIn(s, m));
  const income = inc.reduce((a, s) => a + toMonthly(s), 0);
  const costs = exp.reduce((a, s) => a + (+s.amount || 0), 0);
  const share = plan.share == null || plan.share === '' ? 100 : +plan.share;
  return { inc, exp, income, costs, left: income - costs, share, toLoans: Math.max(0, income - costs) * share / 100 };
}
export const monthlyBudget = (plan, m) => cashFlow(plan, m).toLoans;
export const lumpsAt = (plan, m) => (plan.lumps || []).filter(l => ym(l.month) === m).reduce((s, l) => s + (+l.amount || 0), 0);

// Month-by-month payoff. Interest accrues monthly on principal; unpaid interest is paid first and capitalizes when repayment starts.
export function simulate(loans, plan, strategy, { start = nowYM() } = {}) {
  const ls = loans.map((l, idx) => {
    let rate = +l.rate || 0;
    if (plan.refi?.on && l.kind === 'private') rate = +plan.refi.rate || 0;
    if (plan.autopay) rate = Math.max(0, rate - 0.25);
    const repay = ym(l.repayStart) ?? start;
    const o = { id: l.id, name: l.name, kind: l.kind, idx, sub: l.kind === 'fed_sub', principal: Math.max(0, +l.balance || 0), unpaid: Math.max(0, +l.unpaid || 0),
      rate: rate / 100, min: +l.minPayment || 0, term: +l.termMonths || 120, repay, started: repay <= start, paidOff: null, interest: 0 };
    if (o.started && !o.min) o.min = amort(o.principal + o.unpaid, o.rate, o.term);
    return o;
  });
  const owed = l => l.principal + l.unpaid;
  const orderIdx = Object.fromEntries((plan.customOrder || []).map((id, i) => [id, i]));
  const effRate = (l, m) => (m < l.repay && l.sub) ? 0 : l.rate;
  const sorter = {
    avalanche: m => (a, b) => effRate(b, m) - effRate(a, m) || owed(a) - owed(b),
    snowball: () => (a, b) => owed(a) - owed(b) || b.rate - a.rate,
    private: m => (a, b) => (isFed(a.kind) - isFed(b.kind)) || effRate(b, m) - effRate(a, m) || owed(a) - owed(b),
    custom: () => (a, b) => (orderIdx[a.id] ?? 999 + a.idx) - (orderIdx[b.id] ?? 999 + b.idx),
  };
  const init = Object.fromEntries(ls.map(l => [l.id, owed(l)]));
  const rows = [];
  let m = start, totalInterest = 0, totalPaid = 0, shortfalls = 0, firstShortfall = null, unusedTotal = 0;
  const MAX = start + 12 * 40;
  ls.forEach(l => { if (owed(l) < 0.005) l.paidOff = start - 1; });
  while (ls.some(l => owed(l) >= 0.005) && m < MAX) {
    let mInt = 0;
    for (const l of ls) {
      if (owed(l) < 0.005) continue;
      if (!l.started && m >= l.repay) {
        l.principal += l.unpaid; l.unpaid = 0; l.started = true;
        if (!l.min) l.min = amort(l.principal, l.rate, l.term);
      }
      const i = (m < l.repay && l.sub) ? 0 : l.principal * l.rate / 12;
      l.unpaid += i; mInt += i;
    }
    const active = ls.filter(l => owed(l) >= 0.005);
    const minsDue = active.reduce((s, l) => s + (m >= l.repay ? Math.min(l.min, owed(l)) : 0), 0);
    const budget = strategy === 'minimum' ? 0 : monthlyBudget(plan, m) + Math.max(0, +plan.extraMonthly || 0);
    const lump = strategy === 'minimum' ? 0 : lumpsAt(plan, m);
    const incomeOn = cashFlow(plan, m).inc.length > 0;
    if (strategy !== 'minimum' && incomeOn && budget + 0.01 < minsDue) { shortfalls++; if (firstShortfall == null) firstShortfall = m; }
    let pool = Math.max(budget, minsDue) + lump;
    const pay = {}, intPaid = {};
    const apply = (l, amt) => {
      amt = Math.min(amt, owed(l)); if (amt <= 0) return 0;
      const ti = Math.min(amt, l.unpaid); l.unpaid -= ti; l.principal -= amt - ti; l.interest += ti;
      pay[l.id] = (pay[l.id] || 0) + amt; intPaid[l.id] = (intPaid[l.id] || 0) + ti; return amt;
    };
    for (const l of active) if (m >= l.repay) pool -= apply(l, l.min);
    if (strategy !== 'minimum') {
      for (const l of [...active].sort(sorter[strategy](m))) { if (pool < 0.005) break; pool -= apply(l, pool); }
    }
    if (pool > 0.005) unusedTotal += pool;
    const paid = Object.values(pay).reduce((s, v) => s + v, 0);
    const iPaid = Object.values(intPaid).reduce((s, v) => s + v, 0);
    totalInterest += mInt; totalPaid += paid;
    const bal = {}; let total = 0;
    for (const l of ls) { if (owed(l) < 0.005) { l.principal = 0; l.unpaid = 0; if (l.paidOff == null) l.paidOff = m; } bal[l.id] = owed(l); total += owed(l); }
    rows.push({ m, pay, paid, interest: mInt, interestPaid: iPaid, principalPaid: paid - iPaid, bal, total, budget, minsDue, lump });
    m++;
  }
  const done = !ls.some(l => owed(l) >= 0.005);
  const last = rows.length ? rows[rows.length - 1].m : start - 1;
  return { strategy, start, rows, init, initTotal: Object.values(init).reduce((s, v) => s + v, 0), totalInterest, totalPaid, done,
    payoffM: done ? last : null, months: done ? rows.length : null, shortfalls, firstShortfall, unusedTotal,
    loans: ls.map(l => ({ id: l.id, name: l.name, kind: l.kind, idx: l.idx, paidOff: l.paidOff, interest: l.interest, rate: l.rate, min: l.min })) };
}

export function simulateAll(loans, plan, opts) {
  return Object.fromEntries(STRATEGIES.map(s => [s.id, simulate(loans, plan, s.id, opts)]));
}

// Interest owed today (simple daily interest since the balance date). Subsidized federal loans accrue nothing before repayment.
export function dailyInterest(loans, start = nowYM()) {
  return loans.reduce((s, l) => s + ((l.kind === 'fed_sub' && ym(l.repayStart) > start) ? 0 : (+l.balance || 0) * (+l.rate || 0) / 100 / 365), 0);
}

// Split a payment the way servicers do: accrued interest first (simple daily interest since asOf), then principal.
export function splitPayment(loan, amount, dateISO) {
  const days = Math.max(0, (new Date(dateISO) - new Date(loan.asOf || dateISO)) / 864e5);
  const graceSub = loan.kind === 'fed_sub' && loan.repayStart && ym(dateISO.slice(0, 7)) < ym(loan.repayStart);
  const accrued = graceSub ? 0 : (+loan.balance || 0) * (+loan.rate || 0) / 100 / 365 * days;
  const interestDue = (+loan.unpaid || 0) + accrued;
  const toInterest = Math.min(amount, interestDue);
  const toPrincipal = Math.min(amount - toInterest, +loan.balance || 0);
  const r2 = n => Math.round(n * 100) / 100;
  return {
    interest: r2(toInterest), principal: r2(toPrincipal), applied: r2(toInterest + toPrincipal),
    loan: { ...loan, balance: r2((+loan.balance || 0) - toPrincipal), unpaid: r2(interestDue - toInterest), asOf: dateISO > (loan.asOf || '') ? dateISO : loan.asOf },
  };
}

// Moves that cut interest, each tested against the current plan, biggest savings first.
export function interestMoves(loans, plan, strategy, { start = nowYM() } = {}) {
  const base = simulate(loans, plan, strategy, { start });
  const vs = strategy === 'minimum' ? 'avalanche' : strategy;
  const clone = () => JSON.parse(JSON.stringify(plan));
  const moves = [];
  const add = (key, title, detail, p, strat, apply) => {
    const v = simulate(loans, p, strat, { start });
    moves.push({ key, title, detail, result: v, saved: base.totalInterest - v.totalInterest, sooner: (base.months ?? 480) - (v.months ?? 480), apply });
  };
  if (strategy !== 'avalanche') add('avalanche', 'Switch to Avalanche', 'Every extra dollar goes to your highest-rate loan first', plan, 'avalanche', { strategy: 'avalanche' });
  const capLoans = loans.filter(l => l.kind !== 'fed_sub' && ym(l.repayStart) > start && +l.unpaid > 0);
  const built = Math.round(capLoans.reduce((s, l) => s + (+l.unpaid || 0), 0));
  if (built > 0) {
    const firstCap = Math.min(...capLoans.map(l => ym(l.repayStart)));
    const p = clone(); p.lumps = [...(p.lumps || []), { month: ymStr(start), label: 'Built-up interest', amount: built }];
    add('built', `Pay off the $${built.toLocaleString('en-US')} of built-up interest now`, `It's added to your principal in ${ymLabel(firstCap)}, and from then on you pay interest on that interest`, p, vs, { lump: built, label: 'Built-up interest', month: start });
  }
  for (const amt of [100, 250, 500]) { const p = clone(); p.extraMonthly = (+p.extraMonthly || 0) + amt; add(`extra${amt}`, `Add $${amt} a month`, 'A side gig, a raise, or trimming costs', p, vs, { extra: amt }); }
  if ((plan.share ?? 100) < 100) { const p = clone(); p.share = 100; add('share', 'Send all leftover cash to loans', `You're sending ${plan.share}% now`, p, vs, { share: 100 }); }
  if (!plan.autopay) { const p = clone(); p.autopay = true; add('autopay', 'Turn on autopay', 'Most servicers take 0.25% off your rate', p, vs, { autopay: true }); }
  { const p = clone(); p.lumps = [...(p.lumps || []), { month: ymStr(start + 1), label: 'One-time payment', amount: 1000 }]; add('lump1000', 'Make a one-time $1,000 payment', 'A tax refund, a gift, or summer savings', p, vs, { lump: 1000, label: 'One-time payment', month: start + 1 }); }
  const hiPriv = loans.filter(l => l.kind === 'private' && +l.rate > 6.5);
  if (hiPriv.length && !plan.refi?.on) { const p = clone(); p.refi = { on: true, rate: 6.5 }; add('refi', 'Refinance private loans at 6.5%', 'Only if a lender offers it', p, vs, { refi: 6.5 }); }
  return moves.filter(m => m.saved > 0.5).sort((a, b) => b.saved - a.saved);
}

// Total interest and payoff at each extra monthly amount (0 → max), for the "what paying more buys you" curve.
export function extraCurve(loans, plan, strategy, { start = nowYM(), max = 1000, steps = 20 } = {}) {
  const vs = strategy === 'minimum' ? 'avalanche' : strategy;
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const a = Math.round(max * i / steps);
    const r = simulate(loans, { ...plan, extraMonthly: a }, vs, { start });
    out.push({ extra: a, interest: r.totalInterest, payoffM: r.payoffM, months: r.months, done: r.done });
  }
  return out;
}

// Rolls monthly rows up into calendar years: paid, interest paid, principal paid, balance at year end.
export function yearlySummary(rows) {
  const years = [];
  for (const x of rows) {
    const y = Math.floor(x.m / 12);
    let g = years[years.length - 1];
    if (!g || g.year !== y) years.push(g = { year: y, paid: 0, interestPaid: 0, principalPaid: 0, endBalance: 0, rows: [] });
    g.paid += x.paid; g.interestPaid += x.interestPaid; g.principalPaid += x.principalPaid; g.endBalance = x.total; g.rows.push(x);
  }
  return years;
}

// Returns a new plan with a move applied.
export function applyMove(plan, a, { start = nowYM() } = {}) {
  const p = JSON.parse(JSON.stringify(plan));
  if (a.strategy) p.strategy = a.strategy;
  if (a.extra) p.extraMonthly = (+p.extraMonthly || 0) + a.extra;
  if (a.share) p.share = a.share;
  if (a.autopay) p.autopay = true;
  if (a.refi) p.refi = { on: true, rate: a.refi };
  if (a.lump) p.lumps = [...(p.lumps || []), { month: ymStr(a.month ?? start), label: a.label, amount: a.lump }];
  return p;
}
