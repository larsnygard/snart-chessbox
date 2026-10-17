// js/trainers/memory.js — memorise a game, then reproduce it.
//
// study mode: step through with full information (and optional autoplay)
// quiz mode: the game is replayed from the start; at every trained ply the user
//            must play the move from memory. Other plies autoplay.

import { applyUci } from '../core/chessutil.js';
import { trainerShell } from '../ui/trainer-shell.js';
import { arrowOf, uciFromMove } from './common.js';

export function mountMemory(host, ctx, opts) {
  const game = opts.game;
  const settings = ctx.settings;
  const startFen = game.startFen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const moves = game.moves || [];
  const ucis = game.ucis || [];
  const fromPly = opts.fromPly ?? 0;
  const toPly = Math.min(moves.length, opts.toPly ?? moves.length);
  const side = opts.side || 'both';
  const startTurn = startFen.split(' ')[1] === 'b' ? 'b' : 'w';

  const shell = trainerShell(host, {
    fen: startFen,
    orientation: opts.orientation || (side === 'b' ? 'b' : 'w'),
    theme: settings.boardTheme,
    pieceSet: settings.pieceSet,
    coords: settings.coords,
    animate: settings.animate,
    startTurn,
    onMove: (m) => onUserMove(m),
  });

  const st = {
    mode: opts.mode || 'study',
    ply: 0,
    fen: startFen,
    asked: 0,
    right: 0,
    errors: [],
    lastUci: null,
    done: false,
    busy: false,
    autoplay: null,
    seq: 0,
  };

  shell.setTitle(game.name || `${game.white || '?'} – ${game.black || '?'}`, [
    { text: `${moves.length} moves`, kind: '' },
    { text: side === 'both' ? 'Both colours' : side === 'w' ? 'White moves' : 'Black moves', kind: '' },
    { text: `plies ${fromPly + 1}–${toPly}`, kind: '' },
  ]);
  shell.setPanelTitle(st.mode === 'study' ? 'Study the game' : 'Reproduce the game');
  shell.setGoal(`<span class="dim">${game.note || ''}</span>`);

  shell.addTool('Hint', () => hint());
  shell.addTool('Flip', () => shell.board.setOrientation(shell.board.orientation === 'w' ? 'b' : 'w'));

  const navRow = shell.extra;
  const backBtn = elBtn('◀ Prev', () => stepTo(st.mode === 'study' ? Math.max(0, st.ply - 1) : st.ply));
  const fwdBtn = elBtn('Next ▶', () => stepTo(Math.min(toPly, st.ply + 1)));
  const playBtn = elBtn('Autoplay', () => toggleAutoplay());
  navRow.append(backBtn, fwdBtn, playBtn);
  shell.actions.append(
    elBtn('Restart', () => reset()),
    elBtn(st.mode === 'study' ? 'Start quiz' : 'Study mode', () => switchMode(), true),
  );
  if (opts.onNext) shell.actions.append(elBtn('Next game', () => opts.onNext()));

  function elBtn(label, onClick, primary = false) {
    const b = document.createElement('button');
    b.className = 'btn sm' + (primary ? ' primary' : '');
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  function isQuestion(ply) {
    if (ply < fromPly || ply >= toPly) return false;
    const mover = ply % 2 === 0 ? startTurn : (startTurn === 'w' ? 'b' : 'w');
    return side === 'both' || side === mover;
  }

  function paint() {
    shell.board.setPosition(st.fen, {
      last: st.lastUci ? { from: st.lastUci.slice(0, 2), to: st.lastUci.slice(2, 4) } : null,
      arrows: [],
      clearSelection: true,
    });
    const interactive = st.mode === 'quiz' && !st.done && isQuestion(st.ply);
    shell.board.setInteractive(interactive);
    // In study mode reveal only the moves played so far; in quiz mode hide the
    // moves still ahead of the cursor.
    shell.setMoves(moves.slice(0, st.mode === 'study' ? toPly : st.ply), st.ply - 1, marks());
    const who = st.ply % 2 === 0 ? (startTurn === 'w' ? 'White' : 'Black') : (startTurn === 'w' ? 'Black' : 'White');
    if (st.done) shell.setStatus('<span class="faint">Finished</span>');
    else if (st.mode === 'quiz' && isQuestion(st.ply)) shell.setStatus(`<b>Your move</b> <span class="faint">· ply ${st.ply + 1}, ${who} to move</span>`);
    else shell.setStatus(`<span class="faint">Ply ${st.ply + 1} · ${who} to move</span>`);
  }

  function marks() {
    const m = {};
    for (const e of st.errors) m[e] = 'bad';
    return m;
  }

  function applyAtCursor(uci) {
    const res = applyUci(st.fen, uci);
    if (!res) return null;
    st.fen = res.fen;
    st.lastUci = uci;
    ctx.sound.playForMove(res);
    return res;
  }

  function stepTo(ply) {
    stopAutoplay();
    if (ply === st.ply) { paint(); return; }
    if (ply < st.ply) {
      // replay from the start to keep the state authoritative
      st.fen = startFen;
      st.lastUci = null;
      for (let i = 0; i < ply; i++) { if (!applyAtCursor(ucis[i])) break; }
      st.ply = ply;
      paint();
      return;
    }
    for (let i = st.ply; i < ply; i++) {
      if (!applyAtCursor(ucis[i])) break;
      st.ply = i + 1;
    }
    paint();
  }

  async function autoplayFrom() {
    stopAutoplay();
    st.autoplay = setInterval(() => {
      if (st.ply >= toPly) { stopAutoplay(); return; }
      if (isQuestion(st.ply)) { stopAutoplay(); paint(); return; }
      if (!applyAtCursor(ucis[st.ply])) { stopAutoplay(); return; }
      st.ply++;
      paint();
    }, 1100);
  }

  function toggleAutoplay() {
    if (st.autoplay) stopAutoplay();
    else autoplayFrom();
  }

  function stopAutoplay() {
    if (st.autoplay) { clearInterval(st.autoplay); st.autoplay = null; }
  }

  function quizStep() {
    if (st.done) return;
    if (st.ply >= toPly) return finish();
    if (isQuestion(st.ply)) { paint(); return; }
    // autoplay the plies the user is not being quizzed on
    st.busy = true;
    shell.setStatus('<span class="faint">Replaying…</span>');
    setTimeout(() => {
      if (st.done) return;
      applyAtCursor(ucis[st.ply]);
      st.ply++;
      st.busy = false;
      paint();
      quizStep();
    }, 520);
  }

  function onUserMove(m) {
    if (st.mode !== 'quiz' || st.done || !isQuestion(st.ply)) return;
    const uci = uciFromMove(m);
    const want = ucis[st.ply];
    st.asked++;
    if (want && uci.slice(0, 4) === want.slice(0, 4)) {
      st.right++;
      applyAtCursor(uci);
      st.ply++;
      ctx.sound.play('correct');
      shell.setFeedback('Correct.', 'ok');
      setTimeout(() => { shell.setFeedback('', ''); quizStep(); }, 260);
      paint();
      return;
    }
    st.errors.push(st.ply);
    ctx.sound.play('wrong');
    shell.board.flash(m.to);
    const wantSan = moves[st.ply];
    st.lastUci = want;
    shell.setFeedback(
      `<b>Not the move.</b> This game continued <span class="mono">${wantSan}</span>.`,
      'bad',
      [{ label: 'Show it', onClick: () => { shell.board.setArrows([arrowOf(want, 'hint')]); setTimeout(() => shell.board.setArrows([]), 2000); } }],
    );
    setTimeout(() => {
      if (st.done) return;
      applyAtCursor(want);
      st.ply++;
      st.lastUci = want;
      shell.setFeedback('', '');
      paint();
      quizStep();
    }, 1300);
  }

  function hint() {
    if (st.mode === 'quiz' && st.ply < toPly) {
      const want = ucis[st.ply];
      st.right = Math.max(0, st.right); // a hint does not count as a correct answer below
      shell.board.setArrows([arrowOf(want, 'hint')]);
      shell.setFeedback(`The next move starts on <span class="mono">${want ? want.slice(0, 2) : '—'}</span>.`, 'hint');
      setTimeout(() => shell.board.setArrows([]), 2200);
      if (!st.hinted) st.hinted = true;
      return;
    }
    stepTo(Math.min(toPly, st.ply + 1));
  }

  function switchMode() {
    stopAutoplay();
    if (st.mode === 'study') {
      st.mode = 'quiz';
      st.asked = 0; st.right = 0; st.errors = []; st.hinted = false;
      shell.setPanelTitle('Reproduce the game');
      shell.setFeedback('Quiz started: play the moves from memory. Wrong moves are shown in red.', 'hint');
      reset(true);
    } else {
      st.mode = 'study';
      st.done = false;
      shell.setPanelTitle('Study the game');
      shell.setFeedback('', '');
      stepTo(0);
      paint();
    }
    paintButtons();
  }

  function paintButtons() {
    const showNav = st.mode === 'study';
    navRow.style.display = showNav ? '' : 'none';
  }

  function reset(keepMode = false) {
    stopAutoplay();
    st.seq++;
    st.ply = 0; st.fen = startFen; st.lastUci = null; st.done = false; st.busy = false;
    if (!keepMode) { st.asked = 0; st.right = 0; st.errors = []; st.hinted = false; }
    paint();
    if (st.mode === 'quiz') quizStep();
  }

  function finish() {
    st.done = true;
    stopAutoplay();
    shell.board.setInteractive(false);
    const pct = st.asked ? Math.round((st.right / st.asked) * 100) : 0;
    ctx.sound.play(pct >= 80 ? 'win' : 'lose');
    shell.setFeedback(
      `<b>Recall complete.</b> ${st.right}/${st.asked} from memory (${pct}%).` +
      (st.errors.length ? ` Missed plies: ${st.errors.map((p) => moves[p]).join(', ')}.` : ' Perfect run.'),
      pct >= 80 ? 'ok' : 'bad',
      [
        { label: 'Repeat', onClick: () => reset(true) },
        ...(opts.onNext ? [{ label: 'Next game', primary: true, onClick: () => opts.onNext() }] : []),
      ],
    );
    ctx.record(`memory:${game.id}`, pct >= 80 && !st.hinted);
    if (opts.onDone) opts.onDone({ pct, right: st.right, asked: st.asked, errors: st.errors });
  }

  paintButtons();
  paint();
  if (st.mode === 'quiz') quizStep();

  return {
    destroy() { st.done = true; st.seq++; stopAutoplay(); shell.destroy(); },
    startQuiz() { switchMode(); },
  };
}
