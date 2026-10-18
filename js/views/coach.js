// js/views/coach.js — import your own games, review them with the engine, and
// re-play the position where it went wrong.

import { state, navigate, persist, trainerCtx } from '../app.js';
import { el, icon, toast, modal, confirmDialog, fmtTime } from '../ui/components.js';
import { parsePGN, buildPGN } from '../core/pgn.js';
import { applyUci, sanToUci, scoreToCp, endgameInfo } from '../core/chessutil.js';
import { reviewMoves, reviewSummary, blunderArrows, classInfo } from '../core/moveclass.js';
import { uid } from '../core/sets.js';
import { download, exportName } from '../core/backup.js';
import { createBoard } from '../ui/board.js';
import { orientationFor } from '../ui/orientation.js';
import { createBoardTools } from '../ui/board-tools.js';
import { mountFreeplay } from '../trainers/play.js';

export function render(host, params, query) {
  const id = params && params[0];
  if (query && query.fen) return renderPlayground(host, query);
  if (id) return renderReview(host, id, query || {});
  return renderList(host);
}

// ---------------------------------------------------------------- library
function renderList(host) {
  const games = state.games || [];

  const importCard = el('div', { class: 'card', style: 'margin-bottom:14px' });
  const textarea = el('textarea', { placeholder: '[Event "Club championship"]\n[White "You"]\n[Black "Opponent"]\n\n1. e4 c5 2. Nf3 d6 ...\n\n(you can paste several games at once)' });
  const fileInput = el('input', { type: 'file', accept: '.pgn,text/plain', style: 'display:none' });
  const player = el('input', { type: 'text', placeholder: 'Your name as it appears in the PGN (optional)', value: state.settings.username || '' });

  importCard.append(
    el('div', { class: 'card-head' }, el('h2', { text: 'Import your games' }), el('div', { class: 'spacer' }),
      el('span', { class: 'badge', text: `${games.length} stored` })),
    el('p', { class: 'dim', style: 'font-size:.85rem;margin-top:0', html: 'Paste PGN or pick a file. Games are parsed and validated move by move; you can store a few hundred without slowing anything down.' }),
    el('label', { class: 'field' }, el('span', { text: 'Your PGN name' }), player),
    textarea,
    el('div', { class: 'row', style: 'margin-top:10px' },
      el('button', { class: 'btn primary', html: `${icon('upload')}<span>Add games</span>`, onclick: () => addGames(textarea.value) }),
      el('button', { class: 'btn', text: 'Choose file…', onclick: () => fileInput.click() }),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn ghost', text: 'Play the engine instead', onclick: () => navigate('/coach?fen=start') })),
    fileInput);

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    textarea.value = await f.text();
    toast('PGN loaded — press “Add games”', '');
  });

  function addGames(text) {
    if (!text || !text.trim()) { toast('Nothing to import', 'bad'); return; }
    const parsed = parsePGN(text).filter((g) => g.moves.length >= 6);
    if (!parsed.length) { toast('No legal games found in that PGN', 'bad'); return; }
    const name = player.value.trim();
    if (name && name !== state.settings.username) {
      state.settings.username = name;
      import('../app.js').then(({ saveSettings }) => saveSettings());
    }
    let added = 0;
    const existing = new Set((state.games || []).map((g) => g.moves.join(' ')));
    for (const g of parsed) {
      if (existing.has(g.moves.join(' '))) continue;
      const ucis = sanToUci(g.startFen, g.moves).ucis;
      state.games.push({
        id: uid('game'),
        white: g.headers.White || '?', black: g.headers.Black || '?',
        result: g.result, event: g.headers.Event || '', date: g.headers.Date || '',
        eco: g.headers.ECO || '', moves: g.moves, ucis, startFen: g.startFen,
        added: Date.now(), updated: Date.now(),
      });
      added++;
    }
    if (state.games.length > state.settings.pgnMaxGames) {
      state.games = state.games.slice(-state.settings.pgnMaxGames);
      toast(`Kept the newest ${state.settings.pgnMaxGames} games`, '');
    }
    persist('games', true);
    toast(`Imported ${added} game(s)`, 'ok');
    navigate('/coach');
  }

  host.append(importCard);

  const head = el('div', { class: 'row', style: 'margin:16px 0 10px' },
    el('h3', { text: 'Your games' }), el('div', { class: 'spacer' }),
    el('button', { class: 'btn sm ghost', html: `${icon('download')}<span>Export PGN</span>`, onclick: exportAll }),
    el('button', {
      class: 'btn sm danger', text: 'Clear library',
      onclick: async () => {
        if (await confirmDialog({ title: 'Delete all imported games?', text: 'Analyses go with them. Export first if you want a copy.' })) {
          state.games = [];
          persist('games', true);
          navigate('/coach');
        }
      },
    }));
  host.append(head);

  const mine = state.settings.username ? games.filter((g) => matchesUser(g, state.settings.username)) : games;

  // ---- collections -----------------------------------------------------
  const collections = state.gameCollections || (state.gameCollections = []);
  let activeCol = (() => { try { return localStorage.getItem('scb.coachCollection') || 'all'; } catch (e) { return 'all'; } })();
  const setCol = (id) => {
    activeCol = id;
    try { localStorage.setItem('scb.coachCollection', id); } catch (e) { /* ignore */ }
    navigate('/coach');
  };
  const inCol = (g) => activeCol === 'all' ? true : activeCol === 'none' ? !g.collection : g.collection === activeCol;
  const colName = (id) => (collections.find((c) => c.id === id) || {}).name || '';

  const colBar = el('div', { class: 'filters', style: 'margin:12px 0' });
  function drawColBar() {
    colBar.innerHTML = '';
    const countFor = (id) => mine.filter((g) => (id === 'all' ? true : id === 'none' ? !g.collection : g.collection === id)).length;
    const chip = (id, label) => el('button', {
      class: 'chip' + (activeCol === id ? ' on' : ''), text: `${label} (${countFor(id)})`,
      onclick: () => setCol(id),
    });
    colBar.append(chip('all', 'All games'), chip('none', 'Unfiled'));
    for (const c of collections) colBar.append(chip(c.id, c.name));
    colBar.append(el('button', { class: 'chip', html: `${icon('plus')} New collection`, onclick: () => newCollectionDialog() }));
    if (collections.length) colBar.append(el('button', { class: 'chip', text: 'Manage…', onclick: () => manageCollectionsDialog() }));
  }
  host.append(colBar);
  drawColBar();

  function persistCollections() {
    persist('gameCollections', true);
    persist('games', true);
  }

  function newCollectionDialog(after) {
    const name = el('input', { type: 'text', placeholder: 'Collection name, e.g. “Club games 2026”' });
    modal({
      title: 'New collection',
      body: el('label', { class: 'field' }, el('span', { text: 'Name' }), name),
      actions: [
        { label: 'Cancel' },
        {
          label: 'Create', primary: true, onClick: () => {
            const col = { id: uid('col'), name: name.value.trim() || 'Collection', created: Date.now() };
            state.gameCollections.push(col);
            persistCollections();
            if (after) after(col);
            else navigate('/coach');
          },
        },
      ],
    });
  }

  function manageCollectionsDialog() {
    const body = el('div', { class: 'list' });
    for (const c of collections) {
      body.append(el('div', { class: 'list-item', style: 'cursor:default' },
        el('div', { class: 't' }, el('span', { class: 'name', text: c.name }),
          el('span', { class: 'sub', text: `${games.filter((g) => g.collection === c.id).length} game(s)` })),
        el('button', {
          class: 'btn sm', text: 'Rename', onclick: () => {
            const name = el('input', { type: 'text', value: c.name });
            modal({
              title: 'Rename collection',
              body: el('label', { class: 'field' }, el('span', { text: 'Name' }), name),
              actions: [{ label: 'Cancel' }, {
                label: 'Save', primary: true, onClick: () => {
                  c.name = name.value.trim() || c.name;
                  persistCollections();
                  navigate('/coach');
                },
              }],
            });
          },
        }),
        el('button', {
          class: 'btn sm ghost', text: 'Delete', onclick: async () => {
            const n = games.filter((g) => g.collection === c.id).length;
            const ok = await confirmDialog({
              title: `Delete “${c.name}”?`,
              text: `${n} game(s) stay in your library and become unfiled.`,
              confirmLabel: 'Delete collection',
            });
            if (!ok) return;
            state.gameCollections = collections.filter((x) => x.id !== c.id);
            for (const g of state.games) if (g.collection === c.id) delete g.collection;
            persistCollections();
            navigate('/coach');
          },
        })));
    }
    modal({ title: 'Collections', body, actions: [{ label: 'Close' }] });
  }

  function gameMenu(g) {
    const sel = el('select', {});
    sel.append(el('option', { value: '', text: 'Unfiled' }));
    for (const c of collections) sel.append(el('option', { value: c.id, text: c.name }));
    sel.value = g.collection || '';
    const m = modal({
      title: `${g.white} – ${g.black}`,
      body: el('div', {},
        el('label', { class: 'field' }, el('span', { text: 'Collection' }), sel),
        el('div', { class: 'row', style: 'gap:6px;margin-top:6px' },
          el('button', { class: 'btn sm', html: `${icon('plus')} New collection…`, onclick: () => { m.close(); newCollectionDialog((col) => { g.collection = col.id; persistCollections(); navigate('/coach'); }); } }))),
      actions: [
        { label: 'Cancel' },
        {
          label: 'Delete game', danger: true, onClick: async () => {
            const ok = await confirmDialog({ title: 'Remove this game?', text: 'It is removed from your library; the analysis goes with it.' });
            if (!ok) return false;
            state.games = state.games.filter((x) => x.id !== g.id);
            delete state.analyses[g.id];
            persist('games', true);
            persist('analyses', true);
            navigate('/coach');
          },
        },
        {
          label: 'Save', primary: true, onClick: () => {
            if (sel.value) g.collection = sel.value; else delete g.collection;
            persistCollections();
            navigate('/coach');
          },
        },
      ],
    });
  }

  if (!games.length) {
    host.append(el('div', { class: 'empty', style: 'margin-top:14px' },
      'No games yet. Import a PGN above — or play a game against the engine and analyse it afterwards.'));
    return { destroy() {} };
  }

  const visible = mine.filter(inCol);
  const list = el('div', { class: 'list game-list' });
  host.append(list);
  for (const g of visible.slice().reverse()) {
    const analysed = state.analyses[g.id];
    list.append(el('div', { class: 'list-item', onclick: () => navigate('/coach/' + g.id) },
      el('div', { class: 't' },
        el('span', { class: 'name', text: `${g.white} – ${g.black}` }),
        el('span', { class: 'sub', text: `${g.result || '*'} · ${g.moves.length} moves · ${g.event || 'no event'}${g.date ? ' · ' + g.date : ''}${colName(g.collection) ? ' · ' + colName(g.collection) : ''}` })),
      analysed ? el('span', { class: 'badge ' + (analysed.summary && analysed.summary.counts.blunder ? 'bad' : 'good'), text: `${analysed.summary ? analysed.summary.counts.blunder : 0} blunders` }) : el('span', { class: 'badge', text: 'not analysed' }),
      el('button', { class: 'btn ghost sm icon', html: icon('dots'), title: 'Collection / delete', onclick: (e) => { e.stopPropagation(); gameMenu(g); } }),
      el('button', { class: 'btn sm primary', text: 'Review', onclick: (e) => { e.stopPropagation(); navigate('/coach/' + g.id); } })));
  }
  if (!visible.length) {
    list.append(el('div', { class: 'empty', text: 'No games in this collection yet. Pick “Move to collection” from a game\u2019s ⋯ menu.' }));
  }

  function matchesUser(g, name) {
    const n = name.toLowerCase();
    return (g.white || '').toLowerCase().includes(n) || (g.black || '').toLowerCase().includes(n);
  }

  function exportAll() {
    const pgns = state.games.map((g) => buildPGN({
      headers: {
        Event: g.event, Site: '', Date: g.date || '????.??.??', Round: '',
        White: g.white, Black: g.black, Result: g.result || '*', ECO: g.eco,
      },
      moves: g.moves, result: g.result || '*', startFen: g.startFen,
    }));
    download(`${exportName('snart-chess-games')}.pgn`, pgns.join('\n'), 'application/x-chess-pgn');
    toast('PGN exported', 'ok');
  }

  return { destroy() {} };
}

