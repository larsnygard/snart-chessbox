// js/trainers/play.js — the play-against-the-engine board.
//
// This is a real game board, not a demo: the moves form a tree, so you can jump
// back through the score sheet (or with the ◀ ▶ buttons) and play a different
// move — that becomes a variation, the old line is kept. Moves and whole
// variations can be deleted. The engine can be told to follow one or more of
// your repertoires while the game is inside them, with a badge saying which
// repertoire supplied the move and when engine play starts.
//
// New games are configured in a dialog: colour, time control, strength, think
// time, book and starting position. There are also "Switch sides" and
// "Export to repertoire" actions.

import { START_FEN, applyUci, applySan, turnOf, isValidFen } from '../core/chessutil.js';
import { addLine, removeLine, findMoveNode, pickBookMove, treeLines } from '../core/repertoire.js';
import { trainerShell } from '../ui/trainer-shell.js';
import { el, icon, modal, toast, confirmDialog } from '../ui/components.js';
import { orientationFor } from '../ui/orientation.js';
import { openEngineSettings } from '../ui/engine-settings.js';
import { enginePickUci, arrowOf, uciFromMove, strengthLabel } from './common.js';
import { state, saveSettings, persist, navigate } from '../app.js';
import { saveResume, matchResume, clearResume } from '../ui/resume.js';
import { uid } from '../core/sets.js';

const RESUME_KEY = 'play';

const TIME_CONTROLS = [
  { id: 'none', label: 'No clock', base: 0, inc: 0 },
  { id: '3+0', label: '3 + 0', base: 180000, inc: 0 },
  { id: '5+0', label: '5 + 0', base: 300000, inc: 0 },
  { id: '5+3', label: '5 + 3', base: 300000, inc: 3000 },
  { id: '10+0', label: '10 + 0', base: 600000, inc: 0 },
  { id: '15+10', label: '15 + 10', base: 900000, inc: 10000 },
  { id: '30+0', label: '30 + 0', base: 1800000, inc: 0 },
];

