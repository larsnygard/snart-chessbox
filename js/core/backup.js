// js/core/backup.js — export / import.
//
// Two formats:
//  * PGN  — the portable, human-readable one (games, repertoire lines, memories)
//  * bundle — one JSON file with everything: settings + repertoire trees + sets +
//    imported games + memory games + progress. "Everything" means the user can
//    move to another browser/phone and continue where they left off.

export const BUNDLE_FORMAT = 'snart-chess-trainer-bundle';
export const BUNDLE_VERSION = 1;

export function makeBundle(state, now = Date.now()) {
  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: new Date(now).toISOString(),
    app: 'Snart Chess Trainer',
    settings: state.settings || {},
    repertoires: state.repertoires || [],
    sets: state.sets || [],
    games: state.games || [],
    memoryGames: state.memoryGames || [],
    progress: state.progress || {},
    customPuzzles: state.customPuzzles || [],
  };
}

export function serializeBundle(bundle) { return JSON.stringify(bundle, null, 1); }

export function parseBundle(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('Not a JSON file'); }
  if (!data || data.format !== BUNDLE_FORMAT) throw new Error('Not a Snart Chess Trainer backup');
  if (data.version > BUNDLE_VERSION) throw new Error(`Backup is from a newer version (v${data.version})`);
  return {
    settings: data.settings || null,
    repertoires: Array.isArray(data.repertoires) ? data.repertoires : [],
    sets: Array.isArray(data.sets) ? data.sets : [],
    games: Array.isArray(data.games) ? data.games : [],
    memoryGames: Array.isArray(data.memoryGames) ? data.memoryGames : [],
    progress: data.progress || {},
    customPuzzles: Array.isArray(data.customPuzzles) ? data.customPuzzles : [],
    exportedAt: data.exportedAt,
  };
}

/**
 * Merge imported collections into existing ones.
 * mode 'merge' — same id wins the imported copy only if newer/undefined
 * mode 'replace' — imported list replaces the local one entirely
 */
export function mergeById(local, incoming, { mode = 'merge', idKey = 'id', updatedKey = 'updated' } = {}) {
  if (mode === 'replace') return incoming.slice();
  const byId = new Map((local || []).map((x) => [x[idKey], x]));
  for (const item of incoming || []) {
    const id = item[idKey];
    const existing = byId.get(id);
    if (!existing) { byId.set(id, item); continue; }
    const a = existing[updatedKey] || existing.updated || 0;
    const b = item[updatedKey] || item.updated || 0;
    if (b >= a) byId.set(id, item);
  }
  return Array.from(byId.values());
}

export function mergeProgress(local, incoming) {
  const out = { ...(local || {}) };
  for (const [k, v] of Object.entries(incoming || {})) {
    const cur = out[k];
    if (!cur) { out[k] = v; continue; }
    out[k] = {
      ...cur,
      ...v,
      seen: Math.max(cur.seen || 0, v.seen || 0),
      ok: Math.max(cur.ok || 0, v.ok || 0),
      box: Math.max(cur.box || 0, v.box || 0),
      due: Math.min(cur.due || Infinity, v.due || Infinity),
    };
  }
  return out;
}

/** Filesystem-safe filename stem for exports. */
export function exportName(prefix = 'snart-chess-trainer', now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${prefix}-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
}

/** Trigger a download in the browser (no-op in Node). */
export function download(filename, text, mime = 'application/json') {
  if (typeof document === 'undefined') return false;
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

export function fileToText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(r.error || new Error('read failed'));
    r.readAsText(file);
  });
}
