// js/core/sets.js — exercise sets ("training programmes").
//
// A set is an ordered list of items. An item points at existing material:
//   { kind:'opening',  ref: openingId, side:'w'|'b', plies: n }
//   { kind:'repertoire', ref: repertoireId, branch?: sanPath }
//   { kind:'endgame',  ref: drillId }
//   { kind:'puzzle',   ref: puzzleId }            (single puzzle)
//   { kind:'puzzles',  themes:[...], count:n }    (generated run)
//   { kind:'memory',   ref: gameId, fromPly, toPly, side }
//   { kind:'review',   ref: coachGameId, ply }    (one position from your own game)
//   { kind:'position', fen, goal:'mate'|'win'|'hold', side }
//
// Kept as data + pure helpers so sets survive export/import and can be built by
// the UI without any of the screens being loaded.

export const ITEM_KINDS = ['opening', 'repertoire', 'endgame', 'puzzle', 'puzzles', 'memory', 'review', 'position'];

export const KIND_LABEL = {
  opening: 'Opening line',
  repertoire: 'My repertoire',
  endgame: 'Endgame drill',
  puzzle: 'Puzzle',
  puzzles: 'Puzzle set',
  memory: 'Game recall',
  review: 'Own game position',
  position: 'Custom position',
};

export function makeSet({ name = 'New set', description = '', items = [], color = 'both', builtin = false, id } = {}) {
  return {
    id: id || uid('set'),
    name,
    description,
    color,
    items,
    builtin,
    created: Date.now(),
    updated: Date.now(),
  };
}

export function makeItem(kind, ref, extra = {}) {
  if (!ITEM_KINDS.includes(kind)) throw new Error(`unknown item kind: ${kind}`);
  return { id: uid('it'), kind, ref, ...extra };
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function addItem(set, item) {
  set.items = [...(set.items || []), item];
  set.updated = Date.now();
  return set;
}

export function removeItem(set, itemId) {
  set.items = (set.items || []).filter((i) => i.id !== itemId);
  set.updated = Date.now();
  return set;
}

export function moveItem(set, itemId, delta) {
  const items = [...(set.items || [])];
  const i = items.findIndex((x) => x.id === itemId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= items.length) return set;
  [items[i], items[j]] = [items[j], items[i]];
  set.items = items;
  set.updated = Date.now();
  return set;
}

/** Human description of an item for set editors and session lists. */
export function describeItem(item, ctx = {}) {
  const { openings = [], drills = [], puzzles = [], games = [] } = ctx;
  switch (item.kind) {
    case 'opening': {
      const o = openings.find((x) => x.id === item.ref || x.p === item.ref);
      return o ? o.n : 'Opening line';
    }
    case 'repertoire': return item.ref ? `Repertoire branch (${item.ref})` : 'Repertoire';
    case 'endgame': {
      const d = drills.find((x) => x.id === item.ref);
      return d ? d.title : 'Endgame drill';
    }
    case 'puzzle': {
      const p = puzzles.find((x) => x.id === item.ref);
      return p ? `Puzzle ${p.id} (${(p.themes || []).slice(0, 2).join(', ')})` : 'Puzzle';
    }
    case 'puzzles': return `${item.count || 10} puzzles${item.themes && item.themes.length ? ` — ${item.themes.slice(0, 3).join(', ')}` : ''}`;
    case 'memory': {
      const g = games.find((x) => x.id === item.ref);
      return g ? `Recall: ${g.name || g.white + ' – ' + g.black}` : 'Game recall';
    }
    case 'review': return 'Position from my game';
    case 'position': return item.label || `Position ${item.fen ? item.fen.split(' ')[0].slice(0, 12) : ''}`;
    default: return item.kind;
  }
}

/** Rough duration estimate in minutes, for the set cards. */
export function estimateMinutes(set) {
  return (set.items || []).reduce((a, it) => {
    switch (it.kind) {
      case 'puzzles': return a + Math.max(1, Math.round((it.count || 10) * 0.6));
      case 'opening': return a + 4;
      case 'endgame': return a + 6;
      case 'memory': return a + 5;
      default: return a + 3;
    }
  }, 0);
}

/**
 * Expand a set into a flat queue of sessions the runner can execute.
 * `puzzles` items are resolved against the puzzle database here so the runner
 * only sees concrete puzzles.
 */
export function expandSet(set, ctx = {}, rng = Math.random) {
  const { puzzles = [] } = ctx;
  const queue = [];
  for (const item of set.items || []) {
    if (item.kind === 'puzzles') {
      let pool = puzzles;
      if (item.themes && item.themes.length) {
        pool = puzzles.filter((p) => item.themes.some((t) => (p.themes || []).includes(t)));
      }
      if (item.maxRating) pool = pool.filter((p) => (p.rating || 0) <= item.maxRating);
      if (item.minRating) pool = pool.filter((p) => (p.rating || 0) >= item.minRating);
      const shuffled = pool.slice();
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      for (const p of shuffled.slice(0, item.count || 10)) queue.push({ ...item, kind: 'puzzle', ref: p.id });
    } else {
      queue.push(item);
    }
  }
  return queue;
}
