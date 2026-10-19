// js/app.js — boot, state, persistence, routing and the chrome around views.

import { store, Store, DEFAULT_SETTINGS } from './ui/store.js';
import * as data from './ui/data.js';
import { getEngine } from './ui/engine.js';
import * as sound from './ui/sound.js';
import { toast, icon, el, clear } from './ui/components.js';
import { review as srsReview } from './core/srs.js';
import { initResume } from './ui/resume.js';
import { VERSION, CHANNEL, IS_BETA } from './version.js';
import { makeSet, makeItem } from './core/sets.js';

export const state = {
  settings: { ...DEFAULT_SETTINGS },
  repertoires: [],
  sets: [],
  games: [],
  gameCollections: [],
  memoryGames: [],
  progress: {},
  memoryNotes: {},
  customPuzzles: [],
  analyses: {},
  data: {},
  engineReady: false,
  lastRoute: 'home',
};

const PERSIST_KEYS = ['repertoires', 'sets', 'games', 'gameCollections', 'memoryGames', 'progress', 'memoryNotes', 'customPuzzles', 'analyses'];
const saveTimers = {};

export function persist(key, immediate = false) {
  if (!PERSIST_KEYS.includes(key)) return;
  clearTimeout(saveTimers[key]);
  const doSave = () => { store.set(key, state[key]); };
  if (immediate) doSave();
  else saveTimers[key] = setTimeout(doSave, 400);
}

export function saveSettings() {
  store.set('settings', state.settings);
  sound.configure({ sound: state.settings.sound, vol: state.settings.volume });
}

export function record(key, passed) {
  state.progress[key] = srsReview(state.progress[key], passed);
  persist('progress');
}

export function trainerCtx() {
  return {
    settings: state.settings,
    engine: () => getEngine(),
    sound,
    record,
    toast,
    state,
  };
}

