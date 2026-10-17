// js/core/moveclass.js — turn engine evaluations into coaching feedback.
// Used by the game-review screen ("red arrows on your bad moves") and by the
// repertoire builder's "exclude bad moves" filter.

import { winProbability, MATE_CP, scoreToCp } from './chessutil.js';

export const CLASSES = {
  brilliant: { label: 'Brilliant', cls: 'brilliant', color: '#26c2a3' },
  best:      { label: 'Best',      cls: 'best',      color: '#5fb85f' },
  good:      { label: 'Good',      cls: 'good',      color: '#8bc34a' },
  inaccuracy:{ label: 'Inaccuracy',cls: 'inaccuracy',color: '#e0b83a' },
  mistake:   { label: 'Mistake',   cls: 'mistake',   color: '#e08a3a' },
  blunder:   { label: 'Blunder',   cls: 'blunder',   color: '#dc4c4c' },
};

/**
 * Centipawn loss, from the mover's point of view, between the eval of the move
 * played and the eval of the best move. `before` and `after` are cp values for
 * the side that moved (positive = good for the mover).
 */
export function lossCp(bestCp, playedCp) {
  const loss = bestCp - playedCp;
  if (!Number.isFinite(loss)) return 0;
  return Math.max(0, Math.round(loss));
}

/** Win-probability drop in percentage points (0..100). */
export function lossWinPct(bestCp, playedCp) {
  return Math.max(0, winProbability(bestCp) - winProbability(playedCp));
}

/**
 * Classify by win-probability drop (lichess-style thresholds), with a cp
 * fallback for decisive positions where win% saturates.
 */
export function classify(bestCp, playedCp) {
  if (playedCp >= MATE_CP - 60000) return 'best';
  const dw = lossWinPct(bestCp, playedCp);
  const dc = lossCp(bestCp, playedCp);
  if (dc <= 8 && dw <= 1) return 'best';
  if (dw < 5 && dc < 40) return 'good';
  if (dw < 10 && dc < 90) return 'inaccuracy';
  if (dw < 20 && dc < 220) return 'mistake';
  if (dw >= 20 || dc >= 220) return 'blunder';
  return 'good';
}

export function classInfo(key) { return CLASSES[key] || CLASSES.good; }

/**
 * Given per-ply engine data for a game, produce the review table.
 * evals: [{ ply, fen, uci, san, cp, bestUci, bestSan, bestCp }] where cp and
 * bestCp are from the mover's perspective (cp = eval AFTER the move played).
 * Only plies where the mover is `userColor` are classified.
 */
export function reviewMoves(evals, userColor = 'w') {
  return (evals || []).map((e) => {
    const moverIsUser = e.moverColor ? e.moverColor === userColor : null;
    const bestCp = Number.isFinite(e.bestCp) ? e.bestCp : e.cp;
    const playedCp = Number.isFinite(e.cp) ? e.cp : bestCp;
    const cls = moverIsUser ? classify(bestCp, playedCp) : null;
    return {
      ...e,
      moverIsUser,
      loss: moverIsUser ? lossCp(bestCp, playedCp) : 0,
      lossWin: moverIsUser ? Math.round(lossWinPct(bestCp, playedCp) * 10) / 10 : 0,
      cls,
    };
  });
}

/** Summary numbers for the review header. */
export function reviewSummary(rows, userColor = 'w') {
  const mine = (rows || []).filter((r) => r.moverIsUser && r.cls);
  const counts = { brilliant: 0, best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
  for (const r of mine) counts[r.cls] = (counts[r.cls] || 0) + 1;
  const avgLoss = mine.length ? mine.reduce((a, r) => a + r.loss, 0) / mine.length : 0;
  const acc = mine.length ? Math.max(0, 100 - Math.min(100, avgLoss / 10)) : 0;
  return { counts, avgLoss: Math.round(avgLoss), accuracy: Math.round(acc * 10) / 10, moves: mine.length };
}

/** Red arrows: the user's worst moves, sorted worst-first. */
export function blunderArrows(rows, { minClass = 'mistake', limit = 40 } = {}) {
  const rank = { inaccuracy: 1, mistake: 2, blunder: 3 };
  const min = rank[minClass] || 2;
  return (rows || [])
    .filter((r) => r.moverIsUser && r.cls && (rank[r.cls] || 0) >= min)
    .sort((a, b) => b.loss - a.loss)
    .slice(0, limit)
    .map((r) => ({
      ply: r.ply, san: r.san, cls: r.cls,
      from: r.uci.slice(0, 2), to: r.uci.slice(2, 4),
      bestFrom: r.bestUci ? r.bestUci.slice(0, 2) : null,
      bestTo: r.bestUci ? r.bestUci.slice(2, 4) : null,
      loss: r.loss, lossWin: r.lossWin, eval: r.cp, bestEval: r.bestCp,
    }));
}

/** Which evals should be flagged in the repertoire builder's bad-move filter. */
export function isBadForRepertoire(bestCp, playedCp, maxLossCp = 100) {
  if (playedCp !== undefined && playedCp !== null && playedCp <= -MATE_CP / 2) return true;
  return lossCp(bestCp, playedCp) > maxLossCp;
}

export function cpFromScore(score) { return scoreToCp(score); }
