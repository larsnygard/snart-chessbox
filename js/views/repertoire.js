// js/views/repertoire.js — build, edit and train your own opening repertoire.
//
// Three ways in:
//   * empty tree, add lines by hand or from the opening database
//   * import PGN (a study, a course export, your own games)
//   * auto-build from your imported game library, keeping the branches you
//     actually play and optionally dropping engine-flagged bad moves

import { state, navigate, persist, trainerCtx } from '../app.js';
import { el, icon, toast, modal, confirmDialog } from '../ui/components.js';
import { parsePGN, wrapMovetext, buildPGN } from '../core/pgn.js';
import { START_FEN, applySan, applyUci } from '../core/chessutil.js';
import { emptyTree, addLine, removeLine, buildFromGames, treeLines, treeStats, annotateLosses, dropBadMoves, findMoveNode, movesAt, setComment, mergeTrees } from '../core/repertoire.js';
import { uid } from '../core/sets.js';
import { createBoard } from '../ui/board.js';
import { mountOpening, sansToUcis } from '../trainers/opening.js';
import { download, exportName } from '../core/backup.js';

export function render(host, params, query) {
  const id = params && params[0];
  if (id) return renderEditor(host, id, query || {});
  return renderList(host);
}

function renderList(host) {
  const reps = state.repertoires || [];
  host.append(el('div', { class: 'card', style: 'margin-bottom:14px' },
    el('div', { class: 'row', style: 'gap:16px' },
      el('div', { style: 'flex:1' },
        el('h2', { text: 'Your repertoire' }),
        el('p', { class: 'dim', style: 'margin:0', html: 'A repertoire is a move tree for one colour. Import it from PGN, build it automatically from your own games, or add lines by hand. Training plays the tree from the opponent side, so you rehearse your real lines.' })),
      el('button', { class: 'btn primary', html: `${icon('plus')}<span>New repertoire</span>`, onclick: () => newDialog() }))));

  if (!reps.length) {
    host.append(el('div', { class: 'empty', text: 'No repertoires yet. Create one — you can start empty, from a PGN file, or from the games you already imported.' }));
  } else {
    const list = el('div', { class: 'grid cols-2' });
    for (const rep of reps) {
      const st = treeStats(rep.tree);
      list.append(el('div', { class: 'card' },
        el('div', { class: 'card-head' },
          el('strong', { text: rep.name }),
          el('span', { class: 'badge', text: rep.color === 'w' ? 'White' : 'Black' }),
          el('div', { class: 'spacer' }),
          el('span', { class: 'faint', style: 'font-size:.75rem', text: `${st.leaves} lines · depth ${st.maxDepth}` })),
        el('div', { class: 'dim', style: 'font-size:.82rem;min-height:2.4em', text: rep.description || 'No description' }),
        el('div', { class: 'row tight', style: 'margin-top:8px' },
          el('button', { class: 'btn sm primary', text: 'Train', onclick: () => navigate('/repertoire/' + rep.id + '?tab=train') }),
          el('button', { class: 'btn sm', text: 'Edit', onclick: () => navigate('/repertoire/' + rep.id) }),
          el('button', { class: 'btn sm ghost', text: 'PGN', onclick: () => exportRep(rep) }),
          el('div', { class: 'spacer' }),
          el('button', {
            class: 'btn sm ghost icon', html: icon('trash'), onclick: async () => {
              if (await confirmDialog({ title: 'Delete repertoire?', text: `“${rep.name}” and its move tree will be removed.` })) {
                state.repertoires = state.repertoires.filter((r) => r.id !== rep.id);
                persist('repertoires', true);
                navigate('/repertoire');
              }
            },
          }))));
    }
    host.append(list);
  }

  function newDialog() {
    const name = el('input', { type: 'text', placeholder: 'e.g. “White: 1.e4 main lines”' });
    const color = el('select', {}, el('option', { value: 'w', text: 'I play White' }), el('option', { value: 'b', text: 'I play Black' }));
    const source = el('select', {},
      el('option', { value: 'empty', text: 'Start empty' }),
      el('option', { value: 'games', text: 'Auto-build from my imported games' }),
      el('option', { value: 'pgn', text: 'Import PGN now' }));
    const pgnArea = el('textarea', { placeholder: 'Paste PGN lines or games…', class: 'hidden' });
    const options = el('div', { class: 'split' });
    const maxPly = el('input', { type: 'number', value: '20', min: '4', max: '60' });
    const minCount = el('input', { type: 'number', value: '1', min: '1', max: '20' });
    options.append(
      el('label', { class: 'field' }, el('span', { text: 'Include up to (plies)' }), maxPly),
      el('label', { class: 'field' }, el('span', { text: 'Only moves seen in at least N games' }), minCount));
    source.addEventListener('change', () => {
      pgnArea.classList.toggle('hidden', source.value !== 'pgn');
      options.classList.toggle('hidden', source.value !== 'games');
    });
    options.classList.add('hidden');

    modal({
      title: 'New repertoire',
      body: el('div', {},
        el('label', { class: 'field' }, el('span', { text: 'Name' }), name),
        el('div', { class: 'split' },
          el('label', { class: 'field' }, el('span', { text: 'Colour' }), color),
          el('label', { class: 'field' }, el('span', { text: 'Source' }), source)),
        options, pgnArea,
        el('p', { class: 'faint', style: 'font-size:.78rem', text: 'Auto-build needs imported games (My games tab). It keeps the moves you play, weighted by frequency.' })),
      actions: [
        { label: 'Cancel' },
        {
          label: 'Create', primary: true, onClick: () => {
            const trep = {
              id: uid('rep'), name: name.value || 'New repertoire', color: color.value,
              description: '', tree: emptyTree(color.value), created: Date.now(), updated: Date.now(),
            };
            if (source.value === 'games') {
              const games = pickGames(color.value);
              if (!games.length) { toast('No imported games for that colour', 'bad'); return false; }
              trep.tree = buildFromGames(games, { color: color.value, maxPly: Number(maxPly.value) || 20, minCount: Number(minCount.value) || 1 });
              trep.description = `Auto-built from ${games.length} game(s)`;
            } else if (source.value === 'pgn') {
              const parsed = parsePGN(pgnArea.value);
              let n = 0;
              for (const g of parsed) if (g.moves.length) { addLine(trep.tree, g.moves.slice(0, 40)); n++; }
              if (!n) { toast('No legal moves found in that PGN', 'bad'); return false; }
              trep.description = `Imported from ${n} PGN game(s)`;
            }
            state.repertoires = (state.repertoires || []).concat([trep]);
            persist('repertoires', true);
            navigate('/repertoire/' + trep.id);
          },
        },
      ],
    });
  }

  function pickGames(color) {
    const name = (state.settings.username || '').toLowerCase();
    return (state.games || []).filter((g) => {
      if (!name) return true;
      const white = (g.white || '').toLowerCase().includes(name);
      const black = (g.black || '').toLowerCase().includes(name);
      return color === 'w' ? white : black;
    });
  }

  function exportRep(rep) {
    const lines = treeLines(rep.tree, 4000);
    const text = lines.map((line) => buildPGN({
      headers: { Event: rep.name, White: rep.color === 'w' ? 'Repertoire' : '?', Black: rep.color === 'w' ? '?' : 'Repertoire' },
      moves: line,
    })).join('\n');
    download(`${exportName('repertoire-' + rep.name.replace(/\W+/g, '-').slice(0, 30))}.pgn`, text, 'application/x-chess-pgn');
    toast(`Exported ${lines.length} lines`, 'ok');
  }

  return { destroy() {} };
}

