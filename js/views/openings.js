// js/views/openings.js — browse the bundled opening database and train a line.

import { state, navigate, trainerCtx, data } from '../app.js';
import { el, icon, debounce, toast } from '../ui/components.js';
import { searchOpenings, openingById } from '../ui/data.js';
import { mountOpening, sansToUcis } from '../trainers/opening.js';
import { mastery } from '../core/srs.js';
import { START_FEN } from '../core/chessutil.js';

export function render(host, params, query) {
  const id = params && params[0];
  if (id) return renderTrainer(host, id, query || {});
  return renderBrowser(host);
}

function renderBrowser(host) {
  const progress = state.progress || {};
  const openingProgress = {};
  for (const [k, v] of Object.entries(progress)) if (k.startsWith('opening:')) openingProgress[k] = v;

  const card = el('div', { class: 'card', style: 'margin-bottom:14px' });
  const listBox = el('div', { class: 'list', style: 'max-height:none' });
  const countEl = el('span', { class: 'badge' });

  const filters = { q: '', eco: '', maxPlies: 0 };

  const input = el('input', { type: 'search', placeholder: 'Search 3,300+ named openings — “Najdorf”, “London”, “King’s Indian”…', oninput: debounce((e) => { filters.q = e.target.value; rebuild(); }, 160) });
  const ecoRow = el('div', { class: 'filters' });
  for (const eco of ['', 'A', 'B', 'C', 'D', 'E']) {
    ecoRow.append(el('button', {
      class: 'chip' + (filters.eco === eco ? ' on' : ''), text: eco ? eco + 'xx' : 'All ECO',
      onclick: (e) => { filters.eco = eco; for (const c of ecoRow.children) c.classList.remove('on'); e.target.classList.add('on'); rebuild(); },
    }));
  }
  const depthRow = el('div', { class: 'filters' });
  for (const [label, n] of [['Any length', 0], ['≤ 6 plies', 6], ['≤ 10 plies', 10], ['≤ 16 plies', 16]]) {
    depthRow.append(el('button', {
      class: 'chip' + (filters.maxPlies === n ? ' on' : ''), text: label,
      onclick: (e) => { filters.maxPlies = n; for (const c of depthRow.children) c.classList.remove('on'); e.target.classList.add('on'); rebuild(); },
    }));
  }

  card.append(
    el('div', { class: 'card-head' },
      el('h2', { text: 'Opening database' }), countEl, el('div', { class: 'spacer' }),
      el('span', { class: 'badge', text: `${mastery(openingProgress)}% trained` })),
    el('p', { class: 'dim', style: 'font-size:.85rem;margin-top:0', html: 'Lines and names from the Lichess opening database (CC0). Pick a side and reproduce your moves; the opponent\'s moves autoplay from the book.' }),
    el('div', { class: 'searchrow', style: 'margin-bottom:10px' }, input),
    ecoRow, el('div', { style: 'height:8px' }), depthRow,
  );

  host.append(card, listBox);

  function rebuild() {
    const list = searchOpenings(filters.q, { eco: filters.eco, maxPlies: filters.maxPlies, limit: filters.q || filters.eco || filters.maxPlies ? 300 : 120 });
    countEl.textContent = `${list.length} shown`;
    listBox.innerHTML = '';
    if (!list.length) { listBox.append(el('div', { class: 'empty', text: 'No openings match that search.' })); return; }
    for (const o of list) listBox.append(row(o));
  }

  function row(o) {
    const w = progress['opening:' + o.id + ':w'];
    const b = progress['opening:' + o.id + ':b'];
    const marks = [];
    if (w && w.last === 'ok') marks.push('W');
    if (b && b.last === 'ok') marks.push('B');
    return el('div', { class: 'list-item', style: 'align-items:center' },
      el('span', { class: 'eco', text: o.eco }),
      el('div', { class: 't' },
        el('span', { class: 'name', text: o.name }),
        el('span', { class: 'sub', text: o.moves.join(' ') })),
      marks.length ? el('span', { class: 'badge good', text: marks.join('+') }) : null,
      el('span', { class: 'faint', style: 'font-size:.75rem;width:44px;text-align:right', text: `${o.plies}p` }),
      el('button', { class: 'btn sm', text: 'White', onclick: (e) => { e.stopPropagation(); navigate('/openings/' + encodeURIComponent(o.id) + '?side=w'); } }),
      el('button', { class: 'btn sm', text: 'Black', onclick: (e) => { e.stopPropagation(); navigate('/openings/' + encodeURIComponent(o.id) + '?side=b'); } }));
  }

  rebuild();
  return { destroy() {} };
}

