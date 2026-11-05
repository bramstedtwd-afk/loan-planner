// Keeps planner.sqlite in step between this device and GitHub.
// - Every change is written to a local copy first, so nothing is lost offline or on a failed save.
// - Saves are batched (one commit per pause in editing) and always send the last-known sha.
// - If GitHub has a newer version than the one this device started from, both are merged (store/merge.js): changes
//   from either side are kept, and only an item both changed takes this device's version. Then it saves the merge.
import { openDb, readAll, writeAll, exportBytes } from './db.js';
import { toB64, fromB64 } from './github.js';
import { merge3 } from './merge.js';

export const STATUS = { LOCAL: 'local', LOADING: 'loading', SAVED: 'saved', SAVING: 'saving', PENDING: 'pending', OFFLINE: 'offline', CONFLICT: 'conflict', ERROR: 'error' };

export class Sync {
  // cache: { get(): obj|null, set(obj) } — a small key/value store (localStorage in the app, a Map in tests)
  constructor({ SQL, remote = null, cache, debounceMs = 1500, onChange = () => {} }) {
    Object.assign(this, { SQL, remote, cache, debounceMs, onChange });
    this.db = null; this.sha = null; this.base = null; this.dirty = false; this.messages = [];
    this.status = STATUS.LOADING; this.error = null; this.savedAt = null; this.conflict = null; this.timer = null; this.lastMerge = null;
  }

  set(status, error = null) { this.status = status; this.error = error; this.onChange(this); }
  data() { return readAll(this.db); }

  // base: the bytes this device last agreed on with GitHub (what a merge compares both sides against)
  persist() {
    this.cache.set({ b64: toB64(exportBytes(this.db)), sha: this.sha, base: this.base ? toB64(this.base) : null, dirty: this.dirty, messages: this.messages, savedAt: this.savedAt });
  }

  useBytes(bytes, sha) { this.db?.close?.(); this.db = openDb(this.SQL, bytes); this.sha = sha; }
  readBytes(bytes) { const d = openDb(this.SQL, bytes); try { return readAll(d); } finally { d.close?.(); } }

  async start() {
    const cached = this.cache.get();
    if (cached) {
      this.useBytes(fromB64(cached.b64), cached.sha); this.dirty = !!cached.dirty; this.messages = cached.messages || []; this.savedAt = cached.savedAt || null;
      this.base = cached.base ? fromB64(cached.base) : (cached.dirty ? null : exportBytes(this.db));
    } else this.useBytes(null, null);
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
    if (this.dirty) { await this.mergeWith(remote); return; } // local edits on an older copy: merge, then push
    this.useBytes(remote.bytes, remote.sha); this.base = remote.bytes; this.dirty = false; this.messages = []; this.savedAt = this.savedAt || new Date().toISOString();
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
    let conflicted = false;
    try {
      const bytes = exportBytes(this.db);
      this.sha = await this.remote.save(bytes, this.sha, this.commitMessage());
      this.base = bytes; this.dirty = false; this.messages = []; this.savedAt = new Date().toISOString();
      this.persist(); this.set(STATUS.SAVED);
    } catch (e) {
      if (e.code === 'conflict') conflicted = true;
      else this.set(e.code === 'offline' ? STATUS.OFFLINE : STATUS.ERROR, e);
    } finally { this.saving = false; }
    if (conflicted) { // GitHub moved on while we were editing: merge with it and try again
      let remote;
      try { remote = await this.remote.load(); } catch (e) { this.set(e.code === 'offline' ? STATUS.OFFLINE : STATUS.ERROR, e); return; }
      await this.mergeWith(remote);
    }
  }

  // Merge this device's edits into GitHub's newer version, then save the result on top of it.
  async mergeWith(remote) {
    try {
      const base = this.base ? this.readBytes(this.base) : null;
      const { data, clashes } = merge3(base, this.data(), this.readBytes(remote.bytes));
      this.useBytes(remote.bytes, remote.sha); this.base = remote.bytes;
      writeAll(this.db, data);
      this.lastMerge = { at: new Date().toISOString(), clashes };
      this.messages.push(`Merged with changes from another device${clashes.length ? `; both changed, kept this device’s: ${clashes.join(', ')}` : ''}`);
      this.dirty = true; this.persist(); this.set(STATUS.PENDING);
    } catch (e) { this.conflict = remote; this.set(STATUS.CONFLICT, e); return; } // couldn't merge: ask (Today shows the choice)
    await this.flush();
  }

  // Only if a merge ever fails: 'theirs' loads GitHub's version (dropping this device's unsaved edits); 'mine' merges as a union.
  async resolve(choice) {
    const remote = this.conflict || await this.remote.load();
    this.conflict = null;
    if (choice === 'theirs') {
      this.useBytes(remote?.bytes || null, remote?.sha || null); this.base = remote?.bytes || null; this.dirty = false; this.messages = [];
      this.persist(); this.set(STATUS.SAVED);
    } else {
      this.base = null; this.set(STATUS.PENDING); await this.mergeWith(remote);
    }
  }

  // Retry a failed or offline save (call on 'online' events or a Retry button).
  async retry() { if (this.dirty) { this.status = STATUS.PENDING; await this.flush(); } else if (this.status !== STATUS.CONFLICT) await this.start(); }
}
