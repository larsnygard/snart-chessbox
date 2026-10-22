// js/ui/pgndb.js — the PGN database layer: several named databases, each with
// its own games, importable/exportable as PGN (optionally zipped).
//
// Storage: game records live in their own IndexedDB store (`pgnGames`), the
// compact metadata for every database in one kv key (`pgnMeta`, tagged with
// `dbId`), and the database list in `pgnDbs`. Search therefore never touches the
// big records — only the games you open are deserialised.

import { store } from './store.js';
import { splitGames, parseGame, buildPGN, ratingsFrom, ratingInRange } from '../core/pgn.js';
import { sanToUci, START_FEN } from '../core/chessutil.js';
import {
  positionKey, normaliseFen, matchPly,
  hashKey, gamePositionHashes, indexOffsets, lookupHashes,
} from '../core/possearch.js';
import { createZip, readZipTexts } from '../core/zip.js';

const META_KEY = 'pgnMeta';
const DBS_KEY = 'pgnDbs';
const ACTIVE_KEY = 'scb.pgnDb';
const POS_VERSION = 1;
const posKey = (dbId) => `posIdx:${dbId}`;
export const DEFAULT_DB = 'main';

let meta = null;
let dbs = null;
let importing = false;

export function isImporting() { return importing; }

function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export const dbOf = (m) => m.dbId || DEFAULT_DB;

// ---------------------------------------------------------------- databases
export async function loadDatabases(force = false) {
  if (dbs && !force) return dbs;
  dbs = (await store.get(DBS_KEY, null)) || null;
  if (!dbs || !dbs.length) {
    dbs = [{ id: DEFAULT_DB, name: 'Main database', created: Date.now() }];
    await store.set(DBS_KEY, dbs);
  }
  return dbs;
}

export async function databases() {
  const list = await loadDatabases();
  const all = await loadMeta();
  return list.map((d) => ({ ...d, count: all.filter((m) => dbOf(m) === d.id).length }));
}

export function activeDbId() {
  try {
    const v = localStorage.getItem(ACTIVE_KEY);
    if (v && (dbs || []).some((d) => d.id === v)) return v;
  } catch (e) { /* ignore */ }
  return (dbs && dbs[0] && dbs[0].id) || DEFAULT_DB;
}

export async function setActiveDb(id) {
  await loadDatabases();
  try { localStorage.setItem(ACTIVE_KEY, id); } catch (e) { /* ignore */ }
  return id;
}

export async function activeDb() {
  const list = await databases();
  const id = activeDbId();
  return list.find((d) => d.id === id) || list[0];
}

export async function createDatabase(name, { activate = true } = {}) {
  await loadDatabases();
  const entry = { id: 'db_' + hash(String(name) + Date.now()), name: name || 'New database', created: Date.now() };
  dbs = dbs.concat([entry]);
  await store.set(DBS_KEY, dbs);
  if (activate) await setActiveDb(entry.id);
  return entry;
}

export async function renameDatabase(id, name) {
  await loadDatabases();
  const entry = dbs.find((d) => d.id === id);
  if (!entry) return null;
  entry.name = name || entry.name;
  await store.set(DBS_KEY, dbs);
  return entry;
}

export async function deleteDatabase(id) {
  await loadDatabases();
  if (dbs.length <= 1) throw new Error('Keep at least one database');
  const all = await loadMeta();
  const ids = all.filter((m) => dbOf(m) === id).map((m) => m.id);
  if (ids.length) await store.deleteGameRecords(ids);
  meta = all.filter((m) => dbOf(m) !== id);
  dbs = dbs.filter((d) => d.id !== id);
  await dropPositionIndex(id).catch(() => {});
  await store.set(META_KEY, meta);
  await store.set(DBS_KEY, dbs);
  if (activeDbId() === id) await setActiveDb(dbs[0].id);
  return { removed: ids.length };
}

// ---------------------------------------------------------------- metadata
export async function loadMeta(force = false) {
  if (meta && !force) return meta;
  meta = (await store.get(META_KEY, [])) || [];
  return meta;
}

