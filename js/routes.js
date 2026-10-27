// Every screen, which tab it belongs to, and redirects from older links.
export const TABS = ['today', 'plan', 'wealth', 'loans'];

export const ROUTES = {
  today: { tab: 'today', title: 'Today' },
  plan: { tab: 'plan', title: 'Plan' },
  wealth: { tab: 'wealth', title: 'Wealth' },
  loans: { tab: 'loans', title: 'Loans' },
  activity: { tab: 'loans', title: 'Activity' },
  settings: { tab: null, title: 'Settings' },
};

const ALIASES = { '': 'today', money: 'wealth', history: 'activity' };

export function resolveRoute(hash) {
  const asked = String(hash || '').replace(/^#/, '');
  let key = asked in ALIASES ? ALIASES[asked] : asked;
  if (!(key in ROUTES)) key = 'today';
  return { key, ...ROUTES[key], redirected: asked !== '' && asked !== key };
}