function renderTrainer(host, id, query) {
  const opening = openingById(id);
  if (!opening) { host.append(el('div', { class: 'empty', text: 'Unknown opening line.' })); return { destroy() {} }; }
  const side = query.side === 'b' ? 'b' : query.side === 'w' ? 'w' : (opening.moves.length % 2 === 0 ? 'b' : 'w');

  // neighbours in the database, for "next line"
  const all = data.openings();
  const idx = all.findIndex((o) => o.id === opening.id);
  const similar = all.filter((o) => o.moves[0] === opening.moves[0] && Math.abs(o.plies - opening.plies) <= 2);

  const bar = el('div', { class: 'row', style: 'margin-bottom:10px' },
    el('button', { class: 'btn ghost sm', html: `${icon('back')}<span>Openings</span>`, onclick: () => navigate('/openings') }),
    el('span', { class: 'dim', style: 'font-size:.82rem', text: `${opening.eco} · ${opening.name}` }),
    el('div', { class: 'spacer' }),
    el('button', {
      class: 'btn sm', text: side === 'w' ? 'Switch to Black' : 'Switch to White',
      onclick: () => navigate('/openings/' + encodeURIComponent(opening.id) + '?side=' + (side === 'w' ? 'b' : 'w')),
    }));
  const trainerHost = el('div');
  host.append(bar, trainerHost);

  const handle = mountOpening(trainerHost, trainerCtx(), {
    title: opening.name,
    subtitle: `<span class="badge">${opening.eco}</span> ${opening.moves.length} plies · you play ${side === 'w' ? 'White' : 'Black'} · hints ${state.settings.hints ? 'on' : 'off'}`,
    line: { sans: opening.moves, ucis: sansToUcis(START_FEN, opening.moves) },
    side,
    mode: 'line',
    progressKey: `opening:${opening.id}:${side}`,
    onNext: () => {
      if (!similar.length) return toast('No similar line found', '');
      let i = similar.findIndex((o) => o.id === opening.id);
      i = i < 0 ? 0 : (i + 1) % similar.length;
      navigate('/openings/' + encodeURIComponent(similar[i].id) + '?side=' + side);
    },
    onDone: (res) => { if (res.clean) toast('Clean run — line recorded', 'ok'); },
  });

  const extra = el('div', { class: 'card flat', style: 'margin-top:12px' },
    el('h3', { text: 'About this line' }),
    el('div', { class: 'dim', style: 'font-size:.84rem' },
      el('p', { text: `${opening.name} (${opening.eco}) — ${opening.moves.length} plies deep.` }),
      el('div', { class: 'mono', style: 'font-size:.8rem;color:var(--text-dim)', text: opening.moves.join(' ') })),
    el('div', { class: 'row', style: 'margin-top:10px' },
      el('button', { class: 'btn sm', text: 'Add to a repertoire', onclick: () => addToRepertoire(opening, side) }),
      el('button', { class: 'btn sm', text: 'Copy FEN', onclick: () => { navigator.clipboard && navigator.clipboard.writeText(opening.fen); toast('FEN copied'); } })));
  host.append(extra);

  return { destroy() { handle.destroy(); } };
}

function addToRepertoire(opening, side) {
  if (!state.repertoires.length) {
    toast('Create a repertoire first', '');
    navigate('/repertoire');
    return;
  }
  const target = state.repertoires[0];
  import('../core/repertoire.js').then(({ addLine }) => {
    const res = addLine(target.tree, opening.moves);
    target.updated = Date.now();
    import('../app.js').then(({ persist }) => persist('repertoires', true));
    toast(res.ok ? `Added to “${target.name}”` : 'Could not add that line', res.ok ? 'ok' : 'bad');
  });
}
