// js/core/pgn.js — PGN parsing/serialising without a third-party parser.
// Tolerant by design: comments, NAGs, nested variations, clock/eval comments,
// missing headers, multi-game files and lichess-style exports all load.

import { Chess } from '../../vendor/chess.mjs';
import { START_FEN, applySan } from './chessutil.js';

const RESULT_TOKENS = new Set(['1-0', '0-1', '1/2-1/2', '*', '½-½']);

/** Remove {comments}, ;line comments, %escape lines, and (nested) variations. */
export function cleanMovetext(text) {
  let out = '';
  let i = 0;
  let depth = 0;
  const s = String(text || '');
  while (i < s.length) {
    const ch = s[i];
    if (ch === '{') { const j = s.indexOf('}', i + 1); i = j < 0 ? s.length : j + 1; continue; }
    if (ch === ';') { const j = s.indexOf('\n', i); i = j < 0 ? s.length : j; continue; }
    if (ch === '%' && (i === 0 || s[i - 1] === '\n')) { const j = s.indexOf('\n', i); i = j < 0 ? s.length : j; continue; }
    if (ch === '(') { depth++; i++; continue; }
    if (ch === ')') { if (depth > 0) depth--; i++; continue; }
    if (depth > 0) { i++; continue; }
    out += ch;
    i++;
  }
  return out;
}

/** Split a multi-game PGN file into raw game strings. */
export function splitGames(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const games = [];
  let cur = [];
  let seenMoves = false;
  const flush = () => {
    const body = cur.join('\n').trim();
    if (body) games.push(body);
    cur = [];
    seenMoves = false;
  };
  for (const line of lines) {
    const isHeader = /^\s*\[[A-Za-z0-9_]+\s+"/.test(line);
    // A header after we already consumed movetext means a new game started.
    if (isHeader && seenMoves) flush();
    if (!isHeader && line.trim()) seenMoves = true;
    cur.push(line);
  }
  flush();
  return games;
}

export function parseHeaders(raw) {
  const headers = {};
  const re = /^\s*\[([A-Za-z0-9_]+)\s+"([^"]*)"\s*\]/gm;
  let m;
  while ((m = re.exec(raw))) headers[m[1]] = m[2];
  return headers;
}

export function movetextOf(raw) {
  return String(raw || '')
    .replace(/^\s*\[[A-Za-z0-9_]+\s+"[^"]*"\s*\]\s*$/gm, '')
    .trim();
}

/**
 * Tokens of a movetext: SAN moves only (numbers, NAGs, results and stray
 * annotation glyphs removed).
 */
export function movetextTokens(raw) {
  const clean = cleanMovetext(movetextOf(raw))
    .replace(/\$\d+/g, ' ')
    .replace(/\d+\.(\.\.)?/g, ' ')
    .replace(/[!?]+/g, '');
  return clean
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !RESULT_TOKENS.has(t))
    .filter((t) => !/^(1-0|0-1|1\/2|½)/.test(t));
}

export function parseGame(raw, fallbackFen = START_FEN) {
  const headers = parseHeaders(raw);
  const startFen = headers.FEN && headers.FEN.includes(' ') ? headers.FEN : fallbackFen;
  const tokens = movetextTokens(raw);
  let fen = startFen;
  const moves = [];
  const ucis = [];
  const errors = [];
  for (const san of tokens) {
    const r = applySan(fen, san);
    if (!r) { errors.push(san); break; }
    moves.push(r.san);
    ucis.push(r.from + r.to + (r.promo || ''));
    fen = r.fen;
  }
  const result = headers.Result && RESULT_TOKENS.has(headers.Result) ? headers.Result : guessResult(raw);
  return { headers, startFen, moves, ucis, fen, result, errors, raw };
}

function guessResult(raw) {
  const tail = cleanMovetext(movetextOf(raw)).trim().split(/\s+/).slice(-1)[0];
  return RESULT_TOKENS.has(tail) ? (tail === '½-½' ? '1/2-1/2' : tail) : '*';
}

/** Parse a whole file. Invalid games are returned with `.errors` populated. */
export function parsePGN(text, fallbackFen = START_FEN) {
  return splitGames(text).map((raw) => parseGame(raw, fallbackFen));
}

export function wrapMovetext(moves, startFen = START_FEN) {
  const parts = [];
  const startsBlack = startFen.split(' ')[1] === 'b';
  let moveNo = parseInt((startFen.split(' ')[5] || '1'), 10) || 1;
  moves.forEach((san, i) => {
    const whiteTurn = startsBlack ? i % 2 === 1 : i % 2 === 0;
    if (whiteTurn) parts.push(`${moveNo}.`);
    else if (i === 0) parts.push(`${moveNo}...`);
    parts.push(san);
    if (!whiteTurn) moveNo++;
  });
  // wrap at ~80 chars per line
  const lines = [];
  let line = '';
  for (const p of parts) {
    if ((line + ' ' + p).trim().length > 78) { lines.push(line.trim()); line = ''; }
    line += ' ' + p;
  }
  if (line.trim()) lines.push(line.trim());
  return lines.join('\n');
}

export function buildPGN({ headers = {}, moves = [], result, startFen = START_FEN }) {
  const h = {
    Event: 'Snart Chess Trainer',
    Site: '?',
    Date: new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
    Round: '?',
    White: '?',
    Black: '?',
    Result: result || '*',
    ...headers,
  };
  if (startFen && startFen !== START_FEN) {
    h.SetUp = '1';
    h.FEN = startFen;
  }
  const head = Object.entries(h)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `[${k} "${String(v).replace(/"/g, "'")}"]`)
    .join('\n');
  return `${head}\n\n${wrapMovetext(moves, startFen)}\n${h.Result}\n`;
}

export function pgnMulti(games) {
  return games.map((g) => buildPGN(g)).join('\n');
}

/** Very rough opening-name lookup from a move list (first matching prefix wins). */
export function openingNameFromMoves(moves, openings) {
  if (!openings || !openings.length || !moves.length) return null;
  const key = moves.join(' ');
  let best = null;
  for (const o of openings) {
    const p = o.p;
    if (p === key) return o;
    if (key.startsWith(p + ' ') && (!best || p.length > best.p.length)) best = o;
  }
  return best;
}

/** Sanity: does a PGN block parse into at least one legal move? */
export function looksLikePGN(text) {
  const g = parsePGN(text);
  return g.some((x) => x.moves.length > 0);
}

/** Count plies a game lasts — cheap "is this a real game" check. */
export function plyCount(raw) {
  const g = parseGame(raw);
  return g.moves.length;
}

export function chessFromStart(fen) { return new Chess(fen || START_FEN); }
