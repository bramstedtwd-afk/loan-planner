// Settings: connect the private data repo, see sync status, and download backups.
import { esc, ago } from '../format.js';
import { header } from '../ui/layout.js';

export const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

export function renderSettings(view, ctx) {
  const { config, sync } = ctx;
  const connected = !!config.token;
  const statusLine = !connected ? 'Not connected. Your planner is only saved on this device.'
    : sync.status === 'saved' ? `Connected to ${config.owner}/${config.repo}. Last saved ${ago(sync.savedAt) || 'just now'}.`
    : sync.status === 'conflict' ? 'Your planner changed on another device. Choose which version to keep on the Today screen.'
    : sync.error ? sync.error.message : `Connected to ${config.owner}/${config.repo}.`;
  view.innerHTML = `
    ${header({ title: 'Settings', back: true })}
    <section class="card glass rise">
      <div class="card-h"><h2>GitHub sync</h2><span class="badge ${connected && sync.status === 'saved' ? '' : 'warn'}">${connected ? (sync.status === 'saved' ? 'Connected' : 'Needs attention') : 'Not connected'}</span></div>
      <p class="muted" style="margin:0 0 14px">${esc(statusLine)}</p>
      <form class="form" data-connect novalidate>
        <div class="field-row">
          <label class="field"><span>Owner</span><input name="owner" value="${esc(config.owner)}" autocomplete="off" spellcheck="false" required></label>
          <label class="field"><span>Data repo</span><input name="repo" value="${esc(config.repo)}" autocomplete="off" spellcheck="false" required></label>
        </div>
        <label class="field"><span>File</span><input name="path" value="${esc(config.path)}" autocomplete="off" spellcheck="false" required></label>
        <label class="field"><span>Access key <em>fine-grained token, only for the data repo</em></span>
          <input name="token" type="password" autocomplete="off" spellcheck="false" placeholder="${connected ? 'Saved on this device. Paste a new one to replace it' : 'github_pat_…'}"></label>
        <p class="err" data-err hidden></p>
        <div class="sheet-actions" style="justify-content:flex-start">
          <button class="btn primary" type="submit">${connected ? 'Save and reconnect' : 'Connect'}</button>
          ${connected ? '<button class="btn soft" type="button" data-sync-now>Sync now</button><button class="btn soft danger" type="button" data-forget>Forget key on this device</button>' : ''}
        </div>
      </form>
      <details class="help">
        <summary>How to make the access key</summary>
        <ol>
          <li>Open <a href="${TOKEN_URL}" target="_blank" rel="noopener">GitHub → New fine-grained token</a>.</li>
          <li>Name it “Loan Payoff app”. Set an expiration you’re comfortable with (a year is fine).</li>
          <li>Repository access: <b>Only select repositories</b> → choose <b>${esc(config.repo)}</b>.</li>
          <li>Permissions → Repository permissions → <b>Contents: Read and write</b>. Leave everything else off.</li>
          <li>Generate, copy it, and paste it above. GitHub only shows it once; it never needs to go anywhere else.</li>
        </ol>
      </details>
    </section>
    <section class="card glass rise">
      <div class="card-h"><h2>Backups</h2></div>
      <p class="muted" style="margin:0 0 14px">Every save is already a commit in your data repo, so you can roll back to any version. These give you a copy on this device too.</p>
      <div class="sheet-actions" style="justify-content:flex-start">
        <button class="btn soft" type="button" data-dl-db>Download planner.sqlite</button>
        <button class="btn soft" type="button" data-dl-json>Export data (.json)</button>
      </div>
    </section>`;

  const f = view.querySelector('[data-connect]'), err = view.querySelector('[data-err]');
  f.addEventListener('submit', async e => {
    e.preventDefault(); err.hidden = true;
    const cfg = { owner: f.owner.value.trim(), repo: f.repo.value.trim(), path: f.path.value.trim(), token: f.token.value.trim() || config.token };
    if (!cfg.owner || !cfg.repo || !cfg.path) { err.textContent = 'Fill in the owner, repo and file.'; err.hidden = false; return; }
    if (!cfg.token) { err.textContent = 'Paste your access key.'; err.hidden = false; f.token.focus(); return; }
    const btn = f.querySelector('[type=submit]'); btn.disabled = true; btn.textContent = 'Connecting…';
    try { await ctx.onConnect(cfg); }
    catch (x) { err.textContent = x.message; err.hidden = false; btn.disabled = false; btn.textContent = connected ? 'Save and reconnect' : 'Connect'; }
  });
  view.querySelector('[data-back]').addEventListener('click', ctx.onClose);
  view.querySelector('[data-sync-now]')?.addEventListener('click', ctx.onSyncNow);
  const forget = view.querySelector('[data-forget]');
  forget?.addEventListener('click', () => {
    if (!forget.dataset.armed) { forget.dataset.armed = '1'; forget.textContent = 'Tap again to forget the key'; return; }
    ctx.onForget();
  });
  view.querySelector('[data-dl-db]').addEventListener('click', ctx.onDownloadDb);
  view.querySelector('[data-dl-json]').addEventListener('click', ctx.onExportJson);
}
