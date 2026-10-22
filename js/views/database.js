// js/views/database.js — a real PGN database: import large collections once,
// then search them by player, event, year, result or ECO.
//
// Games live in their own IndexedDB object store (js/ui/pgndb.js); only the
// metadata is held in memory, so a 20,000-game file stays searchable without
// deserialising everything.

import { state, navigate, persist } from '../app.js';
import { el, icon, toast, modal, confirmDialog } from '../ui/components.js';
import {
  importPGNText, searchGames, loadMeta, metaCached, getGame, deleteAllGames, exportPGN,
  toGameObjects, playerList, isImporting, databases, createDatabase, renameDatabase,
  deleteDatabase, setActiveDb, activeDbId, activeDb, exportDatabasePGN, exportDatabaseZip,
  readDatabaseZip, createDatabaseFromRows, countInDb, dbOf, searchPosition,
} from '../ui/pgndb.js';
import { fetchExampleDatabase } from '../ui/packs.js';
import { createSetupBoard } from '../ui/setup-board.js';
import { normaliseFen, positionKey } from '../core/possearch.js';
import { buildFromGames, treeStats, emptyTree } from '../core/repertoire.js';
import { uid } from '../core/sets.js';
import { download, exportName } from '../core/backup.js';
import { START_FEN } from '../core/chessutil.js';