// ---------------------------------------------------------------- editor
function renderEditor(host, id, query) {
  const rep = (state.repertoires || []).find((r) => r.id === id);
  if (!rep) { host.append(el('div', { class: 'empty', text: 'Repertoire not found.' })); return { destroy() {} }; }
  const tab = query.tab === 'train' ? 'train' : 'edit';

  const top = el('div', { class: 'row', style: 'margin-bottom:10px;gap:8px;flex-wrap:wrap' },
    el('button', { class: 'btn ghost sm', html: `${icon('back')}<span>Repertoires</span>`, onclick: () => navigate('/repertoire') }),
    el('strong', { text: rep.name }),
    el('span', { class: 'badge', text: rep.color === 'w' ? 'White' : 'Black' }),
    el('div', { class: 'spacer' }),
    el('button', { class: 'btn sm' + (tab === 'edit' ? ' primary' : ''), text: 'Edit tree', onclick: () => navigate('/repertoire/' + rep.id) }),
    el('button', { class: 'btn sm' + (tab === 'train' ? ' primary' : ''), text: 'Train', onclick: () => navigate('/repertoire/' + rep.id + '?tab=train') }));
  host.append(top);
  const body = el('div');
  host.append(body);

  if (tab === 'train') {
    const lines = treeLines(rep.tree, 1);
    const st = treeStats(rep.tree);
    if (!st.nodes) {
      body.append(el('div', { class: 'empty', text: 'This repertoire has no moves yet. Add lines or import a PGN first.' }));
      return { destroy() {} };
    }
    const handle = mountOpening(body, trainerCtx(), {
      title: rep.name,
      subtitle: `<span class="badge">${rep.color === 'w' ? 'White' : 'Black'}</span> ${st.leaves} lines · opponent picks your most played replies`,
      tree: rep.tree,
      side: rep.color,
      mode: 'tree',
      progressKey: `repertoire:${rep.id}`,
      onNext: () => navigate('/repertoire/' + rep.id + '?tab=train'),
    });
    return { destroy() { handle.destroy(); } };
  }

  // ---------- edit tab ----------
  const layout = el('div', { class: 'trainer' });
  const boardCol = el('div', { class: 'board-col' });
  const sideCol = el('div', { class: 'side-col' });
  const boardHost = el('div');
  const treeCard = el('div', { class: 'card' });
  const treeBox = el('div', { class: 'tree', style: 'max-height:420px;overflow:auto' });
  const statsEl = el('div', { class: 'dim', style: 'font-size:.8rem;margin-bottom:8px' });
  const lineInput = el('input', { type: 'text', placeholder: 'Add a line: e4 c5 Nf3 d6 d4 cxd4 Nxd4' });
  const commentInput = el('textarea', { placeholder: 'Comment for the selected position', style: 'min-height:70px' });

  boardCol.append(boardHost);
  treeCard.append(
    el('div', { class: 'card-head' }, el('h3', { text: 'Move tree' }), el('div', { class: 'spacer' }),
      el('button', { class: 'btn sm', text: 'Import PGN', onclick: () => importDialog() }),
      el('button', { class: 'btn sm', text: 'From my games', onclick: () => buildDialog() })),
    statsEl, treeBox);
  sideCol.append(treeCard,
    el('div', { class: 'card' },
      el('h3', { text: 'Edit' }),
      el('div', { class: 'stack', style: 'gap:8px' },
        lineInput,
        el('div', { class: 'row' },
          el('button', { class: 'btn sm primary', text: 'Add line', onclick: addLineHandler }),
          el('button', { class: 'btn sm', text: 'Save', onclick: save })),
        commentInput,
        el('div', { class: 'row' },
          el('button', { class: 'btn sm', text: 'Save comment', onclick: saveComment }),
          el('div', { class: 'spacer' }),
          el('button', { class: 'btn sm danger', text: 'Exclude bad moves', onclick: () => badMoveDialog() })))));
  layout.append(boardCol, sideCol);
  body.append(layout);

  const board = createBoard(boardHost, {
    fen: START_FEN, orientation: rep.color, theme: state.settings.boardTheme,
    pieceSet: state.settings.pieceSet, coords: state.settings.coords, animate: false, interactive: false,
  });

  let selectedPath = [];

  function save() {
    rep.updated = Date.now();
    persist('repertoires', true);
    toast('Saved', 'ok');
  }

  function addLineHandler() {
    const raw = lineInput.value.replace(/\d+\.(\.\.)?/g, ' ').replace(/[!?]+/g, '').trim();
    if (!raw) return;
    const sans = raw.split(/\s+/);
    const res = addLine(rep.tree, sans);
    if (!res.ok) { toast(`Illegal move: ${res.at}`, 'bad'); return; }
    lineInput.value = '';
    save();
    draw();
    toast('Line added', 'ok');
  }

  function saveComment() {
    if (!selectedPath.length) { toast('Select a move first', ''); return; }
    setComment(rep.tree, selectedPath, commentInput.value);
    save();
    toast('Comment saved', 'ok');
  }

  function draw() {
    const st = treeStats(rep.tree);
    statsEl.textContent = `${st.nodes} positions · ${st.leaves} lines · max depth ${st.maxDepth} plies`;
    treeBox.innerHTML = '';
    if (!rep.tree.moves.length) {
      treeBox.append(el('div', { class: 'faint', style: 'font-size:.84rem', text: 'Empty. Add a line, import PGN, or auto-build from your games.' }));
      return;
    }
    treeBox.append(renderNode(rep.tree, [], 0));
    paintBoard(selectedPath);
  }

  function renderNode(node, path, depth) {
    const wrap = el('div', { class: 'node', style: depth === 0 ? 'border:0;padding-left:0' : '' });
    node.moves.forEach((m, i) => {
      const nextPath = path.concat(m.san);
      const label = el('div', { class: 'row tight', style: 'gap:4px' },
        el('span', {
          class: 'mv' + (m.bad ? ' bad' : ''),
          style: selectedPath.join(' ') === nextPath.join(' ') ? 'background:var(--accent-soft);color:#d8fff2' : '',
          html: `${m.san}${m.count > 1 ? ` <span class="faint">×${m.count}</span>` : ''}`,
          onclick: () => { selectedPath = nextPath; commentInput.value = (m.children && m.children.comment) || ''; draw(); },
        }),
        el('button', {
          class: 'btn ghost sm icon', style: 'padding:0 4px', title: 'Delete branch', html: icon('x'),
          onclick: (e) => {
            e.stopPropagation();
            if (!m.children || m.children.moves.length === 0 || confirm(`Delete the branch after ${m.san}?`)) {
              removeLine(rep.tree, nextPath);
              save();
              draw();
            }
          },
        }));
      wrap.append(label);
      if (m.children && m.children.moves.length) {
        wrap.append(renderNode(m.children, nextPath, depth + 1));
      }
    });
    return wrap;
  }

  function paintBoard(path) {
    let fen = START_FEN;
    let last = null;
    for (const san of path) {
      const r = applySan(fen, san);
      if (!r) break;
      fen = r.fen;
      last = { from: r.from, to: r.to };
    }
    board.setPosition(fen, { last, arrows: [], clearSelection: true });
  }

  function importDialog() {
    const area = el('textarea', { placeholder: 'Paste a PGN (one or more games, or a study export)…', style: 'min-height:200px' });
    modal({
      title: 'Import PGN into this repertoire',
      body: el('div', {},
        area,
        el('p', { class: 'faint', style: 'font-size:.78rem', text: 'All legal moves in each game are merged into the tree. Variations are ignored; comments are dropped.' })),
      actions: [
        { label: 'Cancel' },
        {
          label: 'Import', primary: true, onClick: () => {
            const games = parsePGN(area.value);
            let n = 0;
            for (const g of games) {
              if (!g.moves.length) continue;
              addLine(rep.tree, g.moves.slice(0, 40));
              n++;
            }
            if (!n) { toast('No legal moves found', 'bad'); return false; }
            save(); draw();
            toast(`Merged ${n} game(s)`, 'ok');
          },
        },
      ],
    });
  }

  function buildDialog() {
    const games = state.games || [];
    if (!games.length) {
      toast('Import your games first (My games)', 'bad');
      navigate('/coach');
      return;
    }
    const name = (state.settings.username || '').toLowerCase();
    const maxPly = el('input', { type: 'number', value: '20', min: '4', max: '60' });
    const minCount = el('input', { type: 'number', value: '2', min: '1', max: '10' });
    const excludeBad = el('input', { type: 'checkbox' });
    const threshold = el('input', { type: 'number', value: '80', min: '20', max: '400', step: '10' });
    const merge = el('input', { type: 'checkbox', checked: true });
    const info = el('div', { class: 'dim', style: 'font-size:.82rem', text: `${games.length} games available.` });
    modal({
      title: 'Auto-build repertoire from games',
      body: el('div', {},
        el('label', { class: 'field' }, el('span', { text: 'Colour' }),
          el('div', {}, el('strong', { text: rep.color === 'w' ? 'White' : 'Black' }))),
        el('div', { class: 'split' },
          el('label', { class: 'field' }, el('span', { text: 'Keep lines up to (plies)' }), maxPly),
          el('label', { class: 'field' }, el('span', { text: 'Only moves played in at least N games' }), minCount)),
        el('label', { class: 'check' }, merge, el('span', { text: 'Merge into the existing tree (otherwise replace it)' })),
        el('label', { class: 'check' }, excludeBad, el('span', { text: 'Exclude engine-flagged bad moves (slower: analyses each branch point)' })),
        el('label', { class: 'field' }, el('span', { text: 'Bad move threshold (centipawns lost vs the engine’s move)' }), threshold),
        info),
      actions: [
        { label: 'Cancel' },
        {
          label: 'Build', primary: true, onClick: async (x) => {
            const filtered = games.filter((g) => {
              if (!name) return true;
              const w = (g.white || '').toLowerCase().includes(name);
              const b = (g.black || '').toLowerCase().includes(name);
              return rep.color === 'w' ? w : b;
            });
            if (!filtered.length) { toast('No games for that colour', 'bad'); return false; }
            const target = buildFromGames(filtered, { color: rep.color, maxPly: Number(maxPly.value) || 20, minCount: Number(minCount.value) || 1 });
            const tree = merge.checked ? mergeTrees(rep.tree, target) : target;
            if (excludeBad.checked) {
              await filterBadMoves(tree, Number(threshold.value) || 80, info);
            }
            rep.tree = tree;
            save(); draw();
            toast('Repertoire built', 'ok');
          },
        },
      ],
    });
  }

  function badMoveDialog() {
    const threshold = el('input', { type: 'number', value: '80', min: '20', max: '400', step: '10' });
    const info = el('div', { class: 'dim', style: 'font-size:.82rem' });
    modal({
      title: 'Exclude bad moves',
      body: el('div', {},
        el('p', { class: 'dim', style: 'font-size:.84rem', html: 'Every position with more than one move is analysed with the engine. Moves that lose more than the threshold compared to the best move are removed — the usual clean-up after an automatic import.' }),
        el('label', { class: 'field' }, el('span', { text: 'Threshold (centipawns)' }), threshold),
        info),
      actions: [
        { label: 'Cancel' },
        {
          label: 'Run filter', primary: true, onClick: async () => {
            await filterBadMoves(rep.tree, Number(threshold.value) || 80, info);
            save(); draw();
            toast('Bad moves removed', 'ok');
          },
        },
      ],
    });
  }

  async function filterBadMoves(tree, maxLoss, infoEl) {
    const nodes = [];
    const walk = (node) => {
      if (node.moves && node.moves.length > 1) nodes.push(node);
      for (const m of node.moves || []) if (m.children) walk(m.children);
    };
    walk(tree);
    nodes.sort((a, b) => (b.moves[0].count || 0) - (a.moves[0].count || 0));
    const cap = nodes.slice(0, 250);
    if (infoEl) infoEl.textContent = `Analysing ${cap.length} branch point(s)…`;
    const eng = trainerCtx().engine();
    const evalMap = new Map();
    let done = 0;
    for (const node of cap) {
      try {
        const scores = await eng.evalMoves(node.fen, node.moves.map((m) => m.uci), { movetime: 140 });
        for (const [uci, cp] of scores) evalMap.set(`${node.fen}|${uci}`, cp);
      } catch (e) { /* skip on engine error */ }
      done++;
      if (infoEl && done % 5 === 0) infoEl.textContent = `Analysing… ${done}/${cap.length}`;
      if (done % 3 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    annotateLosses(tree, evalMap, maxLoss);
    const removed = dropBadMoves(tree);
    if (infoEl) infoEl.textContent = `Removed ${removed} branch(es) that lose more than ${maxLoss} cp.`;
  }

  draw();
  return { destroy() { board.destroy(); } };
}
