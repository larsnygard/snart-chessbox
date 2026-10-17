// js/core/evalband.js — "human-ish" move choice: pick among the engine's top
// lines whose evaluation is within a configurable spread of the best move.
//
// The product setting is described as "+/-1 pawn": with a best move of +1.3 the
// engine may randomly play anything down to +0.3, but never a move that gives up
// the advantage (-3.2). So the window is [best - spread, best] — the upper bound
// is the best move itself, and the lower bound scales with the best evaluation,
// never an absolute window around zero. When the best move wins material the
// weaker alternatives inside the window still keep the position reasonable,
// which is exactly what a training partner should do.
//
// Mate scores fold into a large band (see chessutil.scoreToCp) so "mate in 2"
// can never be confused with "wins a queen".

import { scoreToCp, MATE_CP } from './chessutil.js';

export const DEFAULT_SPREAD_CP = 100;

/** lines: [{ move, score:{cp,mate} }] (MultiPV order is irrelevant). */
export function rankLines(lines) {
  return (lines || [])
    .filter((l) => l && l.move && l.move !== '(none)')
    .map((l) => ({ ...l, value: l.value !== undefined ? l.value : scoreToCp(l.score) }))
    .sort((a, b) => b.value - a.value);
}

/**
 * Moves allowed by the spread filter: everything within `spreadCp` of the best.
 * A mate-in-hand is only ever traded for another mate (the band keeps them apart).
 */
export function candidatesWithin(lines, spreadCp = DEFAULT_SPREAD_CP) {
  const ranked = rankLines(lines);
  if (!ranked.length) return [];
  const spread = Math.max(0, Number(spreadCp) || 0);
  const best = ranked[0].value;
  const floor = best - spread * 1;
  const pool = ranked.filter((l) => l.value >= floor);
  // Never downgrade a forced mate to a non-mate when the spread is small-ish:
  // a mate score sits ~MATE_CP away from any cp score so the floor already
  // excludes them; this guard covers a deliberately huge spread.
  if (best >= MATE_CP - 60000) {
    const mates = pool.filter((l) => l.value >= MATE_CP - 60000);
    if (mates.length) return mates;
  }
  return pool;
}

/**
 * Weighted pick. `weighting`:
 *   'uniform'  — equal chance for every move inside the window (default)
 *   'softmax'  — bias towards the better moves (temperature = spread/3)
 *   'best'     — deterministic best move
 */
export function pickWithin(lines, spreadCp = DEFAULT_SPREAD_CP, rng = Math.random, weighting = 'uniform') {
  const pool = candidatesWithin(lines, spreadCp);
  if (!pool.length) return null;
  if (weighting === 'best' || pool.length === 1) return pool[0];
  const spread = Math.max(20, Number(spreadCp) || 0);
  const weights = pool.map((l) => {
    if (weighting === 'softmax') {
      const gap = pool[0].value - l.value;
      return Math.exp(-gap / (spread / 1.5));
    }
    return 1;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

/** Debug/help text for the settings screen: what the current spread means. */
export function describeSpread(bestCp, spreadCp) {
  const best = (bestCp || 0) / 100;
  const floor = best - Math.max(0, spreadCp || 0) / 100;
  return `best ${best >= 0 ? '+' : ''}${best.toFixed(2)} → may play down to ${floor >= 0 ? '+' : ''}${floor.toFixed(2)}`;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
