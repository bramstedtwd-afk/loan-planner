// Temporary data source until the GitHub/SQLite store lands (step 2).
// Order: this browser's saved copy, then a git-ignored local-data.json for development, then nothing.
const KEY = 'loanPayoff.data.v1';

export async function loadLocal() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved?.loans) return { data: saved, source: 'browser' };
  } catch {}
  try {
    const res = await fetch('local-data.json', { cache: 'no-store' });
    if (res.ok) return { data: await res.json(), source: 'dev' };
  } catch {}
  return { data: null, source: 'none' };
}

export function saveLocal(data) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...data, savedAt: new Date().toISOString() })); return true; } catch { return false; }
}
