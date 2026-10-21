// js/ui/pgndb.js — the PGN database layer: several named databases, each with
// its own games, importable/exportable as PGN (optionally zipped).
//
// Storage: game records live in their own IndexedDB store (`pgnGames`), the
// compact metadata for every database in one kv key (`pgnMeta`, tagged with
// `dbId`), and the database list in `pgnDbs`. Search therefore never touches the
// big records — only the games you open are deserialised.

import { store } from './store.js';
import { splitGames, parseGame, buildPGN, ratingsFrom, ratingInRange } from '../core/pgn.js';
import { sanToUci } from '../core/chessutil.js';
import { createZip, readZipTexts } from '../core/zip.js';

const META_KEY = 'pgnMeta';
const DBS_KEY = 'pgnDbs';
const ACTIVE_KEY = 'scb.pgnDb';
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
    if (onProgress) onProgress(raws.length, raws.length, added);
    return { added, skipped, duplicates, rated, total: raws.length };
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
  const all = await loadMeta();
  const ids = all.filter((m) => dbOf(m) === target).map((m) => m.id);
  if (ids.length) await store.deleteGameRecords(ids);
  meta = all.filter((m) => dbOf(m) !== target);
  await store.set(META_KEY, meta);
}

export async function deleteGames(ids) {
  await store.deleteGameRecords(ids);
  meta = (await loadMeta()).filter((m) => !ids.includes(m.id));
  await store.set(META_KEY, meta);
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
