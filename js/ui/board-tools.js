// js/ui/board-tools.js — the strip every board carries:
//   |◀ ▶|  eval bar  W·D·L  [Engine] [Arrows] [Moves] [Think deeper]  |  [Play from here]  [Flip]
//
// It reads the position straight from the board, so any screen gets evaluation,
// a play-from-here entry point and move-list navigation without extra wiring.
// Analysis only runs while the engine switch is on (puzzles switch it off so the
// engine cannot give the solution away).
//
// Display switches, all remembered in settings:
//   Arrows — the engine's top three moves drawn on the board, ranked by width and
//            colour (thick green = what it likes, thin warm = third choice)
//   Moves  — those top three moves as a list under the strip; hovering a row (or
//            tapping it) shows the line, and the row carries W/D/L
//   Think deeper — the engine stays on across screens and searches several times
//            longer per position; turning the engine off cancels it
//
// The eval bar shows win/draw/loss (UCI_ShowWDL) as three segments plus the
// numbers, and falls back to a plain white share when the engine sent no WDL.

import { getEngine } from './engine.js';
import { el, icon, toast } from './components.js';
import { store } from './store.js';
import { winProbability, formatEval, turnOf, uciToSan } from '../core/chessutil.js';

const TOP_MOVES = 3;      // MultiPV window: arrows and the Moves list
const DEEP_MIN_MS = 1500; // "Think deeper" never searches less than this

