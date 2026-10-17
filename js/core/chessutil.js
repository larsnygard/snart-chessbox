// js/core/chessutil.js — thin, DOM-free helpers around chess.js.
// Everything here is pure so it can be imported by Node tests unchanged.

import { Chess } from '../../vendor/chess.mjs';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const FILES = 'abcdefgh';
export const PIECE_NAME = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' };

export function isValidFen(fen) {
  try { new Chess(String(fen)); return true; } catch (e) { return false; }
}

/** A Chess instance for a FEN, or for the start position. Never throws. */
export function game(fen) {
  try { return fen ? new Chess(fen) : new Chess(); } catch (e) { return new Chess(); }
}

export function turnOf(fen) {
  return String(fen).split(' ')[1] === 'b' ? 'b' : 'w';
}

/** 0x88-ish helpers used by the board renderer. */
export function squareOf(file, rank) { return FILES[file] + (rank + 1); }
export function fileOf(sq) { return FILES.indexOf(sq[0]); }
export function rankOf(sq) { return parseInt(sq[1], 10) - 1; }
export function isLightSquare(sq) { return (fileOf(sq) + rankOf(sq)) % 2 === 1; }

/** chess.js board() → flat map { square: {type,color} } limited to occupied squares. */
export function pieceMap(fen) {
  const out = {};
  let board;
  try { board = game(fen).board(); } catch (e) { return out; }
  for (const row of board) for (const sq of row) if (sq) out[sq.square] = { type: sq.type, color: sq.color };
  return out;
}

export function uciToObj(uci) {
  if (!uci || uci.length < 4) return null;
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined };
}
export function objToUci(from, to, promotion) { return from + to + (promotion || ''); }

/** Legal move objects from a square, as {to, uci, promotion, flags}. */
export function legalFrom(fen, from) {
  const c = game(fen);
  return c.moves({ square: from, verbose: true }).map((m) => ({
    from: m.from, to: m.to, promotion: m.promotion, san: m.san, flags: m.flags,
    uci: m.from + m.to + (m.promotion || ''),
  }));
}

/** All legal moves as {from,to,promotion,san,uci}. */
export function legalMoves(fen) {
  return game(fen).moves({ verbose: true }).map((m) => ({
    from: m.from, to: m.to, promotion: m.promotion, san: m.san,
    uci: m.from + m.to + (m.promotion || ''),
  }));
}

/** Apply a UCI move. Returns {fen, san, captured, flags} or null if illegal. */
export function applyUci(fen, uci) {
  const o = uciToObj(uci);
  if (!o) return null;
  const c = game(fen);
  let m;
  try { m = c.move({ from: o.from, to: o.to, promotion: o.promotion || 'q' }); }
  catch (e) { m = null; }
  if (!m) return null;
  return {
    fen: c.fen(), san: m.san, from: m.from, to: m.to,
    captured: m.captured || null, flags: m.flags || '',
    check: c.isCheck(), mate: c.isCheckmate(), draw: c.isDraw(), stalemate: c.isStalemate(),
    promo: m.promotion || null,
  };
}

export function applySan(fen, san) {
  const c = game(fen);
  let m;
  try { m = c.move(san); } catch (e) { m = null; }
  if (!m) return null;
  return { fen: c.fen(), san: m.san, from: m.from, to: m.to, captured: m.captured || null, promo: m.promotion || null, flags: m.flags || '' };
}

/** SAN list + UCI list for a starting position. Stops at the first illegal move. */
export function sanToUci(fen, sans) {
  let f = fen, ucis = [], sAns = [];
  for (const san of sans) {
    const r = applySan(f, san);
    if (!r) break;
    ucis.push(r.from + r.to + (r.promo || ''));
    sAns.push(r.san);
    f = r.fen;
  }
  return { ucis, sans: sAns, fen: f };
}

export function uciToSan(fen, ucis) {
  let f = fen, sans = [], applied = [];
  for (const uci of ucis) {
    const r = applyUci(f, uci);
    if (!r) break;
    sans.push(r.san);
    applied.push(uci);
    f = r.fen;
  }
  return { sans, ucis: applied, fen: f };
}

/** Rebuild the position after `n` plies of a move list. */
export function fenAfter(fen, ucis, n) {
  let f = fen;
  for (let i = 0; i < Math.min(n, ucis.length); i++) {
    const r = applyUci(f, ucis[i]);
    if (!r) break;
    f = r.fen;
  }
  return f;
}

export function material(fen) {
  const w = { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 };
  const b = { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 };
  const pm = pieceMap(fen);
  for (const sq in pm) (pm[sq].color === 'w' ? w : b)[pm[sq].type]++;
  return { w, b };
}

const val = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export function materialScore(fen) {
  const m = material(fen);
  let s = 0;
  for (const k in val) s += (m.w[k] - m.b[k]) * val[k];
  return s;
}

