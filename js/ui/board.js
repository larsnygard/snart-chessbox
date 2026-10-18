// js/ui/board.js — the interactive board.
//
// Deliberately small API:
//   const b = createBoard(host, { theme, pieceSet, coords, onMove, sound })
//   b.setPosition(fen, { last:{from,to}, check:square, arrows:[...] })
//   b.setOrientation('w'|'b')  b.setInteractive(bool)  b.setTheme(...)
//
// Drag & drop and tap-tap both go through `pointer` handling on the board
// element; the pieces layer is pointer-events:none so hit-testing is done from
// the board rect, which also makes touch work without per-piece listeners.

import { Chess } from '../../vendor/chess.mjs';
import { pieceMap, fileOf, rankOf, legalFrom, isLightSquare, turnOf } from '../core/chessutil.js';
import { pieceMarkup, pieceClass } from './pieces.js';

const FILES = 'abcdefgh';

export function createBoard(host, opts = {}) {
  const state = {
    fen: opts.fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    orientation: opts.orientation || 'w',
    interactive: opts.interactive !== false,
    theme: opts.theme || 'forest',
    pieceSet: opts.pieceSet || 'neo',
    coords: opts.coords !== false,
    animate: opts.animate !== false,
    arrows: [],
    engineArrows: [],
    last: null,
    check: null,
    selected: null,
    targets: [],
  };

  const root = document.createElement('div');
  root.className = 'board-outer';
  const board = document.createElement('div');
  board.className = 'board';
  board.dataset.board = state.theme;
  board.tabIndex = 0;
  const squares = document.createElement('div');
  squares.className = 'board-squares';
  const pieces = document.createElement('div');
  pieces.className = 'pieces';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'arrows');
  svg.setAttribute('viewBox', '0 0 8 8');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.innerHTML = `
    <defs>
      <marker id="ah-hint" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 z" fill="#3d8bfd"/></marker>
      <marker id="ah-best" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 z" fill="#37b98a"/></marker>
      <marker id="ah-bad" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 z" fill="#e05656"/></marker>
    </defs>`;
  board.append(squares, pieces, svg);
  root.append(board);
  host.append(root);

  let pieceEls = new Map(); // square -> element

  function squareAtPoint(clientX, clientY) {
    const r = board.getBoundingClientRect();
    const x = (clientX - r.left) / r.width;
    const y = (clientY - r.top) / r.height;
    if (x < 0 || x >= 1 || y < 0 || y >= 1) return null;
    const col = Math.min(7, Math.floor(x * 8));
    const row = Math.min(7, Math.floor(y * 8));
    return squareOfCell(col, row);
  }

  function squareOfCell(col, row) {
    const fileIdx = state.orientation === 'w' ? col : 7 - col;
    const rankIdx = state.orientation === 'w' ? 7 - row : row;
    return FILES[fileIdx] + (rankIdx + 1);
  }

  function cellOfSquare(sq) {
    const f = fileOf(sq), r = rankOf(sq);
    const col = state.orientation === 'w' ? f : 7 - f;
    const row = state.orientation === 'w' ? 7 - r : r;
    return { col, row };
  }

  function place(el, sq) {
    const { col, row } = cellOfSquare(sq);
    el.style.left = `${col * 12.5}%`;
    el.style.top = `${row * 12.5}%`;
  }

  function buildSquares() {
    squares.innerHTML = '';
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const sq = squareOfCell(col, row);
        const d = document.createElement('div');
        d.className = 'sq ' + (isLightSquare(sq) ? 'light' : 'dark');
        d.dataset.sq = sq;
        if (state.coords) {
          const bottomRank = state.orientation === 'w' ? row === 7 : row === 0;
          const leftFile = state.orientation === 'w' ? col === 0 : col === 7;
          if (bottomRank) d.insertAdjacentHTML('beforeend', `<span class="coords file">${sq[0]}</span>`);
          if (leftFile) d.insertAdjacentHTML('beforeend', `<span class="coords rank">${sq[1]}</span>`);
        }
        squares.append(d);
      }
    }
  }

  function makePieceEl(piece) {
    const el = document.createElement('div');
    el.className = 'piece ' + pieceClass(state.pieceSet);
    el.dataset.color = piece.color;
    el.dataset.type = piece.type;
    el.innerHTML = pieceMarkup(state.pieceSet, piece.type, piece.color);
    return el;
  }

  function renderPieces(animateFrom) {
    const target = pieceMap(state.fen);
    const next = new Map();
    // Drop elements whose square is now empty (or has a different piece).
    for (const [sq, el] of pieceEls) {
      const want = target[sq];
      if (!want || want.type !== el.dataset.type || want.color !== el.dataset.color) {
        el.remove();
        pieceEls.delete(sq);
      }
    }
    for (const sq in target) {
      const want = target[sq];
      const existing = pieceEls.get(sq);
      if (existing && existing.dataset.type === want.type && existing.dataset.color === want.color) {
        next.set(sq, existing);
        continue;
      }
      const el = makePieceEl(want);
      if (animateFrom && sq === animateFrom.to && animateFrom.from) {
        place(el, animateFrom.from);
        pieces.append(el);
        // force layout, then glide to the destination
        void el.offsetWidth;
        place(el, sq);
      } else {
        place(el, sq);
        pieces.append(el);
      }
      next.set(sq, el);
    }
    pieceEls = next;
  }

  function renderArrows() {
    // Two layers: `arrows` belongs to the screen (book moves, hints, blunders),
    // `engineArrows` is owned by the engine panel and must not clobber them.
    const all = state.arrows.concat(state.engineArrows).filter((a) => a && a.from && a.to && a.from !== a.to);
    const defs = svg.querySelector('defs');
    svg.innerHTML = '';
    svg.append(defs);
    all.forEach((a, i) => {
      const f = cellOfSquare(a.from), t = cellOfSquare(a.to);
      const x1 = f.col + 0.5, y1 = f.row + 0.5, x2 = t.col + 0.5, y2 = t.row + 0.5;
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const sx = x1 + ux * 0.22, sy = y1 + uy * 0.22;
      const ex = x2 - ux * 0.26, ey = y2 - uy * 0.26;
      const color = a.color === 'bad' ? '#e05656' : a.color === 'best' ? '#37b98a' : '#3d8bfd';
      const marker = a.color === 'bad' ? 'ah-bad' : a.color === 'best' ? 'ah-best' : 'ah-hint';
      const alpha = a.weak ? 0.55 : 0.92;
      const wide = a.weak ? 0.085 : 0.13;
      // invisible fat line first: an arrow is a 0.13-unit stroke, far too thin to tap
      svg.insertAdjacentHTML('beforeend', `<line class="arrow-hit" data-i="${i}" x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="transparent" stroke-width="0.6"/>`);
      svg.insertAdjacentHTML('beforeend', `<line class="arrow-line" x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}" stroke="${color}" stroke-width="${wide}" marker-end="url(#${marker})" opacity="${alpha}"/>`);
      void alpha;
    });
    // re-bind: innerHTML above replaced the nodes
    if (opts.onArrow) {
      for (const hit of svg.querySelectorAll('.arrow-hit')) {
        hit.addEventListener('pointerdown', (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          const a = all[Number(hit.dataset.i)];
          if (a) opts.onArrow(a);
        });
      }
    }
  }

  function paintHighlights() {
    for (const el of squares.children) {
      const sq = el.dataset.sq;
      el.classList.toggle('hl-last', !!(state.last && (state.last.from === sq || state.last.to === sq)));
      el.classList.toggle('hl-check', state.check === sq);
      el.classList.toggle('hl-from', state.selected === sq);
      const t = state.targets.find((x) => x.to === sq);
      el.classList.toggle('hl-target', !!t);
      el.classList.toggle('capture', !!t && !!t.capture);
    }
  }

  function clearSelection() {
    state.selected = null;
    state.targets = [];
    paintHighlights();
  }

  function selectSquare(sq) {
    const pm = pieceMap(state.fen);
    const piece = pm[sq];
    if (!piece) { clearSelection(); return false; }
    const turn = turnOf(state.fen);
    if (opts.allowAnyPiece !== true && piece.color !== turn) { clearSelection(); return false; }
    state.selected = sq;
    state.targets = legalFrom(state.fen, sq).map((m) => ({ ...m, capture: !!pm[m.to] || m.flags.includes('e') }));
    paintHighlights();
    return true;
  }

  function attemptMove(from, to) {
    const pm = pieceMap(state.fen);
    const piece = pm[from];
    if (!piece) return false;
    const moves = legalFrom(state.fen, from).filter((m) => m.to === to);
    if (!moves.length) return false;
    const needsPromo = moves.some((m) => m.promotion);
    if (needsPromo) {
      showPromotion(piece.color, (choice) => {
        clearSelection();
        opts.onMove && opts.onMove({ from, to, promotion: choice });
      });
      return true;
    }
    clearSelection();
    opts.onMove && opts.onMove({ from, to });
    return true;
  }

  function showPromotion(color, done) {
    const overlay = document.createElement('div');
    overlay.className = 'promo';
    const box = document.createElement('div');
    box.className = 'box';
    for (const t of ['q', 'r', 'b', 'n']) {
      const b = document.createElement('button');
      b.dataset.promo = t;
      b.style.color = color === 'w' ? 'var(--piece-white)' : 'var(--piece-black)';
      b.innerHTML = pieceMarkup(state.pieceSet, t, color);
      b.addEventListener('click', () => { overlay.remove(); done(t); });
      box.append(b);
    }
    overlay.append(box);
    overlay.addEventListener('pointerdown', (e) => e.stopPropagation());
    board.append(overlay);
  }

  // ---- pointer handling -------------------------------------------------
  let drag = null;

  board.addEventListener('pointerdown', (e) => {
    if (!state.interactive) return;
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
    const sq = squareAtPoint(e.clientX, e.clientY);
    if (!sq) return;
    // tapping a legal target while a piece is selected: move now
    if (state.selected && state.selected !== sq && state.targets.some((t) => t.to === sq)) {
      if (attemptMove(state.selected, sq)) {
        e.preventDefault();
        return;
      }
    }
    if (state.selected === sq) { clearSelection(); return; }
    if (!selectSquare(sq)) return;
    board.setPointerCapture && board.setPointerCapture(e.pointerId);
    const el = pieceEls.get(sq);
    drag = { from: sq, el, startX: e.clientX, startY: e.clientY, moved: false, pointerId: e.pointerId };
    e.preventDefault();
  });

  board.addEventListener('pointermove', (e) => {
    if (!drag || !drag.el) return;
    const r = board.getBoundingClientRect();
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) > 4) {
      drag.moved = true;
      drag.el.classList.add('dragging');
    }
    if (drag.moved) {
      const { col, row } = cellOfSquare(drag.from);
      const baseX = (col * 12.5 / 100) * r.width;
      const baseY = (row * 12.5 / 100) * r.height;
      drag.el.style.left = `${((baseX + dx) / r.width) * 100}%`;
      drag.el.style.top = `${((baseY + dy) / r.height) * 100}%`;
    }
    e.preventDefault();
  });

  function endDrag(e) {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.el) {
      d.el.classList.remove('dragging');
      place(d.el, d.from);
    }
    if (!d.moved) return; // a plain tap keeps the selection for tap-tap play
    const to = squareAtPoint(e.clientX, e.clientY);
    if (!to || to === d.from) return;
    if (!attemptMove(d.from, to)) clearSelection();
  }
  board.addEventListener('pointerup', endDrag);
  board.addEventListener('pointercancel', (e) => {
    if (drag && drag.el) { drag.el.classList.remove('dragging'); place(drag.el, drag.from); }
    drag = null;
    clearSelection();
    if (e) e.preventDefault && e.preventDefault();
  });
  // stop the page from scrolling/zooming while dragging on the board
  board.addEventListener('touchmove', (e) => { if (drag) e.preventDefault(); }, { passive: false });

  // keyboard: arrows move focus, enter selects (accessibility nicety)
  board.addEventListener('keydown', (e) => {
    if (!state.interactive) return;
    if (e.key === 'Escape') { clearSelection(); return; }
  });

  buildSquares();
  renderPieces();
  paintHighlights();
  renderArrows();

  let positionCb = null;
  const api = {
    root,
    board,
    onPosition(cb) { positionCb = cb; },
    get fen() { return state.fen; },
    get orientation() { return state.orientation; },
    get selected() { return state.selected; },
    setPosition(fen, o = {}) {
      const prevFen = state.fen;
      state.fen = fen;
      state.last = o.last !== undefined ? o.last : state.last;
      state.check = o.check !== undefined ? o.check : findCheckSquare(fen);
      if (o.arrows !== undefined) state.arrows = o.arrows || [];
      if (o.clearSelection) clearSelection();
      else if (state.selected) {
        // keep the selection valid only if the same piece is still there
        const pm = pieceMap(fen);
        if (!pm[state.selected]) clearSelection();
        else { state.targets = legalFrom(fen, state.selected).map((m) => ({ ...m, capture: !!pm[m.to] })); }
      }
      const animateFrom = state.animate && o.animate !== false && o.last && prevFen !== fen ? o.last : null;
      renderPieces(animateFrom);
      paintHighlights();
      renderArrows();
      if (positionCb) positionCb(fen);
    },
    setArrows(arrows) { state.arrows = arrows || []; renderArrows(); },
    setEngineArrows(arrows) { state.engineArrows = arrows || []; renderArrows(); },
    getArrows() { return state.arrows.slice(); },
    setOrientation(o) {
      state.orientation = o === 'b' ? 'b' : 'w';
      state.selected = null;
      state.targets = [];
      rebuild();
    },
    setInteractive(v) { state.interactive = !!v; if (!v) clearSelection(); },
    isInteractive() { return state.interactive; },
    setTheme(theme, pieceSet, coords) {
      state.theme = theme || state.theme;
      state.pieceSet = pieceSet || state.pieceSet;
      board.dataset.board = state.theme;
      if (coords !== undefined) state.coords = !!coords;
      // pieces must be re-created to swap the design
      for (const [, el] of pieceEls) el.remove();
      pieceEls.clear();
      rebuild();
    },
    get theme() { return state.theme; },
    get pieceSet() { return state.pieceSet; },
    clearSelection,
    select: selectSquare,
    flash(sq) {
      const el = board.querySelector(`.sq[data-sq="${sq}"]`);
      if (!el) return;
      el.classList.add('hl-check');
      setTimeout(() => el.classList.remove('hl-check'), 220);
    },
    destroy() { root.remove(); },
  };

  function rebuild() {
    buildSquares();
    for (const [, el] of pieceEls) el.remove();
    pieceEls.clear();
    renderPieces();
    paintHighlights();
    renderArrows();
  }

  function findCheckSquare(fen) {
    try {
      const c = new Chess(fen);
      if (c.isCheck && c.isCheck()) {
        const side = c.turn();
        const pm = pieceMap(fen);
        for (const sq in pm) if (pm[sq].type === 'k' && pm[sq].color === side) return sq;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  return api;
}

export function squareNameFromPoint() { return null; }
