// js/core/setup.js — the board editor's data layer.
//
// The analysis board accepts a hand-built position, so "is this a position a
// chess game can actually reach?" cannot live in the view: it is a pure function
// here (tests/setup.test.mjs replays the cases). Squares are a plain map —
// { e4: {type:'p', color:'w'}, ... } — so half-built boards (no kings yet) are
// representable, and the FEN is only assembled when we ask.

import { Chess } from '../../vendor/chess.mjs';
import { FILES, START_FEN } from './chessutil.js';

export const CASTLE_RIGHTS = ['K', 'Q', 'k', 'q'];
const TYPES = 'kqrbnp';

export function emptyMap() { return {}; }

/** Squares of a FEN's board field. Tolerant: a broken board yields what parsed. */
export function mapFromFen(fen) {
  const map = {};
  const rows = String(fen || '').split(' ')[0].split('/');
  if (rows.length !== 8) return map;
  rows.forEach((row, i) => {
    const rank = 8 - i;
    let file = 0;
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') { file += Number(ch); continue; }
      const type = ch.toLowerCase();
      if (!TYPES.includes(type) || file > 7) { file++; continue; }
      map[FILES[file] + rank] = { type, color: ch === ch.toUpperCase() ? 'w' : 'b' };
      file++;
    }
  });
  return map;
}