// ---------------------------------------------------------------- navigation
const NAV = [
  { id: 'home', label: 'Train', icon: 'home' },
  { id: 'openings', label: 'Openings', icon: 'book' },
  { id: 'endgames', label: 'Endgames', icon: 'crown' },
  { id: 'puzzles', label: 'Puzzles', icon: 'puzzle' },
  { id: 'simultan', label: 'Simultan', icon: 'simultan' },
  { id: 'memory', label: 'Memory', icon: 'brain' },
  { id: 'coach', label: 'My games', icon: 'game' },
  { id: 'database', label: 'Database', icon: 'database' },
  { id: 'repertoire', label: 'Repertoire', icon: 'star' },
  { id: 'sets', label: 'Sets', icon: 'layers' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
  { id: 'about', label: 'About', icon: 'info' },
];
const MOBILE_NAV = ['home', 'openings', 'endgames', 'puzzles'];

const VIEWS = {};
async function loadViews() {
  const mods = {
    home: './views/home.js',
    openings: './views/openings.js',
    endgames: './views/endgames.js',
    puzzles: './views/puzzles.js',
    simultan: './views/simultan.js',
    memory: './views/memory.js',
    coach: './views/coach.js',
    database: './views/database.js',
    about: './views/about.js',
    repertoire: './views/repertoire.js',
    sets: './views/sets.js',
    settings: './views/settings.js',
    session: './views/session.js',
  };
  const entries = await Promise.all(Object.entries(mods).map(async ([k, path]) => [k, await import(path)]));
  for (const [k, m] of entries) VIEWS[k] = m;
}

export function navigate(path) {
  const target = path.startsWith('#') ? path : '#/' + path.replace(/^\//, '');
  if (location.hash === target) renderRoute();
  else location.hash = target;
}

function parseRoute() {
  const raw = (location.hash || '#/home').replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  const query = Object.fromEntries(new URLSearchParams(queryPart || ''));
  return { name: parts[0] || 'home', params: parts.slice(1), query, raw };
}

let current = { destroy: null };
async function renderRoute() {
  const route = parseRoute();
  let name = route.name;
  if (!VIEWS[name]) name = 'home';
  if (current.destroy) { try { current.destroy(); } catch (e) { /* ignore */ } }
  current = { destroy: null };
  const view = document.getElementById('view');
  clear(view);
  if (route.params.length && route.name === 'session') name = 'session';
  const mod = VIEWS[name];
  document.getElementById('pageTitle').textContent = titleFor(name, route);
  state.lastRoute = name;
  markNav(name);
  try {
    const handle = await mod.render(view, route.params, route.query, route);
    current.destroy = handle && handle.destroy ? handle.destroy : null;
  } catch (e) {
    console.error(e);
    view.append(el('div', { class: 'card' },
      el('h2', { text: 'Something broke' }),
      el('p', { class: 'dim', text: String(e && e.message || e) }),
      el('button', { class: 'btn', text: 'Reload', onclick: () => location.reload() })));
  }
  window.scrollTo({ top: 0 });
}

function titleFor(name, route) {
  const map = {
    home: 'Train', openings: 'Openings', endgames: 'Endgames', puzzles: 'Puzzles',
    simultan: 'Simultan', memory: 'Game memory', coach: 'My games', database: 'PGN database', repertoire: 'Repertoire', sets: 'Exercise sets',
    about: 'About',
    settings: 'Settings', session: 'Session',
  };
  return map[name] || 'SnartChessBox';
}

function markNav(name) {
  for (const el2 of document.querySelectorAll('[data-nav]')) {
    el2.classList.toggle('active', el2.dataset.nav === name || (name === 'session' && el2.dataset.nav === 'sets'));
  }
}

/** The menu in the user's order; unknown/new entries keep their default place. */
export function orderedNav() {
  const saved = (state.settings.navOrder || []).filter((id) => NAV.some((n) => n.id === id));
  const rest = NAV.filter((n) => !saved.includes(n.id));
  return saved.map((id) => NAV.find((n) => n.id === id)).concat(rest);
}

let navSuppressClick = false;

function moveNavItem(id, delta) {
  const order = orderedNav().map((n) => n.id);
  const i = order.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= order.length) return false;
  [order[i], order[j]] = [order[j], order[i]];
  state.settings.navOrder = order;
  saveSettings();
  buildChrome();
  const again = document.querySelector(`#sidenav .nav-item[data-nav="${id}"]`);
  if (again) again.focus();
  return true;
}

/** Drag (or Alt+↑/↓) reorders the sidebar; the order is saved in settings. */
function installNavDrag(container) {
  let drag = null;
  const items = () => [...container.querySelectorAll('.nav-item')];

  container.addEventListener('pointerdown', (e) => {
    const item = e.target.closest('.nav-item');
    if (!item || (e.button !== undefined && e.button !== 0)) return;
    drag = { item, startY: e.clientY, dragging: false, pointerId: e.pointerId };
    try { item.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });

  container.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.dragging && Math.abs(e.clientY - drag.startY) > 6) {
      drag.dragging = true;
      drag.item.classList.add('dragging');
      container.classList.add('nav-reordering');
    }
    if (!drag.dragging) return;
    const over = items().find((node) => {
      const r = node.getBoundingClientRect();
      return e.clientY >= r.top && e.clientY <= r.bottom;
    });
    if (over && over !== drag.item) {
      const r = over.getBoundingClientRect();
      container.insertBefore(drag.item, e.clientY < r.top + r.height / 2 ? over : over.nextSibling);
    }
    e.preventDefault();
  });

  const finish = () => {
    if (!drag) return;
    const moved = drag.dragging;
    drag.item.classList.remove('dragging');
    container.classList.remove('nav-reordering');
    drag = null;
    if (!moved) return;
    navSuppressClick = true;
    setTimeout(() => { navSuppressClick = false; }, 80);
    state.settings.navOrder = items().map((node) => node.dataset.nav);
    saveSettings();
    buildChrome();
    toast('Menu order saved', 'ok');
  };
  container.addEventListener('pointerup', finish);
  container.addEventListener('pointercancel', finish);
}

export function refreshChrome() { buildChrome(); }

