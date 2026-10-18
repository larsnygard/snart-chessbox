// js/views/repertoire.js — build, browse, edit and train your own repertoire.
//
// Three ways in:
//   * empty tree, add lines by hand or from the opening database
//   * import PGN (a study, a course export, your own games)
//   * auto-build from your imported game library, keeping the branches you
//     actually play and optionally dropping engine-flagged bad moves
//
// Browse shows every continuation of the current position as an arrow on the
// board. Edit lets you jump to any move, annotate it, replace or delete it, and
// turns any new move played on the board into a new variation.

import { state, navigate, persist, trainerCtx } from '../app.js';
import { el, icon, toast, modal, confirmDialog } from '../ui/components.js';
import { parsePGN, buildPGN } from '../core/pgn.js';
import { emptyTree, addLine, buildFromGames, treeLines, treeStats, annotateLosses, dropBadMoves, mergeTrees } from '../core/repertoire.js';
import { uid } from '../core/sets.js';
import { createExplorer } from '../ui/explorer.js';
import { mountOpening } from '../trainers/opening.js';
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
        el('p', { class: 'dim', style: 'margin:0', html: 'A repertoire is a move tree for one colour. Import it from PGN, build it automatically from your own games, or add lines by hand. <b>Browse</b> shows every continuation of a position as an arrow; <b>Edit</b> turns any new move into a new variation.' })),
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
          el('button', { class: 'btn sm', text: 'Browse', onclick: () => navigate('/repertoire/' + rep.id + '?tab=browse') }),
          el('button', { class: 'btn sm', text: 'Edit', onclick: () => navigate('/repertoire/' + rep.id + '?tab=edit') }),
          el('button', { class: 'btn sm primary', text: 'Train', onclick: () => navigate('/repertoire/' + rep.id + '?tab=train') }),
          el('div', { class: 'spacer' }),
          el('button', { class: 'btn sm ghost', text: 'PGN', onclick: () => exportRep(rep) }),
          el('button', {
            class: 'btn sm ghost icon', html: icon('trash'), title: 'Delete', onclick: async () => {
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
    const options = el('div', { class: 'split hidden' });
    const maxPly = el('input', { type: 'number', value: '20', min: '4', max: '60' });
    const minCount = el('input', { type: 'number', value: '1', min: '1', max: '20' });
    options.append(
      el('label', { class: 'field' }, el('span', { text: 'Include up to (plies)' }), maxPly),
      el('label', { class: 'field' }, el('span', { text: 'Only moves seen in at least N games' }), minCount));
    source.addEventListener('change', () => {
      pgnArea.classList.toggle('hidden', source.value !== 'pgn');
      options.classList.toggle('hidden', source.value !== 'games');
    });

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
            navigate('/repertoire/' + trep.id + '?tab=browse');
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
  const tab = ['browse', 'edit', 'train'].includes(query.tab) ? query.tab : 'browse';

  let explorer = null;
  let trainer = null;

  const tabsRow = el('div', { class: 'row', style: 'gap:6px' });
  const actionsRow = el('div', { class: 'row', style: 'gap:6px;margin-left:auto' });

  const top = el('div', { class: 'row', style: 'margin-bottom:10px;gap:8px;flex-wrap:wrap' },
    el('button', { class: 'btn ghost sm', html: `${icon('back')}<span>Repertoires</span>`, onclick: () => navigate('/repertoire') }),
    el('strong', { text: rep.name }),
    el('span', { class: 'badge', text: rep.color === 'w' ? 'White' : 'Black' }),
    tabsRow, actionsRow);
  const body = el('div');
  host.append(top, body);

  function drawChrome() {
    tabsRow.innerHTML = '';
    for (const [key, label] of [['browse', 'Browse'], ['edit', 'Edit'], ['train', 'Train']]) {
      tabsRow.append(el('button', {
        class: 'btn sm' + (tab === key ? ' primary' : ''), text: label,
        onclick: () => navigate(`/repertoire/${rep.id}?tab=${key}`),
      }));
    }
    actionsRow.innerHTML = '';
    if (tab !== 'train') {
      actionsRow.append(
        el('button', { class: 'btn sm', text: 'Import PGN', onclick: () => importDialog() }),
        el('button', { class: 'btn sm', text: 'From my games', onclick: () => buildDialog() }),
        el('button', { class: 'btn sm danger', text: 'Exclude bad moves', onclick: () => badMoveDialog() }));
    }
  }

  function mountTab() {
    if (explorer) { explorer.destroy(); explorer = null; }
    if (trainer) { trainer.destroy(); trainer = null; }
    body.innerHTML = '';
    if (tab === 'train') {
      const st = treeStats(rep.tree);
      if (!st.nodes) {
        body.append(el('div', { class: 'empty', text: 'This repertoire has no moves yet. Add lines or import a PGN first.' }));
        return;
      }
      trainer = mountOpening(body, trainerCtx(), {
        title: rep.name,
        subtitle: `<span class="badge">${rep.color === 'w' ? 'White' : 'Black'}</span> ${st.leaves} lines · the opponent picks your most-played replies`,
        tree: rep.tree,
        side: rep.color,
        mode: 'tree',
        progressKey: `repertoire:${rep.id}`,
        onNext: () => navigate('/repertoire/' + rep.id + '?tab=train'),
      });
      return;
    }
    explorer = createExplorer(body, {
      tree: rep.tree,
      editable: tab === 'edit',
      settings: state.settings,
      engine: trainerCtx().engine,
      title: tab === 'edit' ? 'Edit repertoire' : 'Browse repertoire',
      onChange: () => { rep.updated = Date.now(); persist('repertoires', true); },
      onPlayFromHere: (fen, turn) => navigate(`/coach?fen=${encodeURIComponent(fen)}&side=${turn}&title=${encodeURIComponent('From your repertoire')}`),
    });
  }

  // ---------- tree-level dialogs
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
            rep.updated = Date.now();
            persist('repertoires', true);
            if (explorer) explorer.refresh();
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
          label: 'Build', primary: true, onClick: async () => {
            const name = (state.settings.username || '').toLowerCase();
            const filtered = games.filter((g) => {
              if (!name) return true;
              const w = (g.white || '').toLowerCase().includes(name);
              const b = (g.black || '').toLowerCase().includes(name);
              return rep.color === 'w' ? w : b;
            });
            if (!filtered.length) { toast('No games for that colour', 'bad'); return false; }
            const target = buildFromGames(filtered, { color: rep.color, maxPly: Number(maxPly.value) || 20, minCount: Number(minCount.value) || 1 });
            const tree = merge.checked ? mergeTrees(rep.tree, target) : target;
            if (excludeBad.checked) await filterBadMoves(tree, Number(threshold.value) || 80, info);
            rep.tree = tree;
            rep.updated = Date.now();
            persist('repertoires', true);
            if (explorer) explorer.refresh();
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
            rep.updated = Date.now();
            persist('repertoires', true);
            if (explorer) explorer.refresh();
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

  drawChrome();
  mountTab();
  return { destroy() { if (explorer) explorer.destroy(); if (trainer) trainer.destroy(); } };
}
