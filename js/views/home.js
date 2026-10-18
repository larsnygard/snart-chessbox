// js/views/home.js — dashboard: what to do next, progress and ready-made plans.

import { state, navigate, persist } from '../app.js';
import { el, icon, toast } from '../ui/components.js';
import { mastery, dueItems } from '../core/srs.js';
import { estimateMinutes, describeItem } from '../core/sets.js';
import { data } from '../app.js';
import { ENDGAME_DRILLS } from '../core/endgames.js';
import { describeResume } from '../ui/resume.js';

export function render(host) {
  const s = state.settings;
  const progress = state.progress || {};

  const statFor = (prefix) => {
    const sub = {};
    for (const [k, v] of Object.entries(progress)) if (k.startsWith(prefix)) sub[k] = v;
    return { count: Object.keys(sub).length, mastery: mastery(sub), due: dueItems(sub).length };
  };
  const puzzles = statFor('puzzle:');
  const endgames = statFor('endgame:');
  const openings = statFor('opening:');
  const memories = statFor('memory:');

  const hero = el('div', { class: 'hero' },
    el('div', { style: 'flex:1' },
      el('h1', { text: s.username ? `Ready, ${s.username}?` : 'Train the positions that decide games.' }),
      el('p', { class: 'lead', html: 'Openings for both colours, endgame technique you can actually convert, tactics with themes, and the great games by heart — all against Stockfish, all offline.' }),
      el('div', { class: 'row' },
        el('button', { class: 'btn primary', html: `${icon('play')}<span>Quick start</span>`, onclick: quickStart }),
        el('button', { class: 'btn', text: 'Browse sets', onclick: () => navigate('/sets') }),
        el('button', { class: 'btn ghost', text: 'Puzzles', onclick: () => navigate('/puzzles') }),
      )),
    el('div', { class: 'card flat', style: 'min-width:210px' },
      el('div', { class: 'stat' }, el('span', { class: 'k', text: 'Due for review' }),
        el('span', { class: 'v', text: String(puzzles.due + endgames.due + openings.due + memories.due) })),
      el('div', { class: 'dim', style: 'font-size:.8rem;margin-top:6px', text: 'Items the scheduler wants to see again today.' })),
  );

  const resume = describeResume();
  const resumeCard = resume ? el('div', { class: 'card', style: 'margin:14px 0;border-color:rgba(55,185,138,.35)' },
    el('div', { class: 'row', style: 'gap:12px' },
      el('span', { html: icon('play'), style: 'color:var(--accent)' }),
      el('div', { style: 'flex:1' },
        el('strong', { text: 'Continue where you left off' }),
        el('div', { class: 'dim', style: 'font-size:.82rem', text: `${resume.label || resume.kind} · ${resume.ago}` })),
      el('button', { class: 'btn primary', text: 'Resume', onclick: () => navigate(resume.goHash || '/home') }))) : null;

  const stats = el('div', { class: 'grid cols-3', style: 'margin:18px 0' },
    statCard('Puzzles', puzzles, '/puzzles', 'puzzle'),
    statCard('Endgames', endgames, '/endgames', 'crown'),
    statCard('Opening lines', openings, '/openings', 'book'),
    statCard('Games memorised', memories, '/memory', 'brain'));

  const setsSection = el('div', { class: 'card', style: 'margin-bottom:16px' },
    el('div', { class: 'card-head' },
      el('h2', { text: 'Training plans' }),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn sm', text: 'New set', onclick: () => navigate('/sets') })),
    el('div', { class: 'grid cols-2', html: '' }));

  const setGrid = setsSection.querySelector('.grid');
  for (const set of state.sets.slice(0, 6)) {
    setGrid.append(setCard(set));
  }
  if (!state.sets.length) {
    setGrid.append(el('div', { class: 'empty', text: 'No sets yet — create one from the Sets tab.' }));
  }

  const jump = el('div', { class: 'card' },
    el('div', { class: 'card-head' }, el('h2', { text: 'Jump straight in' })),
    el('div', { class: 'grid cols-3' },
      jumpCard('Random endgame', 'A drill picked from the endgame library', 'crown', () => {
        const d = ENDGAME_DRILLS[Math.floor(Math.random() * ENDGAME_DRILLS.length)];
        navigate('/endgames/' + d.id);
      }),
      jumpCard('Ten tactics', 'Mate in one until you stop missing them', 'puzzle', () => navigate('/puzzles?themes=mateIn1&count=10&start=1')),
      jumpCard('Random opening', 'Train one line from the bundled database', 'book', () => {
        const all = data.openings();
        const pool = all.filter((o) => o.plies >= 6 && o.plies <= 12);
        const o = pool[Math.floor(Math.random() * pool.length)];
        navigate('/openings/' + encodeURIComponent(o.id) + '?side=' + (Math.random() < 0.5 ? 'w' : 'b'));
      }),
      jumpCard('Play the engine', 'Fat Fritz-free sparring at your settings', 'game', () => navigate('/coach?play=1')),
      jumpCard('Memory quiz', 'Reproduce a famous game from memory', 'brain', () => {
        const games = state.memoryGames.concat(data.famousGames());
        if (!games.length) return navigate('/memory');
        const g = games[Math.floor(Math.random() * games.length)];
        navigate('/memory/' + encodeURIComponent(g.id) + '?mode=quiz');
      }),
      jumpCard('My repertoire', 'Drill the lines you actually play', 'star', () => navigate('/repertoire')),
    ));

  host.append(hero, resumeCard || el('span'), stats, setsSection, jump);

  function quickStart() {
    const due = Object.entries(state.progress || {}).filter(([, v]) => !v.due || v.due <= Date.now());
    if (due.length) {
      const [key] = due[Math.floor(Math.random() * due.length)];
      const [kind, ...rest] = key.split(':');
      const id = rest.join(':');
      if (kind === 'puzzle') return navigate('/puzzles?single=' + encodeURIComponent(id));
      if (kind === 'endgame') return navigate('/endgames/' + encodeURIComponent(id));
      if (kind === 'memory') return navigate('/memory/' + encodeURIComponent(id) + '?mode=quiz');
      if (kind === 'opening') {
        const [oid, side] = id.split(':');
        return navigate('/openings/' + encodeURIComponent(oid) + '?side=' + (side || 'w'));
      }
    }
    const firstSet = state.sets[0];
    if (firstSet) return navigate('/session/' + firstSet.id);
    navigate('/endgames');
  }

  function statCard(label, stat, path, iconName) {
    return el('div', { class: 'card flat', style: 'cursor:pointer', onclick: () => navigate(path) },
      el('div', { class: 'row', style: 'justify-content:space-between' },
        el('span', { class: 'faint', style: 'font-size:.76rem;text-transform:uppercase;letter-spacing:.06em', text: label }),
        el('span', { html: icon(iconName), style: 'color:var(--text-faint)' })),
      el('div', { class: 'row', style: 'align-items:flex-end;gap:10px;margin-top:6px' },
        el('span', { class: 'v', style: 'font-size:1.5rem;font-weight:700', text: String(stat.count) }),
        el('span', { class: 'dim', style: 'font-size:.8rem', text: `${stat.mastery}% mastery` })),
      el('div', { class: 'meter', style: 'margin-top:8px' }, el('i', { style: `width:${stat.mastery}%` })));
  }

  function setCard(set) {
    const ctx = { openings: data.openings(), drills: ENDGAME_DRILLS, puzzles: data.puzzles(), games: state.memoryGames.concat(data.famousGames()) };
    const items = set.items || [];
    return el('div', { class: 'card flat' },
      el('div', { class: 'card-head' },
        el('strong', { class: 'name', text: set.name }),
        el('div', { class: 'spacer' }),
        el('span', { class: 'badge', text: `${items.length} ${items.length === 1 ? 'item' : 'items'}` })),
      el('div', { class: 'dim', style: 'font-size:.82rem;min-height:2.6em', text: set.description || '' }),
      el('div', { class: 'row tight', style: 'margin-top:8px' },
        el('span', { class: 'faint', style: 'font-size:.76rem', text: `~${estimateMinutes(set)} min` }),
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn sm', text: 'Edit', onclick: () => navigate('/sets/' + set.id) }),
        el('button', { class: 'btn sm primary', text: 'Start', onclick: () => navigate('/session/' + set.id) })));
  }

  function jumpCard(title, sub, iconName, onClick) {
    return el('div', { class: 'card flat', style: 'cursor:pointer', onclick: onClick },
      el('div', { class: 'row', style: 'gap:10px' },
        el('span', { html: icon(iconName), style: 'color:var(--accent)' }),
        el('strong', { text: title })),
      el('div', { class: 'dim', style: 'font-size:.82rem;margin-top:4px', text: sub }));
  }

  return { destroy() {} };
}