export function metaCached() { return meta || []; }

export function countInDb(dbId) {
  return (meta || []).filter((m) => dbOf(m) === dbId).length;
}

// ---------------------------------------------------------------- import
export async function importPGNText(text, { source = '', dbId = null, onProgress = null, chunk = 150, max = 200000 } = {}) {
  if (importing) throw new Error('An import is already running');
  importing = true;
  try {
    const target = dbId || activeDbId();
    const raws = splitGames(String(text || ''));
    if (!raws.length) return { added: 0, skipped: 0, duplicates: 0, total: 0 };
    const all = await loadMeta();
    const existing = new Set(all.filter((m) => dbOf(m) === target).map((m) => m.key));
    const metaByKey = new Map(all.filter((m) => dbOf(m) === target).map((m) => [m.key, m]));
    const newMeta = [];
    const indexEntries = [];
    let added = 0, skipped = 0, duplicates = 0, rated = 0;
    let batch = [];
    for (let i = 0; i < raws.length && added < max; i++) {
      let parsed;
      try { parsed = parseGame(raws[i]); } catch (e) { skipped++; continue; }
      if (!parsed.moves.length || parsed.errors.length) { skipped++; continue; }
      const key = `${parsed.headers.White || ''}|${parsed.headers.Black || ''}|${(parsed.headers.Date || '').slice(0, 4)}|${parsed.moves.join(' ')}`;
      const elo = ratingsFrom(parsed.headers);
      if (existing.has(key)) {
        // Same game, imported again — most often an older PGN of this collection
        // without Elo headers. Backfill the ratings instead of dropping them.
        const row = metaByKey.get(key);
        if (row) {
          let touched = false;
          if (elo.whiteElo && row.whiteElo !== elo.whiteElo) { row.whiteElo = elo.whiteElo; touched = true; }
          if (elo.blackElo && row.blackElo !== elo.blackElo) { row.blackElo = elo.blackElo; touched = true; }
          if (touched) rated++;
        }
        duplicates++;
        continue;
      }
      existing.add(key);
      const year = parseInt((parsed.headers.Date || '').slice(0, 4), 10) || 0;
      const id = `${target}_${hash(key)}`;
      const record = {
        id, key, dbId: target,
        white: parsed.headers.White || '?',
        black: parsed.headers.Black || '?',
        whiteLower: (parsed.headers.White || '').toLowerCase(),
        blackLower: (parsed.headers.Black || '').toLowerCase(),
        event: parsed.headers.Event || '',
        eventLower: (parsed.headers.Event || '').toLowerCase(),
        site: parsed.headers.Site || '',
        date: parsed.headers.Date || '',
        year, round: parsed.headers.Round || '',
        result: parsed.result || '*',
        eco: parsed.headers.ECO || '',
        whiteElo: elo.whiteElo,
        blackElo: elo.blackElo,
        moves: parsed.moves,
        startFen: parsed.startFen,
        source, added: Date.now(),
      };
      batch.push(record);
      newMeta.push({
        id, key, dbId: target,
        white: record.white, black: record.black,
        whiteLower: record.whiteLower, blackLower: record.blackLower,
        event: record.event, eventLower: record.eventLower,
        year, result: record.result, eco: record.eco, plies: parsed.moves.length, source,
        whiteElo: elo.whiteElo, blackElo: elo.blackElo,
      });
      if (parsed.posHashes && parsed.posHashes.length) indexEntries.push({ id, hashes: parsed.posHashes });
      added++;
      if (batch.length >= chunk) {
        await store.putGameRecords(batch);
        batch = [];
        if (onProgress) onProgress(i + 1, raws.length, added);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    if (batch.length) await store.putGameRecords(batch);
    meta = all.concat(newMeta);
    await store.set(META_KEY, meta);
    // a database that already has a position index gets the new games appended, so
    // the next search stays instant instead of rebuilding
    let indexed = false;
    try { indexed = await appendToPositionIndex(target, indexEntries); } catch (e) { indexed = false; }
    if (onProgress) onProgress(raws.length, raws.length, added);
    return { added, skipped, duplicates, rated, indexed, total: raws.length };
  } finally {
    importing = false;
  }
}

// ---------------------------------------------------------------- search
export async function searchGames(opts = {}) {
  const all = await loadMeta();
  const {
    dbId = null, player = '', whitePlayer = '', blackPlayer = '',
    event = '', yearFrom = 0, yearTo = 9999, result = '', eco = '',
    whiteEloFrom = 0, whiteEloTo = 0, blackEloFrom = 0, blackEloTo = 0,
    minPlies = 0, limit = 100, offset = 0, sort = 'year',
  } = opts;
  const target = dbId || activeDbId();
  const split = (v) => String(v || '').toLowerCase().split(/[,;]/).map((t) => t.trim()).filter(Boolean);
  const terms = split(player);
  const wTerms = split(whitePlayer);
  const bTerms = split(blackPlayer);
  const ev = String(event).toLowerCase().trim();
  const filtered = all.filter((m) => {
    if (dbOf(m) !== target) return false;
    if (terms.length) {
      const hit = terms.some((t) => m.whiteLower.includes(t) || m.blackLower.includes(t));
      if (!hit) return false;
    }
    if (wTerms.length && !wTerms.some((t) => (m.whiteLower || '').includes(t))) return false;
    if (bTerms.length && !bTerms.some((t) => (m.blackLower || '').includes(t))) return false;
    if (ev && !(m.eventLower || '').includes(ev)) return false;
    if (m.year < yearFrom || m.year > yearTo) return false;
    if (result && m.result !== result) return false;
    if (eco && !(m.eco || '').toUpperCase().startsWith(eco.toUpperCase())) return false;
    if (minPlies && m.plies < minPlies) return false;
    if (!ratingInRange(m.whiteElo, whiteEloFrom, whiteEloTo)) return false;
    if (!ratingInRange(m.blackElo, blackEloFrom, blackEloTo)) return false;
    return true;
  });
  if (sort === 'year') filtered.sort((a, b) => (b.year || 0) - (a.year || 0));
  else if (sort === 'white') filtered.sort((a, b) => a.whiteLower.localeCompare(b.whiteLower));
  else if (sort === 'plies') filtered.sort((a, b) => b.plies - a.plies);
  return { total: filtered.length, games: filtered.slice(offset, offset + limit) };
}

/**
 * Games that reach a position: the cheap metadata filters run first, then every
 * surviving game is replayed and compared ply by ply (js/core/possearch.js).
 * Returns `{ ok, reason, total, scanned, games }` — `games` rows carry `ply`, the
 * half-move at which the position first appears.
 */
// ---------------------------------------------------------------- position index
//
// A FEN cannot say which move order produced it, so a naive position search has to
// replay every game (~110 s for 10,000 games with chess.js). The index does that
// once, at import time or on the first search, and keeps one 32-bit hash per
// position per game: searching then costs a table lookup. This is how SCID feels
// instant on the same collection.

/** { v, dbId, ids: string[], counts: number[], hashes: Uint32Array } or null. */
export async function readPositionIndex(dbId = null) {
  const target = dbId || activeDbId();
  const raw = await store.get(posKey(target), null);
  if (!raw || raw.v !== POS_VERSION || raw.dbId !== target) return null;
  if (!(raw.hashes instanceof Uint32Array) || !Array.isArray(raw.ids)) return null;
  return raw;
}

export async function positionIndexInfo(dbId = null) {
  const idx = await readPositionIndex(dbId);
  return idx ? { games: idx.ids.length, positions: idx.hashes.length } : null;
}

export async function dropPositionIndex(dbId = null) {
  await store.del(posKey(dbId || activeDbId()));
}

/** Walk every game of a database and hash the positions it passes through. */
async function buildPositionIndex(dbId, { onProgress = null, batch = 120 } = {}) {
  const rows = (await loadMeta()).filter((m) => dbOf(m) === dbId);
  const ids = [];
  const counts = [];
  const chunks = [];
  let done = 0;
  for (let i = 0; i < rows.length; i += batch) {
    const slice = rows.slice(i, i + batch);
    const records = await store.getGameRecords(slice.map((m) => m.id));
    const byId = new Map(records.map((r) => [r.id, r]));
    for (const m of slice) {
      const rec = byId.get(m.id);
      if (!rec) continue;
      const hashes = gamePositionHashes(rec.startFen || START_FEN, rec.moves || []);
      if (!hashes.length) continue;
      ids.push(m.id);
      counts.push(hashes.length);
      chunks.push(hashes);
      done++;
    }
    if (onProgress) onProgress(Math.min(i + batch, rows.length), rows.length, done);
    await new Promise((r) => setTimeout(r, 0));
  }
  const total = counts.reduce((a, b) => a + b, 0);
  const hashes = new Uint32Array(total);
  let at = 0;
  for (const chunk of chunks) { hashes.set(chunk, at); at += chunk.length; }
  const index = { v: POS_VERSION, dbId, ids, counts, hashes };
  await store.set(posKey(dbId), index);
  return index;
}

/** Build the index if the database has none (one-time, resumable by the caller). */
export async function ensurePositionIndex(dbId = null, { onBuildProgress = null } = {}) {
  const target = dbId || activeDbId();
  const existing = await readPositionIndex(target);
  if (existing) return { index: existing, built: false };
  const index = await buildPositionIndex(target, { onProgress: onBuildProgress });
  return { index, built: true };
}

/** Add the games of a fresh import to an existing index (no rebuild needed). */
async function appendToPositionIndex(dbId, entries) {
  const idx = await readPositionIndex(dbId);
  if (!idx || !entries.length) return false;
  const extra = entries.reduce((n, e) => n + e.hashes.length, 0);
  const hashes = new Uint32Array(idx.hashes.length + extra);
  hashes.set(idx.hashes, 0);
  let at = idx.hashes.length;
  for (const e of entries) { hashes.set(e.hashes, at); at += e.hashes.length; }
  const next = {
    v: POS_VERSION,
    dbId,
    ids: idx.ids.concat(entries.map((e) => e.id)),
    counts: idx.counts.concat(entries.map((e) => e.hashes.length)),
    hashes,
  };
  await store.set(posKey(dbId), next);
  return true;
}

/**
 * Games that reach a position. Instant when the index exists (built once, then a
 * hash lookup); falls back to the budgeted replay scan if the index cannot be read
 * or written (quota, private mode).
 */
export async function searchPosition(fen, opts = {}) {
  const target = positionKey(normaliseFen(fen) || '');
  if (!target) return { ok: false, reason: 'bad-fen', done: true, total: 0, scanned: 0, candidateCount: 0, nextIndex: 0, games: [] };
  if (importing) return { ok: false, reason: 'busy', done: true, total: 0, scanned: 0, candidateCount: 0, nextIndex: 0, games: [] };
  const {
    limit = 200000, dbId = null, onBuildProgress = null, onProgress = null,
    startIndex = 0, budgetMs = 8000, batch = 150, maxScan = 40000,
  } = opts;
  const database = dbId || activeDbId();

  // every other filter still applies; the index only answers "which games"
  const candidates = (await searchGames({ ...opts, limit: 1000000, offset: 0 })).games.slice(0, maxScan);

  let index = null;
  let built = false;
  try {
    const ensured = await ensurePositionIndex(database, { onBuildProgress });
    index = ensured.index;
    built = ensured.built;
  } catch (e) {
    index = null; // fall through to the replay scan below
  }

  if (index) {
    const offsets = indexOffsets(index.counts);
    const hits = lookupHashes(index.hashes, offsets, index.counts, hashKey(target));
    const wanted = new Map();
    for (const hit of hits) {
      const id = index.ids[hit.game];
      if (id) wanted.set(id, hit.ply);
    }
    const matches = [];
    const verifyBudget = limit + 20;
    let verified = 0;
    for (const m of candidates) {
      if (!wanted.has(m.id)) continue;
      const ply = wanted.get(m.id);
      // a 32-bit hash can collide; confirm the rows we are about to show
      if (verified < verifyBudget) {
        verified++;
        const rec = await store.getGame(m.id);
        const real = rec ? matchPly(target, rec.startFen || START_FEN, rec.moves || []) : -1;
        if (real < 0) continue;
        matches.push({ ...m, ply: real });
        continue;
      }
      matches.push({ ...m, ply });
    }
    return {
      ok: true, done: true, built, indexed: true,
      total: matches.length, scanned: candidates.length,
      candidateCount: candidates.length, nextIndex: candidates.length,
      positions: index.hashes.length, gamesIndexed: index.ids.length,
      games: matches.slice(0, limit),
    };
  }

  // ---- fallback: replay the candidates in budgeted steps (no index available)
  const matches = [];
  const started = Date.now();
  const from = Math.max(0, Math.min(startIndex, candidates.length));
  let processed = from;
  for (let i = from; i < candidates.length; i += batch) {
    const slice = candidates.slice(i, i + batch);
    const records = await store.getGameRecords(slice.map((m) => m.id));
    const byId = new Map(records.map((r) => [r.id, r]));
    for (const m of slice) {
      const rec = byId.get(m.id);
      if (!rec) continue;
      const ply = matchPly(target, rec.startFen || START_FEN, rec.moves || []);
      if (ply >= 0) matches.push({ ...m, ply });
    }
    processed = Math.min(i + slice.length, candidates.length);
    if (onProgress) onProgress(processed, candidates.length, matches.length);
    await new Promise((r) => setTimeout(r, 0));
    if (Date.now() - started > budgetMs) break;
  }
  const done = processed >= candidates.length;
  return {
    ok: true, done, built: false, indexed: false,
    scanned: processed, candidateCount: candidates.length,
    nextIndex: done ? candidates.length : processed,
    total: matches.length, capped: candidates.length >= maxScan,
    games: matches.slice(0, limit),
  };
}

export async function getGame(id) { return store.getGame(id); }

// ---------------------------------------------------------------- export
export async function exportRowsPGN(rows) {
  const parts = [];
  for (const m of rows) {
    const g = await getGame(m.id);
    if (!g) continue;
    parts.push(buildPGN({
      headers: {
        Event: g.event, Site: g.site, Date: g.date, Round: g.round,
        White: g.white, Black: g.black, Result: g.result, ECO: g.eco,
        // meta rows are the newer copy (a re-import backfills ratings there)
        WhiteElo: m.whiteElo || g.whiteElo || '', BlackElo: m.blackElo || g.blackElo || '',
      },
      moves: g.moves, result: g.result, startFen: g.startFen,
    }));
  }
  return parts.join('\n');
}

export async function exportPGN(rows) { return exportRowsPGN(rows); }

/** PGN text for a whole database, assembled in chunks. */
export async function exportDatabasePGN(dbId = null) {
  const target = dbId || activeDbId();
  const rows = (await loadMeta()).filter((m) => dbOf(m) === target);
  const parts = [];
  for (let i = 0; i < rows.length; i += 200) {
    parts.push(await exportRowsPGN(rows.slice(i, i + 200)));
    await new Promise((r) => setTimeout(r, 0));
  }
  const db = (await databases()).find((d) => d.id === target);
  return { name: db ? db.name : 'database', count: rows.length, pgn: parts.filter(Boolean).join('\n') };
}

/** One zip: `<database>.pgn` plus a manifest. */
export async function exportDatabaseZip(dbId = null) {
  const target = dbId || activeDbId();
  const { name, count, pgn } = await exportDatabasePGN(target);
  const safe = name.replace(/[^\w.-]+/g, '-').slice(0, 40) || 'database';
  const zip = await createZip([
    { name: `${safe}.pgn`, data: pgn },
    {
      name: 'manifest.json',
      data: JSON.stringify({
        app: 'SnartChessBox', kind: 'pgn-database', database: name,
        games: count, exportedAt: new Date().toISOString(), format: 1,
      }, null, 1),
    },
  ]);
  return { zip, filename: `${safe}.zip`, count, name };
}

/** Read a .zip containing one or more .pgn files. */
export async function readDatabaseZip(bytes) {
  const files = await readZipTexts(bytes, '.pgn');
  if (!files.length) throw new Error('No .pgn file inside that zip');
  return files;
}

// ---------------------------------------------------------------- copy / move
export async function copyGamesToDatabase(rows, targetDbId, { source = 'copied' } = {}) {
  const all = await loadMeta();
  const existing = new Set(all.filter((m) => dbOf(m) === targetDbId).map((m) => m.key));
  const records = [];
  const newMeta = [];
  for (const m of rows) {
    const g = await getGame(m.id);
    if (!g) continue;
    if (existing.has(m.key)) continue;
    existing.add(m.key);
    const id = `${targetDbId}_${hash(m.key)}`;
    const rec = { ...g, id, dbId: targetDbId, source, added: Date.now() };
    records.push(rec);
    newMeta.push({
      id, key: m.key, dbId: targetDbId,
      white: rec.white, black: rec.black, whiteLower: rec.whiteLower, blackLower: rec.blackLower,
      event: rec.event, eventLower: rec.eventLower, year: rec.year,
      result: rec.result, eco: rec.eco, plies: (rec.moves || []).length, source,
      whiteElo: rec.whiteElo || m.whiteElo || 0, blackElo: rec.blackElo || m.blackElo || 0,
    });
  }
  if (records.length) {
    await store.putGameRecords(records);
    meta = all.concat(newMeta);
    await store.set(META_KEY, meta);
    await dropPositionIndex(targetDbId).catch(() => {}); // rebuilt on the next search
  }
  return records.length;
}

/** Copy a result set into a brand-new database. */
export async function createDatabaseFromRows(rows, name) {
  const db = await createDatabase(name, { activate: false });
  const copied = await copyGamesToDatabase(rows, db.id, { source: 'from search' });
  return { db, copied };
}

// ---------------------------------------------------------------- misc
export async function deleteAllGames(dbId = null) {
  const target = dbId || activeDbId();
  await dropPositionIndex(target).catch(() => {});
  const all = await loadMeta();
  const ids = all.filter((m) => dbOf(m) === target).map((m) => m.id);
  if (ids.length) await store.deleteGameRecords(ids);
  meta = all.filter((m) => dbOf(m) !== target);
  await store.set(META_KEY, meta);
}

export async function deleteGames(ids) {
  const gone = new Set(ids);
  const affected = new Set((await loadMeta()).filter((m) => gone.has(m.id)).map((m) => dbOf(m)));
  await store.deleteGameRecords(ids);
  meta = (await loadMeta()).filter((m) => !ids.includes(m.id));
  await store.set(META_KEY, meta);
  for (const dbId of affected) await dropPositionIndex(dbId).catch(() => {});
}

export async function toGameObjects(rows) {
  const out = [];
  for (const m of rows) {
    const g = await getGame(m.id);
    if (!g) continue;
    out.push({
      id: g.id, white: g.white, black: g.black, result: g.result, event: g.event,
      date: g.date, year: g.year, eco: g.eco, moves: g.moves,
      whiteElo: g.whiteElo || m.whiteElo || 0, blackElo: g.blackElo || m.blackElo || 0,
      ucis: sanToUci(g.startFen, g.moves).ucis, startFen: g.startFen,
      source: g.source, updated: g.added,
    });
  }
  return out;
}

export function playerList() {
  const names = new Map();
  for (const m of meta || []) {
    names.set(m.white, (names.get(m.white) || 0) + 1);
    names.set(m.black, (names.get(m.black) || 0) + 1);
  }
  return [...names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 300).map(([name, n]) => ({ name, n }));
}
