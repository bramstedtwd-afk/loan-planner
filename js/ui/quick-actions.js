// The + button: the few things you do most, one tap from any screen.
import { openSheet } from './sheet.js';

const ACTIONS = [
  { key: 'log', icon: 'i-send', title: 'Log a payment', sub: 'Record what you sent a servicer' },
  { key: 'income', icon: 'i-money', title: 'Add income', sub: 'A job, internship or side gig' },
  { key: 'cost', icon: 'i-loans', title: 'Add monthly costs', sub: 'Rent, food, phone and the rest' },
  { key: 'lump', icon: 'i-spark', title: 'Add a one-time payment', sub: 'Tax refund, bonus or gift toward loans' },
];

// handlers: { log, income, cost, lump }; actions without a handler are left out.
export function openQuickActions(handlers) {
  const list = ACTIONS.filter(a => handlers[a.key]);
  openSheet(`<div class="form"><h2>Quick add</h2><div class="qa">${list.map(a => `
    <button type="button" data-qa="${a.key}"><span class="qi"><svg class="i"><use href="#${a.icon}"/></svg></span><span><b>${a.title}</b><small>${a.sub}</small></span></button>`).join('')}</div></div>`, {
    label: 'Quick add',
    onOpen: (sheet, close) => sheet.querySelectorAll('[data-qa]').forEach(b => b.addEventListener('click', () => { close(); setTimeout(() => handlers[b.dataset.qa](), 190); })),
  });
}
