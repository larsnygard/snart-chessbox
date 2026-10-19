// js/views/play.js — the Play screen: a game against the engine, first-class in
// the menu. Arriving with nothing to resume offers the new-game dialog
// (colour, time control, strength, book repertoires, start position).

import { trainerCtx } from '../app.js';
import { el } from '../ui/components.js';
import { mountPlay } from '../trainers/play.js';

export function render(host) {
  const hostEl = el('div');
  host.append(hostEl);
  const handle = mountPlay(hostEl, trainerCtx(), { openNewGame: true });
  return { destroy() { if (handle && handle.destroy) handle.destroy(); } };
}
