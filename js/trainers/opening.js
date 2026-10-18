// js/trainers/opening.js — opening-line and repertoire training.
//
// Two modes on one engine:
//   line — a fixed variation from the bundled opening database; the user must
//          reproduce their side's moves while the opponent's moves autoplay
//   tree — the user's own repertoire: the opponent picks a weighted book move,
//          the user may play any move that exists in their tree
//
// Hints draw the expected move as an arrow (never auto-played), and every
// finished line feeds the spaced-repetition progress store.

import { START_FEN, applySan, applyUci } from '../core/chessutil.js';
import { movesAt, pickBookMove, findMoveNode } from '../core/repertoire.js';
import { trainerShell } from '../ui/trainer-shell.js';
import { enginePickUci, arrowOf, uciFromMove } from './common.js';

export function mountOpening(host, ctx, opts) {
  const settings = ctx.settings;
  const side = opts.side === 'b' ? 'b' : 'w';
  const mode = opts.mode || (opts.tree ? 'tree' : 'line');
  const line = opts.line || { sans: [], ucis: [] };
  const startFen = opts.startFen || START_FEN;

  const shell = trainerShell(host, {
    fen: startFen,
    orientation: side,
    theme: settings.boardTheme,
    pieceSet: settings.pieceSet,
    coords: settings.coords,
    animate: settings.animate,
    settings,
    nav: {
      first: () => setView(0),
      back: () => setView((st.viewPly ?? st.ucis.length) - 1),
      forward: () => setView((st.viewPly ?? st.ucis.length) + 1),
      last: () => setView(st.ucis.length),
      state: () => ({ atStart: (st.viewPly ?? st.ucis.length) === 0, atEnd: st.viewPly === null || st.viewPly === undefined }),
    },
    startTurn: startFen.split(' ')[1],
    onMove: (m) => onUserMove(m),
  });

  const st = {
    sans: [],
    ucis: [],
    fen: startFen,
    attempts: 0,
    usedHint: false,
    done: false,
    free: false,
    busy: false,
    seq: 0,
    lastOpponentUci: null,
    viewPly: null, // null = the live position; a number = reviewing an earlier ply
  };

  shell.setTitle(opts.title || 'Opening training', [
    { text: side === 'w' ? 'White' : 'Black', kind: '' },
    { text: mode === 'tree' ? 'Repertoire' : 'Line', kind: '' },
  ]);
  shell.setPanelTitle(mode === 'tree' ? 'Your repertoire' : 'Opening line');
  shell.setGoal(opts.subtitle || '');

  const hintBtn = shell.addTool('Hint', () => showHint());
  const flipBtn = shell.addTool('Flip', () => {
    shell.board.setOrientation(shell.board.orientation === 'w' ? 'b' : 'w');
  });
  shell.addAction('Restart', () => restart());
  if (opts.onNext) shell.addAction('Next line', () => opts.onNext(), true);

  function turnOfFen(fen) { return fen.split(' ')[1] === 'b' ? 'b' : 'w'; }

  function expectedMoves() {
    if (mode === 'line' && !st.free) {
      if (st.ucis.length >= line.ucis.length) return [];
      return [line.ucis[st.ucis.length]];
    }
    if (mode === 'tree' && !st.free) {
      const node = findMoveNode(opts.tree, st.sans);
      return movesAt(node).map((m) => m.uci);
    }
    return null; // free play: anything legal
  }

  function expectedSan() {
    if (mode === 'line' && !st.free && st.sans.length < line.sans.length) return line.sans[st.sans.length];
    const node = mode === 'tree' ? findMoveNode(opts.tree, st.sans) : null;
    const moves = movesAt(node);
    return moves.length ? moves[0].san : null;
  }

  function updateStatus() {
    const turn = turnOfFen(st.fen);
    const live = st.viewPly === null || st.viewPly === undefined;
    if (st.done) {
      shell.setStatus('<span class="faint">Line finished</span>');
      shell.board.setInteractive(false);
      return;
    }
    if (!live) {
      shell.setStatus(`Reviewing ply ${st.viewPly} of ${st.ucis.length} · <span class="faint">press ▶| to return to the live position</span>`);
      shell.board.setInteractive(false);
      return;
    }
    if (turn === side) shell.setStatus(st.free ? '<b>Your move</b> — free play' : '<b>Your move</b>');
    else shell.setStatus('<span class="faint">Opponent is moving…</span>');
    shell.board.setInteractive(turn === side && !st.done);
  }

  function viewFen() {
    if (st.viewPly === null || st.viewPly === undefined) return st.fen;
    let f = startFen;
    for (let i = 0; i < st.viewPly; i++) {
      const r = applyUci(f, st.ucis[i]);
      if (!r) break;
      f = r.fen;
    }
    return f;
  }

  /** Review an earlier ply without touching the game state. */
  function setView(n) {
    const max = st.ucis.length;
    const v = Math.max(0, Math.min(max, n));
    st.viewPly = v === max ? null : v;
    renderBoard(null);
    updateStatus();
  }

  function renderBoard(lastUci) {
    const arrows = [];
    if (st.lastOpponentUci) arrows.push(arrowOf(st.lastOpponentUci, 'best'));
    const live = st.viewPly === null || st.viewPly === undefined;
    const viewed = live ? null : st.ucis[st.viewPly - 1];
    const last = lastUci
      ? { from: lastUci.slice(0, 2), to: lastUci.slice(2, 4) }
      : viewed ? { from: viewed.slice(0, 2), to: viewed.slice(2, 4) } : null;
    shell.board.setPosition(viewFen(), { last, arrows, clearSelection: true });
  }

  function commit(uci) {
    const res = applyUci(st.fen, uci);
    if (!res) return null;
    st.sans.push(res.san);
    st.ucis.push(uci);
    st.fen = res.fen;
    st.viewPly = null;
    renderBoard(uci);
    shell.setMoves(st.sans, st.sans.length - 1);
    ctx.sound.playForMove(res);
    updateStatus();
    return res;
  }

  function restart() {
    st.seq++;
    Object.assign(st, { sans: [], ucis: [], fen: startFen, attempts: 0, usedHint: false, done: false, free: false, lastOpponentUci: null, viewPly: null });
    shell.setFeedback('', '');
    shell.setMoves([], -1);
    renderBoard(null);
    updateStatus();
    scheduleOpponentIfNeeded();
  }

  async function opponentTurn() {
    if (st.done) return;
    const turn = turnOfFen(st.fen);
    if (turn === side) return;
    const seq = ++st.seq;
    let uci = null;
    if (mode === 'line' && !st.free && st.ucis.length < line.ucis.length) {
      uci = line.ucis[st.ucis.length];
    } else if (mode === 'tree' && !st.free) {
      const node = findMoveNode(opts.tree, st.sans);
      const book = movesAt(node);
      if (book.length) {
        const pick = pickBookMove(book);
        uci = pick ? pick.uci : null;
      }
    }
    if (!uci) {
      // out of book: either finish or let the engine take over
      if (st.free || settings.engineRepliesInBook) {
        st.free = true;
        try {
          uci = await enginePickUci(ctx, st.fen);
        } catch (e) { uci = null; }
        if (seq !== st.seq) return;
      }
    }
    if (!uci) { finish('book-end'); return; }
    if (seq !== st.seq) return;
    st.lastOpponentUci = uci;
    const res = commit(uci);
    if (!res) { finish('book-end'); return; }
    if (res.mate || res.stalemate || res.draw) { finish('game-over', res); return; }
    updateStatus();
    // the book can run out on the opponent's move too — that still ends the line
    if (mode === 'line' && !st.free && st.ucis.length >= line.ucis.length) finish('book-end');
  }

  function scheduleOpponentIfNeeded(delay = 320) {
    if (st.done) return;
    if (turnOfFen(st.fen) === side) return;
    setTimeout(() => opponentTurn(), delay);
  }

  function onUserMove(m) {
    if (st.done) return;
    if (turnOfFen(st.fen) !== side) return;
    const uci = uciFromMove(m);
    const allowed = expectedMoves();
    if (allowed && allowed.length && !allowed.includes(uci)) {
      st.attempts++;
      ctx.sound.play('wrong');
      const want = expectedSan();
      shell.setFeedback(
        `<b>Not the line.</b> ${want ? `Expected <span class="mono">${want}</span>.` : 'That move is not in your repertoire.'}`,
        'bad',
        [
          { label: 'Try again', onClick: () => shell.setFeedback('', '') },
          { label: 'Show it', onClick: () => showHint(true) },
          ...(mode === 'tree' ? [{
            label: 'Play anyway',
            onClick: () => { st.free = true; shell.setFeedback('', ''); commit(uci); scheduleOpponentIfNeeded(); },
          }] : []),
        ],
      );
      // show the expected move as an arrow, but keep the rejection message on
      // screen (showHint() would replace it with its own feedback text)
      if (settings.hints) {
        st.usedHint = true;
        const hintUci = allowed[0];
        if (hintUci) {
          shell.board.setArrows([arrowOf(hintUci, 'hint')]);
          setTimeout(() => shell.board.setArrows([]), 2600);
        }
      }
      return;
    }
    const res = commit(uci);
    if (!res) { ctx.sound.play('illegal'); return; }
    if (res.mate || res.stalemate || res.draw) { finish('game-over', res); return; }
    if (!st.free) {
      const after = expectedMoves();
      const lineDone = mode === 'line' ? st.ucis.length >= line.ucis.length : (!after || after.length === 0 || turnOfFen(st.fen) === side && after.length === 0);
      if (lineDone) { finish('book-end'); return; }
    }
    scheduleOpponentIfNeeded(220);
  }

  function showHint(force = false) {
    if (!settings.hints && !force) return;
    const ucis = expectedMoves();
    let uci = ucis && ucis[0];
    if (!uci && mode === 'line' && st.ucis.length < line.ucis.length) uci = line.ucis[st.ucis.length];
    if (!uci) { ctx.toast('No hint available here', ''); return; }
    st.usedHint = true;
    shell.board.setArrows([arrowOf(uci, 'hint')]);
    shell.setFeedback(`Hint: <span class="mono">${expectedSan() || uci}</span>`, 'hint');
    setTimeout(() => shell.board.setArrows([]), 2600);
  }

  function finish(reason, res) {
    if (st.done) return;
    st.done = true;
    const clean = st.attempts === 0 && !st.usedHint;
    st.lastOpponentUci = null;
    if (reason === 'game-over' && res) {
      const result = res.mate ? 'Checkmate' : res.stalemate ? 'Stalemate' : 'Draw';
      shell.setFeedback(`<b>${result}.</b> The line ended on the board.`, res.mate ? 'ok' : '', [
        { label: 'Restart', onClick: () => restart() },
        ...(opts.onNext ? [{ label: 'Next line', primary: true, onClick: () => opts.onNext() }] : []),
      ]);
    } else {
      shell.setFeedback(
        `<b>Line complete.</b> ${clean ? 'Clean run — no hints, no wrong moves.' : `${st.attempts} wrong move(s), hints used.`}`,
        clean ? 'ok' : '',
        [
          { label: 'Restart', onClick: () => restart() },
          { label: 'Play on vs engine', onClick: () => { st.done = false; st.free = true; shell.setFeedback('', ''); updateStatus(); scheduleOpponentIfNeeded(0); } },
          ...(opts.onNext ? [{ label: 'Next line', primary: true, onClick: () => opts.onNext() }] : []),
        ],
      );
      ctx.sound.play(clean ? 'correct' : 'click');
    }
    updateStatus();
    shell.board.setInteractive(false);
    if (opts.progressKey) ctx.record(opts.progressKey, clean);
    if (opts.onDone) opts.onDone({ clean, attempts: st.attempts, usedHint: st.usedHint, sans: st.sans });
  }

  shell.setMoves([], -1);
  updateStatus();
  if (turnOfFen(st.fen) !== side) scheduleOpponentIfNeeded(250);
  else if (startFen !== START_FEN) shell.board.setInteractive(true);

  return { destroy() { st.done = true; st.seq++; shell.destroy(); }, shell };
}

/** Build the options object used by both the opening browser and set runner. */
export function openingTrainerOptions(opening, side, settings) {
  const startFen = START_FEN;
  return {
    title: opening.name,
    subtitle: `<span class="badge">${opening.eco}</span> ${opening.moves.length} plies · you play ${side === 'w' ? 'White' : 'Black'}`,
    line: { sans: opening.moves, ucis: sansToUcis(startFen, opening.moves) },
    side,
    progressKey: `opening:${opening.id}:${side}`,
  };
}

export function sansToUcis(fen, sans) {
  let f = fen;
  const out = [];
  for (const san of sans) {
    const r = applySan(f, san);
    if (!r) break;
    out.push(r.from + r.to + (r.promo || ''));
    f = r.fen;
  }
  return out;
}
