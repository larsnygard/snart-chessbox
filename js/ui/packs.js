// js/ui/packs.js — bundled starter packs.
//
// The packs are plain line lists (data/packs/*.json, a few tens of KB each):
// adding one builds the move tree in the browser and stores it as a normal
// repertoire, so the user can browse, edit, train and export it like one they
// built themselves.
//
// The example database is shipped gzipped and is NOT precached: it is only
// downloaded when the user asks for it from the Database screen.

import { state, persist } from '../app.js';
import { linesToTree, treeStats } from '../core/repertoire.js';
import { uid } from '../core/sets.js';
import { importPGNText } from './pgndb.js';

let indexCache = null;
const packCache = new Map();

export async function loadPackIndex() {
  if (indexCache) return indexCache;
  const res = await fetch('data/packs/index.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`packs: HTTP ${res.status}`);
  indexCache = await res.json();
  return indexCache;
}

export async function loadPack(id) {
  if (packCache.has(id)) return packCache.get(id);
  const idx = await loadPackIndex();
  const meta = idx.packs.find((p) => p.id === id);
  if (!meta) throw new Error(`unknown pack ${id}`);
  const res = await fetch('data/packs/' + meta.file, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`pack ${id}: HTTP ${res.status}`);
  const pack = await res.json();
  packCache.set(id, pack);
  return pack;
}

/** Add a pack as a new repertoire. Returns the stored repertoire object. */
export async function addPack(id, { name } = {}) {
  const pack = await loadPack(id);
  const tree = linesToTree(pack.moves, pack.color);
  const stats = treeStats(tree);
  const rep = {
    id: uid('rep'),
    name: name || pack.name,
    color: pack.color,
    description: pack.description,
    source: `Starter pack “${pack.name}” (${pack.lines} lines)`,
    tree,
    created: Date.now(),
    updated: Date.now(),
  };
  state.repertoires = (state.repertoires || []).concat([rep]);
  persist('repertoires', true);
  return { rep, stats, pack };
}

export function hasPack(id) {
  return (state.repertoires || []).some((r) => r.source && r.source.startsWith('Starter pack') && r.name === id);
}

/** Download + decompress the bundled example database (TWIC + Rubinstein games). */
export async function fetchExampleDatabase(onProgress) {
  const gzPath = 'pgn/chessbox-example.pgn.gz';
  let text;
  if (typeof DecompressionStream === 'undefined') {
    const res = await fetch('pgn/chessbox-example.pgn');
    if (!res.ok) throw new Error('Example database unavailable (no decompressor in this browser)');
    text = await res.text();
  } else {
    const res = await fetch(gzPath);
    if (!res.ok) throw new Error(`Example database unavailable (HTTP ${res.status})`);
    const total = Number(res.headers.get('content-length')) || 0;
    // stream so a slow connection still shows progress
    const reader = res.body.pipeThrough(new DecompressionStream('gzip'));
    const chunks = [];
    let read = 0;
    const stream = reader.getReader();
    for (;;) {
      const { done, value } = await stream.read();
      if (done) break;
      chunks.push(value);
      read += value.byteLength;
      if (onProgress) onProgress(read, total);
      await new Promise((r) => setTimeout(r, 0));
    }
    const blob = new Blob(chunks);
    text = await blob.text();
  }
  return text;
}

export const EXAMPLE_DB = {
  label: 'Bundled example database',
  detail: '9,834 master games (TWIC 1666 plus Akiba Rubinstein’s games), ~2.4 MB download',
};
