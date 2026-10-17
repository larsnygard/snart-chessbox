// js/trainers/freeplay.js — unstructured play against the engine from any
// position. Used by "play on vs engine", by the coach screen ("start from your
// blunder") and by the practice tab.

import { START_FEN, applyUci, legalMoves } from '../core/chessutil.js';
import { trainerShell } from '../ui/trainer-shell.js';
import { enginePickUci, arrowOf, uciFromMove, strengthLabel } from './common.js';

export function mountFreeplay(host, ctx, opts = {}) {
  const settings = ctx.settings;
  const startFen = opts.fen || START_FEN;
  const side = opts.side || (startFen.split(' ')[1] === 'b' ? 'b' : 'w');

  const shell = trainerShell(host, {
    fen: startFen,
    orientation: side,
    theme: settings.boardTheme,
    pieceSet: settings.pieceSet,
    coords: settings.coords,
    animate: settings.animate,
    startTurn: startFen.split(' ')[1],
    onMove: (m) => onUserMove(m),
  });

  const st = { fen: startFen, history: [], done: false, seq: 0, lastOpp: null, lastUci: null, evalCp: null, thinking: false };

  shell.setTitle(opts.title || 'Play vs engine', [
    { text: side === 'w' ? 'You are White' : 'You are Black', kind: '' },
    { text: strengthLabel(settings.strength), kind: '' },
    { text: settings.spreadCp ? `±${(settings.spreadCp / 100).toFixed(1)}` : 'exact', kind: '' },
  ]);
  shell.setPanelTitle('Game');
  shell.setGoal(opts.subtitle || '<span class="dim">Free practice. Hints show the engine\'s favourite move.</span>');

  shell.addTool('Hint', () => showHint());
  shell.addTool('Flip', () => shell.board.setOrientation(shell.board.orientation === 'w' ? 'b' : 'w'));
  shell.addAction('Take back', () => takeback());
  shell.addAction('Restart', () => reset());
  const evalEl = document.createElement('div');
  evalEl.className = 'dim';
  evalEl.style.fontSize = '.8rem';
  shell.extra.append(evalEl);

  function turnOf(fen) { return fen.split(' ')[1] === 'b' ? 'b' : 'w'; }

  function paint() {
    shell.board.setPosition(st.fen, {
      last: st.lastUci ? { from: st.lastUci.slice(0, 2), to: st.lastUci.slice(2, 4) } : null,
      arrows: st.lastOpp ? [arrowOf(st.lastOpp, 'best')] : [],
      clearSelection: true,
    });
    const myTurn = turnOf(st.fen) === side && !st.done;
    shell.board.setInteractive(myTurn);
    shell.setStatus(myTurn ? '<b>Your move</b>' : (st.done ? '<span class="faint">Game over</span>' : '<span class="faint">Engine is thinking…</span>'));
    shell.setMoves(st.history.map((h) => h.san), st.history.length - 1);
    if (st.evalCp !== null) evalEl.textContent = `Last engine eval: ${(st.evalCp / 100).toFixed(2)}`;
  }

  function applyMove(uci) {
    const res = applyUci(st.fen, uci);
    if (!res) return null;
    st.fen = res.fen;
    st.history.push({ uci, san: res.san });
    st.lastUci = uci;
    ctx.sound.playForMove(res);
    return res;
  }

  async function engineTurn() {
    if (st.done || turnOf(st.fen) === side) return;
    const seq = ++st.seq;
    st.thinking = true;
    let pick = null;
    try {
      const eng = ctx.engine();
      pick = await eng.pickMove({
        fen: st.fen,
        movetime: settings.thinkMs,
        spreadCp: settings.spreadCp,
        elo: settings.strength,
        weighting: settings.spreadWeighting,
      });
    } catch (e) { pick = null; }
    if (seq !== st.seq || st.done) return;
    st.thinking = false;
    if (!pick || !pick.uci) { shell.setFeedback('The engine could not produce a move.', 'bad'); return; }
    st.evalCp = pick.bestValue !== undefined ? pick.bestValue : null;
    st.lastOpp = pick.uci;
    const res = applyMove(pick.uci);
    paint();
    if (res && (res.mate || res.stalemate || res.draw)) gameOver(res);
  }

  function onUserMove(m) {
    if (st.done || turnOf(st.fen) !== side) return;
    st.lastOpp = null;
    const res = applyMove(uciFromMove(m));
    if (!res) { ctx.sound.play('illegal'); return; }
    paint();
    if (res.mate || res.stalemate || res.draw) return gameOver(res);
    engineTurn();
  }

  function gameOver(res) {
    st.done = true;
    shell.board.setInteractive(false);
    const text = res.mate ? (turnOf(st.fen) === side ? 'You are checkmated.' : 'Checkmate — you won!') : res.stalemate ? 'Stalemate.' : 'Draw.';
    ctx.sound.play(res.mate && turnOf(st.fen) !== side ? 'win' : 'lose');
    shell.setFeedback(`<b>${text}</b>`, res.mate && turnOf(st.fen) !== side ? 'ok' : '', [
      { label: 'New game', onClick: () => reset(), primary: true },
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
      setTimeout(() => { shell.board.setArrows(st.lastOpp ? [arrowOf(st.lastOpp, 'best')] : []); }, 2600);
    } catch (e) { ctx.toast('Engine unavailable', 'bad'); }
  }

  function takeback() {
    if (st.done) { st.done = false; }
    st.seq++;
    st.history.pop();
    st.history.pop();
    st.fen = startFen;
    st.lastUci = null;
    st.lastOpp = null;
    for (const h of st.history) {
      const r = applyUci(st.fen, h.uci);
      if (!r) break;
      st.fen = r.fen;
      st.lastUci = h.uci;
    }
    paint();
    if (turnOf(st.fen) !== side) engineTurn();
  }

  function reset() {
    st.seq++;
    Object.assign(st, { fen: startFen, history: [], done: false, lastOpp: null, lastUci: null, evalCp: null });
    shell.setFeedback('', '');
    paint();
    if (turnOf(st.fen) !== side) engineTurn();
  }

  paint();
  if (turnOf(st.fen) !== side) engineTurn();

  return { destroy() { st.done = true; st.seq++; shell.destroy(); } };
}
