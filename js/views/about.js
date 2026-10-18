// js/views/about.js — version, beta status, release notes, licences, privacy.

import { navigate, state } from '../app.js';
import { el, icon, toast } from '../ui/components.js';
import { VERSION, CHANNEL, BUILD, IS_BETA, BETA_NOTICE, APP_NAME, REPO_URL, LIVE_URL, CHANGELOG } from '../version.js';
import { makeBundle, serializeBundle, download, exportName } from '../core/backup.js';

export function render(host) {
  const page = el('div');

  // ---- header
  page.append(el('div', { class: 'card', style: 'margin-bottom:14px' },
    el('div', { class: 'row', style: 'gap:14px;align-items:flex-start' },
      el('div', { class: 'brand-mark', style: 'width:46px;height:46px;font-size:26px', text: '♞' }),
      el('div', { style: 'flex:1' },
        el('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
          el('h1', { style: 'margin:0;font-size:1.5rem', text: APP_NAME }),
          el('span', { class: 'badge ' + (IS_BETA ? 'warn' : 'good'), text: IS_BETA ? 'beta' : 'stable' }),
          el('span', { class: 'badge mono', text: `v${VERSION}` })),
        el('p', { class: 'dim', style: 'margin:6px 0 0', html: `Build ${BUILD} · channel <b>${CHANNEL}</b> · offline-first chess training.` })),
      el('div', { class: 'row', style: 'gap:6px' },
        el('button', { class: 'btn sm', html: `${icon('download')}<span>Export backup</span>`, onclick: exportBundle }),
        el('button', { class: 'btn sm', html: `${icon('game')}<span>GitHub</span>`, onclick: () => window.open(REPO_URL, '_blank', 'noopener') })))));

  // ---- beta warning
  if (IS_BETA) {
    page.append(el('div', { class: 'card', style: 'border-color:rgba(224,184,58,.45);background:rgba(224,184,58,.07);margin-bottom:14px' },
      el('div', { class: 'row', style: 'gap:10px;align-items:flex-start' },
        el('span', { html: icon('info'), style: 'color:var(--warn)' }),
        el('div', {},
          el('strong', { text: 'This is a beta release' }),
          el('p', { class: 'dim', style: 'margin:4px 0 0;font-size:.86rem', html: 'Features and data formats can change between versions, and an update can make older exports incompatible. <b>Keep a backup</b> (Data → Export bundle) before updating, and treat the app as a work in progress.' })))));
  }

  // ---- what it is
  page.append(el('div', { class: 'card', style: 'margin-bottom:14px' },
    el('h2', { text: 'What this is' }),
    el('p', { class: 'dim', style: 'margin:0;font-size:.88rem', html: `${APP_NAME} is a local-first chess trainer: opening repertoires for both colours, endgame technique drills, themed tactics, simultaneous exhibitions, game memory, review of your own games and a searchable PGN database — all against a Stockfish engine running inside the page. There is no account, no server and no telemetry; everything you import stays in this browser.` })));

  // ---- release notes
  const notesCard = el('div', { class: 'card', style: 'margin-bottom:14px' },
    el('div', { class: 'card-head' }, el('h2', { text: 'Release notes' }), el('div', { class: 'spacer' }),
      el('span', { class: 'faint', style: 'font-size:.76rem', text: 'newest first' })));
  for (const rel of CHANGELOG) {
    const isCurrent = rel.version === VERSION;
    notesCard.append(el('details', { open: isCurrent || undefined, style: 'border-top:1px solid var(--border-soft);padding:8px 0' },
      el('summary', { style: 'cursor:pointer;font-size:.9rem' },
        el('span', { class: 'mono', text: `v${rel.version}` }),
        rel.channel === 'beta' ? el('span', { class: 'badge warn', style: 'margin-left:8px', text: 'beta' }) : null,
        el('span', { class: 'faint', style: 'margin-left:8px;font-size:.78rem', text: rel.date }),
        isCurrent ? el('span', { class: 'badge good', style: 'margin-left:8px', text: 'this build' }) : null),
      el('ul', { class: 'dim', style: 'font-size:.84rem;margin:8px 0 0;padding-left:18px' },
        ...rel.notes.map((n) => el('li', { text: n })))));
  }
  page.append(notesCard);

  // ---- data & privacy
  const storageLine = el('span', { class: 'faint', style: 'font-size:.8rem', text: 'Storage used: —' });
  const cacheLine = el('span', { class: 'faint', style: 'font-size:.8rem', text: 'Deployed build: —' });
  page.append(el('div', { class: 'card', style: 'margin-bottom:14px' },
    el('h2', { text: 'Your data' }),
    el('p', { class: 'dim', style: 'font-size:.86rem;margin-top:0', html: 'Settings, repertoires, exercise sets, imported games, the PGN database and your progress live in this browser (IndexedDB). Nothing is uploaded. Clearing site data, or installing on another device, starts empty — use the backup bundle to move.' }),
    el('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap' },
      el('button', { class: 'btn sm', text: 'Export everything (bundle)', onclick: exportBundle }),
      el('button', { class: 'btn sm', text: 'Export games (PGN)', onclick: () => navigate('/settings') }),
      el('button', { class: 'btn sm ghost', text: 'Open settings', onclick: () => navigate('/settings') })),
    el('div', { class: 'stack', style: 'gap:2px;margin-top:10px' }, storageLine, cacheLine)));

  // ---- licences
  page.append(el('div', { class: 'card', style: 'margin-bottom:14px' },
    el('h2', { text: 'Licences & credits' }),
    el('ul', { class: 'dim', style: 'font-size:.84rem;margin:0;padding-left:18px' },
      el('li', { html: `This app: <b>AGPL-3.0-or-later</b> — source at <a href="${REPO_URL}" target="_blank" rel="noopener">github.com/larsnygard/snart-chessbox</a>.` }),
      el('li', { html: 'Engine: <a href="https://github.com/nmrugg/stockfish.js" target="_blank" rel="noopener">Stockfish.js 19</a> (GPL-3.0), single-threaded lite WASM build.' }),
      el('li', { html: 'Rules and PGN: <a href="https://github.com/jhlywa/chess.js" target="_blank" rel="noopener">chess.js</a> (BSD-2-Clause).' }),
      el('li', { html: 'Opening names: <a href="https://github.com/lichess-org/chess-openings" target="_blank" rel="noopener">Lichess opening database</a> (CC0-1.0).' }),
      el('li', { html: 'Puzzles: <a href="https://database.lichess.org/#puzzles" target="_blank" rel="noopener">Lichess puzzle database</a> (CC0-1.0).' }),
      el('li', { text: 'Piece outlines: DejaVu Sans (Bitstream Vera / DejaVu licence), converted to SVG paths.' }))));

  // ---- technical
  page.append(el('div', { class: 'card' },
    el('h2', { text: 'Technical' }),
    el('div', { class: 'dim', style: 'font-size:.84rem' },
      el('p', { style: 'margin-top:0', html: `Live: <a href="${LIVE_URL}" target="_blank" rel="noopener">${LIVE_URL.replace('https://', '')}</a> · installable as a PWA; after the first load the engine and the datasets are cached for offline use.` }),
      el('p', { html: 'No build step: plain ES modules. The engine runs in a Web Worker; evaluation, book play and analysis all happen on this device.' }),
      el('p', { class: 'faint', html: `Build ${BUILD} · ${CHANNEL} channel · <span class="mono">v${VERSION}</span>` }))));

  host.append(page);

  // live details
  (async () => {
    try {
      const est = await navigator.storage.estimate();
      storageLine.textContent = `Storage used: ${(est.usage / 1048576).toFixed(1)} MB${est.quota ? ` of ${(est.quota / 1048576).toFixed(0)} MB available` : ''}`;
    } catch (e) { /* ignore */ }
    try {
      const keys = await caches.keys();
      const mine = keys.filter((k) => k.startsWith('snartchessbox-'));
      cacheLine.textContent = mine.length ? `Cached app shell: ${mine.sort().pop()}` : 'Cached app shell: not installed yet';
    } catch (e) { /* ignore */ }
  })();

  function exportBundle() {
    download(`${exportName('chessbox-backup')}.json`, serializeBundle(makeBundle(state)), 'application/json');
    toast('Backup exported', 'ok');
  }

  return { destroy() {} };
}
