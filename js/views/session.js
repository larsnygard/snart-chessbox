// js/views/session.js — run an exercise set end to end.

import { state, navigate, trainerCtx, data } from '../app.js';
import { el, icon, toast } from '../ui/components.js';
import { expandSet, describeItem, KIND_LABEL } from '../core/sets.js';
import { ENDGAME_DRILLS, drillById, goalLabel } from '../core/endgames.js';
import { openingById } from '../ui/data.js';
import { applyUci, START_FEN } from '../core/chessutil.js';
import { mountOpening, sansToUcis } from '../trainers/opening.js';
import { mountEndgame } from '../trainers/endgame.js';
import { mountPuzzle } from '../trainers/puzzle.js';
import { mountMemory } from '../trainers/memory.js';
import { mountFreeplay } from '../trainers/play.js';

export function render(host, params) {
  const setId = params && params[0];
  const set = state.sets.find((s) => s.id === setId) || state.sets[0];
  if (!set) { host.append(el('div', { class: 'empty', text: 'No set to run.' })); return { destroy() {} }; }

  const ctxAll = {
    openings: data.openings(),
    drills: ENDGAME_DRILLS,
    puzzles: data.puzzles(),
    games: (state.memoryGames || []).concat(data.famousGames()),
  };
  const queue = expandSet(set, ctxAll);
  const results = [];
  let index = 0;
  let handle = null;
  let pending = null;
  const started = Date.now();

  const bar = el('div', { class: 'row', style: 'margin-bottom:12px;flex-wrap:wrap;gap:8px' },
    el('button', { class: 'btn ghost sm', html: `${icon('back')}<span>Sets</span>`, onclick: () => navigate('/sets') }),
    el('strong', { text: set.name }),
    el('span', { class: 'badge' }),
    el('div', { class: 'meter', style: 'flex:1;min-width:120px;max-width:320px' }, el('i', { style: 'width:0%' })),
    el('button', { class: 'btn sm', text: 'Skip', onclick: () => next({ skipped: true }) }),
    el('button', { class: 'btn sm ghost', text: 'End session', onclick: () => finish() }));
  const stage = el('div');
  const note = el('div', { class: 'card flat', style: 'margin-bottom:12px;font-size:.84rem' });
  host.append(bar, note, stage);

  const badge = bar.querySelector('.badge');
  const meter = bar.querySelector('.meter > i');

  function updateChrome() {
    badge.textContent = `Exercise ${Math.min(index + 1, queue.length)} of ${queue.length}`;
    meter.style.width = `${(index / Math.max(1, queue.length)) * 100}%`;
  }

  function next(result) {
    if (result) results.push(result);
    if (handle) { try { handle.destroy(); } catch (e) {} handle = null; }
    stage.innerHTML = '';
    index++;
    updateChrome();
    if (index >= queue.length) return finish();
    show();
  }

  function show() {
    const item = queue[index];
    note.innerHTML = `<b>${KIND_LABEL[item.kind] || item.kind}</b> · ${describeItem(item, ctxAll)}`;
    try {
      handle = mountItem(item, stage);
    } catch (e) {
      console.error(e);
      toast('Could not start that exercise', 'bad');
      next({ error: true });
    }
  }

  // Trainers report their outcome through onDone; advancing happens when the
  // user presses the trainer's own "next" button (or Skip in the session bar),
  // so the result screen is never destroyed before it is read.
  function mountItem(item, hostEl) {
    const ctx = trainerCtx();
    pending = null;
    const done = (r) => { pending = r; };
    const advance = () => next(pending ? { solved: !!pending.passed || !!pending.pct && pending.pct >= 80 || !!pending.clean, ...pending } : { solved: false });
    switch (item.kind) {
      case 'opening': {
        const o = openingById(item.ref) || data.openings().find((x) => x.name === item.ref);
        if (!o) throw new Error('opening not found');
        const side = item.side || 'w';
        return mountOpening(hostEl, ctx, {
          title: o.name,
          subtitle: `<span class="badge">${o.eco}</span> you play ${side === 'w' ? 'White' : 'Black'}`,
          line: { sans: o.moves, ucis: sansToUcis(START_FEN, o.moves) },
          side, mode: 'line', progressKey: `opening:${o.id}:${side}`,
          onNext: advance,
          onDone: done,
        });
      }
      case 'repertoire': {
        const rep = state.repertoires.find((r) => r.id === item.ref) || state.repertoires[0];
        if (!rep) throw new Error('repertoire not found');
        return mountOpening(hostEl, ctx, {
          title: rep.name, subtitle: 'Your repertoire', tree: rep.tree, side: rep.color,
          mode: 'tree', progressKey: `repertoire:${rep.id}`,
          onNext: advance, onDone: done,
        });
      }
      case 'endgame': {
        const drill = drillById(item.ref);
        if (!drill) throw new Error('drill not found');
        return mountEndgame(hostEl, ctx, { drill, onNext: advance, onDone: done });
      }
      case 'puzzle': {
        const puzzle = data.puzzles().find((p) => p.id === item.ref) || (state.customPuzzles || []).find((p) => p.id === item.ref);
        if (!puzzle) throw new Error('puzzle not found');
        return mountPuzzle(hostEl, ctx, { puzzle, onNext: advance, onDone: done });
      }
      case 'memory': {
        const game = ctxAll.games.find((g) => g.id === item.ref);
        if (!game) throw new Error('game not found');
        return mountMemory(hostEl, ctx, {
          game: { ...game, ucis: game.ucis || sansToUcis(game.startFen, game.moves).ucis },
          fromPly: item.fromPly || 0, toPly: item.toPly || (game.moves || []).length,
          side: item.side || 'both', mode: 'quiz',
          onNext: advance, onDone: done,
        });
      }
      case 'review': {
        const game = (state.games || []).find((g) => g.id === item.ref);
        if (!game) throw new Error('game not found');
        let fen = game.startFen;
        const ucis = game.ucis || sansToUcis(game.startFen, game.moves).ucis;
        for (let i = 0; i < Math.min(item.ply || 0, ucis.length); i++) {
          const r = applyUci(fen, ucis[i]);
          if (!r) break;
          fen = r.fen;
        }
        const side = (item.ply || 0) % 2 === 0 ? 'w' : 'b';
        return mountFreeplay(hostEl, ctx, { fen, side, title: 'Position from your game', subtitle: 'Play it out against the engine.' });
      }
      case 'position': {
        const side = item.side || (item.fen.split(' ')[1] === 'b' ? 'b' : 'w');
        return mountFreeplay(hostEl, ctx, {
          fen: item.fen, side,
          title: 'Custom position',
          subtitle: goalLabel(item.goal || 'win'),
        });
      }
      default: throw new Error('unknown item kind ' + item.kind);
    }
  }

  function finish() {
    if (handle) { try { handle.destroy(); } catch (e) {} handle = null; }
    bar.classList.add('hidden');
    note.classList.add('hidden');
    stage.innerHTML = '';
    const solved = results.filter((r) => r.solved).length;
    const minutes = Math.max(1, Math.round((Date.now() - started) / 60000));
    stage.append(el('div', { class: 'card' },
      el('h2', { text: 'Session complete' }),
      el('div', { class: 'row', style: 'gap:22px;margin:14px 0' },
        stat('Exercises', String(results.length)),
        stat('Solved', String(solved)),
        stat('Time', `${minutes} min`)),
      el('div', { class: 'meter', style: 'margin-bottom:16px' }, el('i', { style: `width:${results.length ? (solved / results.length) * 100 : 0}%` })),
      el('div', { class: 'row' },
        el('button', { class: 'btn primary', text: 'Run again', onclick: () => navigate('/session/' + set.id) }),
        el('button', { class: 'btn', text: 'Edit set', onclick: () => navigate('/sets/' + set.id) }),
        el('button', { class: 'btn ghost', text: 'All sets', onclick: () => navigate('/sets') }))));
  }

  function stat(k, v) {
    return el('div', { class: 'stat' }, el('span', { class: 'v', text: v }), el('span', { class: 'k', text: k }));
  }

  if (!queue.length) {
    stage.append(el('div', { class: 'empty', text: 'This set has no runnable exercises yet.' }));
    return { destroy() {} };
  }
  updateChrome();
  show();
  return { destroy() { if (handle) { try { handle.destroy(); } catch (e) {} } } };
}