export function createBoardTools(host, opts) {
  const settings = opts.settings || {};
  const board = opts.board;
  const nav = opts.nav || null;
  const allowEngine = opts.allowEngine !== false;
  // screens with several boards on one page (simultan) keep the compact strip
  const allowMoveList = opts.engineMoveList !== false && allowEngine;
  // a screen that already runs the engine itself (play, simultan) does not need
  // the strip searching deeper on top of it
  const allowDeep = opts.allowDeep !== false && allowEngine;

  let prevKeyCleanup = null; // must exist before the nav block installs its listener
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
    // two compact buttons on one line; Home/End still jump to the ends
    mk('back', 'back', 'Previous move (←)', () => nav.back && nav.back());
    mk('forward', 'next', 'Next move (→)', () => nav.forward && nav.forward());
    const onKey = (e) => {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === 'ArrowLeft') { nav.back && nav.back(); refresh(); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { nav.forward && nav.forward(); refresh(); e.preventDefault(); }
      else if (e.key === 'Home') { nav.first && nav.first(); refresh(); e.preventDefault(); }
      else if (e.key === 'End') { nav.last && nav.last(); refresh(); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    prevKeyCleanup = () => window.removeEventListener('keydown', onKey);
    wrap.append(group);
  }

  const evalText = el('span', { class: 'eval-text', text: '—' });
  // three segments: White's wins | draws | Black's wins
  const evalBar = el('div', { class: 'evalbar', title: 'Evaluation' },
    el('i', { class: 'fill w', style: 'width:50%;left:0' }),
    el('i', { class: 'fill d', style: 'width:0%;left:50%' }),
    el('i', { class: 'fill k', style: 'width:50%;left:50%' }));
  const wdlText = el('span', { class: 'wdl-text', text: '' });
  const depthEl = el('span', { class: 'faint eval-depth', text: '' });

  /** A switch button: full label, phone label, and the state suffix. */
  function switchBtn(cls, label, title, short = '') {
    const st = el('span', { class: 'st', text: ': off' });
    const kids = [el('span', { class: 'lbl', text: label })];
    if (short) kids.push(el('span', { class: 'lbl-short', text: short }));
    kids.push(st);
    const btn = el('button', { class: `btn sm ${cls}`, title, 'aria-pressed': 'false' }, ...kids);
    return { btn, st };
  }
  const engineSw = switchBtn('engine-switch', 'Engine', 'Engine analysis on/off');
  const arrowsSw = switchBtn('arrows-switch', 'Arrows', 'Show/hide every board arrow: book moves (violet) and the engine’s (green/blue)');
  const movesSw = switchBtn('moves-switch', 'Moves', 'Show/hide the engine’s top 3 moves');
  const deepSw = switchBtn('deep-switch', 'Think deeper', 'Think deeper: engine always on and a much longer search', 'Deeper');

  const playBtn = el('button', {
    class: 'btn sm play-from-here', title: 'Play engine from this position',
    html: `${icon('play')}<span class="lbl">Play engine from here</span>`,
  });
  const flipBtn = el('button', { class: 'btn sm ghost icon', html: icon('rotate'), title: 'Flip board' });

  if (allowEngine) {
    wrap.append(evalText, evalBar, wdlText, engineSw.btn);
    if (allowMoveList) wrap.append(arrowsSw.btn, movesSw.btn);
    else wrap.append(arrowsSw.btn);
    if (allowDeep) wrap.append(deepSw.btn);
    wrap.append(depthEl);
  } else {
    wrap.append(el('span', { class: 'faint', style: 'font-size:.76rem', text: 'Engine hidden in this mode' }));
  }
  const playRow = el('div', { class: 'row tight play-row' });
  if (opts.showPlayFromHere !== false) playRow.append(playBtn);
  playRow.append(flipBtn);
  wrap.append(el('div', { class: 'spacer' }), playRow);

  // the engine's top moves: a list under the strip, one row per move
  const movesPanel = el('div', { class: 'engine-moves hidden' });
  host.append(movesPanel);
  const boardCol = host.closest ? host.closest('.board-col') : null;

  let on = false;
  let busy = false;
  let token = 0;
  let timer = null;
  let showArrows = settings.engineArrows !== false;
  let showMoves = allowMoveList && settings.engineMoves !== false;
  let deep = allowDeep && settings.thinkDeep === true;
  let lastFen = '';
  let lastLines = [];
  let movesKey = null; // skip rebuilding the list when the lines did not change

  engineSw.btn.addEventListener('click', () => {
    on = !on;
    if (!on && deep) { deep = false; persistPreference('thinkDeep', false); } // engine off wins
    syncSwitches();
    if (on) refresh();
    else clearAnalysis();
  });

  arrowsSw.btn.addEventListener('click', () => {
    showArrows = !showArrows;
    persistPreference('engineArrows', showArrows);
    syncSwitches();
    applyArrows();
    // the screen's own arrows (repertoire book moves, hints) ride along
    if (board.setArrowsVisible) board.setArrowsVisible(showArrows);
  });

  movesSw.btn.addEventListener('click', () => {
    showMoves = !showMoves;
    persistPreference('engineMoves', showMoves);
    syncSwitches();
  });

  deepSw.btn.addEventListener('click', () => {
    deep = !deep;
    persistPreference('thinkDeep', deep);
    if (deep && !on) { on = true; refresh(); }
    syncSwitches();
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

  function clearAnalysis() {
    lastFen = '';
    lastLines = [];
    movesKey = null;
    movesPanel.innerHTML = '';
    board.setEngineArrows([]);
    evalText.textContent = '—';
    evalText.className = 'eval-text';
    depthEl.textContent = '';
    wdlText.textContent = '';
    wdlText.removeAttribute('title');
    setBar(50);
  }

  /** White's share of the bar when the engine sent no WDL. */
  function setBar(whitePct) {
    const w = Math.max(2, Math.min(98, whitePct));
    setSegments(w, 0, 100 - w);
  }

  function setSegments(wPct, dPct, lPct) {
    const parts = [[evalBar.querySelector('.fill.w'), 0, wPct],
      [evalBar.querySelector('.fill.d'), wPct, dPct],
      [evalBar.querySelector('.fill.k'), wPct + dPct, lPct]];
    for (const [node, left, width] of parts) {
      if (!node) continue;
      node.style.left = `${Math.max(0, Math.min(100, left))}%`;
      node.style.width = `${Math.max(0, Math.min(100, width))}%`;
    }
  }

  /** Win/draw/loss from the side to move's view → White's view. */
  function wdlWhite(wdl, turn) {
    if (!wdl) return null;
    const [w, d, l] = wdl;
    return turn === 'b' ? [l, d, w] : [w, d, l];
  }

  function showWdl(wdl, turn) {
    const white = wdlWhite(wdl, turn);
    if (!white) {
      wdlText.textContent = '';
      wdlText.removeAttribute('title');
      return;
    }
    const pct = white.map((v) => Math.round(v / 10));
    setSegments(pct[0], pct[1], pct[2]);
    wdlText.textContent = `${pct[0]}·${pct[1]}·${pct[2]}`;
    wdlText.setAttribute('title', `White wins ${pct[0]}% · Draw ${pct[1]}% · Black wins ${pct[2]}%`);
  }

  /** Keep the switch labels, `on` styling and the move list in step with state. */
  function syncSwitches() {
    for (const [sw, value] of [[engineSw, on], [arrowsSw, showArrows], [movesSw, showMoves], [deepSw, deep]]) {
      if (!sw.btn.isConnected) continue;
      sw.st.textContent = value ? ': on' : ': off';
      sw.btn.classList.toggle('on', value);
      sw.btn.setAttribute('aria-pressed', value ? 'true' : 'false');
    }
    const shown = allowMoveList && showMoves && on && lastLines.length > 0;
    movesPanel.classList.toggle('hidden', !shown);
    if (boardCol) {
      // a visible move list costs a row: take it off the board's height cap so the
      // board still fits above the fold on a short screen
      const narrow = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 860px)').matches;
      boardCol.style.setProperty('--em-h', shown ? (narrow ? '42px' : '112px') : '0px');
    }
  }

  /** Persist a display switch — only when the screen handed us the real settings blob. */
  function persistPreference(key, value) {
    if (!opts.settings || !('thinkMs' in opts.settings)) return;
    settings[key] = value;
    try {
      const p = store.set('settings', settings); // async: a toggle must never throw
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* ignore */ }
  }

  /** Side-to-move centipawns, mates mapped to the ends of the range. */
  function cpOf(line) {
    if (!line) return 0;
    if (line.mate != null) return line.mate > 0 ? 100000 - line.mate * 100 : -100000 + Math.abs(line.mate) * 100;
    return line.cp || 0;
  }

  /** Top three moves as arrows: thickness and colour say how good each one is. */
  function applyArrows() {
    if (!on || !showArrows) { board.setEngineArrows([]); return; }
    const best = cpOf(lastLines[0]);
    const widths = [0.16, 0.125, 0.098];
    const alphas = [0.95, 0.8, 0.62];
    const arrows = [];
    lastLines.slice(0, TOP_MOVES).forEach((line, i) => {
      if (!line.move) return;
      const loss = best - cpOf(line); // centipawns behind the best move
      const color = i === 0 || loss <= 20 ? 'best' : loss <= 60 ? 'hint' : loss <= 150 ? 'yellow' : 'bad';
      arrows.push({
        from: line.move.slice(0, 2),
        to: line.move.slice(2, 4),
        color,
        width: widths[i],
        alpha: alphas[i],
        rank: i + 1,
      });
    });
    board.setEngineArrows(arrows);
  }

  /** One pinned line at a time; activating the pinned row again closes it. */
  function togglePin(row) {
    const pinned = row.classList.contains('pinned');
    for (const r of movesPanel.children) r.classList.remove('pinned');
    if (!pinned) row.classList.add('pinned');
  }

  function renderMoves() {
    if (!allowMoveList) return;
    const key = lastFen + '|' + lastLines.slice(0, TOP_MOVES).map((l) => l.pv || l.move || '').join(';');
    if (key === movesKey) return;
    movesKey = key;
    movesPanel.innerHTML = '';
    const turn = turnOf(lastFen);
    lastLines.slice(0, TOP_MOVES).forEach((line, i) => {
      if (!line.move) return;
      const pv = pvLine(lastFen, line.pv || line.move);
      const cpWhite = turn === 'w' ? cpOf(line) : -cpOf(line);
      const white = wdlWhite(line.wdl, turn);
      const pct = white ? white.map((v) => Math.round(v / 10)) : null;
      const row = el('button', {
        class: 'em-row' + (i === 0 ? ' best' : ''), type: 'button',
        title: pv.text || 'engine line',
        'aria-label': `${pv.sans[0] || line.move}, ${pv.text}`,
      },
        el('span', { class: 'em-no', text: String(i + 1) }),
        el('span', { class: 'em-san', text: pv.sans[0] || line.move }),
        el('span', { class: 'em-eval ' + (cpWhite > 40 ? 'pos' : cpWhite < -40 ? 'neg' : ''), text: line.mate != null ? `M${Math.abs(line.mate)}` : formatEval(cpWhite) }),
        pct ? el('span', { class: 'em-wdl', text: `${pct[0]}·${pct[1]}·${pct[2]}`, title: `White wins ${pct[0]}% · Draw ${pct[1]}% · Black wins ${pct[2]}%` }) : null,
        el('span', { class: 'em-line', text: pv.text })
      );
      // Hovering shows the line (CSS). A tap or click pins it open: pointerup is
      // the event that reaches an element on a phone — Chromium's synthesized
      // click from a tap inside the scrolling chip row lands elsewhere — so the
      // pin is driven from the pointer, and `click` only serves keyboard use.
      let press = null;
      row.addEventListener('pointerdown', (e) => { press = { x: e.clientX, y: e.clientY, id: e.pointerId }; });
      row.addEventListener('pointercancel', () => { press = null; });
      row.addEventListener('pointerup', (e) => {
        const p0 = press;
        press = null;
        if (!p0 || p0.id !== e.pointerId) return;
        if (Math.hypot(e.clientX - p0.x, e.clientY - p0.y) > 8) return; // that was a scroll, not a tap
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        activateRow(row, line);
      });
      row.addEventListener('click', (e) => { if (e.detail === 0) activateRow(row, line); }); // keyboard
      movesPanel.append(row);
    });
    syncSwitches();
  }

  /** On an analysis board a row plays its move; everywhere else it opens the line. */
  function activateRow(row, line) {
    if (opts.onEngineMove && line.move) { opts.onEngineMove(line.move); return; }
    togglePin(row);
  }

  /** Re-run analysis for the board's current position (called after every move). */
  function refresh() {
    if (nav && navBtns.back) {
      const s = nav.state ? nav.state() : {};
      navBtns.back.disabled = !!s.atStart;
      navBtns.forward.disabled = !!s.atEnd;
    }
    if (!on || !allowEngine) return;
    token++;
    const my = token;
    clearTimeout(timer);
    depthEl.textContent = '…';
    const base = Math.max(180, Math.min(900, settings.thinkMs || 400));
    const movetime = Math.min(6000, deep ? Math.max(DEEP_MIN_MS, base * 4) : base);
    timer = setTimeout(async () => {
      if (busy) { /* the queue serialises; stale results are dropped by token */ }
      busy = true;
      try {
        const eng = opts.engine ? opts.engine() : getEngine();
        const fen = board.fen;
        const res = await eng.analyse({
          fen,
          movetime,
          multipv: TOP_MOVES,
          elo: 0, // the eval bar must be honest, independent of playing strength
        });
        if (my !== token) return;
        const best = res.lines[0];
        const turn = turnOf(fen);
        if (best) {
          const cpWhite = turn === 'w' ? cpOf(best) : -cpOf(best);
          setBar(winProbability(cpWhite));
          showWdl(best.wdl, turn);
          evalText.textContent = best.mate != null ? `M${Math.abs(best.mate)}${(turn === 'w' ? best.mate > 0 : best.mate < 0) ? '' : ' (against)'}` : formatEval(cpWhite);
          evalText.className = 'eval-text ' + (cpWhite > 40 ? 'pos' : cpWhite < -40 ? 'neg' : '');
          depthEl.textContent = best.depth ? `d${best.depth}` : '';
        }
        lastFen = fen;
        lastLines = res.lines.filter((l) => l.move);
        applyArrows();
        renderMoves();
        syncSwitches();
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
    setOn(v) { if (v !== on) engineSw.btn.click(); },
    arrowsShown: () => showArrows,
    setArrowsShown(v) { if (v !== showArrows) arrowsSw.btn.click(); },
    movesShown: () => showMoves,
    setMovesShown(v) { if (v !== showMoves) movesSw.btn.click(); },
    isDeep: () => deep,
    setDeep(v) { if (v !== deep) deepSw.btn.click(); },
    lines: () => lastLines.slice(),
    destroy() { clearTimeout(timer); if (prevKeyCleanup) prevKeyCleanup(); wrap.remove(); movesPanel.remove(); },
  };
  syncSwitches();
  // only screens that actually carry this switch follow the saved setting: the
  // puzzle and memory-quiz hints have their own toggles
  if (allowEngine && board.setArrowsVisible) board.setArrowsVisible(showArrows);
  if (deep) { on = true; syncSwitches(); refresh(); } // "always on" outlives the screen
  return api;
}

/**
 * A UCI principal variation turned into move numbers + SAN, e.g.
 * `1. e4 e5 2. Nf3 Nc6 3. Bb5` — numbering starts from the FEN's fullmove
 * counter, and Black-to-move positions start with the bare move.
 */
function pvLine(fen, uciStr) {
  const plies = String(uciStr || '').split(/\s+/).filter(Boolean).slice(0, 12);
  if (!plies.length) return { sans: [], text: '' };
  const { sans } = uciToSan(fen, plies);
  if (!sans.length) return { sans, text: '' };
  const whiteFirst = turnOf(fen) === 'w';
  let no = parseInt((fen.split(' ')[5] || '1'), 10) || 1;
  const parts = [];
  for (let i = 0; i < sans.length; i++) {
    const white = (i % 2 === 0) === whiteFirst;
    if (white) parts.push(`${no}.`);
    parts.push(sans[i]);
    if (!white) no++;
  }
  return { sans, text: parts.join(' ') };
}
