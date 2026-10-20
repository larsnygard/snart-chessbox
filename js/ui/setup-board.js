// js/ui/setup-board.js — the position editor behind Analyse → Set up.
//
// A board you build by hand: pick a piece and click a square, drag pieces around,
// drag one off the board (or right-click) to remove it, then set who is to move,
// the castling rights and the en passant square. Nothing here decides whether the
// result is playable — that is js/core/setup.js, called when you press
// "Use position", so the editor can hold a half-built board (no kings yet).

import { el, icon, toast } from './components.js';
import { pieceMarkup, pieceClass } from './pieces.js';
import { FILES, isLightSquare, START_FEN } from '../core/chessutil.js';
import { emptyMap, readFen, mapToFen, epCandidates, validateSetup, CASTLE_RIGHTS } from '../core/setup.js';
import { drillById } from '../core/endgames.js';

const PIECE_ORDER = ['k', 'q', 'r', 'b', 'n', 'p'];
const TURN_LABEL = { w: 'White', b: 'Black' };
const CASTLE_LABEL = { K: 'White O-O', Q: 'White O-O-O', k: 'Black O-O', q: 'Black O-O-O' };

/** Common starting points: the two blanks, and four positions people study. */
export const QUICK_POSITIONS = [
  { id: 'start', label: 'Start position', fen: START_FEN },
  { id: 'empty', label: 'Empty board', fen: '8/8/8/8/8/8/8/8 w - - 0 1' },
  { id: 'kqk', label: 'K+Q vs K', drill: 'kqk-1' },
  { id: 'krk', label: 'K+R vs K', drill: 'krk-1' },
  { id: 'kpk', label: 'K+P vs K', drill: 'kpk-win-1' },
  { id: 'lucena', label: 'Lucena', drill: 'lucena-1' },
  { id: 'philidor', label: 'Philidor', drill: 'philidor-1' },
];