function buildChrome() {
  const sidenav = document.getElementById('sidenav');
  sidenav.innerHTML = '';
  for (const n of orderedNav()) {
    const b = el('button', {
      class: 'nav-item', dataset: { nav: n.id },
      title: `${n.label} — drag to reorder (Alt+↑/↓)`,
      html: `<span class="grip" aria-hidden="true">⠿</span>${icon(n.icon)}<span class="nav-label">${n.label}</span>`,
      onclick: () => { if (!navSuppressClick) navigate('/' + n.id); },
      onkeydown: (e) => {
        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault();
          moveNavItem(n.id, e.key === 'ArrowUp' ? -1 : 1);
        }
      },
    });
    sidenav.append(b);
  }
  if (!sidenav.dataset.drag) {
    installNavDrag(sidenav);
    sidenav.dataset.drag = '1';
  }
  const bottom = document.getElementById('bottomnav');
  bottom.innerHTML = '';
  for (const id of MOBILE_NAV) {
    const n = NAV.find((x) => x.id === id); // fixed four, independent of the custom order
    bottom.append(el('button', {
      dataset: { nav: id }, html: `${icon(n.icon)}<span>${n.label}</span>`,
      onclick: () => navigate('/' + id),
    }));
  }
  bottom.append(el('button', {
    dataset: { nav: 'more' }, html: `${icon('dots')}<span>More</span>`,
    onclick: () => import('./ui/components.js').then(({ sheet }) => sheet('More',
      orderedNav()
        .filter((n) => !MOBILE_NAV.includes(n.id))
        .map((n) => ({ icon: n.icon, label: n.label, onClick: () => navigate('/' + n.id) })))),
  }));

  const buildInfo = document.getElementById('buildInfo');
  if (buildInfo) {
    buildInfo.innerHTML = `<span class="mono">v${VERSION}</span>${IS_BETA ? ' · <span style="color:var(--warn)">beta</span>' : ''}<br>AGPL-3.0 · offline`;
    buildInfo.style.cursor = 'pointer';
    buildInfo.title = 'About SnartChessBox';
    buildInfo.addEventListener('click', () => navigate('/about'));
  }

  document.getElementById('settingsBtn').innerHTML = icon('settings');
  document.getElementById('settingsBtn').addEventListener('click', () => navigate('/settings'));

  const installBtn = document.getElementById('installBtn');
  installBtn.innerHTML = icon('download');
  let installEvent = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e;
    installBtn.hidden = false;
  });
  installBtn.addEventListener('click', async () => {
    if (!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice;
    installEvent = null;
    installBtn.hidden = true;
  });
  window.addEventListener('appinstalled', () => { toast('App installed', 'ok'); installBtn.hidden = true; });
}

function watchProgress(el2) {
  const img = el2.querySelector('img');
  if (!img) return;
  let p = 15;
  const t = setInterval(() => { p = Math.min(88, p + 7); const b = document.getElementById('bootBar'); if (b) b.style.width = p + '%'; }, 200);
  return () => clearInterval(t);
}

