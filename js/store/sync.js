// Keeps planner.sqlite in step between this device and GitHub.
// - Every change is written to a local copy first, so nothing is lost offline or on a failed save.
// - Saves are batched (one commit per pause in editing) and always send the last-known sha.
// - If GitHub has a newer version than the one this device started from, sync stops and asks: use theirs, or keep mine.
import { openDb, readAll, writeAll, exportBytes } from './db.js';
import { toB64, fromB64 } from './github.js';

export const STATUS = { LOCAL: 'local', LOADING: 'loading', SAVED: 'saved', SAVING: 'saving', PENDING: 'pending', OFFLINE: 'offline', CONFLICT: 'conflict', ERROR: 'error' };

export class Sync {
  // cache: { get(): obj|null, set(obj) } — a small key/value store (localStorage in the app, a Map in tests)
  constructor({ SQL, remote = null, cache, debounceMs = 1500, onChange = () => {} }) {
    Object.assign(this, { SQL, remote, cache, debounceMs, onChange });
    this.db = null; this.sha = null; this.dirty = false; this.messages = [];
    this.status = STATUS.LOADING; this.error = null; this.savedAt = null; this.conflict = null; this.timer = null;
  }

  set(status, error = null) { this.status = status; this.error = error; this.onChange(this); }
  data() { return readAll(this.db); }

  persist() {
    this.cache.set({ b64: toB64(exportBytes(this.db)), sha: this.sha, dirty: this.dirty, messages: this.messages, savedAt: this.savedAt });
  }

  useBytes(bytes, sha) { this.db?.close?.(); this.db = openDb(this.SQL, bytes); this.sha = sha; }

  async start() {
    const cached = this.cache.get();
    if (cached) { this.useBytes(fromB64(cached.b64), cached.sha); this.dirty = !!cached.dirty; this.messages = cached.messages || []; this.savedAt = cached.savedAt || null; }
    else this.useBytes(null, null);
    if (!this.remote) { this.set(STATUS.LOCAL); return; }
    let remote;
    try { remote = await this.remote.load(); }
    catch (e) { this.set(e.code === 'offline' ? STATUS.OFFLINE : STATUS.ERROR, e); return; }
    if (!remote) { // nothing on GitHub yet: publish what this device has
      if (cached || this.dirty) { this.dirty = true; this.sha = null; this.persist(); await this.flush(); }
      else this.set(STATUS.SAVED);
      return;
    }
    if (this.dirty && cached?.sha === remote.sha) { await this.flush(); return; } // local edits on top of the latest: push them
    if (this.dirty && cached?.sha !== remote.sha) { this.conflict = remote; this.set(STATUS.CONFLICT); return; }
    this.useBytes(remote.bytes, remote.sha); this.dirty = false; this.messages = []; this.savedAt = this.savedAt || new Date().toISOString();
    this.persist(); this.set(STATUS.SAVED);
  }

  // Record a change. `message` becomes part of the commit message.
  commit(data, message) {
    writeAll(this.db, data);
    this.dirty = true; this.messages.push(message);
    this.persist();
    if (!this.remote) { this.set(STATUS.LOCAL); return; }
    if (this.status === STATUS.CONFLICT) return;
    this.set(STATUS.PENDING);
    clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  commitMessage() {
    const m = this.messages.filter(Boolean);
    if (!m.length) return 'Update planner';
    return m.length === 1 ? m[0] : `${m[m.length - 1]} (+${m.length - 1} more change${m.length > 2 ? 's' : ''})\n\n${m.map(x => `- ${x}`).join('\n')}`;
  }

  async flush() {
    clearTimeout(this.timer); this.timer = null;
    if (!this.remote || !this.dirty || this.status === STATUS.CONFLICT || this.saving) return;
    this.saving = true; this.set(STATUS.SAVING);
    try {
      this.sha = await this.remote.save(exportBytes(this.db), this.sha, this.commitMessage());
      this.dirty = false; this.messages = []; this.savedAt = new Date().toISOString();
      this.persist(); this.set(STATUS.SAVED);
    } catch (e) {
      if (e.code === 'conflict') { try { this.conflict = await this.remote.load(); } catch {} this.set(STATUS.CONFLICT, e); }
      else this.set(e.code === 'offline' ? STATUS.OFFLINE : STATUS.ERROR, e);
    } finally { this.saving = false; }
  }

  // After a conflict: 'theirs' loads GitHub's version (dropping this device's unsaved edits); 'mine' saves this device's version over it.
  async resolve(choice) {
    const remote = this.conflict || await this.remote.load();
    this.conflict = null;
    if (choice === 'theirs') {
      this.useBytes(remote?.bytes || null, remote?.sha || null); this.dirty = false; this.messages = [];
      this.persist(); this.set(STATUS.SAVED);
    } else {
      this.sha = remote?.sha || null; this.dirty = true;
      this.messages.push('Kept this device’s version after a conflict');
      this.persist(); this.set(STATUS.PENDING); await this.flush();
    }
  }

  // Retry a failed or offline save (call on 'online' events or a Retry button).
  async retry() { if (this.dirty) { this.status = STATUS.PENDING; await this.flush(); } else if (this.status !== STATUS.CONFLICT) await this.start(); }
}
