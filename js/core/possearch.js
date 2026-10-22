// js/core/possearch.js — "find the games that reach this position".
//
// A FEN alone cannot say *which* move order produced it, so the only honest way
// to search a PGN database by position is to replay the games. Everything here is
// pure (and tested in tests/possearch.test.mjs); the database layer feeds it game
// records in batches and keeps the ones that match.
//
// What counts as "the same position": the piece placement **and** the side to
// move. Castling rights, the en passant square and the clocks are ignored on
// purpose — the same position reached by a different move order can carry
// different rights, and a database search is about the pieces.

import { Chess } from '../../vendor/chess.mjs';
import { START_FEN } from './chessutil.js';

/**
 * `'<placement> <side>'` — the part of a FEN that identifies a position.
 *
 * Deliberately string work only: this runs once per ply of every replayed game, so
 * a `new Chess(...)` in here turns a 1-second scan into a minute. Validation that
 * needs the rules engine lives in isValidFenText(), called once per search.
 */
export function positionKey(fen) {
  const parts = String(fen || '').trim().split(/\s+/);
  if (parts.length < 2) return null;
  const placement = parts[0];
  if (!/^[rnbqkpRNBQKP1-8/]+$/.test(placement) || placement.split('/').length !== 8) return null;
  const side = String(parts[1]).toLowerCase();
  if (side !== 'w' && side !== 'b') return null;
  return `${placement} ${side}`;
}

/** A full FEN the rules engine accepts (once per search, not per ply). */
export function isValidFenText(fen) {
  if (!positionKey(fen)) return false;
  try { new Chess(String(fen)); return true; } catch (e) { return false; }
}

/** A full FEN, or the `board side` shorthand books use, or null. */
export function normaliseFen(raw) {
  const text = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!text) return null;
  const key = positionKey(text);
  if (!key) return null;
  const rest = text.split(' ').slice(2);
  // keep the caller's castling/ep/clocks when they are there, else neutral values
  const full = `${key} ${rest.join(' ') || '- - 0 1'}`.replace(/\s+/g, ' ').trim();
  return isValidFenText(full) ? full : null;
}

function pieceCount(placement) {
  let n = 0;
  for (const ch of String(placement || '')) if (/[rnbqkpRNBQKP]/.test(ch)) n++;
  return n;
}

/**
 * Earliest ply at which `startFen` + `sans` reaches the position, or -1.
 * Returns 0 for the game's own starting position.
 *
 * `key` must come from positionKey(). Piece counts only ever fall during a game,
 * so the FEN comparison is skipped on every ply where the material cannot match —
 * that is what keeps a 10,000-game scan interactive.
 */
export function matchPly(key, startFen, sans) {
  if (!key) return -1;
  const target = pieceCount(key.split(' ')[0]);
  let chess;
  try { chess = new Chess(startFen || START_FEN); } catch (e) { return -1; }
  let pieces = pieceCount(chess.fen().split(' ')[0]);
  if (pieces === target && positionKey(chess.fen()) === key) return 0;
  const moves = sans || [];
  for (let i = 0; i < moves.length; i++) {
    let done;
    try { done = chess.move(moves[i]); } catch (e) { return -1; }
    if (!done) return -1;
    if (done.captured) pieces--;
    if (pieces !== target) continue;
    if (positionKey(chess.fen()) === key) return i + 1;
  }
  return -1;
}

/**
 * Match a batch of games: `[{ id, startFen, moves }]` → `[{ id, ply }]`.
 * `ply` is the half-move count from the game's start (0 = before any move).
 */
export function findPosition(fen, games) {
  const key = positionKey(normaliseFen(fen) || '');
  if (!key) return [];
  const out = [];
  for (const g of games || []) {
    const ply = matchPly(key, g.startFen, g.moves);
    if (ply >= 0) out.push({ id: g.id, ply });
  }
  return out;
}
