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
/** The placement half of a position key — the position without the side to move. */
export function placementKey(key) {
  return String(key || '').split(' ')[0] || '';
}

export function matchPly(key, startFen, sans, { ignoreTurn = false } = {}) {
  if (!key) return -1;
  const targetKey = ignoreTurn ? placementKey(key) : key;
  const same = (fenKey) => (ignoreTurn ? placementKey(fenKey) === targetKey : fenKey === targetKey);
  const target = pieceCount(key.split(' ')[0]);
  let chess;
  try { chess = new Chess(startFen || START_FEN); } catch (e) { return -1; }
  let pieces = pieceCount(chess.fen().split(' ')[0]);
  if (pieces === target && same(positionKey(chess.fen()))) return 0;
  const moves = sans || [];
  for (let i = 0; i < moves.length; i++) {
    let done;
    try { done = chess.move(moves[i]); } catch (e) { return -1; }
    if (!done) return -1;
    if (done.captured) pieces--;
    if (pieces !== target) continue;
    if (same(positionKey(chess.fen()))) return i + 1;
  }
  return -1;
}

/**
 * Match a batch of games: `[{ id, startFen, moves }]` → `[{ id, ply }]`.
 * `ply` is the half-move count from the game's start (0 = before any move).
 */
export function findPosition(fen, games, opts = {}) {
  const key = positionKey(normaliseFen(fen) || '');
  if (!key) return [];
  const out = [];
  for (const g of games || []) {
    const ply = matchPly(key, g.startFen, g.moves, opts);
    if (ply >= 0) out.push({ id: g.id, ply });
  }
  return out;
}

/** FNV-1a over a position key — the 32 bits the index stores per position. */
export function hashKey(key) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Both hashes a placement can have (one per side to move). */
export function placementHashes(key) {
  const placement = placementKey(key);
  if (!placement) return [];
  return [hashKey(`${placement} w`), hashKey(`${placement} b`)];
}

/**
 * Every position a game passes through, as hashes: [start, after ply 1, ...].
 * This is what an index stores, so a later search is a table lookup instead of a
 * replay (SCID's approach).
 */
export function gamePositionHashes(startFen, sans) {
  const out = [];
  let chess;
  try { chess = new Chess(startFen || START_FEN); } catch (e) { return new Uint32Array(0); }
  out.push(hashKey(positionKey(chess.fen())));
  for (const san of sans || []) {
    let done;
    try { done = chess.move(san); } catch (e) { break; }
    if (!done) break;
    out.push(hashKey(positionKey(chess.fen())));
  }
  return Uint32Array.from(out);
}

/** Where each game's hashes start inside the flattened array. */
export function indexOffsets(counts) {
  const out = new Array(counts.length);
  let at = 0;
  for (let i = 0; i < counts.length; i++) { out[i] = at; at += counts[i]; }
  return out;
}

/**
 * All `{ game, ply }` where the hash occurs. A hash is 32 bits, so a collision is
 * possible (about 1 in 5,000 over a large collection) — callers verify the rows
 * they show with matchPly().
 */
export function lookupHashes(hashes, offsets, counts, target) {
  const hits = [];
  const n = offsets.length;
  for (let i = 0; i < hashes.length; i++) {
    if (hashes[i] !== target) continue;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (offsets[mid] <= i) lo = mid; else hi = mid - 1;
    }
    if (counts[lo] > 0 && i - offsets[lo] < counts[lo]) hits.push({ game: lo, ply: i - offsets[lo] });
  }
  return hits;
}
