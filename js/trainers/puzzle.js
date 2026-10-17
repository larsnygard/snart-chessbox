// js/trainers/puzzle.js — tactical puzzles with theme filters.
//
// A puzzle is a FEN plus a UCI solution line starting with the solver's move;
// the opponent's replies are auto-played. Wrong tries are counted (they change
// the SRS verdict), and the solution can always be revealed.

import { applyUci } from '../core/chessutil.js';
import { trainerShell } from '../ui/trainer-shell.js';
import { arrowOf, uciFromMove } from './common.js';

const THEME_TEXT = {
  mateIn1: 'Mate in 1', mateIn2: 'Mate in 2', mateIn3: 'Mate in 3', mateIn4: 'Mate in 4',
  backRankMate: 'Back rank', smotheredMate: 'Smothered mate', doubleCheck: 'Double check',
  fork: 'Fork', pin: 'Pin', skewer: 'Skewer', discoveredAttack: 'Discovered attack',
  sacrifice: 'Sacrifice', hangingPiece: 'Hanging piece', promotion: 'Promotion',
  endgame: 'Endgame', defensiveMove: 'Defence', zugzwang: 'Zugzwang',
};

export function mountPuzzle(host, ctx, opts) {
  const puzzle = opts.puzzle;
  const settings = ctx.settings;
  const fen0 = puzzle.fen;
  const solverSide = fen0.split(' ')[1] === 'b' ? 'b' : 'w';

  const shell = trainerShell(host, {
    fen: fen0,
    orientation: solverSide,
    theme: settings.boardTheme,
    pieceSet: settings.pieceSet,
    coords: settings.coords,
    animate: settings.animate,
    startTurn: solverSide,
    onMove: (m) => onUserMove(m),
  });

  const sol = puzzle.sol || [];
  const st = { idx: 0, fen: fen0, tries: 0, solved: false, revealed: false, busy: false, seq: 0, lastUci: null, usedHint: false };

  shell.setTitle('Puzzle', [
    { text: `#${puzzle.id}`, kind: '' },
    { text: `${puzzle.rating || '?'} rating`, kind: '' },
    ...(puzzle.themes || []).slice(0, 3).map((t) => ({ text: THEME_TEXT[t] || t, kind: '' })),
  ]);
  shell.setPanelTitle('Find the best move');
  const nMoves = Math.ceil(sol.length / 2);
  shell.setGoal(`<span class="dim">${nMoves} ${nMoves === 1 ? 'move' : 'moves'} to find · ${(puzzle.themes || []).map((t) => THEME_TEXT[t] || t).join(', ') || '—'}</span>`);

  shell.addTool('Hint', () => hint());
  shell.addTool('Flip', () => shell.board.setOrientation(shell.board.orientation === 'w' ? 'b' : 'w'));
  shell.addAction('Solution', () => reveal());
  shell.addAction('Skip', () => finish(false, 'Skipped'), false);
  if (opts.onNext) shell.addAction('Next puzzle', () => opts.onNext(), true);

  function paint() {
    shell.board.setPosition(st.fen, {
      last: st.lastUci ? { from: st.lastUci.slice(0, 2), to: st.lastUci.slice(2, 4) } : null,
      arrows: [],
      clearSelection: true,
    });
    shell.board.setInteractive(!st.solved && !st.revealed);
    const turn = st.fen.split(' ')[1] === 'b' ? 'b' : 'w';
    shell.setStatus(turn === solverSide ? '<b>Your move</b>' : '<span class="faint">Opponent replies…</span>');
  }

  function apply(uci) {
    const res = applyUci(st.fen, uci);
    if (!res) return null;
    st.fen = res.fen;
    st.lastUci = uci;
    ctx.sound.playForMove(res);
    return res;
  }

  function onUserMove(m) {
    if (st.solved || st.revealed || st.busy) return;
    const uci = uciFromMove(m);
    const want = sol[st.idx];
    if (!want) return;
    if (uci.slice(0, 4) !== want.slice(0, 4)) {
      st.tries++;
      ctx.sound.play('wrong');
      shell.board.flash(m.to);
      shell.setFeedback(
        `<b>Not it.</b> ${st.tries >= 2 ? 'Try again, or reveal the solution.' : 'Look for checks, captures and threats.'}`,
        'bad',
        st.tries >= 2 ? [{ label: 'Show solution', onClick: () => reveal() }] : [],
      );
      paint();
      return;
    }
    st.busy = true;
    apply(uci);
    st.idx++;
    paint();
    advance();
  }

  function advance() {
    if (st.idx >= sol.length) {
      st.busy = false;
      return finish(true, 'Solved!');
    }
    const turn = st.fen.split(' ')[1] === 'b' ? 'b' : 'w';
    if (turn === solverSide) {
      st.busy = false;
      paint();
      return;
    }
    const reply = sol[st.idx];
    st.idx++;
    shell.setStatus('<span class="faint">Opponent replies…</span>');
    setTimeout(() => {
      apply(reply);
      paint();
      advance();
    }, 380);
  }

  function hint() {
    st.usedHint = true;
    const uci = sol[st.idx];
    if (!uci) return;
    shell.board.setArrows([arrowOf(uci, 'hint')]);
    shell.setFeedback('Look at the highlight — that piece has the key move.', 'hint');
    setTimeout(() => shell.board.setArrows([]), 2200);
  }

  function reveal() {
    st.revealed = true;
    shell.board.setInteractive(false);
    // replay the rest of the line on the board for the user to see
    const rest = sol.slice(st.idx);
    let i = 0;
    const step = () => {
      if (i >= rest.length) {
        shell.setFeedback(`<b>Solution:</b> ${sol.map((u) => sanOf(u)).join(' ')}`, 'hint', [
          ...(opts.onNext ? [{ label: 'Next puzzle', primary: true, onClick: () => opts.onNext() }] : []),
        ]);
        return;
      }
      const uci = rest[i++];
      apply(uci);
      paint();
      setTimeout(step, 420);
    };
    shell.setFeedback('Revealing the solution…', 'hint');
    step();
    finish(false, 'Solution revealed', true);
  }

  function sanOf(uci) {
    // cheap SAN reconstruction from the current board is not reliable after the
    // line has been played, so fall back to UCI when SAN is unavailable
    return uci;
  }

  function finish(passed, reason, silent = false) {
    if (st.solved) return;
    st.solved = passed;
    shell.board.setInteractive(false);
    if (!silent) {
      ctx.sound.play(passed ? 'correct' : 'click');
      shell.setFeedback(
        `<b>${passed ? 'Solved — well done.' : reason}</b>${st.tries ? ` ${st.tries} wrong attempt(s).` : ''}`,
        passed ? 'ok' : '',
        [
          { label: 'Retry', onClick: () => restart() },
          ...(opts.onNext ? [{ label: 'Next puzzle', primary: true, onClick: () => opts.onNext() }] : []),
        ],
      );
    }
    if (!st.revealed) ctx.record(`puzzle:${puzzle.id}`, passed && st.tries === 0 && !st.usedHint);
    if (opts.onDone) opts.onDone({ passed, tries: st.tries, usedHint: st.usedHint });
  }

  function restart() {
    st.seq++;
    Object.assign(st, { idx: 0, fen: fen0, tries: 0, solved: false, revealed: false, busy: false, lastUci: null, usedHint: false });
    shell.setFeedback('', '');
    paint();
  }

  shell.setMoves([], -1);
  paint();
  return { destroy() { st.busy = true; shell.destroy(); } };
}