function fmtClock(ms) {
  if (ms === null || ms === undefined) return '—';
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function mountPlay(host, ctx, opts = {}) {
  const settings = ctx.settings;
  const resume = opts.resume === false ? null : matchResume(RESUME_KEY);

  // ---- session configuration (persisted between games)
  const cfg = {
    side: opts.side || settings.playSide || 'w',
    startFen: opts.fen || START_FEN,
    timeId: settings.playTimeId || 'none',
    strength: settings.playStrength !== undefined ? settings.playStrength : (settings.strength || 1600),
    thinkMs: settings.playThinkMs || settings.thinkMs || 400,
    bookRepIds: (settings.playBookRepIds || []).filter((id) => (state.repertoires || []).some((r) => r.id === id)),
    bookEnabled: settings.playBookEnabled !== false,
  };
  if (opts.fen && opts.side) { cfg.startFen = opts.fen; cfg.side = opts.side; }

  const shell = trainerShell(host, {
    fen: cfg.startFen,
    orientation: orientationFor(settings, cfg.side),
    theme: settings.boardTheme,
    pieceSet: settings.pieceSet,
    coords: settings.coords,
    animate: settings.animate,
    settings,
    showPlayFromHere: false, // we are already on the play board
    allowDeep: false,        // the game engine is already searching on this screen
    nav: {
      first: () => goTo(0),
      back: () => goTo(cursor - 1),
      forward: () => goTo(cursor + 1),
      last: () => goTo(path.length),
      state: () => ({ atStart: cursor === 0, atEnd: cursor >= path.length }),
    },
    startTurn: cfg.startFen.split(' ')[1],
    onMove: (m) => onUserMove(m),
  });

  // ---- state: a move tree plus the current line and cursor
  let tree = { fen: cfg.startFen, color: cfg.side, moves: [] };
  let path = [];       // SAN moves of the line currently shown
  let cursor = 0;      // plies of that line on the board
  let side = cfg.side;
  const st = {
    done: false, result: null, reason: '',
    seq: 0, thinking: false,
    lastOpp: null,
    bookSource: null, bookMoves: 0,
    clocks: { w: cfg.base || 0, b: cfg.base || 0 },
    useClock: false,
    inc: 0,
    flagged: false,
  };

  // ---- header + panels
  const header = el('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;margin-bottom:8px' });
  const bookBadge = el('span', { class: 'badge', text: 'Engine' });
  const clockRow = el('div', { class: 'row', style: 'gap:8px;margin:6px 0' });
  const youClock = el('span', { class: 'badge mono', text: '—' });
  const engineClock = el('span', { class: 'badge mono', text: '—' });
  const moveCard = el('div', { class: 'card', style: 'margin-top:10px' });
  const moveList = el('div', { class: 'mtree' });
  const actionsRow = el('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;margin-top:8px' });
  const continueBtn = el('button', { class: 'btn sm primary hidden', text: 'Continue from here' });

  header.append(bookBadge, el('div', { class: 'spacer' }),
    el('button', { class: 'btn sm', html: `${icon('plus')}<span>New game</span>`, title: 'New game options', onclick: () => newGameDialog() }),
    el('button', { class: 'btn sm', html: `${icon('rotate')}<span>Switch sides</span>`, title: 'Play the other colour', onclick: () => switchSides() }),
    el('button', { class: 'btn sm', html: `${icon('book')}<span>Book</span>`, title: 'Repertoires the engine plays from', onclick: () => bookDialog() }),
    el('button', { class: 'btn sm', html: `${icon('settings')}<span>Engine</span>`, title: 'Engine settings', onclick: () => openEngineSettings({ onChange: () => paint() }) }),
    el('button', { class: 'btn sm', html: `${icon('star')}<span>Export</span>`, title: 'Export to a repertoire', onclick: () => exportDialog() }));

  shell.sideCol.prepend(header);
  shell.setPanelTitle('Game');
  shell.setMoves([], -1); // the real move list lives in its own card below
  shell.setGoal(opts.subtitle || '<span class="dim">Click a move to jump back, then play something else to create a variation.</span>');
  shell.addTool('Hint', () => showHint());
  shell.addTool('Flip', () => shell.board.setOrientation(shell.board.orientation === 'w' ? 'b' : 'w'));
  shell.addAction('Take back', () => takeBack());
  shell.addAction('Resign', () => resign());

  clockRow.append(el('span', { class: 'faint', style: 'font-size:.76rem', text: 'Clocks' }), youClock, engineClock);
  clockRow.style.display = 'none';
  shell.extra.append(clockRow);

  moveCard.append(el('div', { class: 'card-head' }, el('h3', { style: 'margin:0;text-align:left', text: 'Moves' }), el('div', { class: 'spacer' }),
    el('span', { class: 'faint', style: 'font-size:.72rem', text: 'click to jump · ⋯ to delete' })), moveList, actionsRow);
  shell.sideCol.append(moveCard);
  actionsRow.append(continueBtn,
    el('button', { class: 'btn sm', text: 'Back to live', onclick: () => goTo(path.length) }));

  // ---------------------------------------------------------------- helpers
  function fenAt(n) {
    let f = cfg.startFen;
    for (let i = 0; i < n; i++) {
      const r = applySan(f, path[i]);
      if (!r) break;
      f = r.fen;
    }
    return f;
  }

  function live() { return cursor === path.length; }

  function nodeAt(n) { return findMoveNode(tree, path.slice(0, n)) || tree; }

  function childrenAt(n) { const node = nodeAt(n); return node && node.moves ? node.moves : []; }

  function clockFor(color) { return color === 'w' ? st.clocks.w : st.clocks.b; }

  function setClock(color, ms) {
    if (color === 'w') st.clocks.w = Math.max(0, ms); else st.clocks.b = Math.max(0, ms);
  }

  // ---------------------------------------------------------------- paint
  function paint() {
    const fen = fenAt(cursor);
    const prev = cursor > 0 ? applySan(fenAt(cursor - 1), path[cursor - 1]) : null;
    shell.board.setPosition(fen, {
      last: prev ? { from: prev.from, to: prev.to } : null,
      arrows: live() && st.lastOpp ? [arrowOf(st.lastOpp, 'best')] : [],
      clearSelection: true,
    });
    const turn = turnOf(fen);
    const canPlay = !st.done && turn === side;
    shell.board.setInteractive(canPlay);
    shell.setStatus(statusText(fen, turn));
    renderMoves();
    paintBook();
    paintClocks(turn);
    continueBtn.classList.toggle('hidden', !(!st.done && !live() && turn !== side && !st.thinking));
  }

  function statusText(fen, turn) {
    if (st.done) return `<b>${st.result === 'win' ? 'You won' : st.result === 'loss' ? 'You lost' : 'Draw'}</b> <span class="faint">— ${st.reason}</span>`;
    const at = live() ? '' : ` <span class="faint">· variation mode, ply ${cursor} of ${path.length}</span>`;
    if (turn === side) return `<b>Your move</b>${at}`;
    if (!live()) return `<span class="faint">Engine to move — press “Continue from here”</span>`;
    return `<span class="faint">Engine is thinking…</span>${at}`;
  }

  function paintClocks(turn) {
    clockRow.style.display = st.useClock ? '' : 'none';
    if (!st.useClock) return;
    const mine = side === 'w' ? 'w' : 'b';
    const theirs = mine === 'w' ? 'b' : 'w';
    youClock.textContent = `${side === 'w' ? 'White' : 'Black'} ${fmtClock(st.clocks[mine])}`;
    engineClock.textContent = `Engine ${fmtClock(st.clocks[theirs])}`;
    youClock.className = 'badge mono' + (!st.done && turn === mine ? ' good' : '');
    engineClock.className = 'badge mono' + (!st.done && turn === theirs ? ' good' : '');
  }

  function paintBook() {
    const inBook = st.bookSource;
    bookBadge.className = 'badge ' + (inBook ? 'good' : '');
    bookBadge.textContent = inBook ? `Book: ${inBook}` : (cfg.bookEnabled && cfg.bookRepIds.length ? 'Engine — out of book' : 'Engine');
  }

  function renderMoves() {
    moveList.innerHTML = '';
    const startBtn = el('button', { class: 'mtree-start' + (cursor === 0 ? ' cur' : ''), text: 'Start', onclick: () => goTo(0) });
    moveList.append(el('div', { class: 'mtree-head' }, startBtn,
      el('span', { class: 'faint', style: 'font-size:.74rem', text: live() ? 'live position' : 'reviewing — play a move to make a variation' })));
    if (!path.length) {
      moveList.append(el('div', { class: 'faint', style: 'font-size:.84rem;padding:6px 2px', text: 'No moves yet.' }));
      return;
    }
    const startTurn = cfg.startFen.split(' ')[1] === 'b' ? 'b' : 'w';
    const isWhitePly = (i) => (startTurn === 'w' ? i % 2 === 0 : i % 2 === 1);
    const moveNoFor = (i) => Math.floor((startTurn === 'w' ? i : i + 1) / 2) + 1;

    const cell = (i) => {
      const box = el('span', { class: 'mtree-cell' });
      box.append(el('button', {
        class: 'mtree-mv' + (cursor === i + 1 ? ' cur' : ''),
        text: path[i],
        title: 'Set the board to the position after this move',
        onclick: () => goTo(i + 1),
      }));
      box.append(el('button', {
        class: 'mtree-edit', html: icon('dots'), title: 'Move options (delete, jump)',
        onclick: (e) => { e.stopPropagation(); moveMenu(i); },
      }));
      const siblings = childrenAt(i).filter((m) => m.san !== path[i]);
      if (siblings.length) {
        const alts = el('span', { class: 'mtree-alts' });
        alts.append('(');
        siblings.forEach((s, k) => {
          if (k) alts.append(', ');
          alts.append(el('button', {
            class: 'mtree-alt', text: s.san, title: 'Switch to this variation',
            onclick: () => selectVariation(i, s.san),
          }));
        });
        alts.append(')');
        box.append(alts);
      }
      return box;
    };

    let i = 0;
    while (i < path.length) {
      const row = el('div', { class: 'mtree-row' });
      row.append(el('span', { class: 'mtree-no', text: isWhitePly(i) ? `${moveNoFor(i)}.` : `${moveNoFor(i)}…` }));
      if (isWhitePly(i)) {
        row.append(cell(i));
        if (i + 1 < path.length && !isWhitePly(i + 1)) { row.append(cell(i + 1)); i += 2; }
        else { row.append(el('span')); i += 1; }
      } else {
        row.append(el('span'));
        row.append(cell(i));
        i += 1;
      }
      moveList.append(row);
    }
  }

  // ---------------------------------------------------------------- navigation
  function goTo(n) {
    cursor = Math.max(0, Math.min(path.length, n));
    paint();
    persistResume();
  }

  function selectVariation(ply, san) {
    path = path.slice(0, ply).concat(san);
    cursor = Math.min(ply + 1, path.length);
    paint();
    persistResume();
  }

  // ---------------------------------------------------------------- moves
  function commitMove(uci) {
    const fen = fenAt(cursor);
    const res = applyUci(fen, uci);
    if (!res) return null;
    const prefix = path.slice(0, cursor);
    const exists = childrenAt(cursor).find((m) => m.uci === uci);
    if (!exists) addLine(tree, prefix.concat(res.san));
    path = prefix.concat(res.san);
    cursor = path.length;
    ctx.sound.playForMove(res);
    return res;
  }

  function onUserMove({ from, to, promotion }) {
    if (st.done) return;
    const fen = fenAt(cursor);
    if (turnOf(fen) !== side) return;
    st.lastOpp = null;
    const res = commitMove(from + to + (promotion || ''));
    if (!res) { ctx.sound.play('illegal'); return; }
    if (st.useClock) setClock(side, clockFor(side) + st.inc);
    paint();
    persistResume();
    if (terminal(res)) return;
    engineTurn();
  }

  function terminal(res) {
    if (res.mate) return endGame(turnOf(fenAt(cursor)) === side ? 'loss' : 'win', 'checkmate');
    if (res.stalemate) return endGame('draw', 'stalemate');
    if (res.draw) return endGame('draw', 'draw');
    return false;
  }

  function endGame(result, reason) {
    st.done = true;
    st.result = result;
    st.reason = reason;
    clearResume();
    ctx.sound.play(result === 'win' ? 'win' : result === 'loss' ? 'lose' : 'click');
    shell.setFeedback(`<b>${result === 'win' ? 'You won' : result === 'loss' ? 'You lost' : 'Draw'}</b> — ${reason}`,
      result === 'win' ? 'ok' : result === 'loss' ? 'bad' : '', [
        { label: 'New game', primary: true, onClick: () => newGameDialog() },
        { label: 'Export to repertoire', onClick: () => exportDialog() },
      ]);
    paint();
    return true;
  }

  async function engineTurn() {
    if (st.done) return;
    const fen = fenAt(cursor);
    if (turnOf(fen) === side) return;
    if (!live()) return; // reviewing: the engine only plays when you ask
    const seq = ++st.seq;
    st.thinking = true;
    paint();
    let uci = null;
    const book = bookMove();
    const started = Date.now();
    if (book) {
      uci = book.move.uci;
      st.bookSource = book.rep.name;
      st.bookMoves += 1;
    } else {
      st.bookSource = null;
      try {
        uci = await enginePickUci(ctx, fen, { movetime: cfg.thinkMs, elo: cfg.strength });
      } catch (e) { uci = null; }
    }
    if (seq !== st.seq || st.done) return;
    st.thinking = false;
    if (!uci) { shell.setFeedback('The engine could not produce a move.', 'bad'); paint(); return; }
    st.lastOpp = uci;
    if (st.useClock) setClock(side === 'w' ? 'b' : 'w', clockFor(side === 'w' ? 'b' : 'w') - (Date.now() - started) + st.inc);
    const res = commitMove(uci);
    paint();
    persistResume();
    if (res) terminal(res);
  }

  async function continueFromHere() {
    if (st.done) return;
    const fen = fenAt(cursor);
    if (turnOf(fen) === side) { paint(); return; }
    await engineTurnFromReview();
  }

  async function engineTurnFromReview() {
    const fen = fenAt(cursor);
    const seq = ++st.seq;
    st.thinking = true;
    paint();
    let uci = null;
    try { uci = await enginePickUci(ctx, fen, { movetime: cfg.thinkMs, elo: cfg.strength }); } catch (e) { uci = null; }
    if (seq !== st.seq || st.done) return;
    st.thinking = false;
    if (!uci) { shell.setFeedback('The engine could not produce a move.', 'bad'); paint(); return; }
    st.lastOpp = uci;
    commitMove(uci);
    paint();
    persistResume();
    if (turnOf(fenAt(cursor)) !== side) engineTurn();
  }
  continueBtn.addEventListener('click', () => continueFromHere());

  // ---------------------------------------------------------------- book
  function bookCandidates() {
    if (!cfg.bookEnabled || !cfg.bookRepIds.length || cfg.startFen !== START_FEN) return [];
    const found = [];
    for (const id of cfg.bookRepIds) {
      const rep = (state.repertoires || []).find((r) => r.id === id);
      if (!rep) continue;
      const node = findMoveNode(rep.tree, path.slice(0, cursor));
      if (node && node.moves && node.moves.length) found.push({ rep, moves: node.moves });
    }
    return found;
  }

  function bookMove() {
    const candidates = bookCandidates();
    if (!candidates.length) return null;
    const move = pickBookMove(candidates[0].moves);
    return move ? { move, rep: candidates[0].rep } : null;
  }

  /** Which repertoire (if any) covers the current position, and how far we are. */
  function bookDialog() {
    const reps = state.repertoires || [];
    const chosen = new Set(cfg.bookRepIds);
    const body = el('div');
    if (!reps.length) {
      body.append(el('div', { class: 'empty', text: 'No repertoires yet. Create one under Repertoire, then the engine can play its moves from it here.' }));
    } else {
      const list = el('div', { class: 'list', style: 'max-height:220px;overflow:auto' });
      for (const rep of reps) {
        const cb = el('input', { type: 'checkbox' });
        cb.checked = chosen.has(rep.id);
        cb.addEventListener('change', () => { if (cb.checked) chosen.add(rep.id); else chosen.delete(rep.id); });
        list.append(el('label', { class: 'check' }, cb,
          el('div', {},
            el('span', { text: rep.name }),
            el('div', { class: 'faint', style: 'font-size:.76rem', text: `${rep.color === 'w' ? 'White' : 'Black'} repertoire` }))));
      }
      body.append(el('p', { class: 'dim', style: 'font-size:.84rem;margin-top:0', html: 'The engine follows these repertoires while the game stays inside them, weighted by how often each line is stored. Outside them it plays normal engine moves — the badge next to the board says which.' }), list);
    }
    const inBookNow = bookCandidates();
    const status = el('div', { class: 'feedback hint', style: 'margin-top:10px' });
    status.innerHTML = inBookNow.length
      ? `Position is in book: <b>${inBookNow.map((c) => c.rep.name).join(', ')}</b> · ${st.bookMoves} book move${st.bookMoves === 1 ? '' : 's'} played so far.`
      : (cfg.bookRepIds.length
        ? `Out of book — the engine is playing on its own after ${st.bookMoves} book move${st.bookMoves === 1 ? '' : 's'}.`
        : 'No book selected: the engine plays its own moves.');
    body.append(status);
    modal({
      title: 'Opening book for this game',
      body,
      actions: [
        { label: 'Cancel' },
        {
          label: 'Use selected', primary: true, onClick: () => {
            cfg.bookRepIds = [...chosen];
            settings.playBookRepIds = cfg.bookRepIds;
            saveSettings();
            paint();
            persistResume();
            toast(cfg.bookRepIds.length ? `Book: ${cfg.bookRepIds.length} repertoire(s)` : 'Book off', 'ok');
          },
        },
      ],
    });
  }

  // ---------------------------------------------------------------- move options
  function moveMenu(ply) {
    const san = path[ply];
    const siblings = childrenAt(ply).filter((m) => m.san !== san);
    const jumpRow = el('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' });
    jumpRow.append(el('button', { class: 'btn sm', text: 'Jump to this move', onclick: () => { m.close(); goTo(ply + 1); } }));
    for (const s of siblings) {
      jumpRow.append(el('button', {
        class: 'btn sm', text: `Switch to ${s.san}`,
        onclick: () => { m.close(); selectVariation(ply, s.san); },
      }));
    }
    const deleteRow = el('div', { class: 'row', style: 'gap:6px;margin-top:10px' },
      el('button', { class: 'btn sm danger', text: 'Delete from this move', onclick: () => { m.close(); deleteFrom(ply); } }));
    const body = el('div', {},
      el('div', { class: 'mono', style: 'margin-bottom:8px', text: `${Math.floor(ply / 2) + 1}. ${san}` }),
      jumpRow,
      deleteRow);
    const m = modal({ title: 'Move options', body, actions: [{ label: 'Close' }] });
  }

  function deleteFrom(ply) {
    const losing = path.slice(0, ply + 1);
    const isLastOfLine = ply + 1 >= path.length;
    const doIt = () => {
      removeLine(tree, losing);
      path = path.slice(0, ply);
      cursor = Math.min(cursor, path.length);
      st.done = false; st.result = null;
      paint();
      persistResume();
      toast('Move deleted', 'ok');
    };
    if (!isLastOfLine) {
      confirmDialog({
        title: `Delete ${path[ply]} and the rest of this line?`,
        text: 'Other variations are untouched. This cannot be undone.',
        confirmLabel: 'Delete',
      }).then((ok) => { if (ok) doIt(); });
    } else {
      doIt();
    }
  }

  // ---------------------------------------------------------------- actions
  function takeBack() {
    if (!path.length) return;
    st.seq += 1;
    st.thinking = false;
    // drop plies until it is the user's turn again (usually your move + the reply)
    let guard = 0;
    while (path.length && turnOf(fenAt(path.length)) !== side && guard++ < 4) {
      removeLine(tree, path.slice());
      path.pop();
    }
    cursor = path.length;
    st.done = false; st.result = null; st.reason = '';
    shell.setFeedback('', '');
    paint();
    persistResume();
    if (turnOf(fenAt(cursor)) !== side) engineTurn();
  }

  function resign() {
    if (st.done) return;
    endGame('loss', 'resigned');
  }

  function switchSides() {
    const doSwitch = () => {
      side = side === 'w' ? 'b' : 'w';
      settings.playSide = side;
      saveSettings();
      newGame({ ...cfg, side, startFen: cfg.startFen });
      toast(`Now playing ${side === 'w' ? 'White' : 'Black'}`, 'ok');
    };
    if (path.length) {
      confirmDialog({ title: 'Switch sides?', text: 'A new game starts with the other colour; the current moves stay in the old game.', confirmLabel: 'Switch sides' })
        .then((ok) => { if (ok) doSwitch(); });
    } else doSwitch();
  }

  // ---------------------------------------------------------------- new game
  function newGameDialog() {
    const body = el('div');
    const colours = el('div', { class: 'filters' });
    const timeRow = el('div', { class: 'filters' });
    const strengthRow = el('div', { class: 'filters' });
    const bookList = el('div', { class: 'list', style: 'max-height:160px;overflow:auto' });
    const fenInput = el('input', { type: 'text', placeholder: 'Start position FEN (optional)', value: '' });
    const draft = {
      side: cfg.side, timeId: cfg.timeId, strength: cfg.strength || settings.strength,
      thinkMs: cfg.thinkMs, bookRepIds: new Set(cfg.bookRepIds), bookEnabled: cfg.bookEnabled,
    };

    const paintDialog = () => {
      colours.innerHTML = '';
      for (const [id, label] of [['w', 'I play White'], ['b', 'I play Black']]) {
        colours.append(el('button', {
          class: 'chip' + (draft.side === id ? ' on' : ''), text: label,
          onclick: () => { draft.side = id; paintDialog(); },
        }));
      }
      timeRow.innerHTML = '';
      for (const tc of TIME_CONTROLS) {
        timeRow.append(el('button', {
          class: 'chip' + (draft.timeId === tc.id ? ' on' : ''), text: tc.label,
          onclick: () => { draft.timeId = tc.id; paintDialog(); },
        }));
      }
      strengthRow.innerHTML = '';
      for (const elo of [800, 1200, 1600, 2000, 2400, 0]) {
        strengthRow.append(el('button', {
          class: 'chip' + ((draft.strength || 0) === elo ? ' on' : ''), text: elo ? String(elo) : 'Max',
          onclick: () => { draft.strength = elo; paintDialog(); },
        }));
      }
      bookList.innerHTML = '';
      if (!(state.repertoires || []).length) {
        bookList.append(el('div', { class: 'faint', style: 'font-size:.8rem', text: 'No repertoires yet — the engine will play on its own.' }));
      } else {
        for (const rep of state.repertoires) {
          const cb = el('input', { type: 'checkbox' });
          cb.checked = draft.bookRepIds.has(rep.id);
          cb.addEventListener('change', () => { if (cb.checked) draft.bookRepIds.add(rep.id); else draft.bookRepIds.delete(rep.id); });
          bookList.append(el('label', { class: 'check' }, cb, el('span', { text: rep.name })));
        }
      }
    };
    paintDialog();

    body.append(
      el('div', { class: 'stack', style: 'gap:10px' },
        el('label', { class: 'field' }, el('span', { text: 'Colour' }), colours),
        el('label', { class: 'field' }, el('span', { text: 'Time control' }), timeRow),
        el('label', { class: 'field' }, el('span', { text: 'Engine strength' }), strengthRow),
        el('label', { class: 'field' }, el('span', { text: 'Engine book (repertoires)' }), bookList),
        el('label', { class: 'check' }, el('input', {
          type: 'checkbox', checked: draft.bookEnabled ? true : undefined,
          onchange: (e) => { draft.bookEnabled = e.target.checked; },
        }), el('span', { text: 'Use the book while the game is inside it' })),
        el('label', { class: 'field' }, el('span', { text: 'Start from (optional)' }), fenInput),
        el('p', { class: 'faint', style: 'font-size:.76rem;margin:0', text: 'Think time and randomness come from the Engine dialog; the clock counts your moves and charges the engine its thinking time.' })));

    modal({
      title: 'New game',
      body,
      actions: [
        { label: 'Cancel' },
        {
          label: 'Start', primary: true, onClick: () => {
            const fen = fenInput.value.trim();
            if (fen) {
              if (!isValidFen(fen)) { toast('That does not look like a legal FEN', 'bad'); return false; }
              draft.startFen = fen;
            } else draft.startFen = START_FEN;
            newGame(draft);
          },
        },
      ],
    });
  }

  function newGame(draft) {
    const tc = TIME_CONTROLS.find((t) => t.id === (draft.timeId || 'none')) || TIME_CONTROLS[0];
    cfg.side = draft.side;
    cfg.startFen = draft.startFen || START_FEN;
    cfg.timeId = tc.id;
    cfg.strength = draft.strength;
    cfg.thinkMs = draft.thinkMs || cfg.thinkMs;
    cfg.bookRepIds = [...(draft.bookRepIds || [])];
    cfg.bookEnabled = draft.bookEnabled !== false;

    settings.playSide = cfg.side;
    settings.playTimeId = cfg.timeId;
    settings.playStrength = cfg.strength;
    settings.playBookRepIds = cfg.bookRepIds;
    settings.playBookEnabled = cfg.bookEnabled;
    saveSettings();

    tree = { fen: cfg.startFen, color: cfg.side, moves: [] };
    path = [];
    cursor = 0;
    side = cfg.side;
    st.done = false; st.result = null; st.reason = '';
    st.seq += 1;
    st.thinking = false;
    st.lastOpp = null;
    st.bookSource = null; st.bookMoves = 0;
    st.useClock = tc.base > 0;
    st.base = tc.base;
    st.inc = tc.inc;
    st.clocks = { w: tc.base, b: tc.base };
    st.flagged = false;
    shell.board.setOrientation(orientationFor(settings, side));
    shell.setFeedback('', '');
    paint();
    persistResume();
    if (turnOf(fenAt(0)) !== side) engineTurn();
  }

  // ---------------------------------------------------------------- export to repertoire
  function exportDialog() {
    if (!path.length) { toast('Play or load some moves first', 'bad'); return; }
    const lines = treeLines(tree, 200);
    const nameInput = el('input', { type: 'text', value: `Game ${new Date().toISOString().slice(0, 10)}`, placeholder: 'Repertoire name' });
    const existing = el('select', {}, el('option', { value: '', text: 'Create a new repertoire' }),
      ...(state.repertoires || []).map((r) => el('option', { value: r.id, text: r.name })));
    const colour = el('select', {},
      el('option', { value: side, text: `For my ${side === 'w' ? 'White' : 'Black'} repertoire` }),
      el('option', { value: side === 'w' ? 'b' : 'w', text: `For my ${side === 'w' ? 'Black' : 'White'} repertoire` }));
    const onlyMain = el('input', { type: 'checkbox' });

    modal({
      title: 'Export to repertoire',
      body: el('div', {},
        el('p', { class: 'dim', style: 'font-size:.84rem;margin-top:0', html: `The current game${lines.length > 1 ? ` and ${lines.length - 1} variation(s)` : ''} will be added to your repertoire tree, so the engine can play these lines back to you later.` }),
        el('label', { class: 'field' }, el('span', { text: 'Add to' }), existing),
        el('label', { class: 'field' }, el('span', { text: 'New repertoire name (if creating)' }), nameInput),
        el('label', { class: 'field' }, el('span', { text: 'Colour' }), colour),
        el('label', { class: 'check' }, onlyMain, el('span', { text: 'Only the main line (skip variations)' }))),
      actions: [
        { label: 'Cancel' },
        {
          label: 'Export', primary: true, onClick: () => {
            const only = onlyMain.checked ? [path] : lines;
            let rep = (state.repertoires || []).find((r) => r.id === existing.value);
            if (!rep) {
              rep = {
                id: uid('rep'), name: nameInput.value || 'From a game', color: colour.value,
                description: `Built from a game played ${new Date().toLocaleDateString()}`,
                tree: { fen: START_FEN, color: colour.value, moves: [] },
                created: Date.now(), updated: Date.now(),
              };
              state.repertoires = (state.repertoires || []).concat([rep]);
            }
            let added = 0;
            for (const line of only) {
              if (!line.length) continue;
              const res = addLine(rep.tree, line);
              if (res.ok) added += 1;
            }
            rep.updated = Date.now();
            persist('repertoires', true);
            toast(`${added} line(s) added to “${rep.name}”`, 'ok');
            modal({ title: 'Exported', body: el('div', {}, el('p', { class: 'dim', text: `Open the repertoire to browse or train the lines.` })),
              actions: [{ label: 'Stay here' }, { label: 'Open repertoire', primary: true, onClick: () => navigate('/repertoire/' + rep.id + '?tab=browse') }] });
          },
        },
      ],
    });
  }

  // ---------------------------------------------------------------- hint
  async function showHint() {
    try {
      const uci = await enginePickUci(ctx, fenAt(cursor), { strong: true, movetime: 400 });
      if (!uci) return;
      shell.board.setArrows([arrowOf(uci, 'hint')]);
      const res = applyUci(fenAt(cursor), uci);
      shell.setFeedback(`Engine suggests <span class="mono">${res ? res.san : uci}</span>`, 'hint');
      setTimeout(() => shell.board.setArrows(st.lastOpp ? [arrowOf(st.lastOpp, 'best')] : []), 2600);
    } catch (e) { toast('Engine unavailable', 'bad'); }
  }

  // ---------------------------------------------------------------- clocks
  let clockTimer = null;
  function startClock() {
    if (clockTimer) return;
    clockTimer = setInterval(() => {
      if (!st.useClock || st.done) return;
      if (!live()) return;                            // reviewing does not burn clock
      if (turnOf(fenAt(cursor)) !== side) return;      // the engine pays in search time
      setClock(side, clockFor(side) - 200);
      if (clockFor(side) <= 0) {
        setClock(side, 0);
        endGame('loss', 'time');
      } else paintClocks(turnOf(fenAt(cursor)));
    }, 200);
  }

  // ---------------------------------------------------------------- resume
  function persistResume() {
    if (st.done || !path.length) return;
    saveResume(RESUME_KEY, 'play', {
      startFen: cfg.startFen, side, path: path.slice(), cursor,
      tree, useClock: st.useClock, clocks: { ...st.clocks }, inc: st.inc, timeId: cfg.timeId,
      bookRepIds: cfg.bookRepIds, bookEnabled: cfg.bookEnabled,
    }, `Play vs engine — ${Math.ceil(path.length / 2)} moves`, '#/coach?fen=start');
  }

  const restored = !!(resume && resume.path && resume.path.length && resume.startFen === cfg.startFen && resume.side === cfg.side);
  if (restored) {
    if (resume.tree) tree = resume.tree;
    path = resume.path.slice();
    cursor = Math.min(resume.cursor ?? path.length, path.length);
    st.useClock = !!resume.useClock;
    st.clocks = resume.clocks || st.clocks;
    st.inc = resume.inc || 0;
    cfg.bookRepIds = (resume.bookRepIds || cfg.bookRepIds);
    cfg.bookEnabled = resume.bookEnabled !== false;
    toast('Resumed your game', 'ok');
  } else {
    const tc = TIME_CONTROLS.find((t) => t.id === cfg.timeId) || TIME_CONTROLS[0];
    st.useClock = tc.base > 0;
    st.inc = tc.inc;
    st.clocks = { w: tc.base, b: tc.base };
  }

  // ---------------------------------------------------------------- boot
  paint();
  startClock();
  if (opts.openNewGame && !restored && !path.length) setTimeout(() => newGameDialog(), 200);
  if (!path.length && turnOf(fenAt(0)) !== side) engineTurn();
  else if (path.length && live() && turnOf(fenAt(cursor)) !== side) engineTurn();

  return {
    destroy() {
      st.done = false;
      st.seq += 1;
      if (clockTimer) clearInterval(clockTimer);
      shell.destroy();
    },
  };
}

// keep the old name working for the coach and session screens
export const mountFreeplay = mountPlay;
