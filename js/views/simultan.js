// js/views/simultan.js — simultaneous exhibition against the engine.
//
// Ported from SnartSimChess: you play N boards at once, one at a time. Only the
// focused board is on screen; every other board whose move it is keeps a
// "thinking debt" (it accumulates while you are away). When the engine finally
// answers that board, the debt is paid in extra thinking time — so looking away
// from a board does not make the opponent weaker.
//
// One shared engine instance runs the background searches sequentially, which
// keeps memory flat on phones (one WASM worker instead of N).

import { state, navigate, trainerCtx } from '../app.js';
import { el, icon, toast, confirmDialog } from '../ui/components.js';
import { createBoard } from '../ui/board.js';
import { orientationFor } from '../ui/orientation.js';
import { createBoardTools } from '../ui/board-tools.js';
import { applyUci, START_FEN, turnOf, material } from '../core/chessutil.js';

const COLORS = [
  { id: 'w', name: 'White' },
  { id: 'b', name: 'Black' },
  { id: 'alt', name: 'Alternate' },
];
const COUNTS = [2, 3, 4, 5, 6];
const STRENGTHS = [800, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 0];
const ORDERS = [
  { id: 'sequential', name: 'In order' },
  { id: 'random', name: 'Random' },
];

export function render(host) {
  let session = null;
  let board = null;
  let tools = null;

  const setupCard = el('div');
  const sessionBox = el('div');
  host.append(setupCard, sessionBox);

  drawSetup();

  // ---------------------------------------------------------------- setup
  function drawSetup() {
    const cfg = {
      boards: Number(localStorage.getItem('scb.simultan.boards') || 3),
      color: localStorage.getItem('scb.simultan.color') || 'alt',
      strength: Number(localStorage.getItem('scb.simultan.strength') || state.settings.strength || 1400),
      thinkMs: Number(localStorage.getItem('scb.simultan.think') || 350),
      debt: Number(localStorage.getItem('scb.simultan.debt') || 4),
      order: localStorage.getItem('scb.simultan.order') || 'sequential',
    };
    const save = () => {
      localStorage.setItem('scb.simultan.boards', String(cfg.boards));
      localStorage.setItem('scb.simultan.color', cfg.color);
      localStorage.setItem('scb.simultan.strength', String(cfg.strength));
      localStorage.setItem('scb.simultan.think', String(cfg.thinkMs));
      localStorage.setItem('scb.simultan.debt', String(cfg.debt));
      localStorage.setItem('scb.simultan.order', cfg.order);
    };

    setupCard.innerHTML = '';
    setupCard.append(el('div', { class: 'card', style: 'margin-bottom:14px' },
      el('div', { class: 'card-head' },
        el('h2', { text: 'Simultan' }),
        el('span', { class: 'badge', text: 'exhibition' }),
        el('div', { class: 'spacer' }),
        el('span', { class: 'faint', style: 'font-size:.78rem', text: 'one board at a time · the others think in the background' })),
      el('p', { class: 'dim', style: 'font-size:.86rem;margin-top:0', html:
        'Play several games against the engine at once, like a simultaneous exhibition. Only the focused board is active; every other board keeps thinking while you are away, and pays that time back when it answers. The score counts wins as 1 and draws as ½.' })));

    const chips = (values, current, label, onPick) => {
      const row = el('div', { class: 'filters' });
      for (const v of values) {
        row.append(el('button', {
          class: 'chip' + (v.value === current ? ' on' : ''), text: v.label,
          onclick: (e) => {
            for (const c of row.children) c.classList.remove('on');
            e.currentTarget.classList.add('on');
            onPick(v.value);
          },
        }));
      }
      return el('label', { class: 'field' }, el('span', { text: label }), row);
    };

    const meta = el('div', { class: 'faint', style: 'font-size:.78rem;margin-top:4px' });

    setupCard.append(el('div', { class: 'card' },
      chips(COUNTS.map((n) => ({ value: n, label: `${n} boards` })), cfg.boards, 'Boards', (v) => { cfg.boards = v; save(); }),
      chips(COLORS.map((c) => ({ value: c.id, label: c.name })), cfg.color, 'You play', (v) => { cfg.color = v; save(); }),
      chips(STRENGTHS.map((s) => ({ value: s, label: s ? String(s) : 'Max' })), cfg.strength, 'Engine strength (Elo)', (v) => { cfg.strength = v; save(); }),
      chips([150, 250, 400, 700, 1200].map((t) => ({ value: t, label: `${t} ms` })), cfg.thinkMs, 'Base thinking time per move', (v) => { cfg.thinkMs = v; save(); }),
      chips([0, 2, 4, 8].map((d) => ({ value: d, label: d ? `${d} plies` : 'Off' })), cfg.debt, 'Background thinking (debt)', (v) => { cfg.debt = v; save(); }),
      chips(ORDERS.map((o) => ({ value: o.id, label: o.name })), cfg.order, 'Board order', (v) => { cfg.order = v; save(); }),
      meta,
      el('div', { class: 'row', style: 'margin-top:6px' },
        el('button', { class: 'btn primary', html: `${icon('play')}<span>Start simultan</span>`, onclick: () => start(cfg) }))));

    meta.textContent = `≈ ${cfg.boards} games · ${cfg.thinkMs} ms + ${cfg.debt} plies of background thought · engine ${cfg.strength || 'max'}`;
  }

  // ---------------------------------------------------------------- session
  function start(cfg) {
    session = {
      cfg,
      games: Array.from({ length: cfg.boards }, (_, i) => makeGame(cfg, i)),
      focus: 0,
      finished: false,
      started: Date.now(),
    };
    setupCard.classList.add('hidden');
    const handle = drawSession();
    handle.pump();
  }

  function makeGame(cfg, i) {
    const userColor = cfg.color === 'alt' ? (i % 2 === 0 ? 'w' : 'b') : cfg.color;
    return {
      n: i + 1,
      fen: START_FEN,
      history: [],
      userColor,
      engineColor: userColor === 'w' ? 'b' : 'w',
      result: null,
      reason: '',
      debt: 0,
      thinking: false,
      awaiting: false,
      lastMove: null,
    };
  }

  function drawSession() {
    sessionBox.innerHTML = '';
    if (board) { board.destroy(); board = null; }
    if (tools) { tools.destroy(); tools = null; }

    const layout = el('div', { class: 'trainer' });
    const boardCol = el('div', { class: 'board-col' });
    const sideCol = el('div', { class: 'side-col' });

    const head = el('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' });
    const headTitle = el('strong');
    const headColor = el('span', { class: 'badge' });
    const headWait = el('span', { class: 'badge warn hidden' });
    head.append(headTitle, headColor, headWait, el('div', { class: 'spacer' }),
      el('button', { class: 'btn sm', text: '◀ Previous', onclick: () => focus(-1) }),
      el('button', { class: 'btn sm', text: 'Next ▶', onclick: () => focus(1) }));
    const statusRow = el('div', { class: 'row' });
    const boardHost = el('div');
    const toolsRow = el('div');
    boardCol.append(head, boardHost, statusRow, toolsRow);

    const statCard = el('div', { class: 'card' });
    const listCard = el('div', { class: 'card', style: 'margin-top:12px' });
    sideCol.append(statCard, listCard);
    layout.append(boardCol, sideCol);
    sessionBox.append(layout);

    const g = focused();
    board = createBoard(boardHost, {
      fen: g.fen,
      orientation: orientationFor(state.settings, g.userColor),
      theme: state.settings.boardTheme,
      pieceSet: state.settings.pieceSet,
      coords: state.settings.coords,
      animate: state.settings.animate,
      onMove: (m) => onUserMove(m),
    });
    tools = createBoardTools(toolsRow, {
      board,
      settings: state.settings,
      engine: trainerCtx().engine,
      onPlayFromHere: (fen, turn) => navigate(`/coach?fen=${encodeURIComponent(fen)}&side=${turn}&title=${encodeURIComponent('From a simul board')}`),
    });
    board.onPosition(() => tools.refresh());

    function focused() { return session.games[session.focus]; }

    function paint() {
      const g2 = focused();
      board.setPosition(g2.fen, { last: g2.lastMove, arrows: [], clearSelection: true });
      const myTurn = !g2.result && turnOf(g2.fen) === g2.userColor;
      board.setInteractive(myTurn);
      headTitle.textContent = `Board ${g2.n} of ${session.games.length}`;
      headColor.textContent = g2.userColor === 'w' ? 'you are White' : 'you are Black';
      headWait.classList.toggle('hidden', !g2.awaiting);
      headWait.textContent = g2.thinking ? 'engine thinking…' : 'engine queued';
      statusRow.innerHTML = '';
      const turnText = g2.result
        ? `<b>${g2.result === 'win' ? 'You won' : g2.result === 'loss' ? 'You lost' : 'Draw'}</b> — ${g2.reason}`
        : myTurn ? '<b>Your move</b>' : '<span class="faint">Engine is thinking…</span>';
      statusRow.append(el('div', { class: 'board-status', html: turnText }));
      drawStats();
      drawList();
    }

    // The score card and the board list are built ONCE and then only updated:
    // the engine repaints several times per second, and rebuilding buttons under
    // the user's finger swallowed clicks.
    const statWins = statBox('wins');
    const statDraws = statBox('draws');
    const statLosses = statBox('losses');
    const statScore = statBox('score');
    const statBadge = el('span', { class: 'badge' });
    statCard.append(
      el('div', { class: 'card-head' }, el('h3', { text: 'Score' }), el('div', { class: 'spacer' }), statBadge),
      el('div', { class: 'row', style: 'gap:18px' }, statWins.el, statDraws.el, statLosses.el, statScore.el),
      el('div', { class: 'row', style: 'margin-top:10px' },
        el('button', { class: 'btn sm danger', text: 'Resign this board', onclick: () => resign() }),
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn sm', text: 'New simultan', onclick: () => reset() })));

    const listEl = el('div', { class: 'list' });
    listCard.append(el('div', { class: 'card-head' }, el('h3', { text: 'Boards' }), el('div', { class: 'spacer' }),
      el('span', { class: 'faint', style: 'font-size:.74rem', text: 'tap to switch' })), listEl);
    const rows = session.games.map((x, i) => {
      const name = el('span', { class: 'name' });
      const sub = el('span', { class: 'sub' });
      const res = el('span', { class: 'badge hidden' });
      const row = el('div', {
        class: 'list-item',
        onclick: () => { session.focus = i; paint(); },
      },
        el('span', { class: 'mono faint', style: 'width:18px', text: String(x.n) }),
        el('span', { class: 'badge', text: x.userColor === 'w' ? 'W' : 'B' }),
        el('div', { class: 't' }, name, sub), res);
      listEl.append(row);
      return { row, name, sub, res };
    });

    function statBox(k) {
      const v = el('span', { class: 'v', text: '0' });
      return { v, el: el('div', { class: 'stat' }, v, el('span', { class: 'k', text: k })) };
    }

    function drawStats() {
      const decided = session.games.filter((x) => x.result);
      const wins = session.games.filter((x) => x.result === 'win').length;
      const draws = session.games.filter((x) => x.result === 'draw').length;
      const losses = session.games.filter((x) => x.result === 'loss').length;
      statWins.v.textContent = String(wins);
      statDraws.v.textContent = String(draws);
      statLosses.v.textContent = String(losses);
      statScore.v.textContent = (wins + draws * 0.5).toFixed(1);
      statBadge.textContent = `${decided.length}/${session.games.length} finished`;
    }

    function drawList() {
      session.games.forEach((x, i) => {
        const r = rows[i];
        const mine = turnOf(x.fen) === x.userColor;
        r.row.classList.toggle('sel', i === session.focus);
        r.name.textContent = x.result
          ? (x.result === 'win' ? 'Won' : x.result === 'loss' ? 'Lost' : 'Draw')
          : (mine ? 'Your move' : (x.thinking ? 'Engine thinking…' : 'Engine to move'));
        const plies = Math.ceil(x.history.length / 2);
        r.sub.textContent = `${plies} move${plies === 1 ? '' : 's'}${x.debt ? ` · debt ${x.debt}` : ''}`;
        r.res.classList.toggle('hidden', !x.result);
        if (x.result) {
          r.res.textContent = x.result;
          r.res.className = 'badge ' + (x.result === 'win' ? 'good' : x.result === 'loss' ? 'bad' : '');
        }
      });
    }

    function focus(delta) {
      const n = session.games.length;
      session.focus = (session.focus + delta + n) % n;
      paint();
    }

    function applyMoveTo(g2, uci) {
      const res = applyUci(g2.fen, uci);
      if (!res) return null;
      g2.fen = res.fen;
      g2.history.push({ uci, san: res.san });
      g2.lastMove = { from: uci.slice(0, 2), to: uci.slice(2, 4) };
      g2.debt = 0;
      return res;
    }

    function onUserMove({ from, to, promotion }) {
      const g2 = focused();
      if (g2.result || turnOf(g2.fen) !== g2.userColor) return;
      const uci = from + to + (promotion || '');
      const res = applyMoveTo(g2, uci);
      if (!res) return;
      ctxSound(res);
      checkEnd(g2, res);
      if (!g2.result && turnOf(g2.fen) !== g2.userColor) {
        g2.awaiting = true;
        g2.debt = 0;
      }
      paint();
      pump();
      // move on to the next unfinished board, like walking the hall in a simul
      if (!g2.result && session.cfg.order === 'sequential') setTimeout(() => nextUnfinished(), 250);
    }

    function nextUnfinished() {
      const n = session.games.length;
      for (let i = 1; i <= n; i++) {
        const idx = (session.focus + i) % n;
        const x = session.games[idx];
        if (!x.result && turnOf(x.fen) === x.userColor) { session.focus = idx; paint(); return; }
      }
    }

    function ctxSound(res) {
      try { trainerCtx().sound.playForMove(res); } catch (e) { /* audio is optional */ }
    }

    function checkEnd(g2, res) {
      if (res.mate) {
        const lost = turnOf(g2.fen) === g2.userColor;
        g2.result = lost ? 'loss' : 'win';
        g2.reason = lost ? 'checkmated' : 'checkmate';
        g2.awaiting = false;
        finishCheck();
      } else if (res.stalemate || res.draw) {
        g2.result = 'draw';
        g2.reason = res.stalemate ? 'stalemate' : 'draw';
        g2.awaiting = false;
        finishCheck();
      }
    }

    function finishCheck() {
      if (!session.games.every((x) => x.result)) return;
      session.finished = true;
      const wins = session.games.filter((x) => x.result === 'win').length;
      const draws = session.games.filter((x) => x.result === 'draw').length;
      toast(`Simultan finished: ${wins + draws * 0.5} / ${session.games.length}`, 'ok');
    }

    async function engineTurn(g2) {
      const eng = trainerCtx().engine();
      const extra = Math.min(4, g2.debt) * (session.cfg.thinkMs * 0.45);
      const movetime = Math.min(2600, session.cfg.thinkMs + extra);
      g2.thinking = true;
      if (g2 === focused()) drawList();
      const res = await eng.pickMove({
        fen: g2.fen,
        movetime,
        spreadCp: state.settings.spreadCp,
        elo: session.cfg.strength,
        weighting: state.settings.spreadWeighting,
      }).catch(() => null);
      g2.thinking = false;
      if (!res || !res.uci) { g2.awaiting = false; return; }
      const applied = applyMoveTo(g2, res.uci);
      if (!applied) { g2.awaiting = false; return; }
      g2.awaiting = false;
      ctxSound(applied);
      // check the engine's own move for a terminal position
      if (applied.mate) {
        const lost = turnOf(g2.fen) === g2.userColor;
        g2.result = lost ? 'loss' : 'win';
        g2.reason = lost ? 'checkmated' : 'checkmate';
        finishCheck();
      } else if (applied.stalemate || applied.draw) {
        g2.result = 'draw';
        g2.reason = applied.stalemate ? 'stalemate' : 'draw';
        finishCheck();
      }
      if (g2 === focused()) paint();
      else drawList();
    }

    let engineBusy = false;
    async function pump() {
      if (engineBusy || !session) return;
      // boards away from the focus first: they have been thinking the longest
      const pending = session.games.filter((x) => x.awaiting && !x.result && !x.thinking);
      if (!pending.length) return;
      const g2 = pending.find((x) => x !== focused()) || pending[0];
      engineBusy = true;
      try {
        await engineTurn(g2);
      } finally {
        engineBusy = false;
        if (session) setTimeout(pump, 30);
      }
    }

    function resign() {
      const g2 = focused();
      if (g2.result) return;
      g2.result = 'loss';
      g2.reason = 'resigned';
      g2.awaiting = false;
      paint();
      finishCheck();
    }

    // background "thinking debt": boards you are not looking at get stronger
    const debtTimer = setInterval(() => {
      if (!session || session.finished) return;
      let changed = false;
      for (const x of session.games) {
        if (x.awaiting && !x.result && x !== focused()) {
          const cap = Math.max(0, session.cfg.debt);
          if (x.debt < cap) { x.debt += 1; changed = true; }
        }
      }
      if (changed) drawList();
    }, 1400);

    // keep the engine queue moving even when the user is idle
    const pumpTimer = setInterval(() => pump(), 900);

    const cleanup = () => { clearInterval(debtTimer); clearInterval(pumpTimer); };
    session.cleanup = cleanup;

    // boards where the engine has the move (all black boards in an alternate
    // simul) start thinking immediately, not only the one on screen
    for (const x of session.games) {
      if (!x.result && turnOf(x.fen) !== x.userColor) x.awaiting = true;
    }
    paint();
    pump();
    return { pump, paint };
  }

  function reset() {
    if (session && session.cleanup) session.cleanup();
    if (board) { board.destroy(); board = null; }
    if (tools) { tools.destroy(); tools = null; }
    session = null;
    sessionBox.innerHTML = '';
    setupCard.classList.remove('hidden');
    drawSetup();
  }

  return {
    destroy() {
      if (session && session.cleanup) session.cleanup();
      if (board) board.destroy();
      if (tools) tools.destroy();
    },
  };
}
