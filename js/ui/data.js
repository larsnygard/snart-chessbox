// js/ui/data.js — load and index the bundled datasets.
// Everything is fetched from the app's own directory, so a service-worker
// cached copy makes the whole app work with no network.

const cache = {
  openings: null,
  puzzles: null,
  famous: null,
  errors: [],
};

async function getJSON(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

export async function loadData() {
  const jobs = [
    getJSON('data/openings.json').then((d) => { cache.openings = d; }).catch((e) => cache.errors.push(String(e))),
    getJSON('data/puzzles.json').then((d) => { cache.puzzles = d; }).catch((e) => cache.errors.push(String(e))),
    getJSON('data/famous-games.json').then((d) => { cache.famous = d; }).catch((e) => cache.errors.push(String(e))),
  ];
  await Promise.all(jobs);
  return cache;
}

export function openings() { return cache.openings ? cache.openings.openings : []; }
export function puzzles() { return cache.puzzles ? cache.puzzles.puzzles : []; }
// The bundled file stores movetext as one space-separated string; the app wants
// a SAN array everywhere. Normalise once here so no screen has to care.
let famousNormal = null;
export function famousGames() {
  if (!cache.famous) return [];
  if (!famousNormal) {
    famousNormal = cache.famous.games.map((g) => ({
      ...g,
      moves: Array.isArray(g.moves) ? g.moves : String(g.moves || '').trim().split(/\s+/).filter(Boolean),
    }));
  }
  return famousNormal;
}
export function dataMeta() { return cache; }

export function openingById(id) { return openings().find((o) => o.id === id) || null; }

/** Search openings by name / ECO prefix, with light relevance sorting. */
export function searchOpenings(query, { eco = '', maxPlies = 0, color = 'all', limit = 400 } = {}) {
  const q = (query || '').trim().toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  let list = openings();
  if (eco) list = list.filter((o) => o.eco[0] === eco.toUpperCase());
  if (maxPlies) list = list.filter((o) => o.plies <= maxPlies);
  if (color === 'w') list = list.filter((o) => o.eco[0] !== 'A' && o.eco[0] !== 'B' ? true : o.moves[0] === 'e4' || o.moves[0] === 'd4' || o.moves[0] === 'c4' || o.moves[0] === 'Nf3');
  if (terms.length) {
    list = list.filter((o) => {
      const hay = (o.name + ' ' + o.eco).toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }
  if (q) {
    list = list.slice().sort((a, b) => {
      const an = a.name.toLowerCase(), bn = b.name.toLowerCase();
      const ap = an.startsWith(q) ? 0 : an.includes(q) ? 1 : 2;
      const bp = bn.startsWith(q) ? 0 : bn.includes(q) ? 1 : 2;
      return ap - bp || a.plies - b.plies || an.localeCompare(bn);
    });
  }
  return list.slice(0, limit);
}

/** Opening families ("Sicilian Defense: ...") for grouped browsing. */
export function openingFamilies() {
  const map = new Map();
  for (const o of openings()) {
    const fam = o.name.split(':')[0].trim();
    if (!map.has(fam)) map.set(fam, { name: fam, eco: o.eco, count: 0, examples: [] });
    const f = map.get(fam);
    f.count++;
    if (f.examples.length < 6) f.examples.push(o);
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export const PUZZLE_THEME_LABELS = {
  mateIn1: 'Mate in 1',
  mateIn2: 'Mate in 2',
  mateIn3: 'Mate in 3',
  mateIn4: 'Mate in 4',
  backRankMate: 'Back-rank mate',
  smotheredMate: 'Smothered mate',
  doubleCheck: 'Double check',
  fork: 'Fork',
  pin: 'Pin',
  skewer: 'Skewer',
  discoveredAttack: 'Discovered attack',
  sacrifice: 'Sacrifice',
  hangingPiece: 'Hanging piece',
  promotion: 'Promotion',
  endgame: 'Endgame',
  defensiveMove: 'Defensive move',
  zugzwang: 'Zugzwang',
  trappedPiece: 'Trapped piece',
  attraction: 'Attraction',
  clearance: 'Clearance',
};

export function puzzleThemes() {
  const counts = new Map();
  for (const p of puzzles()) for (const t of p.themes || []) counts.set(t, (counts.get(t) || 0) + 1);
  return Array.from(counts.entries())
    .filter(([t, n]) => n >= 8)
    .sort((a, b) => b[1] - a[1])
    .map(([theme, count]) => ({ theme, count, label: PUZZLE_THEME_LABELS[theme] || theme.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()) }));
}

export function filterPuzzles({ themes = [], minRating = 0, maxRating = 9999, limit = 400 } = {}) {
  let list = puzzles();
  if (themes.length) list = list.filter((p) => themes.some((t) => (p.themes || []).includes(t)));
  if (minRating) list = list.filter((p) => (p.rating || 0) >= minRating);
  if (maxRating < 9999) list = list.filter((p) => (p.rating || 0) <= maxRating);
  return themes.length ? list.slice(0, limit) : list.slice(0, limit);
}

export function famousById(id) { return famousGames().find((g) => g.id === id) || null; }
