// js/ui/store.js — persistence: one IndexedDB key/value store, with a
// localStorage mirror for the settings blob (fast boot) and as a fallback when
// IndexedDB is unavailable (private mode, very old browsers).

const DB_NAME = 'snart-chessbox';
const LEGACY_DB = 'snart-chess-trainer'; // previous name of this app
const DB_VERSION = 2;
const STORE = 'kv';
const GAMES_STORE = 'pgnGames'; // imported PGN database, kept out of the kv blob
const LS_SETTINGS = 'scb.settings.v1';

export const DEFAULT_SETTINGS = {
  // engine
  thinkMs: 400,
  strength: 1600,        // Elo; >=1320 uses UCI_Elo, below uses Skill Level
  spreadCp: 100,         // +/- window in centipawns for random move choice
  spreadWeighting: 'uniform',
  engineRepliesInBook: false, // after the book line ends, keep playing the engine
  // training
  hints: true,
  hintArrows: true,
  autoAdvance: true,
  showLegalMoves: true,
  showEval: true,
  // board
  boardTheme: 'forest',
  pieceSet: 'classic',
  coords: true,
  animate: true,
  autoFlip: false,
  whiteOnBottom: false, // false: the side you play is at the bottom
  playBookRepIds: [], // repertoires the engine plays from in free play
  playBookEnabled: true,
  playSide: 'w',
  playTimeId: 'none',

  // sound
  sound: true,
  volume: 0.6,
  // misc
  username: '',
  reviewDepthMs: 150,
  memoryArrows: true,      // memory study: arrow for the move that was played
  memoryComments: true,    // memory study: show PGN/user comments
  pgnMaxGames: 300,
};

const SETTINGS_VERSION = 1;

function clone(x) { return JSON.parse(JSON.stringify(x)); }

export class Store {
  constructor() {
    this.db = null;
    this.cache = new Map();
    this.memoryOnly = false;
  }