export function createSetupBoard(host, opts = {}) {
  const settings = opts.settings || {};
  const pieceSet = settings.pieceSet || 'classic';
  const onUse = opts.onUse || (() => {});
  const onCancel = opts.onCancel || (() => {});

  let orientation = opts.orientation === 'b' ? 'b' : 'w';
  let map = emptyMap();
  let turn = 'w';
  let castling = [];
  let ep = '-';
  let tool = 'move';   // 'move' | 'erase' | { type, color }
  let selected = null; // tap-tap source square while in move mode
  let press = null;

  host.innerHTML = '';
  const wrap = el('div', { class: 'trainer setup' });
  const boardCol = el('div', { class: 'board-col' });
  const sideCol = el('div', { class: 'side-col' });

  // ---- board column
  const head = el('div', { class: 'row', style: 'gap:8px' },
    el('div', { style: 'font-weight:600', text: 'Set up a position' }),
    el('div', { class: 'spacer' }),
    el('button', {
      class: 'btn sm ghost icon', html: icon('rotate'), title: 'Flip the board',
      onclick: () => { orientation = orientation === 'w' ? 'b' : 'w'; buildSquares(); paint(); },
    }),
    el('button', {
      class: 'btn sm ghost', text: 'Empty',
      onclick: () => { map = emptyMap(); castling = []; ep = '-'; selected = null; paint(); refresh(); },
    }));

  const boardOuter = el('div', { class: 'board-outer' });
  const board = el('div', { class: 'board setup-board', tabindex: '0' });
  board.dataset.board = settings.boardTheme || 'forest';
  const squares = el('div', { class: 'board-squares' });
  const pieces = el('div', { class: 'pieces' });
  board.append(squares, pieces);
  boardOuter.append(board);

  const hint = el('div', { class: 'faint', style: 'font-size:.76rem', text: 'Pick a piece, then click a square. Drag a piece to move it, drag it off the board (or right-click) to remove it.' });
  const palette = el('div', { class: 'setup-palette' });
  const messages = el('div', { class: 'setup-messages' });
  const actions = el('div', { class: 'row', style: 'gap:8px;margin-top:4px' },
    el('button', { class: 'btn sm', text: 'Cancel', onclick: () => onCancel() }),
    el('button', { class: 'btn sm primary', text: 'Use position', onclick: () => submit() }));

  boardCol.append(head, boardOuter, hint, palette, actions, messages);

  // ---- side column: who moves, castling, en passant, quick links
  const turnRow = el('div', { class: 'row', style: 'gap:6px' });
  const turnBtns = {};
  for (const side of ['w', 'b']) {
    const b = el('button', { class: 'btn sm', text: `${TURN_LABEL[side]} to move`, onclick: () => { turn = side; selected = null; paintSelection(); refresh(); } });
    turnBtns[side] = b;
    turnRow.append(b);
  }

  const castleRow = el('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap' });
  const castleBoxes = {};
  for (const right of CASTLE_RIGHTS) {
    const cb = el('input', { type: 'checkbox' });
    cb.addEventListener('change', () => {
      castling = CASTLE_RIGHTS.filter((r) => (r === right ? cb.checked : castling.includes(r)));
      refresh();
    });
    castleBoxes[right] = cb;
    castleRow.append(el('label', { class: 'check', style: 'gap:5px' }, cb, el('span', { style: 'font-size:.8rem', text: CASTLE_LABEL[right] })));
  }

  const epSelect = el('select', {});
  epSelect.addEventListener('change', () => { ep = epSelect.value || '-'; refresh(); });

  const quickRow = el('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' });
  const quickBtns = {};
  for (const q of QUICK_POSITIONS) {
    const b = el('button', { class: 'btn sm', text: q.label, onclick: () => setFen(quickFen(q)) });
    quickBtns[q.id] = b;
    quickRow.append(b);
  }

  const optionsCard = el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('h3', { style: 'margin:0', text: 'Position settings' })),
    el('div', { class: 'field' }, el('span', { style: 'font-size:.8rem', text: 'Side to move' }), turnRow),
    el('div', { class: 'field' }, el('span', { style: 'font-size:.8rem', text: 'Castling rights' }), castleRow,
      el('div', { class: 'faint', style: 'font-size:.74rem;margin-top:4px', text: 'A right is only offered while the king and that rook still stand on their original squares.' })),
    el('div', { class: 'field' }, el('span', { style: 'font-size:.8rem', text: 'En passant' }), epSelect,
      el('div', { class: 'faint', style: 'font-size:.74rem;margin-top:4px', text: 'Only squares where a capture is actually possible are listed.' })));

  const quickCard = el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('h3', { style: 'margin:0', text: 'Quick positions' })),
    quickRow);

  sideCol.append(optionsCard, quickCard);
  wrap.append(boardCol, sideCol);
  host.append(wrap);

  // ------------------------------------------------------------------ board
  function place(node, sq) {
    const f = FILES.indexOf(sq[0]);
    const r = parseInt(sq[1], 10) - 1;
    const col = orientation === 'w' ? f : 7 - f;
    const row = orientation === 'w' ? 7 - r : r;
    node.style.left = `${col * 12.5}%`;
    node.style.top = `${row * 12.5}%`;
  }

  function buildSquares() {
    squares.innerHTML = '';
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const fileIdx = orientation === 'w' ? col : 7 - col;
        const rankIdx = orientation === 'w' ? 7 - row : row;
        const sq = FILES[fileIdx] + (rankIdx + 1);
        const d = el('div', { class: 'sq ' + (isLightSquare(sq) ? 'light' : 'dark'), 'data-sq': sq });
        if (settings.coords !== false) {
          const bottomRank = orientation === 'w' ? row === 7 : row === 0;
          const leftFile = orientation === 'w' ? col === 0 : col === 7;
          if (bottomRank) d.insertAdjacentHTML('beforeend', `<span class="coords file">${sq[0]}</span>`);
          if (leftFile) d.insertAdjacentHTML('beforeend', `<span class="coords rank">${sq[1]}</span>`);
        }
        squares.append(d);
      }
    }
    paintSelection();
  }

  function paintSelection() {
    for (const cell of squares.children) cell.classList.toggle('sel', cell.dataset.sq === selected);
  }

  function paint() {
    pieces.innerHTML = '';
    for (const sq in map) {
      const p = map[sq];
      const node = el('div', {
        class: 'piece ' + pieceClass(pieceSet), 'data-color': p.color, 'data-type': p.type, 'data-sq': sq,
      });
      node.innerHTML = pieceMarkup(pieceSet, p.type, p.color);
      place(node, sq);
      pieces.append(node);
    }
    paintSelection();
  }

  function paintPalette() {
    for (const b of palette.children) {
      const active = b.dataset.tool === (typeof tool === 'string' ? tool : `${tool.color}${tool.type}`);
      b.classList.toggle('on', active);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  // ------------------------------------------------------------------ editing
  function squareAt(e) {
    const r = board.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return null;
    const col = Math.min(7, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * 8)));
    const row = Math.min(7, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * 8)));
    const fileIdx = orientation === 'w' ? col : 7 - col;
    const rankIdx = orientation === 'w' ? 7 - row : row;
    return FILES[fileIdx] + (rankIdx + 1);
  }

  function pieceElAt(sq) {
    return pieces.querySelector(`.piece[data-sq="${sq}"]`);
  }

  function movePiece(from, to) {
    if (!map[from] || from === to) { paint(); return; }
    map[to] = map[from];   // an editor: the destination is replaced, not captured
    delete map[from];
    selected = null;
    paint();
    refresh();
  }

  function tapSquare(sq) {
    if (tool === 'erase') {
      if (map[sq]) { delete map[sq]; paint(); refresh(); }
      return;
    }
    if (tool === 'move') {
      if (map[sq]) { selected = selected === sq ? null : sq; paintSelection(); return; }
      if (selected) { const from = selected; movePiece(from, sq); }
      return;
    }
    map[sq] = { type: tool.type, color: tool.color };
    selected = null;
    paint();
    refresh();
  }

  board.addEventListener('contextmenu', (e) => e.preventDefault());
  board.addEventListener('pointerdown', (e) => {
    if (e.button === 2) {
      const sq = squareAt(e);
      if (sq && map[sq]) { delete map[sq]; paint(); refresh(); }
      return;
    }
    if (e.button !== 0) return;
    const sq = squareAt(e);
    if (!sq) return;
    const node = pieceElAt(sq);
    press = { sq, x: e.clientX, y: e.clientY, moved: false, node, id: e.pointerId };
    if (node) { try { board.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } }
    e.preventDefault();
  });

  board.addEventListener('pointermove', (e) => {
    if (!press || !press.node || !press.node.isConnected) return;
    if (!press.moved && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 5) return;
    press.moved = true;
    press.node.classList.add('dragging');
    const r = board.getBoundingClientRect();
    press.node.style.left = `${((e.clientX - r.left) / r.width) * 100 - 6.25}%`;
    press.node.style.top = `${((e.clientY - r.top) / r.height) * 100 - 6.25}%`;
  });

  board.addEventListener('pointerup', (e) => {
    const p = press;
    press = null;
    if (!p) return;
    const sq = squareAt(e);
    if (p.moved) {
      if (sq && sq !== p.sq) movePiece(p.sq, sq);
      else if (!sq) { delete map[p.sq]; paint(); refresh(); }
      else paint();
      return;
    }
    tapSquare(p.sq);
  });

  board.addEventListener('pointercancel', () => { press = null; paint(); });

  // ------------------------------------------------------------------ state
  function supportedCastling() {
    const has = (sq, type, color) => !!map[sq] && map[sq].type === type && map[sq].color === color;
    return [
      has('e1', 'k', 'w') && has('h1', 'r', 'w') ? 'K' : null,
      has('e1', 'k', 'w') && has('a1', 'r', 'w') ? 'Q' : null,
      has('e8', 'k', 'b') && has('h8', 'r', 'b') ? 'k' : null,
      has('e8', 'k', 'b') && has('a8', 'r', 'b') ? 'q' : null,
    ].filter(Boolean);
  }

  /** Drop rights and ep squares the board no longer supports, then redraw. */
  function refresh() {
    const supported = supportedCastling();
    castling = castling.filter((r) => supported.includes(r));
    const candidates = epCandidates(map, turn);
    if (ep !== '-' && !candidates.includes(ep)) ep = '-';

    for (const side of ['w', 'b']) {
      turnBtns[side].classList.toggle('primary', turn === side);
      turnBtns[side].setAttribute('aria-pressed', turn === side ? 'true' : 'false');
    }
    for (const right of CASTLE_RIGHTS) {
      const box = castleBoxes[right];
      const ok = supported.includes(right);
      box.checked = castling.includes(right);
      box.disabled = !ok;
      box.closest('label').style.opacity = ok ? '1' : '.45';
      box.closest('label').title = ok ? '' : 'The king and that rook are not on their original squares';
    }
    epSelect.innerHTML = '';
    epSelect.append(el('option', { value: '-', text: 'none' }));
    for (const sq of candidates) epSelect.append(el('option', { value: sq, text: sq }));
    epSelect.value = ep === '-' ? '-' : ep;
    epSelect.disabled = candidates.length === 0;

    const current = mapToFen(map, { turn, castling, ep });
    for (const q of QUICK_POSITIONS) {
      quickBtns[q.id].classList.toggle('primary', samePosition(current, quickFen(q)));
    }
    paintPalette();
  }

  function showMessages(lines, kind) {
    messages.innerHTML = '';
    for (const line of lines) messages.append(el('div', { class: `feedback ${kind}`, style: 'margin-top:8px', text: line }));
  }

  function submit() {
    const res = validateSetup(map, { turn, castling, ep });
    if (!res.ok) {
      showMessages(res.errors, 'bad');
      toast('That position is not legal yet', 'bad');
      return;
    }
    showMessages(res.warnings || [], '');
    onUse(res.fen, res.warnings || []);
  }

  function setFen(fen) {
    const state = readFen(fen);
    map = state.map;
    turn = state.turn;
    castling = state.castling;
    ep = state.ep;
    selected = null;
    paint();
    refresh();
  }

  // ------------------------------------------------------------------ palette
  function toolButton(id, label, node) {
    const b = el('button', { class: 'setup-tool', 'data-tool': id, title: label, 'aria-label': label, 'aria-pressed': 'false' }, node);
    b.addEventListener('click', () => { tool = id === 'move' || id === 'erase' ? id : parseTool(id); selected = null; paintPalette(); paintSelection(); });
    return b;
  }

  function parseTool(id) { return { color: id[0], type: id[1] }; }

  palette.append(toolButton('move', 'Move pieces', el('span', { class: 'setup-tool-txt', text: 'Move' })));
  for (const color of ['w', 'b']) {
    for (const type of PIECE_ORDER) {
      const sw = el('span', { class: 'sw', 'data-color': color });
      sw.innerHTML = pieceMarkup(pieceSet, type, color);
      palette.append(toolButton(color + type, `${TURN_LABEL[color]} ${type.toUpperCase()}`, sw));
    }
  }
  palette.append(toolButton('erase', 'Remove a piece', el('span', { class: 'setup-tool-txt', html: icon('x') })));

  buildSquares();
  paint();
  refresh();

  return {
    el: wrap,
    setFen,
    get fen() { return mapToFen(map, { turn, castling, ep }); },
    get state() { return { turn, castling: castling.slice(), ep, pieces: Object.keys(map).length }; },
    validate: () => validateSetup(map, { turn, castling, ep }),
    destroy() { host.innerHTML = ''; },
  };
}

function quickFen(q) {
  if (q.fen) return q.fen;
  const drill = drillById(q.drill);
  return drill ? drill.fen : START_FEN;
}

/** Same board, same side to move, same rights: the move counters do not matter. */
function samePosition(a, b) {
  const key = (fen) => String(fen || '').split(' ').slice(0, 4).join(' ');
  return key(a) === key(b);
}
