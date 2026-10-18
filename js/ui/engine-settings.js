// js/ui/engine-settings.js — the engine dialog reachable from any board.
//
// Strength, think time, randomness window and weighting are global settings
// (they persist), so opening it mid-game changes how the engine plays from the
// next move on — no need to abandon the game.

import { state, saveSettings } from '../app.js';
import { el, icon, modal } from './components.js';
import { describeSpread } from '../core/evalband.js';

const STRENGTHS = [600, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 0];
const THINK = [100, 250, 400, 700, 1200, 2000];
const SPREADS = [0, 50, 100, 150, 250];

export function openEngineSettings({ title = 'Engine settings', onChange } = {}) {
  const s = state.settings;
  const body = el('div');
  const changed = () => { saveSettings(); if (onChange) onChange(); };

  const strengthRow = el('div', { class: 'filters' });
  STRENGTHS.forEach((elo) => {
    strengthRow.append(el('button', {
      class: 'chip' + ((s.strength || 0) === elo ? ' on' : ''),
      text: elo ? String(elo) : 'Max',
      onclick: (e) => {
        s.strength = elo;
        for (const c of strengthRow.children) c.classList.remove('on');
        e.currentTarget.classList.add('on');
        changed();
      },
    }));
  });

  const thinkRow = el('div', { class: 'filters' });
  THINK.forEach((ms) => {
    thinkRow.append(el('button', {
      class: 'chip' + (s.thinkMs === ms ? ' on' : ''),
      text: `${ms} ms`,
      onclick: (e) => {
        s.thinkMs = ms;
        for (const c of thinkRow.children) c.classList.remove('on');
        e.currentTarget.classList.add('on');
        changed();
      },
    }));
  });

  const spreadNote = el('div', { class: 'dim', style: 'font-size:.8rem' });
  const spreadRow = el('div', { class: 'filters' });
  const paintSpread = () => {
    spreadNote.textContent = s.spreadCp === 0
      ? 'Always the engine’s best move.'
      : `May play any move within ±${(s.spreadCp / 100).toFixed(2)} of the best move — with a best of +1.30 it can play down to ${(1.3 - s.spreadCp / 100).toFixed(2)}, never a losing move.`;
  };
  SPREADS.forEach((cp) => {
    spreadRow.append(el('button', {
      class: 'chip' + (s.spreadCp === cp ? ' on' : ''),
      text: cp ? `±${(cp / 100).toFixed(2)}` : 'exact',
      onclick: (e) => {
        s.spreadCp = cp;
        for (const c of spreadRow.children) c.classList.remove('on');
        e.currentTarget.classList.add('on');
        paintSpread();
        changed();
      },
    }));
  });
  paintSpread();

  body.append(
    el('p', { class: 'dim', style: 'font-size:.82rem;margin-top:0', text: 'These apply to every board in the app — the current game continues with the new values from the next search.' }),
    el('label', { class: 'field' }, el('span', { text: 'Playing strength (Elo)' }), strengthRow),
    el('label', { class: 'field' }, el('span', { text: 'Think time per move' }), thinkRow),
    el('label', { class: 'field' }, el('span', { text: 'Randomness window' }), spreadRow, spreadNote),
    el('div', { class: 'faint', style: 'font-size:.76rem', text: 'Strength below Elo 1320 is played with Stockfish’s skill level and a shorter search; the eval bar always shows honest evaluations.' }));

  return modal({ title, body, actions: [{ label: 'Done', primary: true }] });
}

/** Small gear button that opens the dialog (used by the board strip). */
export function engineSettingsButton(label = '') {
  return el('button', {
    class: 'btn sm ghost icon', title: 'Engine settings', html: `${icon('settings')}${label ? `<span>${label}</span>` : ''}`,
    onclick: () => openEngineSettings(),
  });
}
