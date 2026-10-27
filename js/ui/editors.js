// Add/edit sheets for income, monthly costs, planned one-time costs and one-time payments. Shared by the Wealth screen and the + quick actions.
import { ym, ymStr, ymLabel, toMonthly } from '../engine.js';
import { money, todayISO } from '../format.js';
import { formSheet } from './form-sheet.js';
import { ACCOUNT_KINDS } from '../wealth.js';

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
      ],
      submitLabel: isNew ? 'Add' : 'Save',
      onSubmit: v => {
        const item = { ...s, id: s.id || `c${Date.now().toString(36)}`, label: v.label, amount: +v.amount, month: v.month, paidOn: s.paidOn || '' };
        const list = isNew ? [...planned, item] : planned.map((x, k) => k === i ? item : x);
        setList('planned', list, `${isNew ? 'Planned' : 'Updated'}: ${item.label} ${money(item.amount)} in ${ymLabel(ym(item.month))}`, `${item.label} ${isNew ? 'planned' : 'saved'}`);
      },
      onDelete: isNew ? null : () => setList('planned', planned.filter((_, k) => k !== i), `Removed planned cost: ${s.label}`, `${s.label} removed`),
    });
  };
  // Paying it: record the date and take it out of the bank account it came from, so the cushion stays right.
  const markPlannedPaid = i => {
    const s = planned[i], banks = accounts.filter(a => a.kind === 'bank');
    formSheet({
      title: `Paid ${s.label}`,
      fields: [
        { name: 'amount', label: 'Amount paid', type: 'number', value: s.amount, prefix: '$', min: 0, step: 0.01, required: true, half: true },
        { name: 'date', label: 'Paid on', type: 'date', value: todayISO(), required: true, half: true },
        ...(banks.length ? [{ name: 'from', label: 'Paid from', hint: 'lowers that balance', type: 'select', value: banks.length === 1 ? banks[0].id : '',
          options: [['', 'Don’t change any balance'], ...banks.map(a => [a.id, `${a.name} · ${money(+a.balance || 0)}`])] }] : []),
      ],
      submitLabel: 'Mark paid',
      onSubmit: v => {
        const item = { ...s, amount: +v.amount, paidOn: v.date };
        const nextAccounts = v.from ? accounts.map(a => a.id === v.from ? withHistory(a, Math.round(((+a.balance || 0) - +v.amount) * 100) / 100, v.date) : a) : accounts;
        save({ ...data, accounts: nextAccounts, plan: { ...plan, planned: planned.map((x, k) => k === i ? item : x) } },
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

  return { editIncome, editCost, editLump, editPlanned, markPlannedPaid, editAccount, updateBalance, pickAccountToUpdate, INC_PRESETS, COST_PRESETS };
}
