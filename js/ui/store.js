// js/ui/store.js — persistence: one IndexedDB key/value store, with a
// localStorage mirror for the settings blob (fast boot) and as a fallback when
// IndexedDB is unavailable (private mode, very old browsers).

const DB_NAME = 'snart-chess-trainer';
const DB_VERSION = 1;
const STORE = 'kv';
const LS_SETTINGS = 'sct.settings.v1';

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
  // sound
  sound: true,
  volume: 0.6,
  // misc
  username: '',
  reviewDepthMs: 150,
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
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
    if (!this.db) this.memoryOnly = true;
    return this.db;
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
    out._v = SETTINGS_VERSION;
    return out;
  }
}

export const store = new Store();
export { SETTINGS_VERSION };