/**
 * Classify a position for the endgame library / for "is this an endgame" checks.
 * Returns { key, label, category, pieces, isEndgame }.
 */
export function endgameInfo(fen) {
  const m = material(fen);
  const wHeavy = m.w.q * 9 + m.w.r * 5 + m.w.b * 3 + m.w.n * 3;
  const bHeavy = m.b.q * 9 + m.b.r * 5 + m.b.b * 3 + m.b.n * 3;
  const pawns = m.w.p + m.b.p;
  const pieces = Object.values(m.w).reduce((a, b) => a + b, 0) + Object.values(m.b).reduce((a, b) => a + b, 0);
  const isEndgame = (wHeavy + bHeavy) <= 13 || pieces - pawns <= 6;

  const side = (x) => `${x.q ? 'Q' : ''}${x.r ? 'R' : ''}${x.b > 1 ? 'BB' : x.b ? 'B' : ''}${x.n > 1 ? 'NN' : x.n ? 'N' : ''}${x.p ? 'P'.repeat(Math.min(x.p, 4)) : ''}`;
  const w = side(m.w) || 'K', b = side(m.b) || 'K';

  let key = 'other', label = `${w} vs ${b}`, category = 'mixed';
  const lone = (x) => (x.p + x.n + x.b + x.r + x.q) === 0;
  if (lone(m.w) && lone(m.b)) { key = 'kvk'; label = 'King vs King'; category = 'draw'; }
  else if (lone(m.b) && m.w.q && !m.w.r && !m.w.b && !m.w.n && !m.w.p) { key = 'kqk'; label = 'King + Queen vs King'; category = 'mate'; }
  else if (lone(m.b) && m.w.r && !m.w.q && !m.w.b && !m.w.n && !m.w.p) { key = 'krk'; label = 'King + Rook vs King'; category = 'mate'; }
  else if (lone(m.b) && m.w.b === 2 && !m.w.q && !m.w.r && !m.w.n && !m.w.p) { key = 'kbbk'; label = 'King + Two Bishops vs King'; category = 'mate'; }
  else if (lone(m.b) && m.w.b === 1 && m.w.n === 1 && !m.w.q && !m.w.r && !m.w.p) { key = 'kbnk'; label = 'King + Bishop + Knight vs King'; category = 'mate'; }
  else if (lone(m.b) && m.w.n === 2 && !m.w.b && !m.w.q && !m.w.r && !m.w.p) { key = 'knnk'; label = 'King + Two Knights vs King'; category = 'draw'; }
  else if (lone(m.b) && m.w.p === 1 && !m.w.q && !m.w.r && !m.w.b && !m.w.n) { key = 'kpk'; label = 'King + Pawn vs King'; category = 'pawn'; }
  else if (lone(m.w) && m.b.p === 1 && !m.b.q && !m.b.r && !m.b.b && !m.b.n) { key = 'kpk'; label = 'King + Pawn vs King'; category = 'pawn'; }
  else if (m.w.p + m.b.p === 0) { key = 'no-pawns'; category = 'pieces'; }
  else if (m.w.q + m.b.q === 0 && m.w.r + m.b.r === 0) { key = 'minor'; category = 'minor'; }
  else if (m.w.q + m.b.q === 0) { key = 'rook'; category = 'rook'; }
  else { key = 'queen'; category = 'queen'; }

  return { key, label, category, pieces, isEndgame, material: m };
}

export function insufficientMaterial(fen) {
  try { return game(fen).isInsufficientMaterial(); } catch (e) { return false; }
}

/** Centipawn value of a UCI score object, mate scores folded into a large band. */
export const MATE_CP = 100000;
export function scoreToCp(score) {
  if (!score) return -MATE_CP;
  if (score.mate !== undefined && score.mate !== null && Number.isFinite(score.mate)) {
    const m = score.mate;
    if (m > 0) return MATE_CP - Math.min(m, 500) * 100;
    if (m < 0) return -MATE_CP + Math.min(-m, 500) * 100;
  }
  return Number.isFinite(score.cp) ? score.cp : 0;
}

export function formatEval(cp, mate) {
  if (mate !== undefined && mate !== null && mate !== 0) return `M${Math.abs(mate)}`;
  const v = (cp || 0) / 100;
  return (v > 0 ? '+' : v < 0 ? '' : '') + v.toFixed(2);
}

/** Lichess-style win probability in percent (0..100). */
export function winProbability(cp) {
  const c = Math.max(-2000, Math.min(2000, cp || 0));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}

/** Normalise a "moves from now on" wdl counter: how many plies a UCI score survives. */
export function scoreLabel(score) {
  if (!score) return '–';
  if (score.mate !== undefined && score.mate !== null) return `M${Math.abs(score.mate)}`;
  return formatEval(score.cp);
}
