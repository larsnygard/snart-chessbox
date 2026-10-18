// js/ui/pgndb.js — the PGN database: import once, search thousands of games.
//
// Layout: the full games live in their own IndexedDB store (`pgnGames`), while a
// compact metadata list is kept in the key/value store and mirrored in memory.
// Searching therefore never touches the big records — only the games you open
// are deserialised.

import { store } from './store.js';
import { splitGames, parseGame, buildPGN } from '../core/pgn.js';
import { sanToUci } from '../core/chessutil.js';

const META_KEY = 'pgnMeta';
let meta = null;
let importing = false;

function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export async function loadMeta(force = false) {
  if (meta && !force) return meta;
  meta = (await store.get(META_KEY, [])) || [];
  return meta;
}

export function metaCached() { return meta || []; }

export function isImporting() { return importing; }

export async function importPGNText(text, { source = '', onProgress = null, chunk = 150, max = 100000 } = {}) {
  if (importing) throw new Error('An import is already running');
  importing = true;
  try {
    const raws = splitGames(String(text || ''));
    if (!raws.length) return { added: 0, skipped: 0, duplicates: 0, total: 0 };
    const existing = new Set((await loadMeta()).map((m) => m.key));
    let added = 0, skipped = 0, duplicates = 0;
    let batch = [];
    const newMeta = [];
    for (let i = 0; i < raws.length && added < max; i++) {
      const raw = raws[i];
      let parsed;
      try { parsed = parseGame(raw); } catch (e) { skipped++; continue; }
      if (!parsed.moves.length) { skipped++; continue; }
      const key = `${parsed.headers.White || ''}|${parsed.headers.Black || ''}|${(parsed.headers.Date || '').slice(0, 4)}|${parsed.moves.join(' ')}`;
      if (existing.has(key)) { duplicates++; continue; }
      existing.add(key);
      const year = parseInt((parsed.headers.Date || '').slice(0, 4), 10) || 0;
      const id = 'pg_' + hash(key);
      const record = {
        id,
        key,
        white: parsed.headers.White || '?',
        black: parsed.headers.Black || '?',
        whiteLower: (parsed.headers.White || '').toLowerCase(),
        blackLower: (parsed.headers.Black || '').toLowerCase(),
        event: parsed.headers.Event || '',
        eventLower: (parsed.headers.Event || '').toLowerCase(),
        site: parsed.headers.Site || '',
        date: parsed.headers.Date || '',
        year,
        round: parsed.headers.Round || '',
        result: parsed.result || '*',
        eco: parsed.headers.ECO || '',
        moves: parsed.moves,
        startFen: parsed.startFen,
        source,
        added: Date.now(),
      };
      batch.push(record);
      newMeta.push({
        id, key, white: record.white, black: record.black,
        whiteLower: record.whiteLower, blackLower: record.blackLower,
        event: record.event, eventLower: record.eventLower,
        year, result: record.result, eco: record.eco, plies: parsed.moves.length, source,
      });
      added++;
      if (batch.length >= chunk) {
        await store.putGameRecords(batch);
        batch = [];
        if (onProgress) onProgress(i + 1, raws.length, added);
        await new Promise((r) => setTimeout(r, 0)); // keep the UI alive
      }
    }
    if (batch.length) await store.putGameRecords(batch);
    const merged = (await loadMeta()).concat(newMeta);
    meta = merged;
    await store.set(META_KEY, merged);
    if (onProgress) onProgress(raws.length, raws.length, added);
    return { added, skipped, duplicates, total: raws.length };
  } finally {
    importing = false;
  }
}

export async function searchGames(opts = {}) {
  const list = await loadMeta();
  const {
    player = '', event = '', yearFrom = 0, yearTo = 9999, result = '', eco = '',
    minPlies = 0, limit = 100, offset = 0, sort = 'year',
  } = opts;
  const terms = String(player).toLowerCase().split(/[,;]/).map((t) => t.trim()).filter(Boolean);
  const ev = String(event).toLowerCase().trim();
  const filtered = list.filter((m) => {
    if (terms.length) {
      const hit = terms.some((t) => m.whiteLower.includes(t) || m.blackLower.includes(t));
      if (!hit) return false;
    }
    if (ev && !(m.eventLower || '').includes(ev)) return false;
    if (m.year < yearFrom || m.year > yearTo) return false;
    if (result && m.result !== result) return false;
    if (eco && !(m.eco || '').toUpperCase().startsWith(eco.toUpperCase())) return false;
    if (minPlies && m.plies < minPlies) return false;
    return true;
  });
  if (sort === 'year') filtered.sort((a, b) => (b.year || 0) - (a.year || 0));
  else if (sort === 'white') filtered.sort((a, b) => a.whiteLower.localeCompare(b.whiteLower));
  else if (sort === 'plies') filtered.sort((a, b) => b.plies - a.plies);
  return { total: filtered.length, games: filtered.slice(offset, offset + limit) };
}

export async function getGame(id) { return store.getGame(id); }

export async function deleteAllGames() {
  await store.clearGameRecords();
  meta = [];
  await store.set(META_KEY, []);
}

export async function deleteGames(ids) {
  await store.deleteGameRecords(ids);
  meta = (await loadMeta()).filter((m) => !ids.includes(m.id));
  await store.set(META_KEY, meta);
}

/** Rebuild a PGN string for the given metadata rows (byte-identical fields kept). */
export async function exportPGN(rows) {
  const out = [];
  for (const m of rows) {
    const g = await getGame(m.id);
    if (!g) continue;
    out.push(buildPGN({
      headers: {
        Event: g.event, Site: g.site, Date: g.date, Round: g.round,
        White: g.white, Black: g.black, Result: g.result, ECO: g.eco,
      },
      moves: g.moves, result: g.result, startFen: g.startFen,
    }));
  }
  return out.join('\n');
}

/** Turn database rows into the games shape the coaches/repertoire builders expect. */
export async function toGameObjects(rows) {
  const out = [];
  for (const m of rows) {
    const g = await getGame(m.id);
    if (!g) continue;
    out.push({
      id: g.id, white: g.white, black: g.black, result: g.result, event: g.event,
      date: g.date, year: g.year, eco: g.eco, moves: g.moves,
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
  return [...names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 200).map(([name, n]) => ({ name, n }));
}
