// js/trainers/common.js — helpers shared by all training screens.

import { applyUci } from '../core/chessutil.js';

export function uciFromMove({ from, to, promotion }) {
  return from + to + (promotion || '');
}

/** Ask the engine for a move in `fen`. `strong` ignores strength/spread. */
export async function enginePickUci(ctx, fen, { strong = false, movetime, spreadCp, elo } = {}) {
  const s = ctx.settings;
  const eng = ctx.engine();
  const res = await eng.pickMove({
    fen,
    movetime: movetime || s.thinkMs,
    spreadCp: strong ? 0 : (spreadCp !== undefined ? spreadCp : s.spreadCp),
    elo: strong ? 0 : (elo !== undefined ? elo : s.strength),
    weighting: s.spreadWeighting || 'uniform',
  });
  return res.uci;
}

/** Play a UCI move on a fen, returning the applyUci result (or null). */
export function play(fen, uci) { return applyUci(fen, uci); }

export function arrowOf(uci, color = 'hint') {
  if (!uci) return null;
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), color };
}

export function moveNumberLabel(ply, startTurn = 'w') {
  const n = Math.floor(ply / 2) + 1;
  return startTurn === 'w' ? `${n}${ply % 2 === 0 ? '.' : '...'}` : `${n}${ply % 2 === 0 ? '...' : '.'}`;
}

export function strengthLabel(elo) {
  if (!elo) return 'Full strength';
  if (elo >= 3000) return 'Full strength';
  if (elo < 1320) return `~${elo} (skill-limited)`;
  return `${elo} Elo`;
}

export function resultBadge(status) {
  if (status === 'win') return { text: 'Solved', kind: 'good' };
  if (status === 'fail') return { text: 'Failed', kind: 'bad' };
  return { text: 'In progress', kind: '' };
}
