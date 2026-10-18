// js/views/database.js — a real PGN database: import large collections once,
// then search them by player, event, year, result or ECO.
//
// Games live in their own IndexedDB object store (js/ui/pgndb.js); only the
// metadata is held in memory, so a 20,000-game file stays searchable without
// deserialising everything.

import { state, navigate, persist } from '../app.js';
import { el, icon, toast, modal, confirmDialog } from '../ui/components.js';
import { importPGNText, searchGames, loadMeta, metaCached, getGame, deleteAllGames, exportPGN, toGameObjects, playerList, isImporting } from '../ui/pgndb.js';
import { fetchExampleDatabase } from '../ui/packs.js';
import { buildFromGames, treeStats, emptyTree } from '../core/repertoire.js';
import { uid } from '../core/sets.js';
import { download, exportName } from '../core/backup.js';

export function render(host) {
  let results = [];
  let total = 0;
  let offset = 0;
  const limit = 60;

  const importCard = el('div', { class: 'card', style: 'margin-bottom:14px' });
  const filterCard = el('div', { class: 'card', style: 'margin-bottom:12px' });
  const resultBox = el('div');
  host.append(importCard, filterCard, resultBox);

  const filters = { player: '', event: '', yearFrom: '', yearTo: '', result: '', eco: '', minPlies: '' };

  drawImport();
  drawFilters();
  runSearch(true);

  // ---------------------------------------------------------------- import
  function drawImport() {
    importCard.innerHTML = '';
    const fileInput = el('input', { type: 'file', accept: '.pgn,.txt,text/plain', style: 'display:none' });
    const area = el('textarea', { placeholder: '…or paste PGN here (one game or a whole collection)', style: 'min-height:90px' });
    const info = el('div', { class: 'dim', style: 'font-size:.82rem' });
    const bar = el('div', { class: 'meter hidden', style: 'margin-top:8px' }, el('i', { style: 'width:0%' }));
    const count = metaCached().length;

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
        info.textContent = `Imported ${res.added} game(s)${res.duplicates ? `, ${res.duplicates} already present` : ''}${res.skipped ? `, ${res.skipped} skipped` : ''}.`;
        toast(`Database: ${res.added} game(s) added`, 'ok');
        drawImport();
        drawFilters();
        runSearch(true);
      } catch (e) {
        info.textContent = 'Import failed: ' + (e && e.message ? e.message : e);
        toast('Import failed', 'bad');
      }
    };

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
          class: 'btn sm danger', text: 'Clear database',
          onclick: async () => {
            if (await confirmDialog({ title: 'Delete the whole database?', text: `${count} imported games will be removed. Your own games and repertoires are untouched.` })) {
              await deleteAllGames();
              navigate('/database');
            }
          },
        }) : null),
      el('p', { class: 'dim', style: 'font-size:.85rem;margin-top:0', html: 'Load a PGN collection once — master games, tournament bulletins, your own archive. Games are stripped to their moves and headers, stored locally, and searchable by player, event, year, result and ECO.' }),
      el('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
        el('button', { class: 'btn primary', html: `${icon('upload')}<span>Load PGN file…</span>`, onclick: () => fileInput.click() }),
        el('span', { class: 'faint', style: 'font-size:.78rem', text: 'or paste below' })),
      el('div', { style: 'height:8px' }), area,
      el('div', { class: 'row', style: 'margin-top:8px' },
        el('button', { class: 'btn', text: 'Import pasted PGN', onclick: () => doImport(area.value, 'pasted') })),
      el('div', { class: 'row', style: 'margin-top:12px;gap:10px;flex-wrap:wrap' },
        el('button', { class: 'btn', html: `${icon('database')}<span>Load bundled example database</span>`, onclick: loadExample }),
        el('span', { class: 'faint', style: 'font-size:.76rem', text: '9,834 master games (TWIC 1666 plus Rubinstein’s games) · ~2.4 MB, downloaded once' })),
      info, bar, fileInput);

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
        info.textContent = `Example database imported: ${res.added} game(s)${res.duplicates ? `, ${res.duplicates} already present` : ''}.`;
        toast(`${res.added} games imported`, 'ok');
        drawImport();
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

    filterCard.append(
      el('div', { class: 'card-head' }, el('h3', { text: 'Search' }), el('div', { class: 'spacer' }),
        el('span', { class: 'badge', text: `${metaCached().length} games in database` })),
      el('label', { class: 'field' }, el('span', { text: 'Players' }), playerInput, datalist),
      el('label', { class: 'field' }, el('span', { text: 'Event' }), eventInput),
      el('div', { class: 'split' },
        el('label', { class: 'field' }, el('span', { text: 'Year from' }), fromInput),
        el('label', { class: 'field' }, el('span', { text: 'Year to' }), toInput)),
      el('div', { class: 'split' },
        el('label', { class: 'field' }, el('span', { text: 'Result' }), resultSel),
        el('label', { class: 'field' }, el('span', { text: 'ECO prefix' }), ecoInput)),
      el('div', { class: 'row' },
        el('button', { class: 'btn primary', html: `${icon('search')}<span>Search</span>`, onclick: () => runSearch(true) }),
        el('div', { class: 'spacer' }),
        el('span', { class: 'faint', style: 'font-size:.78rem', text: 'Search runs on the stored metadata, so it stays instant.' })));
  }

  async function runSearch(reset) {
    if (reset) { offset = 0; results = []; }
    const res = await searchGames({
      player: filters.player, event: filters.event,
      yearFrom: Number(filters.yearFrom) || 0, yearTo: Number(filters.yearTo) || 9999,
      result: filters.result, eco: filters.eco, minPlies: Number(filters.minPlies) || 0,
      limit, offset,
    });
    total = res.total;
    results = results.concat(res.games);
    offset = results.length;
    drawResults();
  }

  function drawResults() {
    resultBox.innerHTML = '';
    const head = el('div', { class: 'row', style: 'margin-bottom:10px;flex-wrap:wrap;gap:8px' },
      el('h3', { style: 'margin:0', text: `${total} game${total === 1 ? '' : 's'} found` }),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn sm', html: `${icon('star')}<span>Build repertoire from these</span>`, onclick: () => buildRepertoireDialog(), disabled: total === 0 || undefined }),
      el('button', { class: 'btn sm', html: `${icon('download')}<span>Export PGN</span>`, onclick: exportResults, disabled: total === 0 || undefined }));
    resultBox.append(head);

    if (!results.length) {
      resultBox.append(el('div', { class: 'empty', text: metaCached().length ? 'No games match those filters.' : 'The database is empty. Load a PGN collection above.' }));
      return;
    }

    const list = el('div', { class: 'list game-list' });
    for (const g of results) {
      list.append(el('div', { class: 'list-item' },
        el('span', { class: 'badge', text: String(g.year || '—') }),
        el('div', { class: 't' },
          el('span', { class: 'name', text: `${g.white} – ${g.black}` }),
          el('span', { class: 'sub', text: `${g.result} · ${Math.ceil(g.plies / 2)} moves${g.event ? ' · ' + g.event : ''}${g.eco ? ' · ' + g.eco : ''}` })),
        el('button', { class: 'btn sm', text: 'Review', onclick: () => openInCoach(g) }),
        el('button', { class: 'btn sm', text: 'Memorise', onclick: () => toMemory(g) })));
    }
    resultBox.append(list);

    if (results.length < total) {
      resultBox.append(el('div', { class: 'row', style: 'margin-top:10px;justify-content:center' },
        el('button', { class: 'btn', text: `Load more (${total - results.length} left)`, onclick: () => runSearch(false) })));
    }
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
