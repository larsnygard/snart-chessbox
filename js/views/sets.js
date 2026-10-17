// js/views/sets.js — exercise sets: the user-defined training programmes.

import { state, navigate, persist, data } from '../app.js';
import { el, icon, toast, modal, confirmDialog } from '../ui/components.js';
import { makeSet, makeItem, describeItem, estimateMinutes, KIND_LABEL, ITEM_KINDS } from '../core/sets.js';
import { ENDGAME_DRILLS, ENDGAME_GROUPS } from '../core/endgames.js';
import { searchOpenings, PUZZLE_THEME_LABELS, puzzleThemes } from '../ui/data.js';
import { uid } from '../core/sets.js';

function ctxData() {
  return {
    openings: data.openings(),
    drills: ENDGAME_DRILLS,
    puzzles: data.puzzles(),
    games: (state.memoryGames || []).concat(data.famousGames()),
  };
}

export function render(host, params) {
  const id = params && params[0];
  if (id) return renderEditor(host, id);
  return renderList(host);
}

function renderList(host) {
  host.append(el('div', { class: 'card', style: 'margin-bottom:14px' },
    el('div', { class: 'row', style: 'gap:16px' },
      el('div', { style: 'flex:1' },
        el('h2', { text: 'Exercise sets' }),
        el('p', { class: 'dim', style: 'margin:0', html: 'A set is an ordered list of exercises: opening lines, endgame drills, puzzle runs, memory games, positions from your own games. Start a set and the app walks you through it, recording each item for the review scheduler.' })),
      el('button', { class: 'btn primary', html: `${icon('plus')}<span>New set</span>`, onclick: () => createSet() }))));

  const grid = el('div', { class: 'grid cols-2' });
  host.append(grid);
  const ctx = ctxData();
  for (const set of state.sets) {
    grid.append(el('div', { class: 'card' },
      el('div', { class: 'card-head' },
        el('strong', { text: set.name }),
        set.builtin ? el('span', { class: 'badge', text: 'built-in' }) : null,
        el('div', { class: 'spacer' }),
        el('span', { class: 'faint', style: 'font-size:.75rem', text: `${(set.items || []).length} ${(set.items || []).length === 1 ? 'item' : 'items'} · ~${estimateMinutes(set)} min` })),
      el('div', { class: 'dim', style: 'font-size:.82rem;min-height:2.6em', text: set.description || '' }),
      el('div', { class: 'pill-row', style: 'margin-bottom:10px' },
        ...(set.items || []).slice(0, 4).map((it) => el('span', { class: 'chip static', text: describeItem(it, ctx) }))),
      el('div', { class: 'row tight' },
        el('button', { class: 'btn sm primary', text: 'Start', onclick: () => navigate('/session/' + set.id) }),
        el('button', { class: 'btn sm', text: 'Edit', onclick: () => navigate('/sets/' + set.id) }),
        el('button', { class: 'btn sm ghost', text: 'Duplicate', onclick: () => duplicate(set) }),
        el('div', { class: 'spacer' }),
        el('button', {
          class: 'btn sm ghost icon', html: icon('trash'), onclick: async () => {
            if (await confirmDialog({ title: 'Delete set?', text: set.name })) {
              state.sets = state.sets.filter((s) => s.id !== set.id);
              persist('sets', true);
              navigate('/sets');
            }
          },
        }))));
  }

  function createSet() {
    const s = makeSet({ name: 'My training set', description: '' });
    state.sets.push(s);
    persist('sets', true);
    navigate('/sets/' + s.id);
  }

  function duplicate(set) {
    const copy = JSON.parse(JSON.stringify(set));
    copy.id = uid('set');
    copy.name = set.name + ' (copy)';
    copy.builtin = false;
    copy.items = (copy.items || []).map((i) => ({ ...i, id: uid('it') }));
    state.sets.push(copy);
    persist('sets', true);
    navigate('/sets');
  }

  return { destroy() {} };
}

