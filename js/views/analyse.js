// js/views/analyse.js — a free analysis board.
//
// Nothing is being trained here and no game is in progress: you get an empty
// move tree, paste a position (FEN) or a whole game (PGN), and play whatever you
// like — a different move becomes a new variation beside the recorded one. The
// board carries the standard tool strip, so the engine's top three moves arrive
// as ranked arrows, as a list with W/D/L, and "Think deeper" keeps the engine
// running across screens. Clicking one of the engine's moves plays it.
//
// The session is remembered (tree + cursor) so leaving for Settings and coming
// back does not cost the analysis.

import { state, navigate, trainerCtx } from '../app.js';
import { el, icon, modal, toast } from '../ui/components.js';
import { START_FEN, isValidFen, turnOf } from '../core/chessutil.js';
import { emptyTree, addLine, treeStats, treeLines } from '../core/repertoire.js';
import { parsePGN } from '../core/pgn.js';
import { createExplorer } from '../ui/explorer.js';
import { saveResume, matchResume } from '../ui/resume.js';

const RESUME_KEY = 'analyse';

export function render(host, params, query) {
  host.innerHTML = '';
  // ---- what to analyse: a FEN from the address bar, the last session, or nothing
  let tree = emptyTree('w', START_FEN);
  let startPath = [];
  const qFen = query && query.fen ? normaliseFen(query.fen) : null;
  if (qFen) {
    tree = emptyTree(turnOf(qFen), qFen);
  } else {
    const saved = matchResume(RESUME_KEY);
    if (saved && saved.fen && isValidFen(saved.fen)) {
      tree = emptyTree(turnOf(saved.fen), saved.fen);
      for (const line of saved.lines || []) addLine(tree, line);
      startPath = Array.isArray(saved.path) ? saved.path : [];
    }
  }

  const badge = el('span', { class: 'badge', text: '' });
  const top = el('div', { class: 'row', style: 'margin-bottom:10px;gap:8px;flex-wrap:wrap' },
    el('strong', { text: 'Analysis' }),
    badge,
    el('div', { class: 'spacer' }),
    el('button', { class: 'btn sm', text: 'Position (FEN)…', onclick: fenDialog }),
    el('button', { class: 'btn sm', text: 'Game (PGN)…', onclick: gameDialog }),
    el('button', { class: 'btn sm', text: 'Copy FEN', onclick: copyFen }),
    el('button', { class: 'btn sm ghost', text: 'Clear', onclick: clearBoard }));
  const body = el('div');
  host.append(top, body);

  let explorer = null;      // declared before mount(): onCursor fires during mount
  let saveTimer = null;

  function mount(pathAfter = null) {
    if (explorer) { explorer.destroy(); explorer = null; }
    body.innerHTML = '';
    explorer = createExplorer(body, {
      tree,
      initialPath: pathAfter || [],
      editable: true,
      settings: state.settings,
      engine: trainerCtx().engine,
      title: 'Analysis board',
      labels: {
        badge: 'Analysis',
        listTitle: 'Moves (click to jump — play anything to add a variation)',
        treeSummary: 'All lines',
        empty: 'Play any move on the board, or click one of the engine’s moves below it.',
      },
      onChange: () => markDirty(),
      onCursor: () => { updateBadge(); markDirty(); },
      onEngineMove: (uci) => { if (explorer) explorer.playUci(uci); },
      onPlayFromHere: (fen, turn) => navigate(`/coach?fen=${encodeURIComponent(fen)}&side=${turn}&title=${encodeURIComponent('From the analysis board')}`),
    });
    updateBadge();
    markDirty();
  }

  function updateBadge() {
    const st = treeStats(tree);
    badge.textContent = `${st.nodes} position${st.nodes === 1 ? '' : 's'} · ${st.leaves} line${st.leaves === 1 ? '' : 's'}`;
  }

  /** Remember the session (debounced: this runs on every cursor move). */
  function markDirty() {
    if (!explorer) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!explorer) return;
      saveResume(RESUME_KEY, 'analyse', {
        fen: tree.fen,
        lines: treeLines(tree, 400),
        path: explorer.path,
        cursor: explorer.cursor,
      }, describe());
    }, 400);
  }

  function describe() {
    const st = treeStats(tree);
    return st.nodes ? `Analysis · ${st.nodes} positions` : 'Analysis board';
  }

  // ---------------------------------------------------------------- loading
  function loadPosition(fen) {
    tree = emptyTree(turnOf(fen), fen);
    startPath = [];
    mount();
    toast('Position loaded', 'ok');
  }

  function loadGame(g) {
    tree = emptyTree(turnOf(g.startFen || START_FEN), g.startFen || START_FEN);
    const added = addLine(tree, g.moves || []);
    if (!added.ok) { toast(`Stopped at ${added.at || 'an illegal move'}`, 'bad'); return false; }
    startPath = (g.moves || []).slice();
    mount(startPath);
    toast(`Game loaded — ${startPath.length} moves`, 'ok');
  }

  function clearBoard() {
    tree = emptyTree('w', START_FEN);
    startPath = [];
    mount();
    toast('Board cleared', '');
  }

  function fenDialog() {
    const input = el('textarea', { style: 'min-height:84px', placeholder: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4' });
    input.value = explorer ? explorer.fen : START_FEN;
    modal({
      title: 'Analyse a position',
      body: el('div', {},
        input,
        el('div', { class: 'faint', style: 'font-size:.78rem;margin-top:6px', text: 'A FEN from anywhere — a book, a puzzle, another app. FENs that stop after the side to move are completed automatically.' })),
      actions: [
        { label: 'Cancel' },
        {
          label: 'Load', primary: true, onClick: () => {
            const fen = normaliseFen(input.value);
            if (!fen) { toast('That is not a valid FEN', 'bad'); return false; }
            loadPosition(fen);
          },
        },
      ],
    });
  }

  function gameDialog() {
    const area = el('textarea', { style: 'min-height:170px', placeholder: 'Paste a PGN — one game is enough; extra games are ignored.' });
    const file = el('input', { type: 'file', accept: '.pgn,.txt,text/plain', style: 'display:none' });
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      area.value = await f.text();
      toast(`${f.name} loaded`, '');
    });
    modal({
      title: 'Analyse a game',
      body: el('div', {},
        el('div', { class: 'row', style: 'margin-bottom:8px' },
          el('button', { class: 'btn sm', html: `${icon('upload')}<span>Load PGN file…</span>`, onclick: () => file.click() })),
        area,
        file,
        el('div', { class: 'faint', style: 'font-size:.78rem;margin-top:6px', text: 'The whole game becomes the move list, ending on the last move. Deviate anywhere to add a variation; the arrow buttons step back and forward.' })),
      actions: [
        { label: 'Cancel' },
        {
          label: 'Load game', primary: true, onClick: () => {
            const games = parsePGN(area.value || '');
            const game = games.find((g) => g.moves && g.moves.length);
            if (!game) { toast('No legal moves found in that PGN', 'bad'); return false; }
            return loadGame(game) === false ? false : undefined;
          },
        },
      ],
    });
  }

  async function copyFen() {
    const fen = explorer ? explorer.fen : START_FEN;
    try {
      await navigator.clipboard.writeText(fen);
      toast('FEN copied', 'ok');
    } catch (e) {
      toast('Could not copy the FEN here', 'bad');
    }
  }

  mount(startPath);
  return {
    destroy() {
      clearTimeout(saveTimer);
      if (explorer) explorer.destroy();
    },
  };
}

/**
 * Accept a full FEN or the common shorthand: `board side` (a position copied out
 * of a book) gets castling/en-passant/clocks filled in.
 */
function normaliseFen(raw) {
  const text = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!text) return null;
  if (isValidFen(text)) return text;
  const parts = text.split(' ');
  if (parts.length >= 2 && /^[wb]$/i.test(parts[1])) {
    const padded = `${parts[0]} ${parts[1].toLowerCase()} - - 0 1`;
    if (isValidFen(padded)) return padded;
  }
  return null;
}
