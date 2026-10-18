// js/trainers/freeplay.js — play against the engine from any position, with an
// optional opening book built from your own repertoires.
//
// Book behaviour: while the position exists in one of the selected repertoires
// the engine plays a move from that repertoire (weighted by how often the line
// is stored). As soon as the game leaves the book the engine takes over, and the
// badge next to the board says which of the two is playing — so you can see
// exactly where your preparation ends.

import { START_FEN, applyUci } from '../core/chessutil.js';
import { findMoveNode, pickBookMove } from '../core/repertoire.js';
import { trainerShell } from '../ui/trainer-shell.js';
import { el, icon, modal, toast } from '../ui/components.js';
import { orientationFor } from '../ui/orientation.js';
import { openEngineSettings } from '../ui/engine-settings.js';
import { enginePickUci, arrowOf, uciFromMove, strengthLabel } from './common.js';
import { state, saveSettings } from '../app.js';
import { saveResume, matchResume, clearResume } from '../ui/resume.js';

const RESUME_KEY = 'play';

export function mountFreeplay(host, ctx, opts = {}) {
  const settings = ctx.settings;
  const startFen = opts.fen || START_FEN;
  const side = opts.side || (startFen.split(' ')[1] === 'b' ? 'b' : 'w');
  const resume = opts.resume === false ? null : matchResume(RESUME_KEY);

  const shell = trainerShell(host, {
    fen: startFen,
    orientation: orientationFor(settings, side),
    theme: settings.boardTheme,
    pieceSet: settings.pieceSet,
    coords: settings.coords,
    animate: settings.animate,
    settings,
    nav: {
      first: () => setView(0),
      back: () => setView((st.viewPly ?? st.history.length) - 1),
      forward: () => setView((st.viewPly ?? st.history.length) + 1),
      last: () => setView(st.history.length),
      state: () => ({ atStart: (st.viewPly ?? st.history.length) === 0, atEnd: st.viewPly === null || st.viewPly === undefined }),
    },
    startTurn: startFen.split(' ')[1],
    onMove: (m) => onUserMove(m),
  });

  const st = {
    fen: startFen,
    history: [],
    done: false,
    seq: 0,
    lastOpp: null,
    lastUci: null,
    evalCp: null,
    thinking: false,
    viewPly: null,
    bookRepIds: (settings.playBookRepIds || []).filter((id) => (state.repertoires || []).some((r) => r.id === id)),
    bookSource: null,
    bookMoves: 0,
  };

  shell.setTitle(opts.title || 'Play vs engine', [
    { text: side === 'w' ? 'You are White' : 'You are Black', kind: '' },
    { text: strengthLabel(settings.strength), kind: '' },
    { text: settings.spreadCp ? `±${(settings.spreadCp / 100).toFixed(1)}` : 'exact', kind: '' },
  ]);
  shell.setPanelTitle('Game');
  shell.setGoal(opts.subtitle || '<span class="dim">Free practice. Hints show the engine\u2019s favourite move.</span>');

  const bookBadge = el('span', { class: 'badge', text: 'Engine' });
  const headRow = el('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;margin-bottom:8px' },
    bookBadge,
    el('div', { class: 'spacer' }),
    el('button', { class: 'btn sm', html: `${icon('book')}<span>Book</span>`, title: 'Choose repertoires for the engine', onclick: () => bookDialog() }),
    el('button', { class: 'btn sm', html: `${icon('settings')}<span>Engine</span>`, title: 'Engine settings', onclick: () => openEngineSettings({ onChange: () => paint() }) }));
  shell.extra.append(headRow);

  shell.addTool('Hint', () => showHint());
  shell.addTool('Flip', () => shell.board.setOrientation(shell.board.orientation === 'w' ? 'b' : 'w'));
  shell.addAction('Take back', () => takeback());
  shell.addAction('Restart', () => reset());
  const evalEl = el('div', { class: 'dim', style: 'font-size:.8rem' });
  shell.extra.append(evalEl);

  // ---- restore an interrupted game (open Settings mid-game and come back)
  if (resume && resume.startFen === startFen && resume.side === side && Array.isArray(resume.history) && resume.history.length) {
    st.bookRepIds = (resume.bookRepIds || st.bookRepIds).filter((id) => (state.repertoires || []).some((r) => r.id === id));
    replay(resume.history);
    toast('Resumed your game', 'ok');
  }

  function turnOf(fen) { return fen.split(' ')[1] === 'b' ? 'b' : 'w'; }

  function replay(ucis) {
    st.fen = startFen;
    st.history = [];
    st.lastUci = null;
    for (const uci of ucis) {
      const res = applyUci(st.fen, uci);
      if (!res) break;
      st.fen = res.fen;
      st.history.push({ uci, san: res.san });
      st.lastUci = uci;
    }
    st.viewPly = null;
  }

  function persistResume() {
    if (st.done || !st.history.length) return;
    saveResume(RESUME_KEY, 'freeplay', {
      startFen, side, history: st.history.map((h) => h.uci), bookRepIds: st.bookRepIds,
    }, `Play vs engine — ${Math.ceil(st.history.length / 2)} moves`, '#/coach?fen=start');
  }

  // ---- opening book
  function bookCandidates() {
    if (!st.bookRepIds.length || startFen !== START_FEN) return [];
    const sans = st.history.map((h) => h.san);
    const found = [];
    for (const id of st.bookRepIds) {
      const rep = (state.repertoires || []).find((r) => r.id === id);
      if (!rep) continue;
      const node = findMoveNode(rep.tree, sans);
      if (node && node.moves && node.moves.length) found.push({ rep, moves: node.moves });
    }
    return found;
  }

  function bookMove() {
    const candidates = bookCandidates();
    if (!candidates.length) return null;
    const winner = candidates[0];
    const move = pickBookMove(winner.moves);
    return move ? { move, rep: winner.rep } : null;
  }

  function viewFen() {
    if (st.viewPly === null || st.viewPly === undefined) return st.fen;
    let f = startFen;
    for (let i = 0; i < st.viewPly; i++) {
      const r = applyUci(f, st.history[i].uci);
      if (!r) break;
      f = r.fen;
    }
    return f;
  }

  function setView(n) {
    const max = st.history.length;
    const v = Math.max(0, Math.min(max, n));
    st.viewPly = v === max ? null : v;
    paint();
  }

  function paintBook() {
    bookBadge.className = 'badge ' + (st.bookSource ? 'good' : '');
    bookBadge.textContent = st.bookSource
      ? `Book: ${st.bookSource}`
      : (st.bookRepIds.length ? 'Engine — out of book' : 'Engine');
    bookBadge.title = st.bookSource
      ? `The engine is following “${st.bookSource}”`
      : (st.bookRepIds.length ? 'The selected repertoires do not cover this position any more' : 'No opening book selected');
  }

  function paint() {
    const live = st.viewPly === null || st.viewPly === undefined;
    const viewed = live ? null : st.history[st.viewPly - 1];
    shell.board.setPosition(viewFen(), {
      last: live
        ? (st.lastUci ? { from: st.lastUci.slice(0, 2), to: st.lastUci.slice(2, 4) } : null)
        : (viewed ? { from: viewed.uci.slice(0, 2), to: viewed.uci.slice(2, 4) } : null),
      arrows: live && st.lastOpp ? [arrowOf(st.lastOpp, 'best')] : [],
      clearSelection: true,
    });
    const myTurn = live && turnOf(st.fen) === side && !st.done;
    shell.board.setInteractive(myTurn);
    if (!live) {
      shell.setStatus(`Reviewing ply ${st.viewPly} of ${st.history.length} · <span class="faint">press ▶| to return</span>`);
      shell.setMoves(st.history.map((h) => h.san), st.viewPly - 1);
    } else {
      shell.setStatus(myTurn ? '<b>Your move</b>' : (st.done ? '<span class="faint">Game over</span>' : '<span class="faint">Engine is thinking…</span>'));
      shell.setMoves(st.history.map((h) => h.san), st.history.length - 1);
    }
    paintBook();
    if (st.evalCp !== null) evalEl.textContent = `Last engine eval: ${(st.evalCp / 100).toFixed(2)}`;
  }

  function applyMove(uci) {
    const res = applyUci(st.fen, uci);
    if (!res) return null;
    st.fen = res.fen;
    st.history.push({ uci, san: res.san });
    st.lastUci = uci;
    st.viewPly = null;
    ctx.sound.playForMove(res);
    return res;
  }

  async function engineTurn() {
    if (st.done || turnOf(st.fen) === side) return;
    const seq = ++st.seq;
    st.thinking = true;
    let uci = null;
    const book = bookMove();
    if (book) {
      uci = book.move.uci;
      st.bookSource = book.rep.name;
      st.bookMoves += 1;
    } else {
      st.bookSource = null;
      try { uci = await enginePickUci(ctx, st.fen); } catch (e) { uci = null; }
    }
    if (seq !== st.seq || st.done) return;
    st.thinking = false;
    if (!uci) { shell.setFeedback('The engine could not produce a move.', 'bad'); return; }
    st.lastOpp = uci;
    const res = applyMove(uci);
    paint();
    persistResume();
    if (res && (res.mate || res.stalemate || res.draw)) gameOver(res);
  }

  function onUserMove(m) {
    if (st.done || turnOf(st.fen) !== side) return;
    st.lastOpp = null;
    const res = applyMove(uciFromMove(m));
    if (!res) { ctx.sound.play('illegal'); return; }
    paint();
    persistResume();
    if (res.mate || res.stalemate || res.draw) return gameOver(res);
    engineTurn();
  }

  function gameOver(res) {
    st.done = true;
    clearResume();
    shell.board.setInteractive(false);
    const text = res.mate ? (turnOf(st.fen) === side ? 'You are checkmated.' : 'Checkmate — you won!') : res.stalemate ? 'Stalemate.' : 'Draw.';
    ctx.sound.play(res.mate && turnOf(st.fen) !== side ? 'win' : 'lose');
    shell.setFeedback(`<b>${text}</b>`, res.mate && turnOf(st.fen) !== side ? 'ok' : '', [
      { label: 'New game', primary: true, onClick: () => reset() },
    ]);
    shell.setStatus('<span class="faint">Game over</span>');
    if (opts.onDone) opts.onDone({ fen: st.fen, result: text, history: st.history });
  }

  async function showHint() {
    try {
      const uci = await enginePickUci(ctx, st.fen, { strong: true, movetime: 400 });
      if (!uci) return;
      shell.board.setArrows([arrowOf(uci, 'hint')]);
      const res = applyUci(st.fen, uci);
      shell.setFeedback(`Engine suggests <span class="mono">${res ? res.san : uci}</span>`, 'hint');
      setTimeout(() => shell.board.setArrows(st.lastOpp ? [arrowOf(st.lastOpp, 'best')] : []), 2600);
    } catch (e) { toast('Engine unavailable', 'bad'); }
  }

  function takeback() {
    if (st.done) st.done = false;
    st.seq++;
    st.history.pop();
    st.history.pop();
    st.fen = startFen;
    st.lastUci = null;
    st.lastOpp = null;
    st.bookSource = null;
    for (const h of st.history) {
      const r = applyUci(st.fen, h.uci);
      if (!r) break;
      st.fen = r.fen;
      st.lastUci = h.uci;
    }
    paint();
    persistResume();
    if (turnOf(st.fen) !== side) engineTurn();
  }

  function reset() {
    st.seq++;
    Object.assign(st, {
      fen: startFen, history: [], done: false, lastOpp: null, lastUci: null,
      evalCp: null, viewPly: null, bookSource: null, bookMoves: 0,
    });
    clearResume();
    shell.setFeedback('', '');
    paint();
    if (turnOf(st.fen) !== side) engineTurn();
  }

  // ---- book dialog
  function bookDialog() {
    const reps = state.repertoires || [];
    const body = el('div');
    const chosen = new Set(st.bookRepIds);
    if (!reps.length) {
      body.append(el('div', { class: 'empty', text: 'No repertoires yet. Create one under Repertoire, then the engine can play its moves from it here.' }));
    } else {
      const list = el('div', { class: 'list' });
      for (const rep of reps) {
        const cb = el('input', { type: 'checkbox' });
        cb.checked = chosen.has(rep.id);
        cb.addEventListener('change', () => { if (cb.checked) chosen.add(rep.id); else chosen.delete(rep.id); });
        list.append(el('label', { class: 'check', style: 'align-items:flex-start;gap:10px' }, cb,
          el('div', {},
            el('span', { text: rep.name }),
            el('div', { class: 'faint', style: 'font-size:.76rem', text: `${rep.color === 'w' ? 'White' : 'Black'} repertoire` }))));
      }
      body.append(el('p', { class: 'dim', style: 'font-size:.84rem;margin-top:0', html: 'The engine follows these repertoires while the game stays inside them, weighted by how often each line is stored. Outside them it plays normal engine moves.' }), list);
    }
    const inBookNow = bookCandidates();
    const status = el('div', { class: 'feedback hint', style: 'margin-top:10px' });
    status.innerHTML = inBookNow.length
      ? `Position is in book: <b>${inBookNow.map((c) => c.rep.name).join(', ')}</b> · ${st.bookMoves} book move${st.bookMoves === 1 ? '' : 's'} played so far.`
      : (st.bookRepIds.length
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
            st.bookRepIds = [...chosen];
            settings.playBookRepIds = st.bookRepIds;
            saveSettings();
            paint();
            persistResume();
            toast(st.bookRepIds.length ? `Book: ${st.bookRepIds.length} repertoire(s)` : 'Book off', 'ok');
          },
        },
      ],
    });
  }

  paint();
  if (turnOf(st.fen) !== side && !st.history.length) engineTurn();
  else if (st.history.length && turnOf(st.fen) !== side) engineTurn();

  return { destroy() { st.done = true; st.seq++; shell.destroy(); } };
}
