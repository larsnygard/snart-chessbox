// js/ui/board-tools.js — the strip every board carries:
//   |◀ ◀ ▶ ▶|   eval bar   [Engine]   [Play engine from this position]   [Flip]
//
// It reads the position straight from the board, so any screen gets evaluation,
// a play-from-here entry point and move-list navigation without extra wiring.
// Analysis only runs while the engine switch is on (puzzles switch it off so the
// engine cannot give the solution away).

import { getEngine } from './engine.js';
import { el, icon, toast } from './components.js';
import { winProbability, formatEval } from '../core/chessutil.js';

export function createBoardTools(host, opts) {
  const settings = opts.settings || {};
  const board = opts.board;
  const nav = opts.nav || null;
  const allowEngine = opts.allowEngine !== false;

  const wrap = el('div', { class: 'board-tools' });
  host.append(wrap);

  // ---- navigation
  const navBtns = {};
  if (nav) {
    const group = el('div', { class: 'navgroup' });
    const mk = (key, glyph, label, handler) => {
      const b = el('button', { class: 'btn sm icon', title: label, 'aria-label': label, html: icon(glyph) });
      b.addEventListener('click', () => { handler(); refresh(); });
      navBtns[key] = b;
      group.append(b);
      return b;
    };
    mk('first', 'start', 'First move', () => nav.first && nav.first());
    mk('back', 'back', 'Previous move', () => nav.back && nav.back());
    mk('forward', 'next', 'Next move', () => nav.forward && nav.forward());
    mk('last', 'end', 'Last move', () => nav.last && nav.last());
    wrap.append(group);
  }

  const evalText = el('span', { class: 'eval-text', text: '—' });
  const evalBar = el('div', { class: 'evalbar', title: 'Evaluation' }, el('i', { class: 'fill', style: 'width:50%' }));
  const engineBtn = el('button', { class: 'btn sm', text: 'Engine: off' });
  const playBtn = el('button', { class: 'btn sm', text: 'Play engine from here' });
  const flipBtn = el('button', { class: 'btn sm ghost icon', html: icon('rotate'), title: 'Flip board' });
  const depthEl = el('span', { class: 'faint eval-depth', text: '' });

  if (allowEngine) wrap.append(evalText, evalBar, engineBtn, depthEl);
  else wrap.append(el('span', { class: 'faint', style: 'font-size:.76rem', text: 'Engine hidden in this mode' }));
  wrap.append(el('div', { class: 'spacer' }), el('div', { class: 'row tight' }, playBtn, flipBtn));

  let on = false;
  let busy = false;
  let token = 0;
  let timer = null;

  engineBtn.addEventListener('click', () => {
    on = !on;
    engineBtn.textContent = on ? 'Engine: on' : 'Engine: off';
    engineBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) refresh();
    else {
      board.setEngineArrows([]);
      evalText.textContent = '—';
      depthEl.textContent = '';
      setBar(50);
    }
  });

  flipBtn.addEventListener('click', () => {
    board.setOrientation(board.orientation === 'w' ? 'b' : 'w');
  });

  playBtn.addEventListener('click', () => {
    const fen = board.fen;
    const turn = fen.split(' ')[1] === 'b' ? 'b' : 'w';
    if (opts.onPlayFromHere) opts.onPlayFromHere(fen, turn);
    else location.hash = `#/coach?fen=${encodeURIComponent(fen)}&side=${turn}`;
  });

  function setBar(whitePct) {
    const fill = evalBar.querySelector('.fill');
    if (fill) fill.style.width = `${Math.max(2, Math.min(98, whitePct))}%`;
  }

  /** Re-run analysis for the board's current position (called after every move). */
  function refresh() {
    if (nav && navBtns.back) {
      const s = nav.state ? nav.state() : {};
      navBtns.first.disabled = !!s.atStart;
      navBtns.back.disabled = !!s.atStart;
      navBtns.forward.disabled = !!s.atEnd;
      navBtns.last.disabled = !!s.atEnd;
    }
    if (!on || !allowEngine) return;
    token++;
    const my = token;
    clearTimeout(timer);
    depthEl.textContent = '…';
    timer = setTimeout(async () => {
      if (busy) { /* the queue serialises; stale results are dropped by token */ }
      busy = true;
      try {
        const eng = opts.engine ? opts.engine() : getEngine();
        const fen = board.fen;
        const res = await eng.analyse({
          fen,
          movetime: Math.max(180, Math.min(900, settings.thinkMs || 400)),
          multipv: 2,
          elo: 0, // the eval bar must be honest, independent of playing strength
        });
        if (my !== token) return;
        const best = res.lines[0];
        const turn = fen.split(' ')[1] === 'b' ? 'b' : 'w';
        if (best) {
          const cpRaw = best.mate != null
            ? (best.mate > 0 ? 100000 - best.mate * 100 : -100000 + Math.abs(best.mate) * 100)
            : (best.cp || 0);
          const cpWhite = turn === 'w' ? cpRaw : -cpRaw;
          setBar(winProbability(cpWhite));
          evalText.textContent = best.mate != null ? `M${Math.abs(best.mate)}${(turn === 'w' ? best.mate > 0 : best.mate < 0) ? '' : ' (against)'}` : formatEval(cpWhite);
          evalText.className = 'eval-text ' + (cpWhite > 40 ? 'pos' : cpWhite < -40 ? 'neg' : '');
          depthEl.textContent = best.depth ? `d${best.depth}` : '';
          const arrows = [];
          if (best.move) arrows.push({ from: best.move.slice(0, 2), to: best.move.slice(2, 4), color: 'best', weak: false });
          const second = res.lines[1];
          if (second && second.move) arrows.push({ from: second.move.slice(0, 2), to: second.move.slice(2, 4), color: 'hint', weak: true });
          board.setEngineArrows(arrows);
        }
      } catch (e) {
        depthEl.textContent = 'engine error';
      } finally {
        busy = false;
      }
    }, 90);
  }

  const api = {
    el: wrap,
    refresh,
    isOn: () => on,
    setOn(v) { if (v !== on) engineBtn.click(); },
    destroy() { clearTimeout(timer); wrap.remove(); },
  };
  return api;
}
