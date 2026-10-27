// Reads and writes one file in a GitHub repo through the contents API. Every save is a commit.
// Saves send the sha that was loaded, so GitHub refuses a save based on an outdated copy (code 'conflict').

export const toB64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
export const fromB64 = b64 => { const s = atob(b64.replace(/\s/g, '')); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; };

export class GitHubError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

export class GitHubFile {
  constructor({ owner, repo, path, token, branch = 'main', fetch = globalThis.fetch.bind(globalThis) }) {
    Object.assign(this, { owner, repo, path, token, branch, fetch });
  }

  async req(url, init = {}) {
    let res;
    try {
      res = await this.fetch(`https://api.github.com${url}`, { cache: 'no-store', ...init, headers: {
        Accept: 'application/vnd.github+json', Authorization: `Bearer ${this.token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(init.headers || {}),
      } });
    } catch { throw new GitHubError('offline', 'Couldn’t reach GitHub. Check your connection.'); }
    if (res.ok) return res.status === 204 ? null : res.json();
    const body = await res.json().catch(() => ({}));
    const msg = body.message || res.statusText;
    if (res.status === 401) throw new GitHubError('auth', 'GitHub didn’t accept this key. It may have expired or been revoked.', 401);
    if (res.status === 403 && /rate limit/i.test(msg)) throw new GitHubError('rate', 'GitHub is limiting requests right now. Try again in a few minutes.', 403);
    if (res.status === 403) throw new GitHubError('auth', 'This key can’t change the data repo. Give it “Contents: Read and write”.', 403);
    if (res.status === 404) throw new GitHubError('not_found', msg, 404);
    if (res.status === 409 || (res.status === 422 && /sha/i.test(msg))) throw new GitHubError('conflict', 'Your planner changed somewhere else since this device loaded it.', res.status);
    throw new GitHubError('http', `GitHub error ${res.status}: ${msg}`, res.status);
  }

  get contentsUrl() { return `/repos/${this.owner}/${this.repo}/contents/${this.path.split('/').map(encodeURIComponent).join('/')}`; }

  // Confirms the key can see the repo. Returns { private } on success.
  async check() {
    try { const r = await this.req(`/repos/${this.owner}/${this.repo}`); return { private: !!r.private }; }
    catch (e) { if (e.code === 'not_found') throw new GitHubError('no_repo', `Can’t find ${this.owner}/${this.repo} with this key. Check the name and that the key includes this repo.`, 404); throw e; }
  }

  // Returns { bytes, sha } or null when the file doesn't exist yet.
  async load() {
    let meta;
    try { meta = await this.req(`${this.contentsUrl}?ref=${encodeURIComponent(this.branch)}`); }
    catch (e) { if (e.code === 'not_found') return null; throw e; }
    let b64 = meta.content;
    if (!b64 && meta.size > 0) b64 = (await this.req(`/repos/${this.owner}/${this.repo}/git/blobs/${meta.sha}`)).content; // files over 1 MB
    return { bytes: fromB64(b64 || ''), sha: meta.sha };
  }

  // Commits new contents. Pass the sha you loaded (or null to create). Returns the new sha.
  async save(bytes, sha, message) {
    const r = await this.req(this.contentsUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: toB64(bytes), branch: this.branch, ...(sha ? { sha } : {}) }) });
    return r.content.sha;
  }
}