  async open() {
    if (this.db) return this.db;
    if (typeof indexedDB === 'undefined') { this.memoryOnly = true; return null; }
    this.db = await new Promise((resolve) => {
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { resolve(null); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        if (!db.objectStoreNames.contains(GAMES_STORE)) {
          const games = db.createObjectStore(GAMES_STORE, { keyPath: 'id' });
          games.createIndex('whiteLower', 'whiteLower');
          games.createIndex('blackLower', 'blackLower');
          games.createIndex('year', 'year');
          games.createIndex('result', 'result');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
    if (!this.db) this.memoryOnly = true;
    else await this.migrateLegacy();
    return this.db;
  }

  /** Copy data from the pre-rename database once, so a rename loses nothing. */
  async migrateLegacy() {
    try {
      const existing = await new Promise((resolve) => {
        const q = this.db.transaction(STORE, 'readonly').objectStore(STORE).get('settings');
        q.onsuccess = () => resolve(q.result);
        q.onerror = () => resolve(undefined);
      });
      if (existing) return; // already migrated or fresh install with data
      // only open the legacy database when it is actually there (open() creates)
      if (indexedDB.databases) {
        const list = await indexedDB.databases().catch(() => []);
        if (!list.some((d) => d.name === LEGACY_DB)) return;
      }
      const old = await new Promise((resolve) => {
        const req = indexedDB.open(LEGACY_DB);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
        // do not create the legacy database if it is not there
        setTimeout(() => resolve(null), 1500);
      });
      if (!old || !old.objectStoreNames.contains(STORE)) return;
      const keys = Array.from(old.objectStoreNames);
      void keys;
      const records = await new Promise((resolve) => {
        const out = {};
        const tx = old.transaction(STORE, 'readonly');
        const store = tx.objectStore(STORE);
        const all = store.getAllKeys();
        all.onsuccess = () => {
          const ks = all.result || [];
          let left = ks.length;
          if (!left) return resolve(out);
          for (const k of ks) {
            const g = store.get(k);
            g.onsuccess = () => { out[k] = g.result; if (--left === 0) resolve(out); };
            g.onerror = () => { if (--left === 0) resolve(out); };
          }
        };
        all.onerror = () => resolve(out);
      });
      if (!Object.keys(records).length) return;
      const tx = this.db.transaction(STORE, 'readwrite');
      const st = tx.objectStore(STORE);
      for (const [k, v] of Object.entries(records)) if (v !== undefined) st.put(v, k);
      await new Promise((r2) => { tx.oncomplete = r2; tx.onerror = r2; tx.onabort = r2; });
      old.close();
      this.cache.clear();
      console.info('SnartChessBox: migrated data from the previous database');
    } catch (e) {
      /* migration is best-effort; never block boot on it */
    }
  }

  async get(key, fallback = null) {
    if (this.cache.has(key)) return this.cache.get(key);
    let value = fallback;
    if (this.memoryOnly) {
      try {
        const raw = localStorage.getItem('sct.' + key);
        if (raw !== null) value = JSON.parse(raw);
      } catch (e) { /* ignore */ }
    } else {
      await this.open();
      if (!this.db) { this.memoryOnly = true; return this.get(key, fallback); }
      value = await new Promise((resolve) => {
        let req;
        try { req = this.db.transaction(STORE, 'readonly').objectStore(STORE).get(key); }
        catch (e) { resolve(fallback); return; }
        req.onsuccess = () => resolve(req.result === undefined ? fallback : req.result);
        req.onerror = () => resolve(fallback);
      });
    }
    this.cache.set(key, value);
    return value;
  }

  async set(key, value) {
    this.cache.set(key, value);
    if (this.memoryOnly) {
      try { localStorage.setItem('sct.' + key, JSON.stringify(value)); } catch (e) { /* quota */ }
      if (key === 'settings') this.mirrorSettings(value);
      return value;
    }
    await this.open();
    if (!this.db) { this.memoryOnly = true; return this.set(key, value); }
    await new Promise((resolve) => {
      let req;
      try { req = this.db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key); }
      catch (e) { resolve(); return; }
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
    if (key === 'settings') this.mirrorSettings(value);
    return value;
  }

  async del(key) {
    this.cache.delete(key);
    if (this.memoryOnly) { try { localStorage.removeItem('sct.' + key); } catch (e) {} return; }
    await this.open();
    if (!this.db) return;
    await new Promise((resolve) => {
      const req = this.db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  }

  async clearAll() {
    this.cache.clear();
    if (this.memoryOnly) { try { localStorage.clear(); } catch (e) {} return; }
    await this.open();
    if (!this.db) return;
    await new Promise((resolve) => {
      const req = this.db.transaction(STORE, 'readwrite').objectStore(STORE).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  }

  // ---- PGN database records (separate object store; not part of the kv blob)
  async putGameRecords(records) {
    if (!records || !records.length) return;
    await this.open();
    if (!this.db) {
      // fallback: keep them in the kv store so nothing is silently lost
      const cur = await this.get('pgnGamesFallback', []);
      await this.set('pgnGamesFallback', cur.concat(records));
      return;
    }
    await new Promise((resolve) => {
      const tx = this.db.transaction(GAMES_STORE, 'readwrite');
      const st = tx.objectStore(GAMES_STORE);
      for (const r of records) st.put(r);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
      tx.onabort = resolve;
    });
  }

  async getGame(id) {
    await this.open();
    if (!this.db) {
      const all = await this.get('pgnGamesFallback', []);
      return all.find((g) => g.id === id) || null;
    }
    return await new Promise((resolve) => {
      const q = this.db.transaction(GAMES_STORE, 'readonly').objectStore(GAMES_STORE).get(id);
      q.onsuccess = () => resolve(q.result || null);
      q.onerror = () => resolve(null);
    });
  }

  async deleteGameRecords(ids) {
    await this.open();
    if (!this.db) {
      const all = await this.get('pgnGamesFallback', []);
      await this.set('pgnGamesFallback', all.filter((g) => !ids.includes(g.id)));
      return;
    }
    await new Promise((resolve) => {
      const tx = this.db.transaction(GAMES_STORE, 'readwrite');
      const st = tx.objectStore(GAMES_STORE);
      for (const id of ids) st.delete(id);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  }

  async clearGameRecords() {
    await this.open();
    if (!this.db) { await this.set('pgnGamesFallback', []); return; }
    await new Promise((resolve) => {
      const tx = this.db.transaction(GAMES_STORE, 'readwrite');
      tx.objectStore(GAMES_STORE).clear();
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  }

  mirrorSettings(value) {
    try { localStorage.setItem(LS_SETTINGS, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }

  readMirrorSettings() {
    try {
      const raw = localStorage.getItem(LS_SETTINGS);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  /** Deep-merge stored settings over the defaults (unknown keys are kept). */
  static migrateSettings(stored) {
    const out = { ...clone(DEFAULT_SETTINGS), ...(stored || {}) };
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      if (typeof DEFAULT_SETTINGS[k] === 'boolean' && typeof out[k] !== 'boolean') out[k] = DEFAULT_SETTINGS[k];
      if (typeof DEFAULT_SETTINGS[k] === 'number' && !Number.isFinite(out[k])) out[k] = DEFAULT_SETTINGS[k];
    }
    // a saved value that no longer exists (renamed design/theme) must not stick
    if (!['classic', 'outline', 'minimal'].includes(out.pieceSet)) out.pieceSet = DEFAULT_SETTINGS.pieceSet;
    if (!['forest', 'walnut', 'ocean', 'slate', 'midnight', 'paper'].includes(out.boardTheme)) out.boardTheme = DEFAULT_SETTINGS.boardTheme;
    out._v = SETTINGS_VERSION;
    return out;
  }
}

export const store = new Store();
export { SETTINGS_VERSION };
