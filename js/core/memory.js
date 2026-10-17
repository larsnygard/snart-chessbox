// js/core/memory.js — famous-game memorisation, as pure logic.
// A session replays a game from the start; at the plies being trained the user
// must reproduce the move. Both colours can be quizzed ("both"), or just one.
//
// The same module powers "study" (show the moves) and "recall" (hide them), so
// the UI only has to drive one queue.

import { applyUci, applySan } from './chessutil.js';

/**
 * plan: which plies to ask about.
 * game: { moves:[san], ucis:[uci], startFen? }
 * opts: { fromPly, toPly, side:'w'|'b'|'both', shuffle:false }
 */
export function buildQuestionPlan(game, opts = {}) {
  const moves = game.moves || [];
  const ucis = game.ucis || [];
  const startFen = game.startFen;
  const from = Math.max(0, opts.fromPly ?? 0);
  const to = Math.min(moves.length, opts.toPly ?? moves.length);
  const side = opts.side || 'both';
  const plan = [];
  let fen = startFen || null;
  for (let i = 0; i < Math.min(to, moves.length); i++) {
    const mover = i % 2 === 0 ? 'w' : 'b';
    const inRange = i >= from;
    const wanted = side === 'both' || side === mover;
    if (inRange && wanted) plan.push({ ply: i, mover, san: moves[i], uci: ucis[i] || null });
    if (opts.shuffle) { /* shuffled later, with fen recalculation below */ }
  }
  if (opts.shuffle) {
    // Shuffling breaks the "play from the start" flow, so only position-based
    // recall supports it: each question keeps its own fen.
    for (const q of plan) q.fen = fenBefore(game, q.ply);
    for (let i = plan.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [plan[i], plan[j]] = [plan[j], plan[i]];
    }
  }
  return plan;
}

export function fenBefore(game, ply) {
  let fen = game.startFen;
  const ucis = game.ucis || [];
  for (let i = 0; i < ply; i++) {
    const r = applyUci(fen, ucis[i]);
    if (!r) return fen;
    fen = r.fen;
  }
  return fen;
}

/** The position the question is asked from and the expected SAN/UCI. */
export function questionContext(game, ply) {
  return {
    ply,
    fen: fenBefore(game, ply),
    mover: ply % 2 === 0 ? 'w' : 'b',
    expectedSan: game.moves[ply],
    expectedUci: (game.ucis || [])[ply] || null,
    moveNumber: Math.floor(ply / 2) + 1,
  };
}

/** Compare an attempted UCI move against the expected one (promotion-aware). */
export function checkAnswer(expectedUci, attemptUci) {
  if (!expectedUci || !attemptUci) return false;
  // A move typed without a promotion piece means "queen" (the UI default).
  const norm = (u) => u.slice(0, 4) + (u[4] ? u[4] : 'q');
  return norm(expectedUci) === norm(attemptUci);
}

/** First move of a line the user got wrong, for the "show me" arrow. */
export function hintFor(game, ply) {
  const q = questionContext(game, ply);
  return { from: q.expectedUci ? q.expectedUci.slice(0, 2) : null, to: q.expectedUci ? q.expectedUci.slice(2, 4) : null, san: q.expectedSan };
}

export function sessionScore(session) {
  const asked = session.asked || 0;
  const right = session.right || 0;
  return { asked, right, pct: asked ? Math.round((right / asked) * 100) : 0 };
}

/** Deterministic sanity check used by the data tests: a game must replay fully. */
export function replayable(game) {
  let fen = game.startFen;
  for (let i = 0; i < (game.moves || []).length; i++) {
    const r = applySan(fen, game.moves[i]);
    if (!r) return { ok: false, at: i, san: game.moves[i] };
    fen = r.fen;
  }
  return { ok: true, plies: game.moves.length, fen };
}
