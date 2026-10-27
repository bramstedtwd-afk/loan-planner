// "Log a payment" sheet: pick the loan, confirm the amount, see the interest/principal split before saving.
import { splitPayment } from '../engine.js';
import { money, esc, todayISO } from '../format.js';
import { openSheet } from './sheet.js';

// planned: { loanId: amount } for this month, used to suggest the loan and amount.
export function openLogPayment({ data, planned = {}, onSave }) {
  const open = data.loans.filter(l => (+l.balance || 0) + (+l.unpaid || 0) > 0.005);
  if (!open.length) return;
  const sorted = [...open].sort((a, b) => (planned[b.id] || 0) - (planned[a.id] || 0) || +b.rate - +a.rate);
  const first = sorted[0];
  openSheet(`
    <form class="form" data-form novalidate>
      <h2>Log a payment</h2>
      <label class="field"><span>Loan</span>
        <select name="loan">${sorted.map(l => `<option value="${esc(l.id)}">${esc(l.name)}${planned[l.id] ? ` · planned ${money(planned[l.id], true)}` : ''}</option>`).join('')}</select></label>
      <div class="field-row">
        <label class="field"><span>Amount</span><input name="amount" type="number" inputmode="decimal" step="0.01" min="0.01" required value="${planned[first.id] ? planned[first.id].toFixed(2) : ''}" autofocus></label>
        <label class="field"><span>Date paid</span><input name="date" type="date" required value="${todayISO()}"></label>
      </div>
      <label class="field"><span>Note <em>optional</em></span><input name="note" type="text" maxlength="120" placeholder="Autopay, extra principal…"></label>
      <p class="split" data-split aria-live="polite"></p>
      <p class="err" data-err hidden></p>
      <div class="sheet-actions"><button class="btn soft" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Log payment</button></div>
    </form>`, {
    label: 'Log a payment',
    onOpen: (sheet, close) => {
      const f = sheet.querySelector('[data-form]'), out = sheet.querySelector('[data-split]'), err = sheet.querySelector('[data-err]');
      const loanOf = () => data.loans.find(l => l.id === f.loan.value);
      const preview = () => {
        const amt = +f.amount.value, l = loanOf();
        if (!(amt > 0) || !f.date.value) { out.textContent = ''; return; }
        const s = splitPayment(l, amt, f.date.value);
        out.innerHTML = `<b>${money(s.interest, true)}</b> to interest · <b>${money(s.principal, true)}</b> to principal${s.applied < amt - 0.004 ? ` · ${money(amt - s.applied, true)} more than you owe` : ''}`;
      };
      f.loan.addEventListener('change', () => { const p = planned[f.loan.value]; if (p) f.amount.value = p.toFixed(2); preview(); });
      f.addEventListener('input', () => { err.hidden = true; preview(); });
      preview();
      f.addEventListener('submit', e => {
        e.preventDefault();
        const amt = +f.amount.value, l = loanOf();
        if (!(amt > 0)) { err.textContent = 'Enter the amount you paid.'; err.hidden = false; f.amount.focus(); return; }
        if (!f.date.value) { err.textContent = 'Pick the date you paid.'; err.hidden = false; return; }
        const s = splitPayment(l, amt, f.date.value);
        const next = JSON.parse(JSON.stringify(data));
        next.loans = next.loans.map(x => x.id === l.id ? s.loan : x);
        next.payments.push({ id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, loanId: l.id, loanName: l.name, date: f.date.value,
          amount: s.applied, interest: s.interest, principal: s.principal, note: f.note.value.trim(), createdAt: new Date().toISOString() });
        close();
        onSave(next, `Logged ${money(s.applied, true)} payment to ${l.name}`, `${money(s.applied, true)} logged · ${money(s.interest, true)} interest, ${money(s.principal, true)} principal`);
      });
    },
  });
}
