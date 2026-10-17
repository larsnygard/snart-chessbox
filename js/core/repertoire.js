// js/core/repertoire.js — opening repertoire as a move tree.
//
// Tree shape (plain JSON, storage friendly):
//   { fen, color:'w'|'b', moves:[ { san, uci, count, comment, children:{fen,color,moves:[]} } ] }
//
// Building from a PGN set counts how often each move occurs at each position,
// which is what makes "automatic repertoire building" possible: the branches a
// user actually reaches, ordered by frequency. Pruning drops rare branches and
// (optionally) branches the engine marks as losing material — the "exclude bad
// moves" switch.

import { START_FEN, applySan, applyUci, scoreToCp, MATE_CP } from './chessutil.js';

export function emptyTree(color = 'w', fen = START_FEN) {
  return { fen, color, moves: [] };
}

function ensureChildren(node, fen) {
  if (!node.children) node.children = { fen, color: fen.split(' ')[1] === 'b' ? 'b' : 'w', moves: [] };
  return node.children;
}

export function findMoveNode(tree, sans) {
  let node = tree;
  for (const san of sans) {
    if (!node || !node.moves) return null;
    const m = node.moves.find((x) => x.san === san);
    if (!m) return null;
    node = ensureChildren(m, m.fen || node.fen);
    if (m.fen) node.fen = m.fen;
  }
  return node;
}

/** Insert a SAN line, creating nodes; increments `count` along the path. */
export function addLine(tree, sans, { comment = '', weight = 1 } = {}) {
  let node = tree;
  let fen = tree.fen;
  for (const san of sans) {
    const r = applySan(fen, san);
    if (!r) return { ok: false, at: san, fen };
    let m = node.moves.find((x) => x.san === r.san);
    if (!m) {
      m = { san: r.san, uci: r.from + r.to + (r.promo || ''), count: 0, comment: '', fen: r.fen };
      node.moves.push(m);
    }
    m.count += weight;
    node = ensureChildren(m, r.fen);
    node.fen = r.fen;
    fen = r.fen;
  }
  if (comment && node) node.comment = comment;
  return { ok: true, fen, node };
}

export function removeLine(tree, sans) {
  let node = tree;
  const path = [];
  for (const san of sans) {
    const i = node.moves.findIndex((x) => x.san === san);
    if (i < 0) return false;
    path.push([node, i]);
    node = ensureChildren(node.moves[i], node.moves[i].fen || node.fen);
  }
  const [parent, idx] = path[path.length - 1];
  parent.moves.splice(idx, 1);
  // prune now-empty ancestors
  for (let i = path.length - 2; i >= 0; i--) {
    const [p, j] = path[i];
    const child = p.moves[j];
    if (child.children && child.children.moves.length === 0 && !child.children.comment) child.children = undefined;
    if (child.children) break;
  }
  return true;
}

export function setComment(tree, sans, comment) {
  let node = tree;
  let fen = tree.fen;
  for (const san of sans) {
    const m = node.moves.find((x) => x.san === san);
    if (!m) return false;
    fen = m.fen || fen;
    node = ensureChildren(m, fen);
  }
  node.comment = comment;
  return true;
}

/**
 * Build a repertoire from parsed games.
 * games: [{ moves:[san], ucis:[uci], headers }]
 * color: which side the repertoire is for. Opponent moves are stored too —
 * the trainer needs them to play the expected replies offline.
 */
export function buildFromGames(games, { color = 'w', maxPly = 24, minCount = 1 } = {}) {
  const tree = emptyTree(color);
  for (const g of games) {
    if (!g || !g.moves || !g.moves.length) continue;
    addLine(tree, g.moves.slice(0, maxPly), { weight: 1 });
  }
  if (minCount > 1) prune(tree, { minCount });
  sortByCount(tree);
  return tree;
}

/** Recursively drop branches with count < minCount (keeps at least one move). */
export function prune(tree, { minCount = 1, maxBranches = 0 } = {}) {
  const walk = (node) => {
    let moves = node.moves.filter((m) => m.count >= minCount);
    if (!moves.length) moves = node.moves.slice();
    if (maxBranches > 0 && moves.length > maxBranches) {
      moves = moves.slice().sort((a, b) => b.count - a.count).slice(0, maxBranches);
    }
    node.moves = moves;
    for (const m of node.moves) if (m.children) walk(m.children);
  };
  walk(tree);
  sortByCount(tree);
  return tree;
}

export function sortByCount(tree) {
  const walk = (node) => {
    node.moves.sort((a, b) => b.count - a.count || a.san.localeCompare(b.san));
    for (const m of node.moves) if (m.children) walk(m.children);
  };
  walk(tree);
  return tree;
}

