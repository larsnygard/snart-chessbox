// js/trainers/endgame.js — endgame technique drills against the engine.
//
// The engine plays the defending (or attacking) side at full strength; the user
// has a concrete goal and a move budget. Success/failure is judged from the
// resulting position, not from an eval.

import { applyUci, endgameInfo, material } from '../core/chessutil.js';
import { judgeDrill, goalLabel } from '../core/endgames.js';
import { trainerShell } from '../ui/trainer-shell.js';
import { enginePickUci, arrowOf, uciFromMove, strengthLabel } from './common.js';

export function mountEndgame(host, ctx, opts) {
  const drill = opts.drill;
  const settings = ctx.settings;
  const userSide = drill.side;
  const oppSide = userSide === 'w' ? 'b' : 'w';

  const shell = trainerShell(host, {
    fen: drill.fen,
    orientation: userSide,
    theme: settings.boardTheme,
    pieceSet: settings.pieceSet,
    coords: settings.coords,
    animate: settings.animate,
    startTurn: drill.fen.split(' ')[1],
    onMove: (m) => onUserMove(m),
  });

  const st = { fen: drill.fen, history: [], userMoves: 0, done: false, busy: false, seq: 0, hints: 0, lastUci: null, lastOpp: null, status: 'running' };

  shell.setTitle(drill.title, [
    { text: drill.goal === 'hold' ? 'Defence' : drill.goal === 'mate' ? 'Mate' : 'Promotion', kind: '' },
    { text: `Level ${drill.level}`, kind: '' },
  ]);
  shell.setPanelTitle(goalLabel(drill.goal));
  shell.setGoal(`<span class="dim">${drill.hint || ''}</span>`);

  shell.addTool('Hint', () => showHint());
  shell.addTool('Flip', () => shell.board.setOrientation(shell.board.orientation === 'w' ? 'b' : 'w'));
  shell.addAction('Take back', () => takeback());
  shell.addAction('Restart', () => restart());
  if (opts.onNext) shell.addAction('Next drill', () => opts.onNext(), true);

  function turnOf(fen) { return fen.split(' ')[1] === 'b' ? 'b' : 'w'; }
  function myTurn() { return turnOf(st.fen) === userSide && !st.done; }

  function paint() {
    shell.board.setPosition(st.fen, {
      last: st.lastUci ? { from: st.lastUci.slice(0, 2), to: st.lastUci.slice(2, 4) } : null,
      arrows: st.lastOpp ? [arrowOf(st.lastOpp, 'best')] : [],
      clearSelection: true,
    });
    shell.board.setInteractive(myTurn());
    const turn = turnOf(st.fen);
    const who = turn === userSide ? '<b>Your move</b>' : '<span class="faint">Engine is thinking…</span>';
    const budget = drill.goal === 'hold' ? `Survive ${Math.max(0, drill.maxMoves - st.userMoves)} more` : `Move ${Math.min(st.userMoves + 1, drill.maxMoves)} of ${drill.maxMoves}`;
    shell.setStatus(`${who} <span class="faint">· ${budget}</span>`);
    shell.setMoves(st.history.map((h) => h.san), st.history.length - 1);
  }

  function recordMove(uci) {
    const res = applyUci(st.fen, uci);
    if (!res) return null;
    st.fen = res.fen;
    st.history.push({ uci, san: res.san });
    st.lastUci = uci;
    ctx.sound.playForMove(res);
    return res;
  }

  async function engineReply() {
    if (st.done || turnOf(st.fen) === userSide) return;
    const seq = ++st.seq;
    let uci = null;
    try {
      uci = await enginePickUci(ctx, st.fen, { strong: true, movetime: Math.max(300, Math.min(1200, settings.thinkMs)) });
    } catch (e) { uci = null; }
    if (seq !== st.seq || st.done) return;
    if (!uci) { shell.setFeedback('Engine could not move.', 'bad'); return; }
    st.lastOpp = uci;
    const res = recordMove(uci);
    paint();
    if (!res) return;
    if (res.mate) return finish('fail', 'The engine delivered mate.');
    if (res.stalemate || res.draw) {
      if (drill.goal === 'hold') return finish('win', 'Drawn — the defence held.');
      return finish('fail', 'Stalemate or draw — no mate.');
    }
    if (drill.goal === 'promote') {
      // losing the promotion chance shows up as a lost pawn; warn but keep playing
      const m = material(st.fen);
      const userPawns = userSide === 'w' ? m.w.p : m.b.p;
      const startPawns = (() => { const sm = material(drill.fen); return userSide === 'w' ? sm.w.p : sm.b.p; })();
      if (userPawns < startPawns) shell.setFeedback('You lost the pawn — the drill will not promote now.', 'bad');
    }
  }

  function onUserMove(m) {
    if (!myTurn()) return;
    const uci = uciFromMove(m);
    const res = recordMove(uci);
    if (!res) { ctx.sound.play('illegal'); return; }
    st.userMoves++;
    st.lastOpp = null;
    paint();
    const verdict = judgeDrill({
      goal: drill.goal,
      maxMoves: drill.maxMoves,
      movesPlayed: st.userMoves,
      state: { mate: res.mate, stalemate: res.stalemate, draw: res.draw, promo: res.promo },
    });
    if (verdict.status === 'win') return finish('win', verdict.reason);
    if (verdict.status === 'fail') return finish('fail', verdict.reason);
    engineReply();
  }

  async function showHint() {
    st.hints++;
    try {
      const uci = await enginePickUci(ctx, st.fen, { strong: true, movetime: 350 });
      if (!uci) return;
      shell.board.setArrows([arrowOf(uci, 'hint')]);
      const san = applyUci(st.fen, uci);
      shell.setFeedback(`Engine's idea: <span class="mono">${san ? san.san : uci}</span>`, 'hint');
      setTimeout(() => shell.board.setArrows(st.lastOpp ? [arrowOf(st.lastOpp, 'best')] : []), 2400);
    } catch (e) { ctx.toast('Engine unavailable', 'bad'); }
  }

  function takeback() {
    if (st.done || !st.history.length) return;
    st.seq++;
    // remove plies until it is the user's move again
    do {
      const h = st.history.pop();
      if (!h) break;
    } while (st.history.length && turnOf(rebuildFen()) !== userSide);
    st.fen = rebuildFen();
    st.userMoves = Math.max(0, st.userMoves - 1);
    st.lastOpp = null;
    st.lastUci = st.history.length ? st.history[st.history.length - 1].uci : null;
    paint();
    shell.setFeedback('', '');
    if (turnOf(st.fen) !== userSide) engineReply();
  }

  function rebuildFen() {
    let f = drill.fen;
    for (const h of st.history) {
      const r = applyUci(f, h.uci);
      if (!r) break;
      f = r.fen;
    }
    return f;
  }

  function restart() {
    st.seq++;
    Object.assign(st, { fen: drill.fen, history: [], userMoves: 0, done: false, hints: 0, lastUci: null, lastOpp: null, status: 'running' });
    shell.setFeedback('', '');
    paint();
    if (turnOf(st.fen) !== userSide) engineReply();
  }

  function finish(kind, reason) {
    st.done = true;
    st.status = kind;
    shell.board.setInteractive(false);
    const passed = kind === 'win';
    const clean = passed && st.hints === 0;
    ctx.sound.play(passed ? 'win' : 'lose');
    shell.setFeedback(
      `<b>${passed ? 'Drill solved' : 'Drill failed'}.</b> ${reason}${passed ? ` (${st.hints} hint${st.hints === 1 ? '' : 's'})` : ''}`,
      passed ? 'ok' : 'bad',
      [
        { label: 'Retry', onClick: () => restart() },
        ...(opts.onNext ? [{ label: 'Next drill', primary: true, onClick: () => opts.onNext() }] : []),
      ],
    );
    shell.setStatus(`<span class="${passed ? '' : 'faint'}">${passed ? 'Solved' : 'Not solved'}</span>`);
    ctx.record(`endgame:${drill.id}`, clean);
    if (opts.onDone) opts.onDone({ passed, hints: st.hints, moves: st.userMoves });
  }

  paint();
  if (turnOf(st.fen) !== userSide) engineReply();

  return { destroy() { st.done = true; st.seq++; shell.destroy(); } };
}
