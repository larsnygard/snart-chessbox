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
    arrowsVisible: true,  // the strip's Arrows switch hides the screen's own arrows too
    marks: new Map(),        // square -> 'green' | 'red' | 'yellow'  (right-click)
    markArrows: new Map(),   // 'e2e4' -> colour                    (right-click drag)
    preview: null,           // arrow being drawn right now
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
      <marker id="ah-red" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 z" fill="#e04848"/></marker>
      <marker id="ah-yellow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 z" fill="#e6b93c"/></marker>
      <marker id="ah-green" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 z" fill="#2fae80"/></marker>
      <marker id="ah-book" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 z" fill="#a970ff"/></marker>
      <marker id="ah-bookalt" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 z" fill="#6f5bb0"/></marker>
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
    const MARK_COLOUR = { red: '#e04848', yellow: '#e6b93c', green: '#2fae80', blue: '#3d8bfd' };
    // book moves (a repertoire's own arrows) live in their own violet family so a
    // green arrow always means the engine
    const BOOK_COLOUR = { book: '#a970ff', bookalt: '#6f5bb0' };
    const userArrows = [...state.markArrows.entries()].map(([key, colour]) => ({
      from: key.slice(0, 2), to: key.slice(2, 4), color: colour, mark: true,
    }));
    if (state.preview && state.preview.from !== state.preview.to) {
      userArrows.push({ ...state.preview, color: state.preview.color || 'green', mark: true, preview: true });
    }
    const screenArrows = state.arrowsVisible === false ? [] : state.arrows;
    const all = screenArrows.concat(state.engineArrows, userArrows)
      .filter((a) => a && a.from && a.to && a.from !== a.to);
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
      const color = a.color === 'bad' ? '#e05656'
        : a.color === 'best' ? '#37b98a'
        : BOOK_COLOUR[a.color] ? BOOK_COLOUR[a.color]
        : MARK_COLOUR[a.color] || '#3d8bfd';
      const marker = a.color === 'bad' ? 'ah-bad'
        : a.color === 'best' ? 'ah-best'
        : BOOK_COLOUR[a.color] ? `ah-${a.color}`
        : a.color === 'red' ? 'ah-red'
        : a.color === 'yellow' ? 'ah-yellow'
        : a.color === 'green' ? 'ah-green'
        : 'ah-hint';
      // stroke width and opacity may be given per arrow: the engine's top-3
      // arrows use them to rank the moves (thick+bright = the move it likes)
      const alpha = a.preview ? 0.6 : (a.alpha != null ? a.alpha : (a.weak ? 0.55 : 0.92));
      const wide = a.preview ? 0.1 : (a.width != null ? a.width : (a.weak ? 0.085 : 0.13));
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
      const mark = state.marks.get(sq);
      el.classList.toggle('mark-green', mark === 'green');
      el.classList.toggle('mark-red', mark === 'red');
      el.classList.toggle('mark-yellow', mark === 'yellow');
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

  // ---- right-click annotations: circles on squares, arrows by dragging ----
  const MARK_ORDER = ['green', 'red', 'yellow'];
  let markDrag = null;

  function markColourFor(e, current) {
    if (e.shiftKey) return 'red';
    if (e.altKey) return 'yellow';
    if (e.ctrlKey || e.metaKey) return 'green';
    const i = current ? MARK_ORDER.indexOf(current) : -1;
    return i + 1 < MARK_ORDER.length ? MARK_ORDER[i + 1] : null; // cycles green → red → yellow → off
  }

  function setSquareMark(sq, e) {
    const next = markColourFor(e, state.marks.get(sq) || null);
    if (next) state.marks.set(sq, next); else state.marks.delete(sq);
    paintHighlights();
    renderArrows();
  }

  /**
   * Arrows behave like a toggle, not a cycle: a plain re-draw of the same arrow
   * removes it. A modifier picks the colour, and re-drawing an arrow that is
   * already that colour removes it too.
   */
  function arrowColourFor(e, existing) {
    if (e.shiftKey) return existing === 'red' ? null : 'red';
    if (e.altKey) return existing === 'yellow' ? null : 'yellow';
    if (e.ctrlKey || e.metaKey) return existing === 'green' ? null : 'green';
    return existing ? null : 'green';
  }

  function toggleMarkArrow(from, to, e) {
    const key = from + to;
    const next = arrowColourFor(e, state.markArrows.get(key) || null);
    if (!next) state.markArrows.delete(key);
    else state.markArrows.set(key, next);
    renderArrows();
  }

  function clearMarks() {
    if (!state.marks.size && !state.markArrows.size && !state.preview) return;
    state.marks.clear();
    state.markArrows.clear();
    state.preview = null;
    paintHighlights();
    renderArrows();
  }

  // the board owns right-click: never show the browser menu over it
  board.addEventListener('contextmenu', (ev) => ev.preventDefault());

  board.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 2 || !state.interactive) return;
    const sq = squareAtPoint(ev.clientX, ev.clientY);
    if (!sq) return;
    ev.preventDefault();
    ev.stopPropagation();
    markDrag = { from: sq, startX: ev.clientX, startY: ev.clientY, moved: false, pointerId: ev.pointerId };
    if (board.setPointerCapture) { try { board.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ } }
  }, true);

  board.addEventListener('pointermove', (ev) => {
    if (!markDrag) return;
    const to = squareAtPoint(ev.clientX, ev.clientY);
    if (!markDrag.moved && Math.hypot(ev.clientX - markDrag.startX, ev.clientY - markDrag.startY) > 6) markDrag.moved = true;
    if (markDrag.moved) {
      if (to && to !== markDrag.from) {
        const colour = ev.shiftKey ? 'red' : ev.altKey ? 'yellow' : 'green';
        state.preview = { from: markDrag.from, to, color: colour };
      } else state.preview = null;
      renderArrows();
    }
    ev.preventDefault();
  });

  board.addEventListener('pointerup', (ev) => {
    if (!markDrag) return;
    const d = markDrag;
    markDrag = null;
    state.preview = null;
    const to = squareAtPoint(ev.clientX, ev.clientY);
    const mods = { shiftKey: ev.shiftKey, altKey: ev.altKey, ctrlKey: ev.ctrlKey, metaKey: ev.metaKey };
    if (d.moved && to && to !== d.from) toggleMarkArrow(d.from, to, mods);
    else setSquareMark(d.from, mods);
    ev.preventDefault();
  });

  board.addEventListener('pointercancel', () => {
    markDrag = null;
    state.preview = null;
    renderArrows();
  });

  // keyboard: arrows move focus, enter selects (accessibility nicety)
  board.addEventListener('keydown', (e) => {
    if (!state.interactive) return;
    if (e.key === 'Escape') {
      if (state.marks.size || state.markArrows.size) clearMarks();
      else clearSelection();
      return;
    }
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
      if (fen !== prevFen) {
        state.marks.clear();
        state.markArrows.clear();
        state.preview = null;
      }
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
    /** Hide the screen's arrows (book moves, hints) without dropping them. */
    setArrowsVisible(v) { state.arrowsVisible = v !== false; renderArrows(); },
    arrowsVisible() { return state.arrowsVisible !== false; },
    setEngineArrows(arrows) { state.engineArrows = arrows || []; renderArrows(); },
    clearMarks,
    getMarks() { return { squares: [...state.marks.entries()], arrows: [...state.markArrows.entries()] }; },
    getArrows() { return state.arrows.slice(); },
    setOrientation(o) {
      const next = o === 'b' ? 'b' : 'w';
      const changed = next !== state.orientation;
      state.orientation = next;
      state.selected = null;
      state.targets = [];
      rebuild();
      if (changed && opts.onOrientation) opts.onOrientation(next);
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
