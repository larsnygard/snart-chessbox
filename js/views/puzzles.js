// js/views/puzzles.js — puzzle browser with theme filters and a session runner.

import { state, navigate, trainerCtx, data } from '../app.js';
import { el, icon, toast, shuffle } from '../ui/components.js';
import { puzzleThemes, filterPuzzles, PUZZLE_THEME_LABELS } from '../ui/data.js';
import { mountPuzzle } from '../trainers/puzzle.js';
import { mastery } from '../core/srs.js';

const RATINGS = [
  { label: 'Any', min: 0, max: 9999 },
  { label: '≤ 1000', min: 0, max: 1000 },
  { label: '1000–1400', min: 1000, max: 1400 },
  { label: '1400–1800', min: 1400, max: 1800 },
  { label: '1800–2200', min: 1800, max: 2200 },
  { label: '≥ 1800', min: 1800, max: 9999 },
];

export function render(host, params, query) {
  const single = query && query.single;
  const multi = single ? [] : (query.themes || '').split(',').filter(Boolean);

  const filterCard = el('div', { class: 'card', style: 'margin-bottom:14px' });
  const trainerHost = el('div');
  const progressRow = el('div', { class: 'row', style: 'margin-bottom:10px' });
  host.append(filterCard, progressRow, trainerHost);

  const selected = new Set(multi);
  const ratingIdx = { i: 2 };
  const count = { n: Number(query.count || 10) };
  let queue = [];
  let index = 0;
  let handle = null;

  function buildFilters() {
    filterCard.innerHTML = '';
    const themes = puzzleThemes();
    const head = el('div', { class: 'card-head' },
      el('h2', { text: 'Puzzle trainer' }),
      el('div', { class: 'spacer' }),
      el('span', { class: 'badge', text: `${data.puzzles().length} puzzles bundled` }));
    const chips = el('div', { class: 'filters', style: 'margin-bottom:12px' });
    for (const t of themes.slice(0, 22)) {
      const c = el('button', {
        class: 'chip' + (selected.has(t.theme) ? ' on' : ''),
        html: `${t.label} <span class="faint">${t.count}</span>`,
        onclick: () => {
          if (selected.has(t.theme)) selected.delete(t.theme); else selected.add(t.theme);
          buildFilters();
        },
      });
      chips.append(c);
    }
    const ratingChips = el('div', { class: 'filters', style: 'margin-bottom:12px' });
    RATINGS.forEach((r, i) => {
      ratingChips.append(el('button', {
        class: 'chip' + (i === ratingIdx.i ? ' on' : ''),
        text: r.label,
        onclick: () => { ratingIdx.i = i; buildFilters(); },
      }));
    });
    const countChips = el('div', { class: 'filters' });
    [5, 10, 20, 30].forEach((n) => {
      countChips.append(el('button', {
        class: 'chip' + (n === count.n ? ' on' : ''), text: `${n} puzzles`,
        onclick: () => { count.n = n; buildFilters(); },
      }));
    });
    const startBtn = el('button', { class: 'btn primary', html: `${icon('play')}<span>Start session</span>`, onclick: start });
    head.append(startBtn);
    filterCard.append(head,
      el('div', { class: 'dim', style: 'font-size:.8rem;margin-bottom:6px', text: 'Themes' }), chips,
      el('div', { class: 'dim', style: 'font-size:.8rem;margin-bottom:6px', text: 'Difficulty' }), ratingChips,
      el('div', { class: 'dim', style: 'font-size:.8rem;margin-bottom:6px', text: 'Session length' }), countChips,
      el('div', { class: 'faint', style: 'font-size:.78rem;margin-top:12px', text: selected.size ? `Matching puzzles: ${poolSize()}` : 'No theme selected — puzzles will be mixed from the whole set.' }));
  }

  function poolSize() {
    const r = RATINGS[ratingIdx.i];
    return filterPuzzles({ themes: [...selected], minRating: r.min, maxRating: r.max, limit: 5000 }).length;
  }

  function start() {
    const r = RATINGS[ratingIdx.i];
    const pool = filterPuzzles({ themes: [...selected], minRating: r.min, maxRating: r.max, limit: 800 });
    if (!pool.length) { toast('No puzzles match those filters', 'bad'); return; }
    queue = shuffle(pool).slice(0, count.n);
    index = 0;
    filterCard.classList.add('hidden');
    showCurrent();
  }

  function showCurrent() {
    if (index >= queue.length) return endSession();
    if (handle) { handle.destroy(); handle = null; }
    trainerHost.innerHTML = '';
    progressRow.classList.remove('hidden');
    progressRow.innerHTML = '';
    progressRow.append(
      el('span', { class: 'badge', text: `Puzzle ${index + 1} / ${queue.length}` }),
      el('div', { class: 'meter', style: 'flex:1;max-width:260px' }, el('i', { style: `width:${((index) / queue.length) * 100}%` })),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn ghost sm', text: 'End session', onclick: () => endSession() }));
    handle = mountPuzzle(trainerHost, trainerCtx(), {
      puzzle: queue[index],
      onNext: () => { index++; showCurrent(); },
      onDone: () => { /* recorded inside the trainer */ },
    });
  }

  function endSession() {
    if (handle) { handle.destroy(); handle = null; }
    progressRow.classList.add('hidden');
    trainerHost.innerHTML = '';
    filterCard.classList.remove('hidden');
    const sub = {};
    for (const [k, v] of Object.entries(state.progress)) if (k.startsWith('puzzle:')) sub[k] = v;
    toast(`Session finished · ${mastery(sub)}% overall mastery`, 'ok');
    buildFilters();
  }

  if (single) {
    const p = data.puzzles().find((x) => x.id === single);
    if (p) {
      queue = [p]; index = 0;
      filterCard.classList.add('hidden');
      showCurrent();
      return { destroy() { if (handle) handle.destroy(); } };
    }
  }

  const intro = el('div', { class: 'card', style: 'margin-bottom:14px' },
    el('div', { class: 'row', style: 'gap:14px' },
      el('div', { style: 'flex:1' },
        el('h2', { text: 'Tactics, by theme' }),
        el('p', { class: 'dim', style: 'margin:0', html: 'Puzzles come from the Lichess puzzle database (CC0) and are replayed with chess.js when the dataset is built, so every solution line is legal. Filter by mating pattern, motif or difficulty.' })),
      el('div', { class: 'stat' },
        el('span', { class: 'v', text: `${state.progress ? Object.keys(state.progress).filter((k) => k.startsWith('puzzle:')).length : 0}` }),
        el('span', { class: 'k', text: 'attempted' }))));

  host.insertBefore(intro, filterCard);
  buildFilters();

  return { destroy() { if (handle) handle.destroy(); } };
}
