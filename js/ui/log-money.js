// "Log money in/out" and the Sunday balance check-in. Logging never changes a bank balance; the check-in is what confirms them.
import { money, esc, todayISO } from '../format.js';
import { openSheet } from './sheet.js';
import { formSheet } from './form-sheet.js';
import { balances, applyCheckin, UNLOGGED, oddThreshold, explainGap, recurringDue } from '../tracker.js';
import { cashFlow, nowYM, WEEKS_PER_MONTH } from '../engine.js';

// entry: an existing logged transaction to edit, or null for a new one. dir: 'out' or 'in' for a new one.
export function openLogMoney({ data, save, entry = null, dir = 'out' }) {
  const cats = data.plan.categories || { out: ['Other'], in: ['Other'] };
  const e = entry || { dir, amount: '', category: '', date: todayISO(), note: '' };
  const isUnlogged = String(e.kind || '').startsWith('unlogged');
  const options = d => (cats[d] || []).map(c => `<option ${c === e.category ? 'selected' : ''}>${esc(c)}</option>`).join('');
  openSheet(`
    <form class="form" data-form novalidate>
      <h2>${entry ? (isUnlogged ? 'Unlogged difference' : 'Edit entry') : 'Log money in/out'}</h2>
      ${isUnlogged ? `<p class="muted" style="margin:-6px 0 0">${esc(e.note)}. If you remember what it was, log it as its own entry and lower this one.</p>` : ''}
      <div class="seg" role="radiogroup" aria-label="Direction">
        <label><input type="radio" name="dir" value="out" ${e.dir !== 'in' ? 'checked' : ''}><span>Money out</span></label>
        <label><input type="radio" name="dir" value="in" ${e.dir === 'in' ? 'checked' : ''}><span>Money in</span></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Amount</span><span class="affix"><b>$</b><input name="amount" type="number" inputmode="decimal" step="0.01" min="0.01" required value="${e.amount}" autofocus></span></label>
        <label class="field"><span>Date</span><input name="date" type="date" required value="${esc(e.date)}"></label>
      </div>
      ${isUnlogged ? '' : `<label class="field"><span>Category</span><select name="category">${options(e.dir === 'in' ? 'in' : 'out')}</select></label>`}
      <label class="field"><span>Note <em>optional</em></span><input name="note" type="text" maxlength="80" value="${isUnlogged ? '' : esc(e.note)}" placeholder="Groceries, Venmo from Sam…"></label>
      <p class="muted small" style="margin:0">Your bank balance stays as you last confirmed it; this moves the estimate until Sunday’s check-in.</p>
      <p class="err" data-err hidden></p>
      <div class="sheet-actions">
        ${entry ? '<button class="btn soft danger" type="button" data-delete style="margin-right:auto">Delete</button>' : ''}
        <button class="btn soft" type="button" data-close>Cancel</button><button class="btn primary" type="submit">${entry ? 'Save' : 'Log it'}</button>
      </div>
    </form>`, {
    label: 'Log money in or out',
    onOpen: (sheet, close) => {
      const f = sheet.querySelector('[data-form]'), err = sheet.querySelector('[data-err]');
      f.querySelectorAll('input[name="dir"]').forEach(r => r.addEventListener('change', () => { if (f.category) f.category.innerHTML = options(f.dir.value); }));
      f.addEventListener('input', () => { err.hidden = true; });
      f.addEventListener('submit', ev => {
        ev.preventDefault();
        const amount = Math.round(+f.amount.value * 100) / 100;
        if (!(amount > 0)) { err.textContent = 'Enter an amount.'; err.hidden = false; f.amount.focus(); return; }
        if (!f.date.value) { err.textContent = 'Pick a date.'; err.hidden = false; return; }
        const item = { ...e, id: e.id || `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, amount, dir: f.dir.value, date: f.date.value,
          category: isUnlogged ? UNLOGGED : f.category.value, note: isUnlogged ? e.note : f.note.value.trim(), kind: e.kind || 'logged', createdAt: e.createdAt || new Date().toISOString() };
        const list = entry ? data.transactions.map(t => t.id === e.id ? item : t) : [...data.transactions, item];
        close();
        save({ ...data, transactions: list }, `${entry ? 'Edited' : 'Logged'} ${item.dir === 'in' ? 'money in' : 'money out'}: ${money(amount, true)} ${item.category}`,
          `${item.dir === 'in' ? '+' : '−'}${money(amount, true)} ${item.category} ${entry ? 'saved' : 'logged'}`);
      });
      const del = sheet.querySelector('[data-delete]');
      del?.addEventListener('click', () => {
        if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = 'Tap again to delete'; return; }
        close(); save({ ...data, transactions: data.transactions.filter(t => t.id !== e.id) }, `Deleted ${e.category} ${money(+e.amount, true)} (${e.date})`, 'Entry deleted');
      });
    },
  });
}

// Confirm what's really in each bank account. The gap from the estimate becomes one "Unlogged" entry.
export function openCheckin({ data, save }) {
  const b = balances(data);
  if (!b.hasBank) return;
  const today = todayISO();
  formSheet({
    title: 'Update your balances',
    intro: `Open your bank app and enter what’s there now. ${b.asOf ? `Since ${b.asOf} you logged ${money(b.inSince, true)} in and ${money(b.outSince, true)} out, so the estimate is <b>${money(b.estimated, true)}</b>.` : 'This is your first check-in.'}`,
    fields: [
      ...b.banks.map(a => ({ name: `a_${a.id}`, label: a.name, hint: `last ${money(+a.balance || 0, true)}`, type: 'number', value: '', prefix: '$', min: 0, step: 0.01, required: true, half: b.banks.length > 1 })),
      { name: 'date', label: 'As of', type: 'date', value: today, required: true, half: true },
    ],
    footer: '<p class="split" data-gap></p>',
    onInput: (v, sheet) => {
      const vals = b.banks.map(a => v[`a_${a.id}`]);
      const out = sheet.querySelector('[data-gap]');
      if (vals.some(x => x === '')) { out.textContent = ''; return; }
      const real = vals.reduce((s, x) => s + +x, 0), gap = real - b.estimated;
      out.innerHTML = !b.asOf ? `Total <b>${money(real, true)}</b>.`
        : Math.abs(gap) < 0.5 ? `Total <b>${money(real, true)}</b>, right on the estimate.`
        : `Total <b>${money(real, true)}</b>: ${money(Math.abs(gap), true)} ${gap < 0 ? 'less' : 'more'} than estimated. It’s saved as an <b>Unlogged ${gap < 0 ? 'out' : 'in'}</b> for this week.`;
    },
    submitLabel: 'Confirm balances',
    onSubmit: v => {
      const realById = Object.fromEntries(b.banks.map(a => [a.id, +v[`a_${a.id}`]]));
      const r = applyCheckin(data, realById, v.date);
      save(r.data, `Balance check-in ${v.date}: ${money(r.real, true)}${Math.abs(r.gap) >= 0.5 ? ` (unlogged ${r.gap < 0 ? '−' : '+'}${money(Math.abs(r.gap), true)})` : ''}`,
        Math.abs(r.gap) >= 0.5 ? `Balances confirmed · ${money(Math.abs(r.gap), true)} unlogged ${r.gap < 0 ? 'out' : 'in'}` : 'Balances confirmed');
      // an odd gap asks right away what it was
      const u = r.data.transactions.find(t => t.kind === 'unlogged' && t.date === v.date);
      if (u && u.amount >= oddThresholdFor(r.data)) setTimeout(() => openExplain({ data: r.data, save, id: u.id }), 260);
    },
  });
}

// The odd-balance threshold for this plan: $75, or 10% of a typical week's money in and out, whichever is bigger.
export function oddThresholdFor(data) {
  const cf = cashFlow(data.plan || {}, nowYM());
  return oddThreshold(cf.income / WEEKS_PER_MONTH, (cf.costs + cf.oneTime) / WEEKS_PER_MONTH);
}

// Explain an Unlogged amount: split it into categories. What's left stays Unlogged, or you accept it as is.
export function openExplain({ data, save, id }) {
  const u = (data.transactions || []).find(t => t.id === id);
  if (!u) return;
  const cats = (data.plan.categories || {})[u.dir] || ['Other'];
  const due = recurringDue(data, todayISO()).filter(x => x.r.dir === u.dir);
  formSheet({
    title: `What was the ${money(u.amount, true)}?`,
    intro: `Your real balance on ${u.date} was ${money(u.amount, true)} ${u.dir === 'out' ? 'lower' : 'higher'} than the estimate.${due.length ? ` Unconfirmed: ${due.map(x => `${x.r.label} (${x.due})`).join(', ')}; confirm those in Spending if they explain it.` : ''} Split it into what it was; anything you leave stays Unlogged.`,
    fields: [
      ...cats.map(c => ({ name: `c_${c}`, label: c, type: 'number', value: '', prefix: '$', min: 0, step: 0.01, half: true })),
      { name: 'rest', label: 'Whatever’s left', type: 'segmented', value: 'keep', options: [['keep', 'Ask me again'], ['accept', 'It’s fine, keep as Unlogged']] },
    ],
    footer: '<p class="split" data-left></p>',
    onInput: (v, sheet) => {
      const used = cats.reduce((s, c) => s + (+v[`c_${c}`] || 0), 0);
      sheet.querySelector('[data-left]').innerHTML = used > u.amount + 0.004 ? `That’s <b>${money(used - u.amount, true)}</b> more than the gap.` : `<b>${money(u.amount - used, true)}</b> left unexplained.`;
    },
    submitLabel: 'Save',
    onSubmit: v => {
      const splits = Object.fromEntries(cats.map(c => [c, +v[`c_${c}`] || 0]));
      if (Object.values(splits).reduce((s, x) => s + x, 0) > u.amount + 0.004) return 'The parts add up to more than the gap.';
      save(explainGap(data, id, splits, { accept: v.rest === 'accept' }), `Explained ${money(u.amount, true)} from the ${u.date} check-in`, 'Saved');
    },
  });
}
