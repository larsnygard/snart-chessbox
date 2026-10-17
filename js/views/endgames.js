// js/views/endgames.js — the endgame library and the drill screen.

import { state, navigate, trainerCtx } from '../app.js';
import { ENDGAME_DRILLS, ENDGAME_GROUPS, drillById, goalLabel } from '../core/endgames.js';
import { el, icon } from '../ui/components.js';
import { mountEndgame } from '../trainers/endgame.js';
import { mastery } from '../core/srs.js';
import { endgameInfo } from '../core/chessutil.js';

export function render(host, params) {
  const id = params && params[0];
  if (id) return renderDrill(host, id);
  return renderGallery(host);
}

function renderGallery(host) {
  const progress = state.progress || {};
  const solved = ENDGAME_DRILLS.filter((d) => progress['endgame:' + d.id] && progress['endgame:' + d.id].last === 'ok').length;

  host.append(el('div', { class: 'card', style: 'margin-bottom:16px' },
    el('div', { class: 'row', style: 'gap:16px' },
      el('div', { style: 'flex:1' },
        el('h2', { text: 'Endgame technique' }),
        el('p', { class: 'dim', style: 'margin:0', html: 'Every drill is a legal position with a machine-checked result. The engine defends at full strength; you have a move budget. Hints and take-backs are always available.' })),
      el('div', { class: 'stat', style: 'text-align:right' },
        el('span', { class: 'v', text: `${solved}/${ENDGAME_DRILLS.length}` }),
        el('span', { class: 'k', text: 'solved clean' })))));

  for (const group of ENDGAME_GROUPS) {
    const drills = ENDGAME_DRILLS.filter((d) => d.group === group.id);
    if (!drills.length) continue;
    const card = el('div', { class: 'card', style: 'margin-bottom:14px' },
      el('div', { class: 'card-head' },
        el('h3', { text: group.title }),
        el('span', { class: 'badge', text: `${drills.length}` }),
        el('div', { class: 'spacer' })),
      el('div', { class: 'dim', style: 'font-size:.84rem;margin-bottom:10px', text: group.blurb }),
      el('div', { class: 'grid cols-3' }));

    const grid = card.querySelector('.grid');
    for (const d of drills) {
      const p = progress['endgame:' + d.id];
      const done = p && p.last === 'ok';
      grid.append(el('div', {
        class: 'card flat', style: 'cursor:pointer;border-color:' + (done ? 'rgba(55,185,138,.35)' : 'var(--border-soft)'),
        onclick: () => navigate('/endgames/' + d.id),
      },
        el('div', { class: 'row', style: 'justify-content:space-between;gap:8px' },
          el('strong', { style: 'font-size:.92rem', text: d.title }),
          done ? el('span', { class: 'badge good', text: 'solved' }) : el('span', { class: 'badge', text: `L${d.level}` })),
        el('div', { class: 'dim', style: 'font-size:.78rem;margin-top:4px', text: `${goalLabel(d.goal)} · ${d.maxMoves} moves · ${endgameInfo(d.fen).label}` })));
    }
    host.append(card);
  }

  host.append(el('div', { class: 'card flat' },
    el('h3', { text: 'How the drills are scored' }),
    el('ul', { class: 'dim', style: 'font-size:.86rem;margin:0;padding-left:18px' },
      el('li', { text: 'A drill counts as solved only when you reach the goal on the board (mate, promotion, or the draw held).' }),
      el('li', { text: 'Using a hint still solves the drill, but it is not recorded as a clean run for the spaced-repetition schedule.' }),
      el('li', { text: 'Positions are validated with Stockfish — see tools/verify-endgames.mjs.' }))));

  return { destroy() {} };
}

function renderDrill(host, id) {
  const drill = drillById(id);
  if (!drill) { host.append(el('div', { class: 'empty', text: 'Unknown drill' })); return { destroy() {} }; }
  const list = ENDGAME_DRILLS.filter((d) => d.group === drill.group);
  const idx = list.findIndex((d) => d.id === drill.id);

  const back = el('div', { class: 'row', style: 'margin-bottom:10px' },
    el('button', { class: 'btn ghost sm', html: `${icon('back')}<span>All drills</span>`, onclick: () => navigate('/endgames') }),
    el('span', { class: 'dim', style: 'font-size:.82rem', text: `${idx + 1} of ${list.length} in ${drill.group}` }));
  const trainerHost = el('div');
  host.append(back, trainerHost);

  const handle = mountEndgame(trainerHost, trainerCtx(), {
    drill,
    onNext: () => {
      const next = list[(idx + 1) % list.length];
      navigate('/endgames/' + next.id);
    },
  });
  return { destroy() { handle.destroy(); } };
}
