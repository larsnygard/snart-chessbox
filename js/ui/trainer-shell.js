// js/ui/trainer-shell.js — shared layout for every training screen:
// board on the left (sticky on desktop), information/controls on the right.

import { createBoard } from './board.js';
import { createBoardTools } from './board-tools.js';
import { el, icon } from './components.js';

export function trainerShell(host, opts = {}) {
  host.innerHTML = '';
  const wrap = el('div', { class: 'trainer' });
  const boardCol = el('div', { class: 'board-col board-sticky' });
  const sideCol = el('div', { class: 'side-col' });

  const topRow = el('div', { class: 'row' });
  const titleEl = el('div', { class: 'row', style: 'gap:8px;font-weight:600' });
  const badgeRow = el('div', { class: 'row tight' });
  topRow.append(titleEl, el('div', { class: 'spacer' }), badgeRow);

  const boardHost = el('div');
  const statusRow = el('div', { class: 'row', style: 'gap:8px' });
  const statusEl = el('div', { class: 'board-status' });
  const toolbar = el('div', { class: 'board-toolbar' });
  const toolsRow = el('div');

  boardCol.append(topRow, boardHost, statusRow, toolsRow);
  statusRow.append(statusEl, el('div', { class: 'spacer' }), toolbar);

  const infoCard = el('div', { class: 'card' });
  const titleRow = el('div', { class: 'card-head' });
  const panelTitle = el('h2', { style: 'font-size:1rem;margin:0' });
  titleRow.append(panelTitle, el('div', { class: 'spacer' }));
  const goalEl = el('div', { class: 'dim', style: 'font-size:.86rem' });
  const feedbackEl = el('div', { class: 'feedback hidden' });
  const movesWrap = el('div', { style: 'display:flex;flex-direction:column;gap:8px' });
  const movesHead = el('div', { class: 'row tight', style: 'font-size:.74rem;color:var(--text-faint);text-transform:uppercase;letter-spacing:.06em' }, 'Moves');
  const movesBox = el('div', { class: 'movelist' });
  const extra = el('div', { class: 'stack', style: 'gap:8px' });
  const actions = el('div', { class: 'row', style: 'gap:8px;margin-top:2px' });
  movesWrap.append(movesHead, movesBox);
  infoCard.append(titleRow, goalEl, feedbackEl, movesWrap, extra, actions);

  sideCol.append(infoCard);
  wrap.append(boardCol, sideCol);
  host.append(wrap);

  const board = createBoard(boardHost, {
    fen: opts.fen,
    orientation: opts.orientation || 'w',
    theme: opts.theme,
    pieceSet: opts.pieceSet,
    coords: opts.coords,
    animate: opts.animate,
    allowAnyPiece: !!opts.allowAnyPiece,
    onMove: (m) => opts.onMove && opts.onMove(m),
  });

  // Every board gets the same strip: move navigation (when the screen has a
  // move cursor), the eval bar, the engine switch and "play from this position".
  const tools = createBoardTools(toolsRow, {
    board,
    settings: opts.settings || {},
    engine: opts.engine,
    nav: opts.nav || null,
    allowEngine: opts.allowEngine !== false,
    onPlayFromHere: opts.onPlayFromHere,
    showPlayFromHere: opts.showPlayFromHere,
    allowDeep: opts.allowDeep,
  });
  board.onPosition(() => tools.refresh());

  const api = {
    board, wrap, toolbar, extra, actions, infoCard, sideCol, tools,
    setTitle(text, badges = []) {
      titleEl.innerHTML = `<span>${text}</span>`;
      badgeRow.innerHTML = '';
      for (const b of badges) badgeRow.append(el('span', { class: `badge ${b.kind || ''}`, text: b.text }));
    },
    setPanelTitle(text) { panelTitle.textContent = text; },
    setGoal(html) { goalEl.innerHTML = html; },
    setStatus(text) { statusEl.innerHTML = text; },
    setFeedback(text, kind = '', ctas = []) {
      feedbackEl.className = 'feedback ' + kind;
      feedbackEl.innerHTML = '';
      if (!text) { feedbackEl.classList.add('hidden'); return; }
      feedbackEl.append(el('div', { html: text }));
      if (ctas.length) {
        const row = el('div', { class: 'row', style: 'margin-top:8px' });
        for (const c of ctas) row.append(el('button', { class: 'btn sm ' + (c.primary ? 'primary' : ''), text: c.label, onclick: c.onClick }));
        feedbackEl.append(row);
      }
    },
    setMoves(sans, currentIndex = -1, marks = {}) {
      movesBox.innerHTML = '';
      if (!sans.length) {
        // an empty move list is just noise on single-move screens
        movesWrap.style.display = 'none';
        return;
      }
      movesWrap.style.display = 'flex';
      movesBox.style.display = 'grid';
      const startTurn = opts.startTurn || 'w';
      let i = 0;
      let moveNo = 1;
      while (i < sans.length) {
        const row = [el('div', { class: 'no', text: `${moveNo}.` })];
        for (let k = 0; k < 2; k++) {
          if (i >= sans.length) { row.push(el('div')); break; }
          if (i === 0 && startTurn === 'b' && k === 0) { row.push(el('div', { class: 'mv faint', text: '…' })); continue; }
          const idx = i;
          const cls = 'mv' + (idx === currentIndex ? ' cur' : '') + (marks[idx] ? ' ' + marks[idx] : '');
          row.push(el('div', { class: cls, text: sans[idx], onclick: () => opts.onMoveClick && opts.onMoveClick(idx) }));
          i++;
        }
        moveNo++;
        movesBox.append(...row);
      }
      // scroll only inside the move list: scrollIntoView() also scrolls the page,
      // which made the board jump while playing
      const cur = movesBox.querySelector('.mv.cur');
      if (cur) {
        const top = cur.offsetTop - movesBox.offsetTop;
        const bottom = top + cur.offsetHeight;
        if (top < movesBox.scrollTop) movesBox.scrollTop = Math.max(0, top - 6);
        else if (bottom > movesBox.scrollTop + movesBox.clientHeight) {
          movesBox.scrollTop = bottom - movesBox.clientHeight + 6;
        }
      }
    },
    addTool(label, onClick, cls = 'btn sm') {
      const b = el('button', { class: cls, html: label, onclick: onClick });
      toolbar.append(b);
      return b;
    },
    addAction(label, onClick, primary = false) {
      const b = el('button', { class: 'btn sm' + (primary ? ' primary' : ''), text: label, onclick: onClick });
      actions.append(b);
      return b;
    },
    addBadge(text, kind = '') { badgeRow.append(el('span', { class: `badge ${kind}`, text })); },
    destroy() { host.innerHTML = ''; },
    icon,
  };
  return api;
}