/** All leaf lines as SAN arrays. */
export function treeLines(tree, maxLines = 5000) {
  const out = [];
  const walk = (node, path) => {
    if (out.length >= maxLines) return;
    if (!node.moves || !node.moves.length) { if (path.length) out.push(path); return; }
    for (const m of node.moves) {
      const next = path.concat(m.san);
      if (m.children && m.children.moves.length) walk(m.children, next);
      else out.push(next);
    }
  };
  walk(tree, []);
  return out;
}

export function treeStats(tree) {
  let nodes = 0, leaves = 0, plies = 0, freq = 0;
  const walk = (node, depth) => {
    if (!node.moves || !node.moves.length) { leaves++; plies = Math.max(plies, depth); return; }
    for (const m of node.moves) {
      nodes++; freq += m.count;
      if (m.children) walk(m.children, depth + 1); else { leaves++; plies = Math.max(plies, depth + 1); }
    }
  };
  walk(tree, 0);
  return { nodes, leaves, maxDepth: plies, totalVisits: freq };
}

/**
 * Moves available at a position, keyed by SAN.
 * Returns [{san, uci, count, value?}] sorted by popularity.
 */
export function movesAt(node) {
  return node && node.moves ? node.moves.slice() : [];
}

/**
 * Position lookups for the trainer: walk a path and give the book replies for
 * the side that is NOT the repertoire side.
 */
export function bookReplies(tree, pathSans) {
  const node = findMoveNode(tree, pathSans);
  return node ? node.moves : [];
}

/** Weighted random pick among book moves, by how often they were played. */
export function pickBookMove(moves, rng = Math.random) {
  if (!moves || !moves.length) return null;
  const total = moves.reduce((a, m) => a + Math.max(1, m.count || 1), 0);
  let r = rng() * total;
  for (const m of moves) {
    r -= Math.max(1, m.count || 1);
    if (r <= 0) return m;
  }
  return moves[moves.length - 1];
}

/**
 * Attach engine evaluations (map key `${fenUci}|${uci}` → cp from the mover's
 * point of view) and mark moves that throw away more than maxLossCp compared to
 * the best move at the same position.
 * Returns { kept, rejected:[{path, uci, san, loss}] } and mutates the tree to
 * annotate nodes with `.loss`.
 */
export function annotateLosses(tree, evalMap, maxLossCp = 100) {
  const rejected = [];
  const walk = (node) => {
    if (!node.moves || !node.moves.length) return;
    const evals = node.moves.map((m) => {
      const v = evalMap.get(`${node.fen}|${m.uci}`);
      return { m, cp: v === undefined ? null : v };
    });
    const known = evals.filter((e) => e.cp !== null);
    const best = known.length ? Math.max(...known.map((e) => e.cp)) : null;
    for (const e of evals) {
      if (best === null || e.cp === null) { e.m.loss = null; continue; }
      e.m.loss = Math.max(0, best - e.cp);
      if (e.m.loss > maxLossCp) {
        e.m.bad = true;
        rejected.push({ san: e.m.san, uci: e.m.uci, loss: e.m.loss, fen: node.fen });
      } else e.m.bad = false;
    }
    for (const m of node.moves) if (m.children) walk(m.children);
  };
  walk(tree);
  return rejected;
}

/** Remove every node annotated `bad` (used after annotateLosses). */
export function dropBadMoves(tree, minKeep = 1) {
  let removed = 0;
  const walk = (node) => {
    if (!node.moves) return;
    const good = node.moves.filter((m) => !m.bad);
    if (good.length >= Math.min(minKeep, node.moves.length)) {
      removed += node.moves.length - good.length;
      node.moves = good;
    }
    for (const m of node.moves) if (m.children) walk(m.children);
  };
  walk(tree);
  sortByCount(tree);
  return removed;
}

/** Import a flat list of lines (SAN arrays) into a tree. */
export function linesToTree(lines, color = 'w') {
  const tree = emptyTree(color);
  for (const l of lines) addLine(tree, l, { weight: 1 });
  return tree;
}

/** Merge another tree into this one (counts add, comments kept). */
export function mergeTrees(target, other) {
  const walk = (node, from) => {
    for (const m of from.moves || []) {
      let t = node.moves.find((x) => x.san === m.san);
      if (!t) {
        t = { san: m.san, uci: m.uci, count: 0, comment: m.comment || '', fen: m.fen };
        node.moves.push(t);
      }
      t.count += Math.max(0, m.count || 0);
      if (!t.comment && m.comment) t.comment = m.comment;
      if (m.children && m.children.moves.length) {
        const tc = ensureChildren(t, m.fen || node.fen);
        walk(tc, m.children);
      }
    }
  };
  walk(target, other);
  sortByCount(target);
  return target;
}

/** UCI→cp from mover's perspective, excluding moves that lose to mate. */
export function evalValueToCp(ev) {
  if (!ev) return null;
  return scoreToCp(ev);
}

export function mateWindowCp() { return MATE_CP; }
