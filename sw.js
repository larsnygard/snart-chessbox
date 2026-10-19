// sw.js — app-shell cache for SnartChessBox.
//
// Offline is the point of this app: the engine, the opening tree, the puzzle
// dataset and the UI all have to live in the cache, otherwise "train on a plane"
// does not work. Bump VERSION on any asset change — `activate` is what purges
// the stale build from installed devices.

const VERSION = 'v1.10.1-1';
const CACHE = `snart-chessbox-${VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',

  './js/app.js',
  './js/version.js',
  './js/core/backup.js',
  './js/core/chessutil.js',
  './js/core/endgames.js',
  './js/core/evalband.js',
  './js/core/memory.js',
  './js/core/moveclass.js',
  './js/core/pgn.js',
  './js/core/repertoire.js',
  './js/core/sets.js',
  './js/core/srs.js',
  './js/core/zip.js',
  './js/trainers/common.js',
  './js/trainers/endgame.js',
  './js/trainers/play.js',
  './js/trainers/memory.js',
  './js/trainers/opening.js',
  './js/trainers/puzzle.js',
  './js/ui/board.js',
  './js/ui/engine-settings.js',
  './js/ui/orientation.js',
  './js/ui/packs.js',
  './js/ui/pgndb.js',
  './js/ui/resume.js',
  './js/ui/board-tools.js',
  './js/ui/explorer.js',
  './js/ui/components.js',
  './js/ui/data.js',
  './js/ui/engine.js',
  './js/ui/pieces.js',
  './js/ui/piece-paths.js',
  './js/ui/sound.js',
  './js/ui/store.js',
  './js/ui/trainer-shell.js',
  './js/views/about.js',
  './js/views/coach.js',
  './js/views/database.js',
  './js/views/endgames.js',
  './js/views/home.js',
  './js/views/memory.js',
  './js/views/openings.js',
  './js/views/play.js',
  './js/views/puzzles.js',
  './js/views/repertoire.js',
  './js/views/session.js',
  './js/views/sets.js',
  './js/views/simultan.js',
  './js/views/settings.js',

  './vendor/chess.mjs',
  './engines/stockfish-19-lite-single.js',
  './engines/stockfish-19-lite-single.wasm',

  './data/openings.json',
  './data/puzzles.json',
  './data/famous-games.json',
  './data/packs/index.json',
  './data/packs/rubinstein-white.json',
  './data/packs/rubinstein-black.json',
  './data/packs/caro-kann-black.json',

  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon-180.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  // allSettled, not addAll: one bad URL must not leave an empty cache behind a
  // worker that activates successfully.
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(ASSETS.map((url) => cache.add(new Request(url, { cache: 'reload' }))));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) {
      refresh(cache, req);
      return hit;
    }
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (err) {
      if (req.mode === 'navigate') {
        const fallback = (await cache.match('./index.html', { ignoreSearch: true }))
          || (await cache.match('./', { ignoreSearch: true }));
        if (fallback) return fallback;
      }
      return new Response('Offline and not cached', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }
  })());
});

async function refresh(cache, req) {
  try {
    const res = await fetch(req);
    if (res && res.ok && res.type === 'basic') await cache.put(req, res);
  } catch (e) {
    /* offline: keep what we have */
  }
}