function renderEditor(host, id) {
  const set = state.sets.find((s) => s.id === id);
  if (!set) { host.append(el('div', { class: 'empty', text: 'Set not found.' })); return { destroy() {} }; }
  const ctx = ctxData();

  const name = el('input', { type: 'text', value: set.name });
  const desc = el('input', { type: 'text', value: set.description || '' });
  const itemsBox = el('div', { class: 'list' });
  const statsEl = el('span', { class: 'badge' });

  host.append(el('div', { class: 'row', style: 'margin-bottom:12px' },
    el('button', { class: 'btn ghost sm', html: `${icon('back')}<span>Sets</span>`, onclick: () => navigate('/sets') }),
    el('div', { class: 'spacer' }),
    el('button', { class: 'btn sm', text: 'Save', onclick: save }),
    el('button', { class: 'btn sm primary', text: 'Start session', onclick: () => { save(); navigate('/session/' + set.id); } })));

  host.append(el('div', { class: 'card', style: 'margin-bottom:14px' },
    el('label', { class: 'field' }, el('span', { text: 'Name' }), name),
    el('label', { class: 'field' }, el('span', { text: 'Description' }), desc),
    el('div', { class: 'row' }, statsEl)));

  const listCard = el('div', { class: 'card' },
    el('div', { class: 'card-head' },
      el('h3', { text: 'Exercises' }), el('div', { class: 'spacer' }),
      el('button', { class: 'btn sm primary', html: `${icon('plus')}<span>Add exercise</span>`, onclick: addDialog })),
    itemsBox);
  host.append(listCard);

  function save() {
    set.name = name.value || 'Untitled set';
    set.description = desc.value;
    set.updated = Date.now();
    if (!set.builtin) { /* built-ins stay editable, the marker just informs */ }
    persist('sets', true);
    toast('Set saved', 'ok');
    draw();
  }

  function draw() {
    statsEl.textContent = `${(set.items || []).length} items · ~${estimateMinutes(set)} min`;
    itemsBox.innerHTML = '';
    if (!set.items || !set.items.length) {
      itemsBox.append(el('div', { class: 'empty', text: 'No exercises yet — add one.' }));
      return;
    }
    set.items.forEach((item, i) => {
      itemsBox.append(el('div', { class: 'list-item', style: 'cursor:default' },
        el('span', { class: 'faint mono', style: 'width:22px', text: String(i + 1) }),
        el('div', { class: 't' },
          el('span', { class: 'name', text: describeItem(item, ctx) }),
          el('span', { class: 'sub', text: KIND_LABEL[item.kind] || item.kind })),
        el('button', { class: 'btn ghost sm icon', html: icon('back'), style: 'transform:rotate(90deg)', onclick: () => { swap(i, -1); } }),
        el('button', { class: 'btn ghost sm icon', html: icon('next'), style: 'transform:rotate(90deg)', onclick: () => { swap(i, 1); } }),
        el('button', { class: 'btn ghost sm icon', html: icon('x'), onclick: () => remove(i) })));
    });
  }

  function swap(i, delta) {
    const j = i + delta;
    if (j < 0 || j >= set.items.length) return;
    [set.items[i], set.items[j]] = [set.items[j], set.items[i]];
    persist('sets', true);
    draw();
  }
  function remove(i) {
    set.items.splice(i, 1);
    persist('sets', true);
    draw();
  }

  function addDialog() {
    const kindSel = el('select', {}, ...ITEM_KINDS.filter((k) => k !== 'position' || true).map((k) => el('option', { value: k, text: KIND_LABEL[k] })));
    const body = el('div');
    const addBtn = { label: 'Add', primary: true, onClick: () => { add(); } };

    const m = modal({ title: 'Add exercise', body: el('div', {}, el('label', { class: 'field' }, el('span', { text: 'Type' }), kindSel), body), actions: [{ label: 'Cancel' }, addBtn], wide: true });
    kindSel.addEventListener('change', () => formFor(kindSel.value));
    formFor('opening');

    let collector = () => null;

    function formFor(kind) {
      body.innerHTML = '';
      collector = () => null;
      if (kind === 'opening') {
        const search = el('input', { type: 'search', placeholder: 'Search openings…' });
        const results = el('div', { class: 'list', style: 'max-height:240px;overflow:auto' });
        const side = el('select', {}, el('option', { value: 'w', text: 'Train as White' }), el('option', { value: 'b', text: 'Train as Black' }));
        let chosen = null;
        const draw = () => {
          results.innerHTML = '';
          for (const o of searchOpenings(search.value, { limit: 25 })) {
            results.append(el('div', {
              class: 'list-item' + (chosen && chosen.id === o.id ? ' sel' : ''),
              onclick: () => { chosen = o; draw(); },
            }, el('span', { class: 'eco', text: o.eco }), el('div', { class: 't' },
              el('span', { class: 'name', text: o.name }),
              el('span', { class: 'sub', text: o.moves.join(' ') }))));
          }
        };
        search.addEventListener('input', draw);
        draw();
        body.append(search, el('div', { style: 'height:8px' }), results, el('label', { class: 'field', style: 'margin-top:10px' }, el('span', { text: 'Side' }), side));
        collector = () => chosen ? [makeItem('opening', chosen.id, { side: side.value })] : [];
      } else if (kind === 'repertoire') {
        if (!state.repertoires.length) { body.append(el('div', { class: 'empty', text: 'No repertoire yet.' })); return; }
        const sel = el('select', {}, ...state.repertoires.map((r) => el('option', { value: r.id, text: r.name })));
        body.append(el('label', { class: 'field' }, el('span', { text: 'Repertoire' }), sel));
        collector = () => [makeItem('repertoire', sel.value)];
      } else if (kind === 'endgame') {
        const boxes = el('div', { class: 'list', style: 'max-height:300px;overflow:auto' });
        const checked = new Set();
        for (const g of ENDGAME_GROUPS) {
          boxes.append(el('div', { class: 'faint', style: 'font-size:.75rem;margin-top:6px', text: g.title }));
          for (const d of ENDGAME_DRILLS.filter((x) => x.group === g.id)) {
            const cb = el('input', { type: 'checkbox' });
            cb.addEventListener('change', () => { if (cb.checked) checked.add(d.id); else checked.delete(d.id); });
            boxes.append(el('label', { class: 'check' }, cb, el('span', { text: d.title })));
          }
        }
        body.append(boxes);
        collector = () => [...checked].map((id2) => makeItem('endgame', id2));
      } else if (kind === 'puzzles') {
        const themes = puzzleThemes();
        const chips = el('div', { class: 'filters' });
        const sel = new Set();
        for (const t of themes.slice(0, 20)) {
          chips.append(el('button', {
            class: 'chip', html: `${t.label} <span class="faint">${t.count}</span>`,
            onclick: (e) => {
              if (sel.has(t.theme)) { sel.delete(t.theme); e.currentTarget.classList.remove('on'); }
              else { sel.add(t.theme); e.currentTarget.classList.add('on'); }
            },
          }));
        }
        const count = el('input', { type: 'number', value: '10', min: '1', max: '50' });
        body.append(chips, el('label', { class: 'field', style: 'margin-top:10px' }, el('span', { text: 'How many puzzles' }), count));
        collector = () => [makeItem('puzzles', null, { themes: [...sel], count: Number(count.value) || 10 })];
      } else if (kind === 'puzzle') {
        const idInput = el('input', { type: 'text', placeholder: 'Puzzle id, e.g. 00sHx' });
        body.append(el('label', { class: 'field' }, el('span', { text: 'Puzzle id' }), idInput));
        collector = () => (idInput.value.trim() ? [makeItem('puzzle', idInput.value.trim())] : []);
      } else if (kind === 'memory') {
        const games = ctx.games;
        if (!games.length) { body.append(el('div', { class: 'empty', text: 'No games in the memory library.' })); return; }
        const sel = el('select', {}, ...games.map((g) => el('option', { value: g.id, text: g.name || `${g.white} – ${g.black}` })));
        const from = el('input', { type: 'number', value: '0', min: '0' });
        const to = el('input', { type: 'number', value: '40', min: '2' });
        const side = el('select', {}, el('option', { value: 'both', text: 'Both colours' }), el('option', { value: 'w', text: 'White' }), el('option', { value: 'b', text: 'Black' }));
        body.append(
          el('label', { class: 'field' }, el('span', { text: 'Game' }), sel),
          el('div', { class: 'split' },
            el('label', { class: 'field' }, el('span', { text: 'From ply' }), from),
            el('label', { class: 'field' }, el('span', { text: 'To ply' }), to)),
          el('label', { class: 'field' }, el('span', { text: 'Colours' }), side));
        collector = () => [makeItem('memory', sel.value, { fromPly: Number(from.value) || 0, toPly: Number(to.value) || 40, side: side.value })];
      } else if (kind === 'review') {
        const games = (state.games || []);
        if (!games.length) { body.append(el('div', { class: 'empty', text: 'No imported games yet.' })); return; }
        const sel = el('select', {}, ...games.slice(-40).map((g, i) => el('option', { value: g.id, text: `${g.white} – ${g.black}` })));
        const ply = el('input', { type: 'number', value: '0', min: '0' });
        body.append(el('label', { class: 'field' }, el('span', { text: 'Game' }), sel),
          el('label', { class: 'field' }, el('span', { text: 'Ply to start from' }), ply));
        collector = () => [makeItem('review', sel.value, { ply: Number(ply.value) || 0 })];
      } else if (kind === 'position') {
        const fen = el('input', { type: 'text', placeholder: 'FEN of the position' });
        const goal = el('select', {}, el('option', { value: 'win', text: 'Win' }), el('option', { value: 'mate', text: 'Mate' }), el('option', { value: 'hold', text: 'Hold' }));
        const side = el('select', {}, el('option', { value: 'w', text: 'You are White' }), el('option', { value: 'b', text: 'You are Black' }));
        body.append(el('label', { class: 'field' }, el('span', { text: 'FEN' }), fen),
          el('div', { class: 'split' },
            el('label', { class: 'field' }, el('span', { text: 'Goal' }), goal),
            el('label', { class: 'field' }, el('span', { text: 'Side' }), side)));
        collector = () => (fen.value.trim() ? [makeItem('position', null, { fen: fen.value.trim(), goal: goal.value, side: side.value })] : []);
      }
    }

    function add() {
      const items = collector();
      if (!items.length) { toast('Nothing selected', 'bad'); return false; }
      set.items = (set.items || []).concat(items);
      set.updated = Date.now();
      persist('sets', true);
      draw();
      toast(`${items.length} exercise(s) added`, 'ok');
    }
  }

  draw();
  return { destroy() {} };
}
