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

const CAL_COLOUR = { G: 'green', R: 'red', Y: 'yellow', B: 'blue' };
const CAL_LETTER = { green: 'G', red: 'R', yellow: 'Y', blue: 'B' };

/** Split a PGN comment body into free text plus `[%cal ...]` arrows. */
export function parseAnnotationText(body) {
  const arrows = [];
  const cal = /\[%cal\s+([^\]]+)\]/i.exec(body || '');
  if (cal) {
    for (const part of cal[1].split(',')) {
      const m = /^\s*([GRYB])([a-h][1-8])([a-h][1-8])\s*$/.exec(part);
      if (m) arrows.push({ from: m[2], to: m[3], color: CAL_COLOUR[m[1]] || 'green' });
    }
  }
  const comment = String(body || '').replace(/\[%cal\s+[^\]]+\]/ig, '').trim();
  return { comment, arrows };
}

/** Annotations → PGN comment, e.g. `{text [%cal Gc1f4,Re8e4]}`. */
export function annotationToPgn(ann) {
  if (!ann) return '';
  const parts = [];
  if (ann.arrows && ann.arrows.length) {
    parts.push('[%cal ' + ann.arrows.map((a) => (CAL_LETTER[a.color] || 'G') + a.from + a.to).join(',') + ']');
  }
  if (ann.comment) parts.push(String(ann.comment).replace(/[{}]/g, '').trim());
  return parts.length ? `{${parts.join(' ')}}` : '';
}

/**
 * Comments and arrows from a PGN block, keyed by the number of plies played
 * (0 = the starting position). Comments inside variations are ignored.
 */
export function parseAnnotations(raw) {
  const text = movetextOf(raw);
  const out = {};
  let ply = 0;
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '(') { depth++; i++; continue; }
    if (ch === ')') { if (depth) depth--; i++; continue; }
    if (ch === ';') { const j = text.indexOf('\n', i); i = j < 0 ? text.length : j; continue; }
    if (ch === '{') {
      const j = text.indexOf('}', i + 1);
      const body = text.slice(i + 1, j < 0 ? text.length : j);
      i = j < 0 ? text.length : j + 1;
      if (depth === 0) {
        const parsed = parseAnnotationText(body);
        if (parsed.comment || parsed.arrows.length) {
          const cur = out[ply] || { comment: '', arrows: [] };
          out[ply] = {
            comment: [cur.comment, parsed.comment].filter(Boolean).join(' ').trim(),
            arrows: cur.arrows.concat(parsed.arrows),
          };
        }
      }
      continue;
    }
    const m = /^\s*([^\s(){};]+)/.exec(text.slice(i));
    if (!m) { i++; continue; }
    i += m[0].length;
    const tok = m[1];
    if (/^\d+\.(\.\.)?$/.test(tok)) continue;
    if (/^(1-0|0-1|1\/2-1\/2|½-½|\*)$/.test(tok)) continue;
    if (tok.startsWith('$') || /^[!?]+$/.test(tok)) continue;
    ply += 1;
  }
  return out;
}

export function wrapMovetext(moves, startFen = START_FEN, annotations = null) {
  const parts = [];
  const startsBlack = startFen.split(' ')[1] === 'b';
  let moveNo = parseInt((startFen.split(' ')[5] || '1'), 10) || 1;
  moves.forEach((san, i) => {
    const whiteTurn = startsBlack ? i % 2 === 1 : i % 2 === 0;
    if (whiteTurn) parts.push(`${moveNo}.`);
    else if (i === 0) parts.push(`${moveNo}...`);
    parts.push(san);
    if (annotations) {
      const ann = annotations[i + 1];
      const text = annotationToPgn(ann);
      if (text) parts.push(text);
    }
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

export function buildPGN({ headers = {}, moves = [], result, startFen = START_FEN, annotations = null }) {
  const h = {
    Event: 'SnartChessBox',
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
  return `${head}\n\n${wrapMovetext(moves, startFen, annotations)}\n${h.Result}\n`;
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