// ---------------------------------------------------------------- seeding
function seedSets() {
  if (state.sets.length) return;
  const findOpen = (name) => {
    const all = data.openings();
    return all.find((o) => o.name === name) || all.find((o) => o.name.toLowerCase() === name.toLowerCase())
      || all.find((o) => o.name.toLowerCase().startsWith(name.toLowerCase()));
  };
  const sets = [];
  sets.push(makeSet({
    id: 'set-tactics-mate1', name: 'Mate in one — find the finish', builtin: true,
    description: 'Ten mate-in-one puzzles to warm up: back ranks, smothered mates and queen sacrifices.',
    items: [makeItem('puzzles', null, { themes: ['mateIn1'], count: 10 })],
  }));
  sets.push(makeSet({
    id: 'set-tactics-mix', name: 'Tactics mix — forks, pins, sacrifices', builtin: true,
    description: 'A dozen middlegame tactics drawn from the bundled puzzle set.',
    items: [makeItem('puzzles', null, { themes: ['fork', 'pin', 'sacrifice'], count: 12 })],
  }));
  sets.push(makeSet({
    id: 'set-basic-mates', name: 'Basic mates', builtin: true,
    description: 'Queen, rook, two bishops and the bishop+knight mate — the four every player must own.',
    items: ['kqk-1', 'krk-1', 'kbbk-1', 'kbnk-1'].map((id) => makeItem('endgame', id)),
  }));
  sets.push(makeSet({
    id: 'set-pawn-endings', name: 'Pawn endings', builtin: true,
    description: 'Key squares, the opposition, rook-pawn draws and connected passers.',
    items: ['kpk-win-1', 'kpk-win-2', 'kpk-hold-1', 'kpk-hold-2', 'kpkpk-1'].map((id) => makeItem('endgame', id)),
  }));
  const whiteOpenings = ['Italian Game: Giuoco Piano', 'Ruy Lopez', 'Sicilian Defense: Najdorf Variation']
    .map(findOpen).filter(Boolean)
    .map((o) => makeItem('opening', o.id, { side: 'w' }));
  if (whiteOpenings.length) {
    sets.push(makeSet({
      id: 'set-openings-white', name: 'White: 1.e4 classics', builtin: true,
      description: 'Meet 1.e4 with the Italian, the Ruy Lopez and the open Sicilian.',
      items: whiteOpenings, color: 'w',
    }));
  }
  const blackOpenings = ['Sicilian Defense: Najdorf Variation', 'French Defense', 'Caro-Kann Defense: Main Line']
    .map(findOpen).filter(Boolean)
    .map((o) => makeItem('opening', o.id, { side: 'b' }));
  if (blackOpenings.length) {
    sets.push(makeSet({
      id: 'set-openings-black', name: 'Black: Sicilian, French, Caro-Kann', builtin: true,
      description: 'Three solid answers to 1.e4, trained from the black side.',
      items: blackOpenings, color: 'b',
    }));
  }
  const opera = data.famousGames().find((g) => /morphy/i.test(g.white || '') && (g.year === 1858 || /opera/i.test(g.name || '')));
  if (opera) {
    sets.push(makeSet({
      id: 'set-memory-opera', name: 'Memory: the Opera Game', builtin: true,
      description: 'Learn Morphy\u2019s 1858 masterpiece move by move, then reproduce it from memory.',
      items: [makeItem('memory', opera.id, { fromPly: 0, toPly: opera.moves ? opera.moves.length : 32, side: 'both' })],
    }));
  }
  state.sets = sets;
  persist('sets', true);
}

// ---------------------------------------------------------------- boot
async function boot() {
  const bootMsg = document.getElementById('bootMsg');
  const stopWatch = watchProgress(document.getElementById('boot'));
  try {
    await store.open();
    const stored = await store.get('settings', null);
    state.settings = Store.migrateSettings(stored || store.readMirrorSettings() || {});
    for (const key of PERSIST_KEYS) {
      const empty = key === 'progress' || key === 'analyses' || key === 'memoryNotes' ? {} : [];
      const v = await store.get(key, empty);
      state[key] = v === null || v === undefined ? empty : v;
    }
    sound.configure({ sound: state.settings.sound, vol: state.settings.volume });
    await initResume();
    boostEngineState('loading');
    if (bootMsg) bootMsg.textContent = 'Loading openings, puzzles and famous games…';
    state.data = await data.loadData();
    if (data.dataMeta().errors.length) console.warn('data load problems:', data.dataMeta().errors);
    seedSets();
    await loadViews();
    buildChrome();
    window.addEventListener('hashchange', renderRoute);
    await renderRoute();
    // engine warms up in the background so the first move is instant
    getEngine().start().then(() => {
      state.engineReady = true;
      boostEngineState('ready');
    }).catch((e) => {
      console.warn('engine start failed', e);
      boostEngineState('error');
    });
  } catch (e) {
    console.error(e);
    if (bootMsg) bootMsg.textContent = 'Boot failed: ' + (e && e.message ? e.message : e);
  } finally {
    const boot = document.getElementById('boot');
    if (boot) { boot.style.transition = 'opacity .25s'; boot.style.opacity = '0'; setTimeout(() => boot.remove(), 280); }
    if (stopWatch) stopWatch();
  }
}

export function boostEngineState(kind) {
  const el2 = document.getElementById('engineState');
  if (!el2) return;
  const map = {
    loading: 'Engine: loading…',
    ready: 'Engine: ready (offline)',
    busy: 'Engine: thinking…',
    error: 'Engine: failed to start',
  };
  el2.textContent = map[kind] || kind;
}

// service worker: offline
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e));
  });
}

boot();

export { data, getEngine, sound, store, DEFAULT_SETTINGS };
