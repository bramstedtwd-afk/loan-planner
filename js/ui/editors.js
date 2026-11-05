// Add/edit sheets for income, monthly costs, planned one-time costs and one-time payments. Shared by the Wealth screen and the + quick actions.
import { ym, ymStr, ymLabel, toMonthly, activeIn } from '../engine.js';
import { money, todayISO } from '../format.js';
import { formSheet } from './form-sheet.js';
import { openSheet } from './sheet.js';
import { ACCOUNT_KINDS } from '../wealth.js';
import { applyCheckin } from '../tracker.js';

export const INC_KINDS = { part: 'Part-time', intern: 'Internship', full: 'Full-time', other: 'Other' };

export function makeEditors({ data, save, start }) {
  const plan = data.plan;
  const g = ym(plan.gradMonth) ?? start + 12;
  const setList = (key, list, message, toastMsg) => save({ ...data, plan: { ...plan, [key]: list } }, message, toastMsg);

  const summer = (() => { const y = Math.floor(start / 12) + (start % 12 >= 4 ? 1 : 0); return [ymStr(y * 12 + 4), ymStr(y * 12 + 7)]; })();
  const INC_PRESETS = {
    part: { label: 'Part-time job', kind: 'part', per: 'week', start: ymStr(start), end: ymStr(g) },
    intern: { label: 'Summer internship', kind: 'intern', per: 'week', start: summer[0], end: summer[1] },
    full: { label: 'Full-time job', kind: 'full', per: 'week', start: ymStr(g + 1), end: '' },
    other: { label: '', kind: 'other', per: 'month', start: ymStr(start), end: '' },
  };
  const COST_PRESETS = {
    now: { label: 'Current monthly costs', start: ymStr(start), end: ymStr(g) },
    post: { label: 'After-graduation costs', start: ymStr(g + 1), end: '' },
    other: { label: '', start: ymStr(start), end: '' },
  };

  const editIncome = (i, preset = { ...INC_PRESETS.other, amount: '' }) => {
    const isNew = i == null, s = isNew ? preset : plan.incomes[i];
    formSheet({
      title: isNew ? 'Add income' : 'Edit income',
      fields: [
        { name: 'label', label: 'Name', value: s.label, required: true, maxlength: 50, placeholder: 'Campus job' },
        { name: 'kind', label: 'Type', type: 'segmented', value: s.kind || 'other', options: Object.entries(INC_KINDS) },
        { name: 'amount', label: 'Take-home pay', type: 'number', value: s.amount, prefix: '$', min: 0, step: 1, required: true, half: true },
        { name: 'per', label: 'Paid per', type: 'segmented', value: s.per || 'week', options: [['week', 'Week'], ['month', 'Month']], half: true },
        { name: 'start', label: 'Starts', type: 'month', value: s.start, required: true, half: true },
        { name: 'end', label: 'Ends', hint: 'blank = ongoing', type: 'month', value: s.end, half: true },
      ],
      footer: '<p class="split" data-monthly></p>',
      onInput: (v, sheet) => { sheet.querySelector('[data-monthly]').innerHTML = v.amount > 0 ? `That’s about <b>${money(toMonthly(v))}</b> a month.` : ''; },
      submitLabel: isNew ? 'Add income' : 'Save',
      onSubmit: v => {
        if (v.end && ym(v.end) < ym(v.start)) return 'The end month is before the start month.';
        const item = { label: v.label, kind: v.kind, amount: +v.amount, per: v.per, start: v.start, end: v.end };
        const list = isNew ? [...plan.incomes, item] : plan.incomes.map((x, k) => k === i ? item : x);
        setList('incomes', list, `${isNew ? 'Added' : 'Updated'} income: ${item.label} ${money(item.amount)}/${item.per}`, `${item.label} ${isNew ? 'added' : 'saved'}`);
      },
      onDelete: isNew ? null : () => setList('incomes', plan.incomes.filter((_, k) => k !== i), `Removed income: ${s.label}`, `${s.label} removed`),
    });
  };

  const editCost = (i, preset = { ...COST_PRESETS.other, amount: '' }) => {
    const isNew = i == null, s = isNew ? preset : plan.expenses[i];
    formSheet({
      title: isNew ? 'Add monthly costs' : 'Edit monthly costs',
      fields: [
        { name: 'label', label: 'Name', value: s.label, required: true, maxlength: 50, placeholder: 'Rent and food' },
        { name: 'amount', label: 'Per month', type: 'number', value: s.amount, prefix: '$', min: 0, step: 1, required: true },
        { name: 'start', label: 'Starts', type: 'month', value: s.start, required: true, half: true },
        { name: 'end', label: 'Ends', hint: 'blank = ongoing', type: 'month', value: s.end, half: true },
      ],
      submitLabel: isNew ? 'Add costs' : 'Save',
      onSubmit: v => {
        if (v.end && ym(v.end) < ym(v.start)) return 'The end month is before the start month.';
        const item = { label: v.label, amount: +v.amount, start: v.start, end: v.end };
        const list = isNew ? [...plan.expenses, item] : plan.expenses.map((x, k) => k === i ? item : x);
        setList('expenses', list, `${isNew ? 'Added' : 'Updated'} costs: ${item.label} ${money(item.amount)}/mo`, `${item.label} ${isNew ? 'added' : 'saved'}`);
      },
      onDelete: isNew ? null : () => setList('expenses', plan.expenses.filter((_, k) => k !== i), `Removed costs: ${s.label}`, `${s.label} removed`),
    });
  };

  const editLump = i => {
    const isNew = i == null, s = isNew ? { label: '', month: ymStr(start + 5), amount: '' } : plan.lumps[i];
    formSheet({
      title: isNew ? 'Add a one-time payment' : 'Edit one-time payment',
      fields: [
        { name: 'label', label: 'What is it', value: s.label, required: true, maxlength: 50, placeholder: 'Tax refund' },
        { name: 'amount', label: 'Amount', type: 'number', value: s.amount, prefix: '$', min: 1, step: 1, required: true, half: true },
        { name: 'month', label: 'Month', type: 'month', value: s.month, required: true, half: true },
      ],
      submitLabel: isNew ? 'Add' : 'Save',
      onSubmit: v => {
        const item = { label: v.label, amount: +v.amount, month: v.month };
        const list = isNew ? [...plan.lumps, item] : plan.lumps.map((x, k) => k === i ? item : x);
        setList('lumps', list, `${isNew ? 'Added' : 'Updated'} one-time payment: ${item.label} ${money(item.amount)} in ${ymLabel(ym(item.month))}`, `${item.label} ${isNew ? 'added' : 'saved'}`);
      },
      onDelete: isNew ? null : () => setList('lumps', plan.lumps.filter((_, k) => k !== i), `Removed one-time payment: ${s.label}`, `${s.label} removed`),
    });
  };

  // planned one-time costs: tuition or anything else you'll pay out of pocket in a known month
  const planned = plan.planned || [];
  const editPlanned = i => {
    const isNew = i == null, s = isNew ? { label: '', month: ymStr(start + 2), amount: '' } : planned[i];
    formSheet({
      title: isNew ? 'Plan a one-time cost' : 'Edit planned cost',
      intro: isNew ? 'Something you’ll pay out of pocket in a known month, like a semester’s tuition. The app keeps enough cash aside for it before suggesting any extra loan payments.' : '',
      fields: [
        { name: 'label', label: 'What is it', value: s.label, required: true, maxlength: 50, placeholder: 'Spring semester' },
        { name: 'amount', label: 'Amount', type: 'number', value: s.amount, prefix: '$', min: 1, step: 1, required: true, half: true },
        { name: 'month', label: 'Due', type: 'month', value: s.month, required: true, half: true },
        { name: 'estimate', label: 'How sure', type: 'segmented', value: s.estimate ? 'est' : 'ok', options: [['ok', 'Confirmed'], ['est', 'Estimate']] },
      ],
      submitLabel: isNew ? 'Add' : 'Save',
      onSubmit: v => {
        const item = { ...s, id: s.id || `c${Date.now().toString(36)}`, label: v.label, amount: +v.amount, month: v.month, paidOn: s.paidOn || '', estimate: v.estimate === 'est' };
        const list = isNew ? [...planned, item] : planned.map((x, k) => k === i ? item : x);
        setList('planned', list, `${isNew ? 'Planned' : 'Updated'}: ${item.label} ${money(item.amount)} in ${ymLabel(ym(item.month))}`, `${item.label} ${isNew ? 'planned' : 'saved'}`);
      },
      onDelete: isNew ? null : () => setList('planned', planned.filter((_, k) => k !== i), `Removed planned cost: ${s.label}`, `${s.label} removed`),
    });
  };
  // budgets: the four monthly budgets are the current monthly costs, so saving them updates the costs the plan uses
  const BUDGET_CATS = ['Housing', 'Personal monthly', 'Food', 'Fun'];
  const editBudgets = () => {
    const b = plan.spendBudgets || {}, nowIdx = plan.expenses.findIndex(x => activeIn(x, start));
    formSheet({
      title: 'Monthly budgets',
      intro: `These add up to your monthly costs${nowIdx >= 0 ? ` (“${plan.expenses[nowIdx].label}”)` : ''}, so changing one updates the plan, verdict and charts.`,
      fields: BUDGET_CATS.map(c => ({ name: c, label: c, type: 'number', value: b[c] ?? '', prefix: '$', min: 0, step: 5, half: true })),
      footer: '<p class="split" data-total></p>',
      onInput: (v, sheet) => { sheet.querySelector('[data-total]').innerHTML = `Total <b>${money(BUDGET_CATS.reduce((s, c) => s + (+v[c] || 0), 0))}</b> a month`; },
      submitLabel: 'Save budgets',
      onSubmit: v => {
        const spendBudgets = Object.fromEntries(BUDGET_CATS.map(c => [c, +v[c] || 0])), total = Object.values(spendBudgets).reduce((s, x) => s + x, 0);
        const expenses = nowIdx >= 0 ? plan.expenses.map((x, k) => k === nowIdx ? { ...x, amount: total } : x) : plan.expenses;
        const cats = plan.categories || { out: [], in: [] };
        const out = [...new Set([...BUDGET_CATS.filter(c => spendBudgets[c] > 0), ...cats.out])];
        save({ ...data, plan: { ...plan, spendBudgets, expenses, categories: { ...cats, out } } }, `Budgets: ${BUDGET_CATS.map(c => `${c} ${money(spendBudgets[c])}`).join(', ')} = ${money(total)}/mo`, `Budgets saved · ${money(total)} a month`);
      },
    });
  };

  // recurring entries: the paycheck and rent that come due on their own and need one tap to confirm
  const recurring = data.recurring || [];
  const CAD = [['biweekly', 'Every 2 weeks'], ['monthly-last', 'Last day of month'], ['monthly', 'Same day monthly'], ['weekly', 'Weekly']];
  const editRecurring = (i, preset = { dir: 'out', cadence: 'monthly-last', anchor: todayISO(), amount: '', label: '', category: '' }) => {
    const isNew = i == null, r = isNew ? preset : recurring[i], cats = plan.categories || { out: ['Other'], in: ['Other'] };
    formSheet({
      title: isNew ? 'Add a recurring entry' : `Edit ${r.label}`,
      intro: 'When it comes due, Spending shows it so you confirm it with one tap (or change the amount, or skip it).',
      fields: [
        { name: 'label', label: 'Name', value: r.label, required: true, maxlength: 40, placeholder: 'Rent' },
        { name: 'dir', label: 'Money', type: 'segmented', value: r.dir, options: [['out', 'Out'], ['in', 'In']] },
        { name: 'amount', label: 'Usual amount', type: 'number', value: r.amount, prefix: '$', min: 0, step: 0.01, required: true, half: true },
        { name: 'category', label: 'Category', type: 'select', value: r.category, options: [...new Set([...cats.out, ...cats.in, r.category].filter(Boolean))].map(c => [c, c]), half: true },
        { name: 'cadence', label: 'How often', type: 'select', value: r.cadence, options: CAD, half: true },
        { name: 'anchor', label: 'First (or next) date', type: 'date', value: r.anchor, required: true, half: true },
        { name: 'variable', label: 'Amount', type: 'segmented', value: r.variable ? 'varies' : 'fixed', options: [['fixed', 'Fixed'], ['varies', 'Varies: ask me each time']] },
        ...(isNew ? [] : [{ name: 'active', label: 'Status', type: 'segmented', value: r.active === false ? 'off' : 'on', options: [['on', 'Active'], ['off', 'Stopped']] }]),
      ],
      submitLabel: isNew ? 'Add' : 'Save',
      onSubmit: v => {
        const item = { ...r, id: r.id || `rc${Date.now().toString(36)}`, label: v.label, dir: v.dir, amount: +v.amount, category: v.category, cadence: v.cadence, anchor: v.anchor, variable: v.variable === 'varies', active: v.active !== 'off' };
        const list = isNew ? [...recurring, item] : recurring.map((x, k) => k === i ? item : x);
        save({ ...data, recurring: list }, `${isNew ? 'Added' : 'Updated'} recurring: ${item.label} ${money(item.amount)}`, `${item.label} ${isNew ? 'added' : 'saved'}`);
      },
      onDelete: isNew ? null : () => save({ ...data, recurring: recurring.filter((_, k) => k !== i) }, `Removed recurring: ${r.label}`, `${r.label} removed`),
    });
  };

  // one Add button for the whole money plan
  const addAnything = () => openSheet(`<div class="form"><h2>Add to your money plan</h2><div class="qa">${[
    ['inc', 'Income', 'A job, internship or other pay'], ['exp', 'Monthly costs', 'For a stretch of months'], ['rec', 'Recurring entry', 'Paycheck, rent or a bill to confirm when due'],
    ['planned', 'Planned cost', 'Tuition or anything due in a known month'], ['loan', 'Future loan', 'A loan you expect to take'], ['lump', 'One-time payment', 'Refund or gift toward loans'],
  ].map(([k, t, sub]) => `<button type="button" data-add-kind="${k}"><span><b>${t}</b><small>${sub}</small></span></button>`).join('')}</div></div>`, {
    label: 'Add to your money plan',
    onOpen: (sheet, close) => sheet.querySelectorAll('[data-add-kind]').forEach(b => b.addEventListener('click', () => { close(); setTimeout(() => ({
      inc: () => editIncome(null), exp: () => editCost(null), rec: () => editRecurring(null), planned: () => editPlanned(null), lump: () => editLump(null), loan: () => { location.hash = '#loans'; },
    })[b.dataset.addKind](), 190); })),
  });

  // Paying it: record the date. It shows in Spending and lowers the estimated balance; the real one waits for the check-in.
  const markPlannedPaid = i => {
    const s = planned[i];
    formSheet({
      title: `Paid ${s.label}`,
      fields: [
        { name: 'amount', label: 'Amount paid', type: 'number', value: s.amount, prefix: '$', min: 0, step: 0.01, required: true, half: true },
        { name: 'date', label: 'Paid on', type: 'date', value: todayISO(), required: true, half: true },
      ],
      submitLabel: 'Mark paid',
      onSubmit: v => {
        const item = { ...s, amount: +v.amount, paidOn: v.date };
        save({ ...data, plan: { ...plan, planned: planned.map((x, k) => k === i ? item : x) } },
          `Paid ${item.label}: ${money(item.amount, true)} (${v.date})`, `${item.label} marked paid`);
      },
    });
  };

  // accounts: every balance change also records a dated history entry
  const accounts = data.accounts || [];
  const withHistory = (a, balance, date) => ({ ...a, balance, updatedAt: date, history: [...(a.history || []).filter(h => h.date !== date), { date, balance }].sort((x, y) => x.date.localeCompare(y.date)) });
  const setAccounts = (list, message, toastMsg) => save({ ...data, accounts: list }, message, toastMsg);

  const editAccount = (i, kind = 'bank') => {
    const isNew = i == null, a = isNew ? { kind, name: '', institution: '', balance: '', rate: '', minPayment: '' } : accounts[i];
    formSheet({
      title: isNew ? `Add ${ACCOUNT_KINDS[a.kind]?.label.toLowerCase() || 'an account'}` : `Edit ${a.name}`,
      fields: [
        { name: 'name', label: 'Name', value: a.name, required: true, maxlength: 50, placeholder: a.kind === 'debt' ? 'Credit card' : a.kind === 'brokerage' ? 'Robinhood' : a.kind === 'retirement' ? 'Roth IRA' : 'Checking' },
        { name: 'kind', label: 'Type', type: 'select', value: a.kind, options: Object.entries(ACCOUNT_KINDS).map(([k, v]) => [k, v.label]), half: true },
        { name: 'institution', label: 'Bank or company', value: a.institution, maxlength: 50, half: true },
        { name: 'balance', label: a.kind === 'debt' ? 'Amount owed' : 'Balance', type: 'number', value: a.balance, prefix: '$', min: 0, step: 0.01, required: true, half: true },
        { name: 'rate', label: 'Interest rate', hint: 'debts', type: 'number', value: a.rate || '', suffix: '%', min: 0, max: 60, step: 0.01, half: true },
        { name: 'minPayment', label: 'Monthly minimum', hint: 'debts', type: 'number', value: a.minPayment || '', prefix: '$', min: 0, step: 0.01, half: true },
        { name: 'notes', label: 'Notes', value: a.notes, maxlength: 120, half: true },
      ],
      submitLabel: isNew ? 'Add account' : 'Save',
      onSubmit: v => {
        const today = todayISO();
        let acct = { ...a, name: v.name, kind: v.kind, institution: v.institution, rate: +v.rate || 0, minPayment: +v.minPayment || 0, notes: v.notes, source: a.source || 'manual' };
        if (isNew) { acct.id = `a${Date.now().toString(36)}`; acct.order = Math.max(0, ...accounts.map(x => x.order ?? 0)) + 1; }
        acct = (isNew || +v.balance !== +a.balance) ? withHistory(acct, +v.balance, today) : { ...acct, balance: +v.balance };
        const list = isNew ? [...accounts, acct] : accounts.map((x, k) => k === i ? acct : x);
        setAccounts(list, isNew ? `Added account ${acct.name}: ${money(acct.balance, true)}` : `Updated account ${acct.name}`, isNew ? `${acct.name} added` : `${acct.name} saved`);
      },
      onDelete: isNew ? null : () => setAccounts(accounts.filter((_, k) => k !== i), `Removed account ${a.name}`, `${a.name} removed`),
    });
  };

  const updateBalance = i => {
    const a = accounts[i];
    formSheet({
      title: `Update ${a.name}`,
      intro: `Last updated ${a.updatedAt || 'never'} at ${money(+a.balance || 0, true)}.`,
      fields: [
        { name: 'balance', label: a.kind === 'debt' ? 'Amount owed today' : 'Balance today', type: 'number', value: a.balance, prefix: '$', min: 0, step: 0.01, required: true, half: true },
        { name: 'date', label: 'As of', type: 'date', value: todayISO(), required: true, half: true },
      ],
      footer: '<p class="split" data-delta></p>',
      onInput: (v, sheet) => { const d = (+v.balance || 0) - (+a.balance || 0); sheet.querySelector('[data-delta]').innerHTML = Math.abs(d) >= 0.01 ? `<b>${d > 0 ? '+' : '−'}${money(Math.abs(d), true)}</b> since last update` : ''; },
      submitLabel: 'Update',
      onSubmit: v => {
        // A bank balance is a check-in: any gap from the estimate is recorded as Unlogged, the same as on Sunday.
        if (a.kind === 'bank') {
          const r = applyCheckin(data, { [a.id]: +v.balance }, v.date);
          return save(r.data, `Balance ${a.name}: ${money(+v.balance, true)} (${v.date})${Math.abs(r.gap) >= 0.5 ? `, unlogged ${r.gap < 0 ? '−' : '+'}${money(Math.abs(r.gap), true)}` : ''}`, `${a.name} updated`);
        }
        const acct = withHistory(a, +v.balance, v.date);
        setAccounts(accounts.map((x, k) => k === i ? acct : x), `Balance ${a.name}: ${money(+v.balance, true)} (${v.date})`, `${a.name} updated`);
      },
    });
  };

  const pickAccountToUpdate = () => {
    if (!accounts.length) return editAccount(null, 'bank');
    formSheet({
      title: 'Update a balance',
      fields: [{ name: 'acct', label: 'Account', type: 'select', value: '0', options: accounts.map((a, k) => [String(k), `${a.name} · ${money(+a.balance || 0)}`]) }],
      submitLabel: 'Next',
      onSubmit: v => { setTimeout(() => updateBalance(+v.acct), 200); },
    });
  };

  return { editIncome, editCost, editLump, editPlanned, markPlannedPaid, editBudgets, editRecurring, addAnything, editAccount, updateBalance, pickAccountToUpdate, INC_PRESETS, COST_PRESETS };
}
