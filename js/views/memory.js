// js/views/memory.js — famous games database with memorisation training.

import { state, navigate, trainerCtx, persist, data } from '../app.js';
import { el, icon, toast, modal, confirmDialog } from '../ui/components.js';
import { parsePGN, buildPGN } from '../core/pgn.js';
import { sanToUci } from '../core/chessutil.js';
import { mountMemory } from '../trainers/memory.js';
import { mastery } from '../core/srs.js';
import { uid } from '../core/sets.js';
import { download, exportName } from '../core/backup.js';

export function render(host, params, query) {
  const id = params && params[0];
  if (id) return renderTrainer(host, id, query || {});
  return renderList(host);
}

function allGames() {
  const famous = data.famousGames().map((g) => ({ ...g, builtin: true }));
  return famous.concat(state.memoryGames || []);
}

function progressMap() {
  const out = {};
  for (const [k, v] of Object.entries(state.progress || {})) if (k.startsWith('memory:')) out[k] = v;
  return out;
}

function renderList(host) {
  const pm = progressMap();
  const games = allGames();
  const learned = games.filter((g) => pm['memory:' + g.id] && pm['memory:' + g.id].last === 'ok').length;

  host.append(el('div', { class: 'card', style: 'margin-bottom:14px' },
    el('div', { class: 'row', style: 'gap:16px' },
      el('div', { style: 'flex:1' },
        el('h2', { text: 'Learn a game by heart' }),
        el('p', { class: 'dim', style: 'margin:0', html: 'Study the moves, then reproduce them without looking. Recall accuracy above 80% counts as learned. Add your own games — a club game, a brilliancy, or your own — and train them the same way.' })),
      el('div', { class: 'stat', style: 'text-align:right' },
        el('span', { class: 'v', text: `${learned}/${games.length}` }),
        el('span', { class: 'k', text: 'learned' })))));

  const head = el('div', { class: 'row', style: 'margin-bottom:10px' },
    el('h3', { text: 'Game library' }), el('div', { class: 'spacer' }),
    el('button', { class: 'btn sm', html: `${icon('plus')}<span>Add game</span>`, onclick: () => addGameDialog() }),
    el('button', { class: 'btn sm ghost', html: `${icon('download')}<span>Export PGN</span>`, onclick: exportPGN }));
  host.append(head);

  const list = el('div', { class: 'list game-list' });
  host.append(list);

  const seen = new Set();
  for (const g of games) {
    if (seen.has(g.id)) continue;
    seen.add(g.id);
    const p = pm['memory:' + g.id];
    list.append(el('div', { class: 'list-item', onclick: () => navigate('/memory/' + encodeURIComponent(g.id) + '?mode=quiz') },
      el('div', { class: 't' },
        el('span', { class: 'name', text: g.name || `${g.white || '?'} – ${g.black || '?'}${g.year ? ' (' + g.year + ')' : ''}` }),
        el('span', { class: 'sub', text: `${g.white || '?'} vs ${g.black || '?'}${g.event ? ' · ' + g.event : ''} · ${(g.moves || []).length} moves` })),
      p && p.last === 'ok' ? el('span', { class: 'badge good', text: 'learned' }) : (p ? el('span', { class: 'badge', text: `${Math.min(100, (p.box || 0) * 20)}%` }) : null),
      g.builtin ? null : el('button', {
        class: 'btn ghost sm icon', html: icon('trash'),
        onclick: async (e) => {
          e.stopPropagation();
          if (await confirmDialog({ title: 'Remove game?', text: g.name || 'This will remove the game from your library.' })) {
            state.memoryGames = state.memoryGames.filter((x) => x.id !== g.id);
            persist('memoryGames', true);
            navigate('/memory');
          }
        },
      }),
      el('button', { class: 'btn sm', text: 'Study', onclick: (e) => { e.stopPropagation(); navigate('/memory/' + encodeURIComponent(g.id) + '?mode=study'); } }),
      el('button', { class: 'btn sm primary', text: 'Quiz', onclick: (e) => { e.stopPropagation(); navigate('/memory/' + encodeURIComponent(g.id) + '?mode=quiz'); } })));
  }

  host.append(el('div', { class: 'card flat', style: 'margin-top:14px' },
    el('h3', { text: 'How to memorise a game' }),
    el('ol', { class: 'dim', style: 'font-size:.86rem;margin:0;padding-left:18px' },
      el('li', { text: 'Open the game in study mode and step through it, saying the ideas out loud (or in your head).' }),
      el('li', { text: 'Switch to quiz mode for the first 10 plies, then extend the range as you get them right.' }),
      el('li', { text: 'A perfect quiz run marks the game as learned and schedules a review.' }))));

  function addGameDialog() {
    const textarea = el('textarea', { placeholder: '[Event "..."]\n[White "..."]\n\n1. e4 e5 2. Nf3 ...' });
    const nameInput = el('input', { type: 'text', placeholder: 'Optional name, e.g. “My best game 2026”' });
    const m = modal({
      title: 'Add a game to memory training',
      body: el('div', {},
        el('label', { class: 'field' }, el('span', { text: 'Name' }), nameInput),
        el('label', { class: 'field' }, el('span', { text: 'PGN' }), textarea),
        el('div', { class: 'faint', style: 'font-size:.78rem', text: 'Comments, variations and NAGs are stripped. The game is validated move by move before it is saved.' })),
      actions: [
        { label: 'Cancel' },
        {
          label: 'Add game', primary: true,
          onClick: () => {
            const parsed = parsePGN(textarea.value).filter((g) => g.moves.length > 4);
            if (!parsed.length) { toast('No legal game found in that PGN', 'bad'); return false; }
            for (const g of parsed) {
              const ucis = sanToUci(g.startFen, g.moves).ucis;
              state.memoryGames.push({
                id: uid('mem'),
                name: nameInput.value || g.headers.Event || `${g.headers.White || '?'} – ${g.headers.Black || '?'}`,
                white: g.headers.White || '?', black: g.headers.Black || '?',
                year: (g.headers.Date || '').slice(0, 4) || '', event: g.headers.Event || '',
                result: g.result, moves: g.moves, ucis, startFen: g.startFen,
                note: 'Custom game', source: 'user', updated: Date.now(),
              });
            }
            persist('memoryGames', true);
            toast(`Added ${parsed.length} game(s)`, 'ok');
            navigate('/memory');
          },
        },
      ],
    });
    return m;
  }

  function exportPGN() {
    const games = allGames().map((g) => ({
      headers: {
        Event: g.event || 'Memory training', Site: g.source || '', Date: g.year ? `${g.year}.??.??` : '????.??.??',
        White: g.white || '?', Black: g.black || '?', Result: g.result || '*',
      },
      moves: g.moves, result: g.result || '*', startFen: g.startFen,
    }));
    download(`${exportName('snart-chess-memory')}.pgn`, games.map(buildPGN).join('\n'), 'application/x-chess-pgn');
    toast('PGN exported', 'ok');
  }

  return { destroy() {} };
}

