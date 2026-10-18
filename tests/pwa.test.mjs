// tests/pwa.test.mjs — installability and offline integrity, dependency-free.
//
// The three-way diff that matters: what index.html loads, what sw.js precaches,
// and what is actually on disk. A worker that activates with an empty cache
// looks healthy and fails only when the user is offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const html = read('index.html');
const sw = read('sw.js');
const manifest = JSON.parse(read('manifest.json'));

function swAssets() {
  const m = /const ASSETS = \[([\s\S]*?)\];/.exec(sw);
  assert.ok(m, 'sw.js must declare an ASSETS array');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

test('every precached asset exists on disk', () => {
  const assets = swAssets();
  assert.ok(assets.length > 30, `only ${assets.length} assets precached`);
  const missing = assets.filter((a) => {
    const clean = a.replace(/^\.\//, '');
    if (clean === '' || clean === '.') return !existsSync(join(ROOT, 'index.html'));
    return !existsSync(join(ROOT, clean));
  });
  assert.deepEqual(missing, [], `precached but missing: ${missing.join(', ')}`);
});

test('every local script/style/icon the page loads is precached', () => {
  const assets = new Set(swAssets().map((a) => a.replace(/^\.\//, '')));
  const refs = [
    ...[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map((m) => m[1]),
  ].filter((u) => !/^https?:/.test(u));
  for (const ref of refs) assert.ok(assets.has(ref), `page loads ${ref} but it is not precached`);
  assert.ok(assets.has('index.html'), 'navigation document must be precached');
});

test('ES module imports resolve to files that exist and are precached', () => {
  const assets = new Set(swAssets().map((a) => a.replace(/^\.\//, '')));
  const files = swAssets().filter((a) => a.endsWith('.js')).map((a) => a.replace(/^\.\//, ''));
  for (const file of files) {
    const src = read(file);
    for (const m of src.matchAll(/from\s+'([^']+)'/g)) {
      const spec = m[1];
      if (!spec.startsWith('.') && !spec.startsWith('/')) continue;
      const resolved = new URL(spec, 'file://' + join(ROOT, file)).pathname.replace(ROOT + '/', '');
      assert.ok(existsSync(join(ROOT, resolved)), `${file} imports missing ${resolved}`);
      assert.ok(assets.has(resolved), `${file} imports ${resolved} which is not precached`);
    }
  }
});

test('manifest is installable', () => {
  assert.ok(manifest.name && manifest.short_name, 'name/short_name required');
  assert.ok(manifest.short_name.length <= 14, 'short_name should fit a launcher label');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.start_url.startsWith('./'), 'start_url must be relative');
  assert.ok(manifest.scope === './', 'scope must be relative');
  assert.ok(manifest.theme_color && manifest.background_color);
  const purposes = manifest.icons.map((i) => i.purpose || 'any');
  assert.ok(manifest.icons.some((i) => i.sizes === '192x192' && (i.purpose || 'any').includes('any')));
  assert.ok(manifest.icons.some((i) => i.sizes === '512x512'));
  assert.ok(purposes.some((p) => p.includes('maskable')), 'a maskable icon is required for Android');
  for (const icon of manifest.icons) {
    assert.ok(existsSync(join(ROOT, icon.src)), `icon missing: ${icon.src}`);
    if (icon.src.endsWith('.png')) {
      const buf = readFileSync(join(ROOT, icon.src));
      assert.equal(buf.subarray(1, 4).toString(), 'PNG', `${icon.src} is not a PNG`);
      const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
      assert.equal(`${w}x${h}`, icon.sizes, `${icon.src} is ${w}x${h} but manifest says ${icon.sizes}`);
    }
  }
});

test('manifest screenshots exist with the declared size and are not precached', () => {
  const precached = swAssets().map((a) => a.replace(/^\.\//, ''));
  for (const shot of manifest.screenshots || []) {
    assert.ok(existsSync(join(ROOT, shot.src)), `screenshot missing: ${shot.src}`);
    const buf = readFileSync(join(ROOT, shot.src));
    const [w, h] = shot.sizes.split('x').map(Number);
    assert.equal(buf.readUInt32BE(16), w, `${shot.src} width`);
    assert.equal(buf.readUInt32BE(20), h, `${shot.src} height`);
    assert.ok(['narrow', 'wide'].includes(shot.form_factor), `${shot.src} needs form_factor`);
    assert.ok(!precached.includes(shot.src), `${shot.src} must not be precached`);
  }
});

test('apple-touch-icon is opaque and the right size', () => {
  const buf = readFileSync(join(ROOT, 'icons/apple-touch-icon-180.png'));
  assert.equal(buf.readUInt32BE(16), 180);
  assert.equal(buf.readUInt32BE(20), 180);
  assert.match(html, /rel="apple-touch-icon"/);
  assert.match(html, /apple-mobile-web-app-capable/);
});

test('service worker has the offline-critical mechanics', () => {
  assert.match(sw, /addEventListener\('install'/, 'install handler');
  assert.match(sw, /addEventListener\('activate'/, 'activate handler');
  assert.match(sw, /addEventListener\('fetch'/, 'fetch handler');
  assert.match(sw, /const VERSION = '[^']+'/, 'versioned build');
  assert.match(sw, /const CACHE = `[^`]*\$\{VERSION\}`/, 'cache name carries the version');
  assert.match(sw, /Promise\.allSettled/, 'install must not be atomic (allSettled)');
  assert.ok(!/cache\.addAll/.test(sw), 'addAll leaves an empty cache on one failure');
  assert.match(sw, /caches\.delete/, 'stale caches must be purged on activate');
  assert.match(sw, /clients\.claim/, 'claim clients');
  assert.match(sw, /ignoreSearch: true/, 'cache matching must ignore query strings');
  assert.match(sw, /req\.method !== 'GET'/, 'only GET requests are cached');
  assert.match(sw, /url\.origin !== self\.location\.origin/, 'cross-origin requests pass through');
});

test('version numbers agree across js/version.js, package.json and the manifest', () => {
  const src = read('js/version.js');
  const appVersion = /export const VERSION = '([^']+)'/.exec(src)?.[1];
  assert.ok(appVersion, 'js/version.js must export VERSION');
  const pkg = JSON.parse(read('package.json'));
  const mf = JSON.parse(read('manifest.json'));
  assert.equal(pkg.version, appVersion, 'package.json version');
  assert.equal(mf.version, appVersion, 'manifest version');

  const swTag = /const VERSION = '([^']+)'/.exec(sw)?.[1];
  assert.ok(swTag, 'sw.js must declare a cache tag');
  const base = appVersion.split('-')[0]; // 1.5.0-beta.1 → 1.5.0
  assert.ok(swTag.startsWith(`v${base}-`), `SW cache tag ${swTag} must start with v${base}- so the app and the cache agree`);
});

test('release notes lead with the current version and are ordered newest-first', () => {
  const src = read('js/version.js');
  const appVersion = /export const VERSION = '([^']+)'/.exec(src)[1];
  const versions = [...src.matchAll(/version: '([^']+)',\s*\n\s*date:/g)].map((m) => m[1]);
  assert.ok(versions.length >= 3, `only ${versions.length} changelog entries`);
  assert.equal(versions[0], appVersion, 'the newest release note must be the current version');
});

test('beta builds carry a warning', () => {
  const src = read('js/version.js');
  if (!/export const CHANNEL = 'beta'/.test(src)) return; // stable: nothing to warn about
  assert.match(src, /export const BETA_NOTICE = '[^']{20,}'/, 'beta builds need a visible notice');
});

test('index.html declares the PWA basics', () => {
  assert.match(html, /<link rel="manifest" href="manifest\.json">/);
  assert.match(html, /<meta name="theme-color"/);
  assert.match(html, /<meta name="viewport"[^>]*width=device-width/);
  assert.match(html, /<script type="module" src="js\/app\.js">/);
});

test('the engine assets and datasets are present and non-trivial', () => {
  for (const f of ['engines/stockfish-19-lite-single.js', 'engines/stockfish-19-lite-single.wasm', 'data/openings.json', 'data/puzzles.json', 'data/famous-games.json']) {
    assert.ok(existsSync(join(ROOT, f)), `${f} missing`);
    assert.ok(statSync(join(ROOT, f)).size > 10000, `${f} looks empty`);
  }
  assert.ok(statSync(join(ROOT, 'engines/stockfish-19-lite-single.wasm')).size > 500000, 'engine wasm looks truncated');
});

test('no absolute asset URLs (the app must work from a subpath)', () => {
  const absolute = [...html.matchAll(/(?:src|href)="(\/[^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(absolute, [], `absolute paths break subpath hosting: ${absolute.join(', ')}`);
});