export function render(host) {
  let results = [];
  let total = 0;
  let offset = 0;
  const limit = 60;
  let matches = [];        // every game holding the searched position
  let scanned = 0;         // games replayed for that search
  let capped = false;      // the scan hit its ceiling
  let setupEditor = null;  // the board used to build a FEN
  let setupOpen = false;
  let posScan = null;      // resumable position scan: { fen, nextIndex, candidateCount, done, matches }

  const dbBar = el('div');
  const importCard = el('div', { class: 'card', style: 'margin-bottom:14px' });
  const filterCard = el('div', { class: 'card', style: 'margin-bottom:12px' });
  const setupHost = el('div', { class: 'card hidden', style: 'margin-bottom:12px' });
  const resultBox = el('div');
  host.append(dbBar, importCard, filterCard, setupHost, resultBox);

  const filters = {
    player: '', whitePlayer: '', blackPlayer: '', event: '', yearFrom: '', yearTo: '',
    whiteEloFrom: '', whiteEloTo: '', blackEloFrom: '', blackEloTo: '',
    result: '', eco: '', minPlies: '', fen: '',
  };

  drawDbBar();
  drawImport();
  drawFilters();
  runSearch(true);

  // ---------------------------------------------------------------- which database
  function drawDbBar() {
    dbBar.innerHTML = '';
    const active = activeDbId();
    const sel = el('select', { style: 'max-width:280px', onchange: (e) => { setActiveDb(e.target.value).then(() => navigate('/database')); } });
    dbBar.append(
      el('div', { class: 'card', style: 'margin-bottom:12px' },
        el('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap' },
          el('span', { class: 'faint', style: 'font-size:.8rem', text: 'Database' }),
          el('div', { id: 'dbSelectHost', style: 'min-width:220px;flex:1;max-width:340px' }),
          el('button', { class: 'btn sm', html: `${icon('plus')}<span>New database</span>`, onclick: () => newDbDialog() }),
          el('button', { class: 'btn sm ghost', text: 'Rename', onclick: () => renameDbDialog() }),
          el('button', { class: 'btn sm ghost', text: 'Delete', onclick: () => deleteDbDialog() }),
          el('div', { class: 'spacer' }),
          el('button', { class: 'btn sm', html: `${icon('download')}<span>Backup (.zip)</span>`, onclick: () => backupDbZip() }),
          el('button', { class: 'btn sm ghost', text: 'Export PGN', onclick: () => downloadDbPgn() }))));
    databases().then((list) => {
      sel.innerHTML = '';
      for (const d of list) sel.append(el('option', { value: d.id, text: `${d.name} — ${d.count} games` }));
      sel.value = active;
      const host = document.getElementById('dbSelectHost');
      if (host) { host.innerHTML = ''; host.append(sel); }
    }).catch(() => {});
  }

  function newDbDialog() {
    const name = el('input', { type: 'text', placeholder: 'Database name, e.g. “TWIC 1666”' });
    modal({
      title: 'New database',
      body: el('label', { class: 'field' }, el('span', { text: 'Name' }), name),
      actions: [
        { label: 'Cancel' },
        { label: 'Create', primary: true, onClick: async () => {
          await createDatabase(name.value.trim() || 'New database');
          toast('Database created', 'ok');
          navigate('/database');
        } },
      ],
    });
  }

  function renameDbDialog() {
    const active = activeDbId();
    const current = metaCached().length >= 0 ? '' : '';
    void current;
    const name = el('input', { type: 'text', placeholder: 'New name' });
    databases().then((list) => {
      const db = list.find((d) => d.id === active);
      if (db) name.value = db.name;
    });
    modal({
      title: 'Rename database',
      body: el('label', { class: 'field' }, el('span', { text: 'Name' }), name),
      actions: [
        { label: 'Cancel' },
        { label: 'Rename', primary: true, onClick: async () => {
          await renameDatabase(active, name.value.trim() || 'Database');
          toast('Renamed', 'ok');
          navigate('/database');
        } },
      ],
    });
  }

  function deleteDbDialog() {
    const active = activeDbId();
    const n = countInDb(active);
    modal({
      title: 'Delete this database?',
      body: el('p', { class: 'dim', text: `${n} game(s) will be removed. Other databases and your own games are untouched.` }),
      actions: [
        { label: 'Cancel' },
        { label: 'Delete', danger: true, onClick: async () => {
          try {
            await deleteDatabase(active);
            toast('Database deleted', 'ok');
            navigate('/database');
          } catch (e) { toast(String(e.message || e), 'bad'); }
        } },
      ],
    });
  }

  async function backupDbZip() {
    toast('Packing the database…', '');
    const { zip, filename, count, name } = await exportDatabaseZip();
    download(filename, zip, 'application/zip');
    toast(`${count} games backed up (${name})`, 'ok');
  }

  async function downloadDbPgn() {
    const { pgn, count, name } = await exportDatabasePGN();
    download(`${exportName('chessbox-' + name.replace(/\W+/g, '-').slice(0, 30))}.pgn`, pgn, 'application/x-chess-pgn');
    toast(`${count} games exported`, 'ok');
  }



  // ---------------------------------------------------------------- import
  function drawImport() {
    importCard.innerHTML = '';
    const fileInput = el('input', { type: 'file', accept: '.pgn,.txt,text/plain', style: 'display:none' });
    const zipInput = el('input', { type: 'file', accept: '.zip,application/zip', style: 'display:none' });
    const area = el('textarea', { placeholder: '…or paste PGN here (one game or a whole collection)', style: 'min-height:90px' });
    const info = el('div', { class: 'dim import-info', style: 'font-size:.82rem' });
    const bar = el('div', { class: 'meter hidden', style: 'margin-top:8px' }, el('i', { style: 'width:0%' }));
    const count = countInDb(activeDbId());

    const doImport = async (text, source) => {
      if (!text || !text.trim()) { toast('Nothing to import', 'bad'); return; }
      if (isImporting()) { toast('An import is already running', 'bad'); return; }
      info.textContent = 'Parsing…';
      bar.classList.remove('hidden');
      try {
        const res = await importPGNText(text, {
          source,
          onProgress: (done, totalGames, added) => {
            const pct = totalGames ? Math.round((done / totalGames) * 100) : 0;
            bar.querySelector('i').style.width = `${pct}%`;
            info.textContent = `Parsing ${done}/${totalGames} · ${added} added`;
          },
        });
        const summary = `Imported ${res.added} game(s)${res.duplicates ? `, ${res.duplicates} already present` : ''}${res.rated ? `, ratings updated on ${res.rated}` : ''}${res.skipped ? `, ${res.skipped} skipped` : ''}.`;
        info.textContent = summary;
        toast(`Database: ${res.added} game(s) added${res.rated ? `, ${res.rated} ratings filled in` : ''}`, 'ok');
        drawImport();
        // the card was rebuilt, so the summary goes onto the new line — the old
        // node (and the "ratings updated on N" message) used to vanish instantly
        const fresh = importCard.querySelector('.import-info');
        if (fresh) fresh.textContent = summary;
        drawFilters();
        runSearch(true);
      } catch (e) {
        info.textContent = 'Import failed: ' + (e && e.message ? e.message : e);
        toast('Import failed', 'bad');
      }
    };

    zipInput.addEventListener('change', async () => {
      const f = zipInput.files && zipInput.files[0];
      if (!f) return;
      try {
        const files = await readDatabaseZip(new Uint8Array(await f.arrayBuffer()));
        importZipDialog(files, f.name);
      } catch (e) {
        toast('Could not read that zip: ' + (e.message || e), 'bad');
      }
      zipInput.value = '';
    });

    fileInput.addEventListener('change', async () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      if (f.size > 120 * 1024 * 1024) { toast('File too large (>120 MB) — split it first', 'bad'); return; }
      info.textContent = `Reading ${f.name} (${(f.size / 1048576).toFixed(1)} MB)…`;
      const text = await f.text();
      await doImport(text, f.name);
      fileInput.value = '';
    });

    importCard.append(
      el('div', { class: 'card-head' },
        el('h2', { text: 'PGN database' }),
        el('span', { class: 'badge', text: `${count} games` }),
        el('div', { class: 'spacer' }),
        count ? el('button', {
          class: 'btn sm danger', text: 'Clear this database',
          onclick: async () => {
          if (await confirmDialog({ title: 'Delete the games in this database?', text: `${countInDb(activeDbId())} games will be removed from the active database. Other databases, your own games and repertoires are untouched.` })) {
            await deleteAllGames(activeDbId());
            navigate('/database');
          }
          },
        }) : null),
      el('p', { class: 'dim', style: 'font-size:.85rem;margin-top:0', html: 'Load a PGN collection once — master games, tournament bulletins, your own archive. Games are stripped to their moves and headers, stored locally, and searchable by player, event, year, result and ECO.' }),
      el('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
        el('button', { class: 'btn primary', html: `${icon('upload')}<span>Load PGN file…</span>`, onclick: () => fileInput.click() }),
        el('button', { class: 'btn', html: `${icon('upload')}<span>Import .zip</span>`, title: 'A zip with one or more .pgn files', onclick: () => zipInput.click() }),
        el('span', { class: 'faint', style: 'font-size:.78rem', text: 'or paste below' })),
      el('div', { style: 'height:8px' }), area,
      el('div', { class: 'row', style: 'margin-top:8px' },
        el('button', { class: 'btn', text: 'Import pasted PGN', onclick: () => doImport(area.value, 'pasted') })),
      el('div', { class: 'row', style: 'margin-top:12px;gap:10px;flex-wrap:wrap' },
        el('button', { class: 'btn', html: `${icon('database')}<span>Load bundled example database</span>`, onclick: loadExample }),
        el('span', { class: 'faint', style: 'font-size:.76rem', text: '9,834 master games (TWIC 1666 plus Rubinstein’s games) · ~2.4 MB, downloaded once' })),
      info, bar, fileInput, zipInput);

    /** A zip can either feed the active database or become a new one. */
    function importZipDialog(files, zipName) {
      const total = files.reduce((n, f) => n + (f.text.match(/\[Event /g) || []).length, 0);
      const base = String(zipName || 'import').replace(/\.zip$/i, '');
      const target = el('select', {},
        el('option', { value: 'new', text: `Create a new database (“${base}”)` }),
        el('option', { value: 'active', text: `Add to the active database` }));
      const name = el('input', { type: 'text', value: base, placeholder: 'New database name' });
      modal({
        title: 'Import zipped PGN',
        body: el('div', {},
          el('p', { class: 'dim', style: 'margin-top:0', text: `${files.length} file(s), ${total} game(s) inside ${zipName}.` }),
          el('label', { class: 'field' }, el('span', { text: 'Where' }), target),
          el('label', { class: 'field' }, el('span', { text: 'Name for the new database' }), name),
          el('p', { class: 'faint', style: 'font-size:.78rem;margin:0', text: 'Duplicates (same players, year and moves) are skipped automatically.' })),
        actions: [
          { label: 'Cancel' },
          {
            label: 'Import', primary: true, onClick: async () => {
              let dbId = activeDbId();
              if (target.value === 'new') {
                const created = await createDatabase(name.value.trim() || base);
                dbId = created.id;
                await setActiveDb(dbId);
              }
              info.textContent = 'Importing from zip…';
              bar.classList.remove('hidden');
              let added = 0, dupes = 0, skipped = 0;
              for (const f of files) {
                const res = await importPGNText(f.text, {
                  source: zipName, dbId,
                  onProgress: (done, all, a) => {
                    bar.querySelector('i').style.width = `${all ? Math.round((done / all) * 100) : 0}%`;
                    info.textContent = `${f.name}: ${done}/${all} · ${added + a} added`;
                  },
                });
                added += res.added; dupes += res.duplicates; skipped += res.skipped;
              }
              toast(`Imported ${added} game(s)${dupes ? `, ${dupes} duplicates` : ''}`, 'ok');
              navigate('/database');
            },
          },
        ],
      });
    }

    async function loadExample() {
      if (isImporting()) { toast('An import is already running', 'bad'); return; }
      info.textContent = 'Downloading the example database…';
      bar.classList.remove('hidden');
      try {
        const text = await fetchExampleDatabase((read, total) => {
          const mb = (read / 1048576).toFixed(1);
          info.textContent = total ? `Downloading… ${mb} MB of ${(total / 1048576).toFixed(1)} MB` : `Downloading… ${mb} MB`;
        });
        info.textContent = 'Parsing games…';
        bar.querySelector('i').style.width = '0%';
        const res = await importPGNText(text, {
          source: 'example database',
          onProgress: (done, totalGames, added) => {
            const pct = totalGames ? Math.round((done / totalGames) * 100) : 0;
            bar.querySelector('i').style.width = `${pct}%`;
            info.textContent = `Parsing ${done}/${totalGames} · ${added} added`;
          },
        });
        const summary = `Example database imported: ${res.added} game(s)${res.duplicates ? `, ${res.duplicates} already present` : ''}${res.rated ? `, ratings updated on ${res.rated}` : ''}.`;
        info.textContent = summary;
        toast(`${res.added} games imported`, 'ok');
        drawImport();
        const fresh = importCard.querySelector('.import-info');
        if (fresh) fresh.textContent = summary;
        drawFilters();
        runSearch(true);
      } catch (e) {
        info.textContent = 'Could not load the example database: ' + (e && e.message ? e.message : e);
        toast('Example database failed to load', 'bad');
      }
    }
  }

  // ---------------------------------------------------------------- filters
  function drawFilters() {
    filterCard.innerHTML = '';
    const players = playerList();
    const playerInput = el('input', {
      type: 'search', list: 'db-players',
      placeholder: 'Player name(s), comma separated — e.g. Kasparov, Karpov',
      value: filters.player,
      oninput: (e) => { filters.player = e.target.value; },
    });
    const datalist = el('datalist', { id: 'db-players' });
    for (const p of players) datalist.append(el('option', { value: p.name }));

    const whiteInput = el('input', { type: 'search', list: 'db-players', placeholder: 'White player contains…', value: filters.whitePlayer, oninput: (e) => { filters.whitePlayer = e.target.value; } });
    const blackInput = el('input', { type: 'search', list: 'db-players', placeholder: 'Black player contains…', value: filters.blackPlayer, oninput: (e) => { filters.blackPlayer = e.target.value; } });
    const eventInput = el('input', { type: 'text', placeholder: 'Event contains…', value: filters.event, oninput: (e) => { filters.event = e.target.value; } });
    const fromInput = el('input', { type: 'number', placeholder: 'from', value: filters.yearFrom, oninput: (e) => { filters.yearFrom = e.target.value; } });
    const toInput = el('input', { type: 'number', placeholder: 'to', value: filters.yearTo, oninput: (e) => { filters.yearTo = e.target.value; } });
    const resultSel = el('select', { onchange: (e) => { filters.result = e.target.value; } },
      el('option', { value: '', text: 'Any result' }),
      el('option', { value: '1-0', text: '1-0' }),
      el('option', { value: '0-1', text: '0-1' }),
      el('option', { value: '1/2-1/2', text: 'Draw' }));
    resultSel.value = filters.result;
    const ecoInput = el('input', { type: 'text', placeholder: 'ECO e.g. B', value: filters.eco, oninput: (e) => { filters.eco = e.target.value; } });
    const minPlies = el('input', { type: 'number', placeholder: 'min moves', oninput: (e) => { filters.minPlies = e.target.value; } });
    const eloInput = (key, placeholder) => el('input', {
      type: 'number', min: '0', max: '4000', step: '10', inputmode: 'numeric',
      placeholder, value: filters[key],
      oninput: (e) => { filters[key] = e.target.value; },
    });
    const whiteEloFrom = eloInput('whiteEloFrom', 'from');
    const whiteEloTo = eloInput('whiteEloTo', 'to');
    const blackEloFrom = eloInput('blackEloFrom', 'from');
    const blackEloTo = eloInput('blackEloTo', 'to');
    const eloRange = (a, b) => el('div', { class: 'row tight' }, a, el('span', { class: 'faint', text: '–' }), b);
    const fenInput = el('input', {
      type: 'text', placeholder: 'Paste a FEN — or build the position on a board…',
      value: filters.fen, spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off',
      style: 'flex:1 1 auto;min-width:0;font-family:var(--mono);font-size:.78rem',
      oninput: (e) => { filters.fen = e.target.value; },
    });
    const unrated = metaCached().filter((m) => dbOf(m) === activeDbId() && !m.whiteElo && !m.blackElo).length;
    const ratingActive = ['whiteEloFrom', 'whiteEloTo', 'blackEloFrom', 'blackEloTo'].some((k) => Number(filters[k]) > 0);

    filterCard.append(
      el('div', { class: 'card-head' }, el('h3', { text: 'Search' }), el('div', { class: 'spacer' }),
        el('span', { class: 'badge', text: `${countInDb(activeDbId())} games in this database` })),
      el('label', { class: 'field' }, el('span', { text: 'Any player (either colour)' }), playerInput, datalist),
      el('div', { class: 'split' },
        el('label', { class: 'field' }, el('span', { text: 'White player' }), whiteInput),
        el('label', { class: 'field' }, el('span', { text: 'Black player' }), blackInput)),
      el('label', { class: 'field' }, el('span', { text: 'Event' }), eventInput),
      el('div', { class: 'split' },
        el('label', { class: 'field' }, el('span', { text: 'Year from' }), fromInput),
        el('label', { class: 'field' }, el('span', { text: 'Year to' }), toInput)),
      el('div', { class: 'split' },
        el('label', { class: 'field' }, el('span', { text: 'Result' }), resultSel),
        el('label', { class: 'field' }, el('span', { text: 'ECO prefix' }), ecoInput)),
      el('div', { class: 'split' },
        el('label', { class: 'field' }, el('span', { text: 'White Elo' }), eloRange(whiteEloFrom, whiteEloTo)),
        el('label', { class: 'field' }, el('span', { text: 'Black Elo' }), eloRange(blackEloFrom, blackEloTo))),
      el('div', { class: 'faint', style: 'font-size:.76rem;margin:-4px 0 6px', html: 'Ratings come from the PGN\u2019s WhiteElo/BlackElo headers. Leave one end empty for an open range — <b>from 2700</b> alone is 2700+.'
        + (unrated ? ` <span class="badge" style="margin-left:6px">${unrated} of ${countInDb(activeDbId())} games have no rating</span>` : '')
        + (unrated && ratingActive ? ' Re-import the same PGN to fill them in — duplicates pick up the ratings.' : '') }),
      el('label', { class: 'field' }, el('span', { text: 'Position (FEN)' }),
        el('div', { class: 'row', style: 'gap:6px;flex-wrap:nowrap' },
          fenInput,
          el('button', {
            class: 'btn sm', html: `${icon('pencil')}<span>Board…</span>`,
            title: 'Set the pieces up on a board and use that position',
            onclick: () => toggleSetup(),
          }))),
      el('div', { class: 'faint', style: 'font-size:.76rem;margin:-4px 0 6px', html: 'Finds the games that reach this position — same pieces, same side to move; castling rights, the en passant square and the clocks are ignored. Indexed like a proper database, so the first search builds the index once and every search after it is instant.' }),
      el('div', { class: 'row' },
        el('button', { class: 'btn primary', html: `${icon('search')}<span>Search</span>`, onclick: () => runSearch(true) }),
        el('div', { class: 'spacer' }),
        el('span', { class: 'faint', style: 'font-size:.78rem', text: 'Search runs on the stored metadata, so it stays instant.' })));
  }

  /** The board used to build a FEN, right under the filters. */
  function toggleSetup() {
    if (setupOpen) { hideSetup(); return; }
    setupOpen = true;
    setupHost.classList.remove('hidden');
    setupHost.innerHTML = '';
    setupEditor = createSetupBoard(setupHost, {
      settings: state.settings,
      onUse: (fen) => {
        filters.fen = fen;
        hideSetup();
        drawFilters();
        runSearch(true);
      },
      onCancel: () => hideSetup(),
    });
    setupEditor.setFen(normaliseFen(filters.fen) || START_FEN);
    setupHost.scrollIntoView({ block: 'nearest' });
  }

  function hideSetup() {
    setupOpen = false;
    setupHost.classList.add('hidden');
    if (setupEditor) { setupEditor.destroy(); setupEditor = null; }
    setupHost.innerHTML = '';
  }

  async function runSearch(reset) {
    const fen = String(filters.fen || '').trim();
    if (fen) return runPositionSearch(reset, fen);
    if (reset) { matches = []; scanned = 0; capped = false; }
    if (reset) { offset = 0; results = []; }
    const res = await searchGames({
      player: filters.player, whitePlayer: filters.whitePlayer, blackPlayer: filters.blackPlayer, event: filters.event,
      yearFrom: Number(filters.yearFrom) || 0, yearTo: Number(filters.yearTo) || 9999,
      whiteEloFrom: Number(filters.whiteEloFrom) || 0, whiteEloTo: Number(filters.whiteEloTo) || 0,
      blackEloFrom: Number(filters.blackEloFrom) || 0, blackEloTo: Number(filters.blackEloTo) || 0,
      result: filters.result, eco: filters.eco, minPlies: Number(filters.minPlies) || 0,
      limit, offset,
    });
    total = res.total;
    results = results.concat(res.games);
    offset = results.length;
    drawResults();
  }

  /** Replay every game the cheap filters leave, and keep those that reach the FEN. */
  async function runPositionSearch(reset, fen, { budgetMs = 8000 } = {}) {
    if (!positionKey(normaliseFen(fen))) { toast('That FEN is not a valid position', 'bad'); return; }
    if (reset || !posScan || posScan.fen !== fen) {
      posScan = { fen, nextIndex: 0, candidateCount: 0, done: false, matches: [] };
    }
    if (reset) { offset = 0; results = []; matches = []; }
    const bar = el('div', { class: 'meter', style: 'margin-top:10px' }, el('i', { style: 'width:0%' }));
    const status = el('div', { class: 'dim', style: 'font-size:.82rem', text: 'Replaying the games…' });
    resultBox.innerHTML = '';
    resultBox.append(el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', { style: 'margin:0', text: 'Searching by position' })),
      status, bar));
    let res;
    try {
      res = await searchPosition(fen, {
        ...searchOpts(),
        startIndex: posScan.nextIndex,
        budgetMs,
        onBuildProgress: (done, all, games) => {
          bar.querySelector('i').style.width = `${all ? Math.round((done / all) * 100) : 0}%`;
          status.textContent = `Building the position index — one time only: ${done} of ${all} games (${games} indexed)…`;
        },
        onProgress: (done, all, found) => {
          bar.querySelector('i').style.width = `${all ? Math.round((done / all) * 100) : 0}%`;
          status.textContent = `Replayed ${done} of ${all} games — ${found} hold that position`;
        },
      });
    } catch (e) {
      resultBox.innerHTML = '';
      toast('Could not search by position', 'bad');
      return;
    }
    if (!res.ok) {
      resultBox.innerHTML = '';
      toast('That FEN is not a valid position', 'bad');
      return;
    }
    posScan.candidateCount = res.candidateCount;
    posScan.nextIndex = res.nextIndex;
    posScan.done = res.done;
    posScan.matches = posScan.matches.concat(res.games);
    posScan.capped = res.capped;
    posScan.indexed = !!res.indexed;
    posScan.positions = res.positions || 0;
    posScan.gamesIndexed = res.gamesIndexed || 0;
    matches = posScan.matches;
    total = matches.length;
    scanned = res.scanned;
    capped = !!res.capped;
    results = matches.slice(0, limit);
    offset = results.length;
    drawResults();
  }

  /** "3 games reach that position" / "12 games so far hold that position". */
  function positionHeading() {
    const n = `${total} game${total === 1 ? '' : 's'}`;
    return posScan && !posScan.done ? `${n} so far hold that position` : `${n} reach that position`;
  }

  function drawResults() {
    resultBox.innerHTML = '';
    const posMode = !!String(filters.fen || '').trim();
    const head = el('div', { class: 'row', style: 'margin-bottom:10px;flex-wrap:wrap;gap:8px' },
      el('h3', { style: 'margin:0', text: posMode ? positionHeading() : `${total} game${total === 1 ? '' : 's'} found` }),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn sm', html: `${icon('star')}<span>Build repertoire from these</span>`, onclick: () => buildRepertoireDialog(), disabled: total === 0 || undefined }),
      el('button', { class: 'btn sm', html: `${icon('plus')}<span>New database from these</span>`, title: 'Copy the full result set into its own database', onclick: () => newDbFromResults(), disabled: total === 0 || undefined }),
      el('button', { class: 'btn sm', html: `${icon('download')}<span>Export PGN</span>`, onclick: exportResults, disabled: total === 0 || undefined }));
    resultBox.append(head);
    if (posMode) {
      const partial = posScan && !posScan.done;
      const note = posScan && posScan.indexed
        ? `Instant: a hash lookup into the position index (${posScan.gamesIndexed.toLocaleString()} games, ${posScan.positions.toLocaleString()} positions), then your other filters.`
        : partial
          ? `Scanned ${scanned} of ${posScan.candidateCount} games so far — searching the whole database at once would freeze the app, so it works in steps.`
          : `Replayed ${scanned} game${scanned === 1 ? '' : 's'} to find them${capped ? ' — stopped at the scan limit, narrow the other filters for a full sweep' : ''}.`;
      resultBox.append(el('div', { class: 'faint', style: 'font-size:.76rem;margin-bottom:10px', text: note }));
      if (partial) {
        resultBox.append(el('div', { class: 'row', style: 'gap:8px;margin-bottom:10px;flex-wrap:wrap' },
          el('button', {
            class: 'btn sm primary', text: 'Scan the rest of the database',
            onclick: () => runPositionSearch(false, posScan.fen, { budgetMs: 150000 }),
          }),
          el('span', { class: 'faint', style: 'font-size:.76rem', text: 'Takes a while on a large collection; the bar above shows it moving.' })));
      }
    }

    if (!results.length) {
      const ratingFilterOn = ['whiteEloFrom', 'whiteEloTo', 'blackEloFrom', 'blackEloTo'].some((k) => Number(filters[k]) > 0);
      const noRatings = metaCached().filter((m) => dbOf(m) === activeDbId() && !m.whiteElo && !m.blackElo).length;
      const posFilterOn = !!String(filters.fen || '').trim();
      const empty = !metaCached().length
        ? 'The database is empty. Load a PGN collection above.'
        : posFilterOn
          ? 'No game reaches that position. The search needs the same pieces and the same side to move — if you built it by hand, check whose turn it is.'
          : ratingFilterOn && noRatings
          ? `No games match those filters. ${noRatings} game(s) here carry no rating — importing the same PGN again fills them in without duplicating anything.`
          : 'No games match those filters.';
      resultBox.append(el('div', { class: 'empty', text: empty }));
      return;
    }

    const list = el('div', { class: 'list game-list' });
    for (const g of results) {
      list.append(el('div', { class: 'list-item' },
        el('span', { class: 'badge', text: String(g.year || '—') }),
        el('div', { class: 't' },
          el('span', { class: 'name', text: `${withElo(g.white, g.whiteElo)} – ${withElo(g.black, g.blackElo)}` }),
          el('span', { class: 'sub', text: `${g.result} · ${Math.ceil(g.plies / 2)} moves${g.event ? ' · ' + g.event : ''}${g.eco ? ' · ' + g.eco : ''}${g.ply != null ? ` · reached at move ${Math.ceil(g.ply / 2)}` : ''}` })),
        el('button', { class: 'btn sm', text: 'Review', onclick: () => openInCoach(g) }),
        el('button', { class: 'btn sm', text: 'Memorise', onclick: () => toMemory(g) })));
    }
    resultBox.append(list);

    if (results.length < total) {
      resultBox.append(el('div', { class: 'row', style: 'margin-top:10px;justify-content:center' },
        el('button', { class: 'btn', text: `Load more (${total - results.length} left)`, onclick: () => (posMode ? loadMoreMatches() : runSearch(false)) })));
    }
  }

  /** Position results are already a full scan: page them from memory. */
  function loadMoreMatches() {
    results = matches.slice(0, results.length + limit);
    offset = results.length;
    drawResults();
  }

  async function gameObjects(rows) { return toGameObjects(rows); }

  async function openInCoach(meta) {
    const g = await getGame(meta.id);
    if (!g) { toast('Game not found', 'bad'); return; }
    const game = (await toGameObjects([meta]))[0];
    if (!game) { toast('Could not load the game', 'bad'); return; }
    state.games = (state.games || []).filter((x) => x.id !== game.id).concat([{ ...game, updated: Date.now() }]);
    persist('games', true);
    navigate('/coach/' + game.id);
  }

  async function toMemory(meta) {
    const game = (await toGameObjects([meta]))[0];
    if (!game) return;
    if ((state.memoryGames || []).some((m) => m.moves && m.moves.join(' ') === game.moves.join(' '))) {
      toast('Already in the memory library', '');
      return;
    }
    state.memoryGames.push({
      id: uid('mem'),
      name: `${game.white} – ${game.black}${game.year ? ' (' + game.year + ')' : ''}`,
      white: game.white, black: game.black, year: String(game.year || ''),
      event: game.event, result: game.result, moves: game.moves, ucis: game.ucis,
      startFen: game.startFen, note: 'From the PGN database', source: 'database', updated: Date.now(),
    });
    persist('memoryGames', true);
    toast('Added to game memory', 'ok');
  }

  async function newDbFromResults() {
    const name = el('input', { type: 'text', value: filterSummary(), placeholder: 'Database name' });
    modal({
      title: 'New database from these results',
      body: el('div', {},
        el('p', { class: 'dim', style: 'margin-top:0', text: `Copies all ${total} matching game(s) into a new database. The current database is left as it is.` }),
        el('label', { class: 'field' }, el('span', { text: 'Name' }), name)),
      actions: [
        { label: 'Cancel' },
        {
          label: 'Create', primary: true, onClick: async () => {
            const all = await searchGames({ ...searchOpts(), limit: 200000, offset: 0 });
            if (!all.games.length) { toast('Nothing to copy', 'bad'); return false; }
            const { db, copied } = await createDatabaseFromRows(all.games, name.value.trim() || 'From search');
            await setActiveDb(db.id);
            toast(`Created “${db.name}” with ${copied} game(s)`, 'ok');
            navigate('/database');
          },
        },
      ],
    });
  }

  /** The current filter set, in the shape searchGames expects. */
  function searchOpts() {
    return {
      player: filters.player, whitePlayer: filters.whitePlayer, blackPlayer: filters.blackPlayer, event: filters.event,
      yearFrom: Number(filters.yearFrom) || 0, yearTo: Number(filters.yearTo) || 9999,
      whiteEloFrom: Number(filters.whiteEloFrom) || 0, whiteEloTo: Number(filters.whiteEloTo) || 0,
      blackEloFrom: Number(filters.blackEloFrom) || 0, blackEloTo: Number(filters.blackEloTo) || 0,
      result: filters.result, eco: filters.eco, minPlies: Number(filters.minPlies) || 0,
    };
  }

  /** "Kasparov (2851)" — the rating only when the game carries one. */
  function withElo(name, elo) {
    return elo ? `${name} (${elo})` : name;
  }

  function filterSummary() {
    const bits = [];
    if (filters.player) bits.push(filters.player);
    if (filters.whitePlayer) bits.push('white: ' + filters.whitePlayer);
    if (filters.blackPlayer) bits.push('black: ' + filters.blackPlayer);
    if (filters.event) bits.push(filters.event);
    if (filters.yearFrom || filters.yearTo) bits.push(`${filters.yearFrom || ''}-${filters.yearTo || ''}`);
    if (filters.result) bits.push(filters.result);
    if (filters.eco) bits.push('ECO ' + filters.eco);
    const win = (a, b) => (a && b ? `${a}-${b}` : a ? `${a}+` : b ? `-${b}` : '');
    if (String(filters.fen || '').trim()) bits.push('position');
    if (win(filters.whiteEloFrom, filters.whiteEloTo)) bits.push('wElo ' + win(filters.whiteEloFrom, filters.whiteEloTo));
    if (win(filters.blackEloFrom, filters.blackEloTo)) bits.push('bElo ' + win(filters.blackEloFrom, filters.blackEloTo));
    return bits.join(' ').slice(0, 40) || 'From search';
  }

  function exportResults() {
    modal({
      title: 'Export PGN',
      body: el('p', { class: 'dim', text: `Export the ${total} matching games (not just the ${results.length} shown).` }),
      actions: [
        { label: 'Cancel' },
        {
          label: 'Export', primary: true, onClick: async () => {
            const all = await searchGames({
              player: filters.player, event: filters.event,
              yearFrom: Number(filters.yearFrom) || 0, yearTo: Number(filters.yearTo) || 9999,
              whiteEloFrom: Number(filters.whiteEloFrom) || 0, whiteEloTo: Number(filters.whiteEloTo) || 0,
      blackEloFrom: Number(filters.blackEloFrom) || 0, blackEloTo: Number(filters.blackEloTo) || 0,
      result: filters.result, eco: filters.eco, minPlies: Number(filters.minPlies) || 0,
              limit: 100000, offset: 0,
            });
            const text = await exportPGN(all.games);
            download(`${exportName('chessbox-pgn-export')}.pgn`, text, 'application/x-chess-pgn');
            toast(`Exported ${all.games.length} games`, 'ok');
          },
        },
      ],
    });
  }

  function buildRepertoireDialog() {
    const name = el('input', { type: 'text', value: 'From master games', placeholder: 'Repertoire name' });
    const color = el('select', {},
      el('option', { value: 'w', text: 'Build my White repertoire (keep White’s moves)' }),
      el('option', { value: 'b', text: 'Build my Black repertoire (keep Black’s moves)' }));
    const maxPly = el('input', { type: 'number', value: '20', min: '4', max: '60' });
    const minCount = el('input', { type: 'number', value: '2', min: '1', max: '50' });
    const onlyThisColour = el('input', { type: 'checkbox', checked: true });
    const info = el('div', { class: 'dim', style: 'font-size:.82rem', text: `${total} game(s) match the current filters.` });

    modal({
      title: 'Build a repertoire from the database',
      body: el('div', {},
        el('p', { class: 'dim', style: 'font-size:.84rem;margin-top:0', html: 'The selected games are merged into a move tree, keeping the branches you actually meet. Use the player filter to build, say, a White repertoire from Kasparov’s and Karpov’s games.' }),
        el('label', { class: 'field' }, el('span', { text: 'Name' }), name),
        el('label', { class: 'field' }, el('span', { text: 'Colour' }), color),
        el('div', { class: 'split' },
          el('label', { class: 'field' }, el('span', { text: 'Keep lines up to (plies)' }), maxPly),
          el('label', { class: 'field' }, el('span', { text: 'Only moves seen in at least N games' }), minCount)),
        el('label', { class: 'check' }, onlyThisColour, el('span', { text: 'Only games where the chosen colour was played by the filtered player' })),
        info),
      actions: [
        { label: 'Cancel' },
        {
          label: 'Build', primary: true, onClick: async () => {
            const all = await searchGames({
              player: filters.player, event: filters.event,
              yearFrom: Number(filters.yearFrom) || 0, yearTo: Number(filters.yearTo) || 9999,
              whiteEloFrom: Number(filters.whiteEloFrom) || 0, whiteEloTo: Number(filters.whiteEloTo) || 0,
      blackEloFrom: Number(filters.blackEloFrom) || 0, blackEloTo: Number(filters.blackEloTo) || 0,
      result: filters.result, eco: filters.eco, minPlies: Number(filters.minPlies) || 0,
              limit: 100000, offset: 0,
            });
            if (!all.games.length) { toast('No games match', 'bad'); return false; }
            const games = await toGameObjects(all.games);
            const names = String(filters.player || '').toLowerCase().split(/[,;]/).map((s) => s.trim()).filter(Boolean);
            const filtered = onlyThisColour.checked && names.length
              ? games.filter((g) => {
                const side = color.value === 'w' ? g.white : g.black;
                return names.some((n) => (side || '').toLowerCase().includes(n));
              })
              : games;
            if (!filtered.length) { toast('No games for that colour and player filter', 'bad'); return false; }
            const tree = buildFromGames(filtered, {
              color: color.value, maxPly: Number(maxPly.value) || 20, minCount: Number(minCount.value) || 1,
            });
            const rep = {
              id: uid('rep'), name: name.value || 'From master games', color: color.value,
              description: `Built from ${filtered.length} database game(s)${filters.player ? ` — ${filters.player}` : ''}`,
              tree, created: Date.now(), updated: Date.now(),
            };
            state.repertoires = (state.repertoires || []).concat([rep]);
            persist('repertoires', true);
            const st = treeStats(tree);
            toast(`Repertoire built: ${st.leaves} lines`, 'ok');
            navigate('/repertoire/' + rep.id + '?tab=browse');
          },
        },
      ],
    });
  }

  return { destroy() {} };
}
