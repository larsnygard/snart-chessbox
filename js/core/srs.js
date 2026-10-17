// js/core/srs.js — a small, boring spaced-repetition scheduler.
// One item = { box, due, seen, ok, lapses }. Ladder in days; a failed review
// drops one box (never below 0) and re-queues the item for the same session.

export const LADDER_DAYS = [0, 1, 3, 7, 16, 35, 70, 120];
export const DAY = 86400000;

export function newSrs(now = Date.now()) {
  return { box: 0, due: now, seen: 0, ok: 0, lapses: 0, last: null };
}

export function review(item, passed, now = Date.now()) {
  const it = { ...newSrs(now), ...(item || {}) };
  it.seen += 1;
  if (passed) {
    it.ok += 1;
    it.box = Math.min(LADDER_DAYS.length - 1, (it.box || 0) + 1);
  } else {
    it.lapses += 1;
    it.box = Math.max(0, (it.box || 0) - 1);
  }
  it.due = now + LADDER_DAYS[it.box] * DAY;
  it.last = passed ? 'ok' : 'fail';
  return it;
}

export function isDue(item, now = Date.now()) { return !item || !item.due || item.due <= now; }

export function dueItems(map, now = Date.now()) {
  return Object.entries(map || {}).filter(([, v]) => isDue(v, now)).map(([k]) => k);
}

export function mastery(map) {
  const vals = Object.values(map || {});
  if (!vals.length) return 0;
  const sum = vals.reduce((a, v) => a + Math.min(1, (v.box || 0) / 4), 0);
  return Math.round((sum / vals.length) * 100);
}

export function describeDue(ts, now = Date.now()) {
  if (!ts || ts <= now) return 'due now';
  const d = Math.ceil((ts - now) / DAY);
  return d === 1 ? 'tomorrow' : `in ${d} days`;
}
