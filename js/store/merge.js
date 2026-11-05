// Three-way merge of two versions of the planner: what this device has (mine), what GitHub has (theirs), and the version
// both started from (base). Every change from either side is kept; only when both changed the very same item does this
// device win (and that's reported). With no base (older devices), it's a union: nothing either side has is dropped.
// Pure: works on the app's data shape, so it's tested without a database.

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// One value: whoever changed it from the base wins; if both did, mine does.
function pick(b, m, t, path, clashes) {
  if (same(m, b)) return t;
  if (same(t, b) || same(m, t)) return m;
  clashes.push(path);
  return m;
}

// A list of records, matched by key. Additions and deletions from both sides are kept.
function mergeList(b = [], m = [], t = [], keyOf, path, clashes) {
  const map = list => new Map(list.map(x => [keyOf(x), x]));
  const B = map(b), M = map(m), T = map(t);
  const keys = [...T.keys(), ...[...M.keys()].filter(k => !T.has(k))];
  const out = [];
  for (const k of keys) {
    const v = pick(B.get(k), M.get(k), T.get(k), `${path}: ${k}`, clashes);
    if (v !== undefined) out.push(v);
  }
  return out;
}

const KEYS = {
  loans: x => x.id, payments: x => x.id, scenarios: x => x.id, accounts: x => x.id, transactions: x => x.id,
  checkins: x => x.date, recurring: x => x.id,
};
// lists inside the plan; incomes, costs and one-time payments have no ids, so they're matched by what they are
const PLAN_LISTS = {
  planned: x => x.id, incomes: x => `${x.label}|${x.start}`, expenses: x => `${x.label}|${x.start}`, lumps: x => `${x.label}|${x.month}`,
};
const LABEL = { loans: 'Loan', payments: 'Payment', scenarios: 'Scenario', accounts: 'Account', transactions: 'Entry', checkins: 'Check-in',
  recurring: 'Recurring', planned: 'Planned cost', incomes: 'Income', expenses: 'Monthly costs', lumps: 'One-time payment' };

export function merge3(base, mine, theirs) {
  const b = base || {}, clashes = [];
  const out = {};
  for (const [k, keyOf] of Object.entries(KEYS)) out[k] = mergeList(b[k], mine[k], theirs[k], keyOf, LABEL[k], clashes);
  const bp = b.plan || {}, mp = mine.plan || {}, tp = theirs.plan || {};
  const plan = {};
  for (const k of new Set([...Object.keys(mp), ...Object.keys(tp)])) {
    if (PLAN_LISTS[k]) plan[k] = mergeList(bp[k], mp[k], tp[k], PLAN_LISTS[k], LABEL[k], clashes);
    else if (k === 'dismissed' || k === 'spendBudgets') { // small objects: merge key by key
      const o = {};
      for (const kk of new Set([...Object.keys(mp[k] || {}), ...Object.keys(tp[k] || {})])) {
        const v = pick(bp[k]?.[kk], mp[k]?.[kk], tp[k]?.[kk], `${k}.${kk}`, clashes);
        if (v !== undefined) o[kk] = v;
      }
      plan[k] = o;
    } else plan[k] = pick(bp[k], mp[k], tp[k], `Setting ${k}`, clashes);
  }
  out.plan = plan;
  return { data: out, clashes };
}