/** Build the FEN. `castling` may be a string ('KQ') or an iterable of rights. */
export function mapToFen(map, { turn = 'w', castling = '', ep = '-' } = {}) {
  const rows = [];
  for (let rank = 8; rank >= 1; rank--) {
    let row = '';
    let empty = 0;
    for (const f of FILES) {
      const p = map[f + rank];
      if (!p) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      row += p.color === 'w' ? p.type.toUpperCase() : p.type;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  const held = Array.from(castling || []);
  const rights = CASTLE_RIGHTS.filter((r) => held.includes(r)).join('') || '-';
  const target = ep && ep !== '-' ? ep : '-';
  return `${rows.join('/')} ${turn === 'b' ? 'b' : 'w'} ${rights} ${target} 0 1`;
}

export function startMap() { return mapFromFen(START_FEN); }

/** Split a FEN into the editor's state. */
export function readFen(fen) {
  const parts = String(fen || '').trim().split(/\s+/);
  return {
    map: mapFromFen(fen),
    turn: parts[1] === 'b' ? 'b' : 'w',
    castling: (parts[2] || '-').split('').filter((r) => CASTLE_RIGHTS.includes(r)),
    ep: parts[3] && parts[3] !== '-' ? parts[3] : '-',
  };
}

/**
 * En passant squares this position could legally carry for `turn`.
 *
 * The FEN's ep field names the square *behind* the pawn that just advanced two
 * squares: White's e2-e4 leaves e3 (rank 3), Black's e7-e5 leaves e6 (rank 6) —
 * so with White to move only rank-6 targets make sense. A target is only offered
 * when the doubled pawn is still standing there, the square in front of it is
 * empty, and a pawn of the side to move stands beside it ready to capture.
 */
export function epCandidates(map, turn) {
  const out = [];
  const rank = turn === 'w' ? 5 : 4;          // rank the doubled pawn stands on
  const targetRank = turn === 'w' ? 6 : 3;    // rank of the ep square itself
  const doubled = turn === 'w' ? 'b' : 'w';   // colour of the pawn that moved
  const captor = turn === 'w' ? 'w' : 'b';
  FILES.split('').forEach((f, i) => {
    const pawn = map[f + rank];
    if (!pawn || pawn.type !== 'p' || pawn.color !== doubled) return;
    if (map[f + targetRank]) return;          // the ep square must be empty
    const neighbours = [FILES[i - 1], FILES[i + 1]].filter(Boolean)
      .some((n) => {
        const q = map[n + rank];
        return q && q.type === 'p' && q.color === captor;
      });
    if (neighbours) out.push(f + targetRank);
  });
  return out;
}

/**
 * Everything a hand-built position must satisfy before it can be analysed.
 * Returns { ok, errors, warnings, fen } — errors block, warnings do not.
 */
export function validateSetup(map, opts = {}) {
  const turn = opts.turn === 'b' ? 'b' : 'w';
  const castling = Array.from(opts.castling || []).filter((r) => CASTLE_RIGHTS.includes(r));
  const ep = opts.ep && opts.ep !== '-' ? String(opts.ep) : '-';
  const errors = [];
  const warnings = [];

  const kings = { w: [], b: [] };
  const counts = { w: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0, total: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0, total: 0 } };
  for (const sq in map) {
    const p = map[sq];
    if (!p || !TYPES.includes(p.type) || (p.color !== 'w' && p.color !== 'b')) continue;
    counts[p.color][p.type]++;
    counts[p.color].total++;
    if (p.type === 'k') kings[p.color].push(sq);
    if (p.type === 'p' && (sq[1] === '1' || sq[1] === '8')) errors.push(`A pawn cannot stand on ${sq}`);
  }

  const label = { w: 'White', b: 'Black' };
  for (const side of ['w', 'b']) {
    if (kings[side].length === 0) errors.push(`${label[side]} has no king`);
    else if (kings[side].length > 1) errors.push(`${label[side]} has ${kings[side].length} kings`);
    const c = counts[side];
    if (c.p > 8) errors.push(`${label[side]} has ${c.p} pawns (at most 8)`);
    if (c.total > 16) errors.push(`${label[side]} has ${c.total} pieces (at most 16)`);
  }

  // castling rights need the pieces that carry them
  const has = (sq, type, color) => !!map[sq] && map[sq].type === type && map[sq].color === color;
  const rightChecks = [
    ['K', has('e1', 'k', 'w') && has('h1', 'r', 'w'), 'White kingside: the king on e1 and the rook on h1'],
    ['Q', has('e1', 'k', 'w') && has('a1', 'r', 'w'), 'White queenside: the king on e1 and the rook on a1'],
    ['k', has('e8', 'k', 'b') && has('h8', 'r', 'b'), 'Black kingside: the king on e8 and the rook on h8'],
    ['q', has('e8', 'k', 'b') && has('a8', 'r', 'b'), 'Black queenside: the king on e8 and the rook on a8'],
  ];
  for (const [right, ok, text] of rightChecks) {
    if (castling.includes(right) && !ok) errors.push(`Cannot offer ${right === right.toUpperCase() ? 'White' : 'Black'} ${right.toLowerCase() === 'k' ? 'kingside' : 'queenside'} castling without ${text}`);
  }

  if (ep !== '-') {
    if (!/^[a-h][36]$/.test(ep)) errors.push(`The en passant square must be on rank 3 or 6 (got ${ep})`);
    else if (map[ep]) errors.push(`The en passant square ${ep} must be empty`);
    else {
      const rank = ep[1] === '3' ? '4' : '5';
      const movedColor = ep[1] === '3' ? 'w' : 'b';
      if (!has(ep[0] + rank, 'p', movedColor)) {
        errors.push(`En passant on ${ep} needs the ${movedColor === 'w' ? 'white' : 'black'} pawn that just moved to be on ${ep[0] + rank}`);
      }
      const wantRank = turn === 'w' ? '6' : '3';
      if (ep[1] !== wantRank) errors.push(`With ${label[turn]} to move the en passant square belongs on rank ${wantRank}, not ${ep[1]}`);
      if (!epCandidates(map, turn).includes(ep)) warnings.push(`No pawn can capture on ${ep}, so the engine will ignore it`);
    }
  }

  const fen = mapToFen(map, { turn, castling, ep });
  if (!errors.length) {
    let chess = null;
    try { chess = new Chess(fen); } catch (e) { errors.push('That position cannot be read as a chess position'); }
    if (chess) {
      // the side that just moved may not have left its own king in check
      const flipped = fen.replace(/ ([wb]) /, (m, t) => ` ${t === 'w' ? 'b' : 'w'} `);
      let otherInCheck = false;
      try { otherInCheck = new Chess(flipped).isCheck(); } catch (e) { otherInCheck = false; }
      if (otherInCheck) errors.push(`${label[turn === 'w' ? 'b' : 'w']} is in check, but ${label[turn]} is to move`);
      if (!errors.length) {
        let moves = [];
        try { moves = chess.moves(); } catch (e) { errors.push('This position has no legal moves to analyse'); }
        if (moves.length === 0 && !errors.length) {
          warnings.push(chess.isCheckmate() ? 'Checkmate: there is nothing left to analyse here' : 'Stalemate: there is nothing left to analyse here');
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings, fen };
}