function renderPlayground(host, query) {
  const trainerHost = el('div');
  const bar = el('div', { class: 'row', style: 'margin-bottom:10px' },
    el('button', { class: 'btn ghost sm', html: `${icon('back')}<span>My games</span>`, onclick: () => navigate('/coach') }));
  host.append(bar, trainerHost);
  const fen = query.fen && query.fen !== 'start' ? query.fen : undefined;
  const handle = mountFreeplay(trainerHost, trainerCtx(), {
    fen,
    side: query.side === 'b' ? 'b' : query.side === 'w' ? 'w' : undefined,
    title: query.title || 'Play vs engine',
    subtitle: query.subtitle,
  });
  return { destroy() { handle.destroy(); } };
}

// ---------------------------------------------------------------- review
function renderReview(host, id) {
  const game = (state.games || []).find((g) => g.id === id);
  if (!game) { host.append(el('div', { class: 'empty', text: 'Game not found.' })); return { destroy() {} }; }
  const ucis = game.ucis || sanToUci(game.startFen, game.moves).ucis;
  const userColor = detectUserColor(game);
  const analysed = state.analyses[game.id];

  // positions[i] = fen before ply i; positions[n] = final
  const positions = [game.startFen];
  for (const u of ucis) {
    const r = applyUci(positions[positions.length - 1], u);
    if (!r) break;
    positions.push(r.fen);
  }

  const top = el('div', { class: 'row', style: 'margin-bottom:10px' },
    el('button', { class: 'btn ghost sm', html: `${icon('back')}<span>My games</span>`, onclick: () => navigate('/coach') }),
    el('span', { class: 'dim', style: 'font-size:.82rem', text: `${game.white} – ${game.black} · ${game.result || '*'} · you are ${userColor === 'w' ? 'White' : 'Black'}` }),
    el('div', { class: 'spacer' }),
    el('button', {
      class: 'btn sm', text: userColor === 'w' ? 'I was Black' : 'I was White',
      onclick: () => {
        game.userColor = userColor === 'w' ? 'b' : 'w';
        persist('games', true);
        navigate('/coach/' + id);
      },
    }));

  const layout = el('div', { class: 'trainer' });
  const boardCol = el('div', { class: 'board-col' });
  const sideCol = el('div', { class: 'side-col' });
  const boardHost = el('div');
  const toolsRow = el('div');
  const statusRow = el('div', { class: 'row' });
  const card = el('div', { class: 'card' });
  const summaryEl = el('div', { class: 'stack', style: 'gap:8px' });
  const analysisBtnRow = el('div', { class: 'row', style: 'margin-top:8px' });
  const movesTable = el('div', { style: 'max-height:340px;overflow-y:auto;margin-top:10px' });
  const feedback = el('div', { class: 'feedback hidden' });

  boardCol.append(boardHost, statusRow, toolsRow);
  card.append(el('h2', { text: 'Review', style: 'font-size:1rem;margin:0 0 8px' }), summaryEl, feedback, analysisBtnRow, movesTable);
  sideCol.append(card);
  layout.append(boardCol, sideCol);
  host.append(top, layout);

  const board = createBoard(boardHost, {
    fen: positions[0],
    orientation: orientationFor(state.settings, userColor),
    theme: state.settings.boardTheme,
    pieceSet: state.settings.pieceSet,
    coords: state.settings.coords,
    animate: false,
    interactive: false,
  });

  let rows = analysed ? analysed.rows : null;
  let summary = analysed ? analysed.summary : null;
  let blunders = analysed ? analysed.blunders : [];
  let cursor = 0;
  let busy = false;
  let cancel = false;

  // standard strip: move navigation, eval bar, engine switch, play-from-here
  const tools = createBoardTools(toolsRow, {
    board,
    settings: state.settings,
    nav: {
      first: () => setCursor(0),
      back: () => setCursor(cursor - 1),
      forward: () => setCursor(cursor + 1),
      last: () => setCursor(ucis.length),
      state: () => ({ atStart: cursor === 0, atEnd: cursor >= ucis.length }),
    },
    onPlayFromHere: (fen, turn) => navigate(`/coach?fen=${encodeURIComponent(fen)}&side=${turn}&title=${encodeURIComponent('From your game')}`),
  });
  board.onPosition(() => tools.refresh());
  const playBtn = el('button', {
    class: 'btn sm', text: 'Play from here',
    onclick: () => {
      const fen = positions[cursor];
      const side = cursor % 2 === 0 ? (game.startFen.split(' ')[1] === 'b' ? 'b' : 'w') : (game.startFen.split(' ')[1] === 'b' ? 'w' : 'b');
      navigate(`/coach?fen=${encodeURIComponent(fen)}&side=${side}&title=${encodeURIComponent('From your game')}`);
    },
  });
  const bestBtn = el('button', {
    class: 'btn sm', text: 'Start from the blunder', onclick: () => {
      const b = blunders[0];
      if (!b) return toast('No blunder found', '');
      const fen = positions[b.ply];
      navigate(`/coach?fen=${encodeURIComponent(fen)}&side=${game.startFen.split(' ')[1] === 'b' ? (b.ply % 2 === 0 ? 'b' : 'w') : (b.ply % 2 === 0 ? 'w' : 'b')}&title=${encodeURIComponent('Retry: ' + b.san)}`);
    },
  });
  statusRow.append(el('div', { class: 'board-status' }), el('div', { class: 'spacer' }), playBtn, bestBtn);

  function setCursor(n) {
    cursor = Math.max(0, Math.min(ucis.length, n));
    renderCursor();
  }

  function renderCursor() {
    const fen = positions[cursor];
    const arrows = [];
    if (rows && cursor > 0) {
      const row = rows[cursor - 1];
      if (row && row.cls && ['blunder', 'mistake', 'inaccuracy'].includes(row.cls)) {
        arrows.push({ from: row.uci.slice(0, 2), to: row.uci.slice(2, 4), color: 'bad' });
        if (row.bestUci) arrows.push({ from: row.bestUci.slice(0, 2), to: row.bestUci.slice(2, 4), color: 'best' });
      }
    }
    board.setPosition(fen, {
      last: cursor > 0 ? { from: ucis[cursor - 1].slice(0, 2), to: ucis[cursor - 1].slice(2, 4) } : null,
      arrows,
      clearSelection: true,
    });
    const moveNo = Math.floor(cursor / 2) + (game.startFen.split(' ')[1] === 'b' ? 0 : 1);
    statusRow.firstElementChild.innerHTML = cursor === 0
      ? '<span class="faint">Starting position</span>'
      : `Move ${Math.ceil(cursor / 2)} · <span class="mono">${game.moves[cursor - 1]}</span>${rows && rows[cursor - 1] ? ` · <span class="${clsSpan(rows[cursor - 1].cls)}">${rows[cursor - 1].cls || ''}</span>` : ''}`;
    renderTable();
  }

  function clsSpan(cls) {
    return cls === 'blunder' ? 'cls-B' : cls === 'mistake' ? 'cls-M' : cls === 'inaccuracy' ? 'cls-I' : 'cls-G';
  }

  function renderTable() {
    movesTable.innerHTML = '';
    if (!rows) {
      movesTable.append(el('div', { class: 'dim', style: 'font-size:.84rem', text: 'Run the engine review to see where the game turned.' }));
      return;
    }
    const table = el('table', { class: 'an-table' },
      el('thead', {}, el('tr', {}, el('th', { text: '#' }), el('th', { text: 'Move' }), el('th', { text: 'Eval' }), el('th', { text: 'Loss' }), el('th', { text: 'Verdict' }))));
    const tbody = el('tbody');
    rows.forEach((r, i) => {
      if (r.moverColor !== userColor) return;
      tbody.append(el('tr', {
        class: i + 1 === cursor ? 'cur' : '',
        style: 'cursor:pointer',
        onclick: () => setCursor(i + 1),
      },
        el('td', { class: 'n', text: String(Math.floor(i / 2) + 1) }),
        el('td', { class: 'mono', text: r.san }),
        el('td', { class: 'mono', text: evalText(r.cp) }),
        el('td', { class: 'mono', text: r.loss ? '-' + (r.loss / 100).toFixed(2) : '—' }),
        el('td', { class: clsSpan(r.cls), text: (classInfo(r.cls) || {}).label || '' })));
    });
    table.append(tbody);
    movesTable.append(table);
  }

  function evalText(cp) {
    if (cp === null || cp === undefined) return '–';
    if (Math.abs(cp) > 50000) return (cp > 0 ? 'M' : '-M');
    return (cp > 0 ? '+' : '') + (cp / 100).toFixed(2);
  }

  function renderSummary() {
    summaryEl.innerHTML = '';
    if (!summary) {
      summaryEl.append(el('div', { class: 'dim', style: 'font-size:.86rem', text: 'No analysis yet. Reviewing a 40-move game takes about half a minute with the default think time.' }));
    } else {
      const c = summary.counts;
      summaryEl.append(
        el('div', { class: 'row', style: 'gap:14px' },
          statBox('Accuracy', `${summary.accuracy}%`),
          statBox('Blunders', String(c.blunder), 'bad'),
          statBox('Mistakes', String(c.mistake), 'warn'),
          statBox('Inaccuracies', String(c.inaccuracy))),
        el('div', { class: 'dim', style: 'font-size:.8rem', text: `Red arrows mark your bad moves; the green arrow shows the engine's move. Click a row to jump there.` }));
    }
    analysisBtnRow.innerHTML = '';
    if (busy) {
      analysisBtnRow.append(el('span', { class: 'dim', style: 'font-size:.84rem', text: 'Analysing…' }),
        el('button', { class: 'btn sm danger', text: 'Stop', onclick: () => { cancel = true; } }));
    } else {
      analysisBtnRow.append(el('button', {
        class: 'btn sm ' + (summary ? '' : 'primary'),
        text: summary ? 'Re-analyse' : 'Analyse game',
        onclick: () => runAnalysis(),
      }), el('span', { class: 'faint', style: 'font-size:.76rem', text: `${state.settings.reviewDepthMs} ms per position` }));
    }
  }

  function statBox(label, value, kind = '') {
    return el('div', { class: 'stat' },
      el('span', { class: 'v', style: kind === 'bad' ? 'color:var(--bad)' : kind === 'warn' ? 'color:var(--warn)' : '', text: value }),
      el('span', { class: 'k', text: label }));
  }

  async function runAnalysis() {
    if (busy) return;
    busy = true;
    cancel = false;
    renderSummary();
    const eng = trainerCtx().engine();
    const perPos = Math.max(60, Math.min(600, state.settings.reviewDepthMs));
    const results = [];
    try {
      for (let i = 0; i < positions.length; i++) {
        if (cancel) break;
        const r = await eng.analyse({ fen: positions[i], movetime: perPos, multipv: 1 });
        const l1 = r.lines[0] || {};
        results.push({ cp: l1.cp, mate: l1.mate, best: l1.move || r.best || null });
        if (i % 2 === 0) {
          feedback.className = 'feedback hint';
          feedback.innerHTML = `Analysing position ${i + 1} of ${positions.length}…`;
        }
        if (i % 4 === 0) await new Promise((res) => setTimeout(res, 0));
      }
      feedback.className = 'feedback hidden';
      if (cancel) { busy = false; renderSummary(); return; }
      const startTurn = game.startFen.split(' ')[1] === 'b' ? 'b' : 'w';
      const evalRows = [];
      for (let i = 0; i < ucis.length; i++) {
        const moverColor = (i % 2 === 0) === (startTurn === 'w') ? 'w' : 'b';
        const bestCp = scoreToCp(results[i]);
        const afterCp = -scoreToCp(results[i + 1] || { cp: 0 });
        const bestUci = results[i] ? results[i].best : null;
        const bestApplied = bestUci ? applyUci(positions[i], bestUci) : null;
        evalRows.push({
          ply: i, fen: positions[i], uci: ucis[i], san: game.moves[i], moverColor,
          cp: afterCp, bestCp, bestUci, bestSan: bestApplied ? bestApplied.san : null,
        });
      }
      rows = reviewMoves(evalRows, userColor);
      summary = reviewSummary(rows, userColor);
      blunders = blunderArrows(rows, { minClass: 'mistake', limit: 60 });
      state.analyses[game.id] = {
        rows, summary, blunders, at: Date.now(),
        plies: ucis.length, userColor,
      };
      persist('analyses');
      renderSummary();
      renderCursor();
      ctxToast(`Analysis done · ${summary.counts.blunder} blunders`, summary.counts.blunder ? '' : 'ok');
    } catch (e) {
      feedback.className = 'feedback bad';
      feedback.textContent = 'Engine error: ' + (e && e.message ? e.message : e);
    } finally {
      busy = false;
      renderSummary();
    }
  }

  function ctxToast(msg, kind) { toast(msg, kind); }

  renderSummary();
  renderCursor();
  if (!rows) setTimeout(() => runAnalysis(), 400);

  // keyboard navigation
  function onKey(e) {
    if (e.key === 'ArrowLeft') { setCursor(cursor - 1); e.preventDefault(); }
    if (e.key === 'ArrowRight') { setCursor(cursor + 1); e.preventDefault(); }
  }
  document.addEventListener('keydown', onKey);
  return { destroy() { cancel = true; document.removeEventListener('keydown', onKey); board.destroy(); } };
}

function detectUserColor(game) {
  if (game.userColor) return game.userColor;
  const name = (state.settings.username || '').toLowerCase();
  if (name) {
    if ((game.white || '').toLowerCase().includes(name)) return 'w';
    if ((game.black || '').toLowerCase().includes(name)) return 'b';
  }
  return 'w';
}
