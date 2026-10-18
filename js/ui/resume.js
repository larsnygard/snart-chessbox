// js/ui/resume.js — one "unfinished session" slot.
//
// Trainers write their state here after every move; the router restores it when
// you come back to the same screen (open Settings mid-game, come back, continue),
// and Home offers a "continue where you left off" card.

import { store } from './store.js';

let current = null;

export async function initResume() {
  current = await store.get('resume', null);
  return current;
}

export function getResume() { return current; }

export function saveResume(route, kind, data, label = '') {
  current = { route, kind, data, label, updated: Date.now() };
  store.set('resume', current);
  return current;
}

export function clearResume() {
  current = null;
  store.del('resume');
}

/** Resume data for this route, if it is recent enough to be useful. */
export function matchResume(route, maxAgeMs = 12 * 3600 * 1000) {
  if (!current || current.route !== route) return null;
  if (Date.now() - (current.updated || 0) > maxAgeMs) return null;
  return current.data;
}

export function describeResume() {
  if (!current) return null;
  const age = Date.now() - (current.updated || 0);
  const mins = Math.round(age / 60000);
  return {
    ...current,
    ago: mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`,
  };
}
