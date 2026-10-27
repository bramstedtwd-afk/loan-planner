// Display helpers shared by every screen.
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = (n, cents = false) => {
  const v = Math.abs(n) < 0.005 ? 0 : n;
  return (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
};
export const dur = months => {
  const y = Math.floor(months / 12), m = months % 12;
  return [y ? `${y} year${y > 1 ? 's' : ''}` : '', m ? `${m} month${m > 1 ? 's' : ''}` : ''].filter(Boolean).join(' ') || '0 months';
};
export const pct = r => `${(+r).toFixed(2).replace(/\.?0+$/, '')}%`;
