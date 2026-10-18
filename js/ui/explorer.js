// js/ui/explorer.js — a position explorer over a repertoire move tree.
//
// Behaviour the training screens rely on:
//   * clicking a move in the list puts the board on that move
//   * every position shows ALL continuations in the tree as arrows; clicking an
//     arrow plays it
//   * playing a different move creates a new variation (it is added beside the
//     existing move, never on top of it)
//   * each move has an edit button (comment / replace / delete / new variation)
//   * the board carries the standard tool strip: navigation, eval bar, engine
//     switch and "play engine from this position"

import { applySan, applyUci, START_FEN, formatEval, winProbability } from '../core/chessutil.js';
import { addLine, removeLine, setComment, findMoveNode, treeStats, treeLines } from '../core/repertoire.js';
import { createBoard } from './board.js';
import { createBoardTools } from './board-tools.js';
import { el, icon, modal, toast, confirmDialog } from './components.js';

export function createExplorer(host, opts = {}) {
  const tree = opts.tree;
  const editable = opts.editable !== false;
  const settings = opts.settings || {};
  const onChange = opts.onChange || (() => {});
  // Start on the most-played line (cursor at the root) so the move list shows
  // the repertoire immediately instead of an empty panel; clicking any move
  // then walks the board along it.
  const explicitPath = opts.initialPath && opts.initialPath.length ? opts.initialPath.slice() : null;
  let path = explicitPath || (treeLines(tree, 1)[0] || []).slice();
  let cursor = explicitPath ? path.length : 0;

  host.innerHTML = '';
  const wrap = el('div', { class: 'trainer explorer' });
  const boardCol = el('div', { class: 'board-col' });
  const sideCol = el('div', { class: 'side-col' });

  // ---- board
  const head = el('div', { class: 'row', style: 'gap:8px' },
    el('div', { class: 'row', style: 'gap:8px;font-weight:600' }, opts.title || 'Position'),
    el('div', { class: 'spacer' }),
    el('span', { class: 'badge', text: tree.color === 'b' ? 'Black repertoire' : 'White repertoire' }));
  const boardHost = el('div');
  const statusRow = el('div', { class: 'row', style: 'gap:8px' }, el('div', { class: 'board-status' }));
  const toolsRow = el('div');
  boardCol.append(head, boardHost, statusRow, toolsRow);

  const board = createBoard(boardHost, {
    fen: tree.fen || START_FEN,
    orientation: tree.color || 'w',
    theme: settings.boardTheme,
    pieceSet: settings.pieceSet,
    coords: settings.coords,
    animate: settings.animate,
    onMove: (m) => onBoardMove(m),
    onArrow: (a) => onArrowClick(a),
  });

  // ---- side panel
  const listCard = el('div', { class: 'card' });
  const listHead = el('div', { class: 'card-head' },
    el('h3', { style: 'margin:0', text: editable ? 'Moves (click to jump, pencil to edit)' : 'Moves' }),
    el('div', { class: 'spacer' }),
    el('span', { class: 'badge', text: '' }));
  const moveList = el('div', { class: 'mtree' });
  const addRow = el('div', { class: 'stack', style: 'gap:6px;margin-top:10px' });
  listCard.append(listHead, moveList);
  if (editable) listCard.append(addRow);

  const treeCard = el('details', { class: 'card', style: 'margin-top:12px' },
    el('summary', { style: 'cursor:pointer;font-size:.86rem', text: 'Whole repertoire (lines)' }),
    el('div', { class: 'tree-lines', style: 'margin-top:8px;max-height:260px;overflow:auto' }));

  sideCol.append(listCard, treeCard);
  wrap.append(boardCol, sideCol);
  host.append(wrap);

  const tools = createBoardTools(toolsRow, {
    board,
    settings,
    engine: opts.engine,
    nav: {
      first: () => go(0),
      back: () => go(cursor - 1),
      forward: () => go(cursor + 1),
      last: () => go(path.length),
      state: () => ({ atStart: cursor === 0, atEnd: cursor >= path.length }),
    },
    onPlayFromHere: opts.onPlayFromHere,
  });
  board.onPosition(() => tools.refresh());

  // ---------------------------------------------------------------- helpers
  function nodeAt(n) {
    return findMoveNode(tree, path.slice(0, n)) || tree;
  }

  function fenAt(n) {
    let fen = tree.fen || START_FEN;
    for (let i = 0; i < n; i++) {
      const r = applySan(fen, path[i]);
      if (!r) break;
      fen = r.fen;
    }
    return fen;
  }

  function childrenAt(n) {
    return nodeAt(n).moves || [];
  }

  function go(n) {
    cursor = Math.max(0, Math.min(path.length, n));
    render();
  }

  function loadPath(sans, toEnd = true) {
    path = sans.slice();
    cursor = toEnd ? path.length : 0;
    render();
  }

  function arrowList() {
    return childrenAt(cursor).map((m, i) => ({
      from: m.uci.slice(0, 2),
      to: m.uci.slice(2, 4),
      color: path[cursor] === m.san ? 'best' : 'hint',
      weak: path[cursor] !== m.san,
      san: m.san,
    }));
  }

  function onArrowClick(a) {
    const child = childrenAt(cursor).find((m) => m.uci === `${a.from}${a.to}`);
    if (!child) return;
    const prefix = path.slice(0, cursor);
    path = prefix.concat(child.san);
    cursor = path.length;
    render();
  }

  function onBoardMove({ from, to, promotion }) {
    const uci = from + to + (promotion || '');
    const fen = fenAt(cursor);
    const res = applyUci(fen, uci);
    if (!res) return;
    const prefix = path.slice(0, cursor);
    const exists = childrenAt(cursor).find((m) => m.uci === uci);
    if (!exists) {
      if (!editable) {
        toast('That move is not in this repertoire — switch to Edit to add it', '');
        board.setPosition(fen, { clearSelection: true });
        return;
      }
      const added = addLine(tree, prefix.concat(res.san));
      if (!added.ok) { toast(`Illegal move ${res.san}`, 'bad'); return; }
      onChange();
      toast(`New variation: ${res.san}`, 'ok');
    }
    path = prefix.concat(res.san);
    cursor = path.length;
    render();
  }

  // ---------------------------------------------------------------- rendering
  function render() {
    const fen = fenAt(cursor);
    board.setPosition(fen, {
      last: cursor > 0
        ? (() => { const u = childrenAt(cursor - 1).find((m) => m.san === path[cursor - 1]); return u ? { from: u.uci.slice(0, 2), to: u.uci.slice(2, 4) } : null; })()
        : null,
      arrows: arrowList(),
      clearSelection: true,
    });
    board.setInteractive(true);
    renderList();
    renderStatus();
    renderFullTree();
    tools.refresh();
  }

  function renderStatus() {
    const kids = childrenAt(cursor);
    const st = treeStats(tree);
    const statusEl = statusRow.querySelector('.board-status');
    const turn = fenAt(cursor).split(' ')[1] === 'b' ? 'Black' : 'White';
    statusEl.innerHTML = cursor === 0
      ? `Starting position · <span class="faint">${kids.length} continuation${kids.length === 1 ? '' : 's'}</span>`
      : `Move ${Math.ceil(cursor / 2)} · <span class="mono">${path[cursor - 1]}</span> · <span class="faint">${turn} to move · ${kids.length} continuation${kids.length === 1 ? '' : 's'}</span>`;
    listHead.querySelector('.badge').textContent = `${st.leaves} lines · ${st.nodes} positions`;
    if (editable) {
      addRow.innerHTML = '';
      const input = el('input', { type: 'text', placeholder: 'Add a line: e4 c5 Nf3 d6 d4' });
      const add = el('button', {
        class: 'btn sm primary', text: 'Add line', onclick: () => {
          const sans = input.value.replace(/\d+\.(\.\.)?/g, ' ').replace(/[!?]+/g, '').trim().split(/\s+/).filter(Boolean);
          if (!sans.length) return;
          const res = addLine(tree, sans);
          if (!res.ok) { toast(`Illegal move: ${res.at}`, 'bad'); return; }
          input.value = '';
          onChange();
          loadPath(sans);
          toast('Line added', 'ok');
        },
      });
      addRow.append(input, el('div', { class: 'row' }, add,
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn sm ghost', text: 'Delete from here', onclick: deleteFromCursor })));
    }
  }

  function renderList() {
    moveList.innerHTML = '';
    moveList.append(el('div', { class: 'mtree-head' },
      el('button', { class: 'mtree-start' + (cursor === 0 ? ' cur' : ''), text: 'Start position', onclick: () => go(0) }),
      el('span', { class: 'faint', style: 'font-size:.74rem', text: cursor === 0 ? 'click a move to walk the board along the line' : '' })));
    if (!path.length) {
      moveList.append(el('div', { class: 'faint', style: 'font-size:.84rem;padding:8px 2px', text: editable ? 'Empty. Play a move on the board or add a line below.' : 'No line loaded.' }));
      return;
    }
    const startTurn = (tree.fen || START_FEN).split(' ')[1] === 'b' ? 'b' : 'w';
    const isWhitePly = (i) => (startTurn === 'w' ? i % 2 === 0 : i % 2 === 1);
    const moveNoFor = (i) => Math.floor((startTurn === 'w' ? i : i + 1) / 2) + 1;

    const cell = (i) => {
      const box = el('span', { class: 'mtree-cell' });
      box.append(el('button', {
        class: 'mtree-mv' + (cursor === i + 1 ? ' cur' : ''),
        text: path[i],
        title: `Set the board to the position after ${path[i]}`,
        onclick: () => go(i + 1),
      }));
      box.append(el('button', {
        class: 'mtree-edit', html: icon('pencil'), title: 'Edit this move',
        onclick: (e) => { e.stopPropagation(); editMenu(i); },
      }));
      const siblings = childrenAt(i).filter((m) => m.san !== path[i]);
      if (siblings.length) {
        const alts = el('span', { class: 'mtree-alts' });
        alts.append('(');
        siblings.forEach((s, k) => {
          if (k) alts.append(', ');
          alts.append(el('button', {
            class: 'mtree-alt', text: s.san, title: `Switch to the ${s.san} variation`,
            onclick: () => {
              path = path.slice(0, i).concat(s.san);
              cursor = i + 1;
              render();
            },
          }));
        });
        alts.append(')');
        box.append(alts);
      }
      return box;
    };

    let i = 0;
    while (i < path.length) {
      const row = el('div', { class: 'mtree-row' });
      row.append(el('span', { class: 'mtree-no', text: isWhitePly(i) ? `${moveNoFor(i)}.` : `${moveNoFor(i)}…` }));
      if (isWhitePly(i)) {
        row.append(cell(i));
        if (i + 1 < path.length && !isWhitePly(i + 1)) { row.append(cell(i + 1)); i += 2; }
        else { row.append(el('span')); i += 1; }
      } else {
        row.append(el('span'));
        row.append(cell(i));
        i += 1;
      }
      moveList.append(row);
    }
  }

  function renderFullTree() {
    const box = treeCard.querySelector('.tree-lines');
    if (!treeCard.open) return;
    box.innerHTML = '';
    const lines = treeLines(tree, 400);
    if (!lines.length) { box.append(el('div', { class: 'faint', text: 'Empty repertoire.' })); return; }
    for (const line of lines) {
      box.append(el('button', {
        class: 'mtree-line', text: line.join(' '),
        onclick: () => loadPath(line),
      }));
    }
  }
  treeCard.addEventListener('toggle', renderFullTree);

  // ---------------------------------------------------------------- editing
  function editMenu(ply) {
    const node = childrenAt(ply).find((m) => m.san === path[ply]);
    if (!node) return;
    const comment = (node.children && node.children.comment) || '';
    const body = el('div', {},
      el('div', { class: 'mono', style: 'font-size:.9rem;margin-bottom:8px', text: `${ply + 1}. ${node.san}` }),
      el('div', { class: 'dim', style: 'font-size:.8rem;margin-bottom:10px', text: `${node.count || 1} game(s) reach this move${comment ? ' · has a comment' : ''}` }),
      el('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap' },
        el('button', { class: 'btn sm', text: 'Jump here', onclick: () => { m.close(); go(ply + 1); } }),
        ...(editable ? [
          el('button', { class: 'btn sm', text: comment ? 'Edit comment' : 'Add comment', onclick: () => { m.close(); commentDialog(ply, comment); } }),
          el('button', { class: 'btn sm', text: 'Change move…', onclick: () => { m.close(); changeDialog(ply); } }),
          el('button', { class: 'btn sm', text: 'New variation from here', onclick: () => { m.close(); go(ply + 1); toast('Play a different move on the board', ''); } }),
        ] : []),
      ));
    const m = modal({
      title: `Move ${ply + 1}: ${node.san}`,
      body,
      actions: editable ? [{
        label: 'Delete move', danger: true, onClick: async () => {
          const ok = await confirmDialog({ title: `Delete ${node.san}?`, text: 'This move and everything after it in this line will be removed.' });
          if (!ok) return false;
          removeLine(tree, path.slice(0, ply + 1));
          if (cursor > ply) { path = path.slice(0, ply); cursor = ply; }
          onChange();
          render();
          toast('Move deleted', 'ok');
        },
      }] : [],
    });
  }

  function commentDialog(ply, current) {
    const area = el('textarea', { style: 'min-height:90px' });
    area.value = current || '';
    modal({
      title: `Comment on ${path[ply]}`,
      body: area,
      actions: [{ label: 'Cancel' }, {
        label: 'Save', primary: true, onClick: () => {
          setComment(tree, path.slice(0, ply + 1), area.value.trim());
          onChange();
          render();
          toast('Comment saved', 'ok');
        },
      }],
    });
  }

  function changeDialog(ply) {
    const fen = fenAt(ply);
    const input = el('input', { type: 'text', placeholder: 'New move, e.g. Nf3 or Nf3!?' });
    const info = el('div', { class: 'faint', style: 'font-size:.78rem;margin-top:8px', text: 'The rest of the old line is dropped; other variations are untouched.' });
    modal({
      title: `Replace ${path[ply]}`,
      body: el('div', {}, input, info),
      actions: [{ label: 'Cancel' }, {
        label: 'Replace', primary: true, onClick: () => {
          const san = input.value.replace(/[!?]+/g, '').trim();
          const res = applySan(fen, san);
          if (!res) { toast('Illegal move', 'bad'); return false; }
          const parent = path.slice(0, ply);
          removeLine(tree, path.slice(0, ply + 1));
          addLine(tree, parent.concat(res.san));
          path = parent.concat(res.san);
          cursor = path.length;
          onChange();
          render();
          toast('Move replaced', 'ok');
        },
      }],
    });
  }

  function deleteFromCursor() {
    if (!cursor) { toast('Nothing selected', ''); return; }
    removeLine(tree, path.slice(0, cursor));
    path = path.slice(0, cursor - 1);
    cursor = Math.min(cursor, path.length);
    onChange();
    render();
    toast('Line deleted', 'ok');
  }

  render();

  return {
    refresh: render,
    destroy() { host.innerHTML = ''; },
    get path() { return path.slice(); },
    get cursor() { return cursor; },
    setPath: loadPath,
  };
}