function renderTrainer(host, id, query) {
  const game = allGames().find((g) => g.id === id);
  if (!game) { host.append(el('div', { class: 'empty', text: 'Game not found.' })); return { destroy() {} }; }
  const moves = game.moves || [];

  const cfg = {
    mode: query.mode === 'study' ? 'study' : 'quiz',
    fromPly: Number(query.from || 0),
    toPly: Number(query.to || moves.length),
    side: query.side === 'w' || query.side === 'b' ? query.side : 'both',
  };

  const bar = el('div', { class: 'row', style: 'margin-bottom:10px;gap:8px' },
    el('button', { class: 'btn ghost sm', html: `${icon('back')}<span>Library</span>`, onclick: () => navigate('/memory') }),
    el('span', { class: 'dim', style: 'font-size:.82rem', text: game.name || `${game.white} – ${game.black}` }),
    el('div', { class: 'spacer' }));

  const controls = el('div', { class: 'card flat', style: 'margin-bottom:12px;display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end' });
  const modeSel = el('select', {},
    el('option', { value: 'study', text: 'Study (see the moves)' }),
    el('option', { value: 'quiz', text: 'Quiz (reproduce from memory)' }));
  modeSel.value = cfg.mode;
  const sideSel = el('select', {},
    el('option', { value: 'both', text: 'Both colours' }),
    el('option', { value: 'w', text: 'White moves only' }),
    el('option', { value: 'b', text: 'Black moves only' }));
  sideSel.value = cfg.side;
  const fromSel = el('select', {}, ...rangeOptions(0, moves.length, 2, cfg.fromPly));
  const toSel = el('select', {}, ...rangeOptions(2, moves.length + 2, 2, cfg.toPly));
  const go = el('button', { class: 'btn sm primary', text: 'Load', onclick: () => {
    navigate(`/memory/${encodeURIComponent(game.id)}?mode=${modeSel.value}&side=${sideSel.value}&from=${fromSel.value}&to=${toSel.value}`);
  } });
  controls.append(
    field('Mode', modeSel), field('Colours', sideSel), field('From ply', fromSel), field('To ply', toSel), go);

  const trainerHost = el('div');
  host.append(bar, controls, trainerHost);

  function field(label, input) {
    return el('label', { style: 'display:flex;flex-direction:column;gap:4px;font-size:.78rem;color:var(--text-dim)' },
      el('span', { text: label }), el('div', { style: 'min-width:130px' }, input));
  }
  function rangeOptions(min, max, step, current) {
    const opts = [];
    for (let i = min; i <= max; i += step) opts.push(el('option', { value: String(i), text: String(i), selected: i === current || undefined }));
    return opts;
  }

  const handle = mountMemory(trainerHost, trainerCtx(), {
    game: { ...game, ucis: game.ucis || sanToUci(game.startFen || undefined, moves).ucis },
    ...cfg,
    onNext: () => {
      const games = allGames();
      const i = games.findIndex((g) => g.id === game.id);
      const next = games[(i + 1) % games.length];
      navigate('/memory/' + encodeURIComponent(next.id) + '?mode=quiz');
    },
  });

  host.append(el('div', { class: 'card flat', style: 'margin-top:12px' },
    el('div', { class: 'row' },
      el('button', { class: 'btn sm', text: 'Export this game (PGN)', onclick: () => {
        download(`${exportName('game-' + (game.name || 'memory').replace(/\W+/g, '-').slice(0, 40))}.pgn`,
          buildPGN({ headers: { Event: game.event || '', White: game.white || '?', Black: game.black || '?', Result: game.result || '*' }, moves: game.moves, startFen: game.startFen }),
          'application/x-chess-pgn');
      } }),
      el('span', { class: 'faint', style: 'font-size:.78rem', text: game.source ? `Source: ${game.source}` : '' }))));

  return { destroy() { handle.destroy(); } };
}
