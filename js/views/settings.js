// js/views/settings.js — engine, board, sound, data and about.

import { state, navigate, persist, saveSettings, data } from '../app.js';
import { el, icon, toast, modal, confirmDialog, fmtTime } from '../ui/components.js';
import { DEFAULT_SETTINGS } from '../ui/store.js';
import { pieceMarkup, PIECE_SETS } from '../ui/pieces.js';
import * as sound from '../ui/sound.js';
import { makeBundle, serializeBundle, parseBundle, mergeById, mergeProgress, download, exportName, fileToText } from '../core/backup.js';
import { describeSpread } from '../core/evalband.js';
import { buildPGN } from '../core/pgn.js';
import { ENDGAME_DRILLS } from '../core/endgames.js';

const VERSION = '1.2.0';
const THEMES = [
  { id: 'forest', name: 'Forest', light: '#eeeed2', dark: '#769656' },
  { id: 'walnut', name: 'Walnut', light: '#f0d9b5', dark: '#b58863' },
  { id: 'ocean', name: 'Ocean', light: '#dee3e6', dark: '#8ca2ad' },
  { id: 'slate', name: 'Slate', light: '#c9ced6', dark: '#5d6570' },
  { id: 'midnight', name: 'Midnight', light: '#9aa2b1', dark: '#3b4252' },
  { id: 'paper', name: 'Paper', light: '#f7f2e7', dark: '#cbb894' },
];
const STRENGTHS = [800, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500, 0];

export function render(host) {
  const s = state.settings;

  host.append(el('div', { class: 'card', style: 'margin-bottom:14px' },
    el('h2', { text: 'Settings' }),
    el('p', { class: 'dim', style: 'margin:0;font-size:.86rem', text: 'Everything is stored on this device only. Exports below give you a portable backup.' })));

  // ---------------------------------------------------------------- engine
  const thinkOut = el('span', { class: 'badge', text: fmtTime(s.thinkMs) });
  const think = el('input', { type: 'range', min: '50', max: '3000', step: '25', value: String(s.thinkMs) });
  think.addEventListener('input', () => { thinkOut.textContent = fmtTime(Number(think.value)); s.thinkMs = Number(think.value); save(); });

  const strengthOut = el('span', { class: 'badge', text: s.strength ? `${s.strength} Elo` : 'Full strength' });
  const strength = el('input', { type: 'range', min: '400', max: '3200', step: '50', value: String(s.strength || 3200) });
  const strengthRow = el('div', { class: 'filters', style: 'margin-top:8px' });
  const strengthChips = [];
  for (const elo of STRENGTHS) {
    const chip = el('button', {
      class: 'chip' + ((s.strength || 0) === elo ? ' on' : ''),
      text: elo ? String(elo) : 'Max',
      onclick: () => {
        s.strength = elo;
        strength.value = String(elo || 3200);
        strengthOut.textContent = elo ? `${elo} Elo` : 'Full strength';
        for (const c of strengthChips) c.classList.remove('on');
        chip.classList.add('on');
        save();
      },
    });
    strengthChips.push(chip);
    strengthRow.append(chip);
  }
  strength.addEventListener('input', () => {
    const v = Number(strength.value);
    s.strength = v >= 3200 ? 0 : v;
    strengthOut.textContent = s.strength ? `${s.strength} Elo` : 'Full strength';
    for (const c of strengthChips) c.classList.remove('on');
    save();
  });

  const spreadOut = el('span', { class: 'badge', text: `±${(s.spreadCp / 100).toFixed(2)}` });
  const spread = el('input', { type: 'range', min: '0', max: '300', step: '10', value: String(s.spreadCp) });
  const spreadNote = el('div', { class: 'dim', style: 'font-size:.82rem' });
  function spreadText() {
    spreadNote.innerHTML = s.spreadCp === 0
      ? 'The engine always plays its best move.'
      : `The engine searches the top moves and may play any move whose evaluation is within <b>${(s.spreadCp / 100).toFixed(2)} pawns of the best move</b>. With a best move of +1.30 it may choose anything down to ${((1.3 - s.spreadCp / 100)).toFixed(2)}, but never a move that throws the game away.`;
  }
  spread.addEventListener('input', () => {
    s.spreadCp = Number(spread.value);
    spreadOut.textContent = `±${(s.spreadCp / 100).toFixed(2)}`;
    spreadText();
    save();
  });
  spreadText();

  const weighting = el('select', {},
    el('option', { value: 'uniform', text: 'Equal chance for every move in the window' }),
    el('option', { value: 'softmax', text: 'Favour the better moves' }),
    el('option', { value: 'best', text: 'Always the best move (spread ignored)' }));
  weighting.value = s.spreadWeighting || 'uniform';
  weighting.addEventListener('change', () => { s.spreadWeighting = weighting.value; save(); });

  const testOut = el('div', { class: 'feedback', style: 'margin-top:10px' });
  const testBtn = el('button', {
    class: 'btn sm', text: 'Test this setting', onclick: async () => {
      testOut.className = 'feedback hint';
      testOut.textContent = 'Asking the engine…';
      try {
        const { getEngine } = await import('../app.js');
        const eng = getEngine();
        const res = await eng.analyse({ fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 2 4', movetime: Math.max(200, s.thinkMs), multipv: 5, elo: s.strength });
        const best = Math.max(...res.lines.map((l) => (l.mate != null ? (l.mate > 0 ? 100000 : -100000) : l.cp)));
        const rows = res.lines.map((l) => {
          const v = l.mate != null ? (l.mate > 0 ? 100000 : -100000) : l.cp;
          const ok = s.spreadCp > 0 ? v >= best - s.spreadCp : v === best;
          return `<div>${ok ? '✅' : '⛔'} <span class="mono">${l.move}</span> ${l.mate != null ? 'M' + l.mate : (l.cp / 100).toFixed(2)}</div>`;
        }).join('');
        testOut.innerHTML = `<b>Allowed at ±${(s.spreadCp / 100).toFixed(2)}:</b><div class="mono" style="font-size:.8rem;margin-top:6px">${rows}</div>`;
      } catch (e) {
        testOut.className = 'feedback bad';
        testOut.textContent = 'Engine not ready: ' + (e && e.message ? e.message : e);
      }
    },
  });

  const engineCard = el('div', { class: 'card', style: 'margin-bottom:14px' },
    el('div', { class: 'card-head' }, el('h3', { text: 'Engine' }), el('div', { class: 'spacer' }),
      el('span', { class: 'badge', text: 'Stockfish 19 lite · WASM' })),
    el('label', { class: 'field' }, el('div', { class: 'row' }, el('span', { text: 'Think time per move' }), el('div', { class: 'spacer' }), thinkOut), think),
    el('label', { class: 'field' }, el('div', { class: 'row' }, el('span', { text: 'Playing strength' }), el('div', { class: 'spacer' }), strengthOut), strength, strengthRow,
      el('div', { class: 'faint', style: 'font-size:.76rem;margin-top:6px', text: 'Stockfish limits itself with UCI_Elo from 1320 up; below that the skill level and a shorter think time make it beatable.' })),
    el('label', { class: 'field' }, el('div', { class: 'row' }, el('span', { text: 'Randomness window (top moves)' }), el('div', { class: 'spacer' }), spreadOut), spread, spreadNote),
    el('label', { class: 'field' }, el('span', { text: 'How to pick inside the window' }), weighting),
    testBtn, testOut);
  host.append(engineCard);

  // ---------------------------------------------------------------- training
  const trainingCard = el('div', { class: 'card', style: 'margin-bottom:14px' },
    el('div', { class: 'card-head' }, el('h3', { text: 'Training' })),
    toggle('hints', 'Hints on', 'Draw the next book move or the engine\'s suggestion as an arrow.'),
    toggle('autoAdvance', 'Advance automatically', 'Jump to the next exercise after a solved item.'),
    toggle('showEval', 'Show engine evaluation', 'Display the evaluation of the last search.'),
    el('label', { class: 'field', style: 'margin-top:8px' },
      el('span', { text: 'Your name (used to find your games in imported PGN and to greet you)' }),
      el('input', { type: 'text', value: s.username || '', placeholder: 'e.g. Lars', oninput: (e) => { s.username = e.target.value; save(); } })));
  host.append(trainingCard);

  function toggle(key, label, hint) {
    const cb = el('input', { type: 'checkbox', checked: !!s[key] || undefined });
    cb.checked = !!s[key];
    cb.addEventListener('change', () => { s[key] = cb.checked; save(); if (key === 'sound') sound.configure({ sound: s.sound }); });
    return el('label', { class: 'check' }, cb, el('div', {}, el('span', { text: label }), hint ? el('div', { class: 'faint', style: 'font-size:.76rem', text: hint }) : null));
  }

  // ---------------------------------------------------------------- board
  const themeRow = el('div', { class: 'swatches' });
  for (const t of THEMES) {
    const sw = el('button', {
      class: 'swatch' + (s.boardTheme === t.id ? ' on' : ''), title: t.name,
      html: `<div class="mini" style="--sq-light:${t.light};--sq-dark:${t.dark}"><i></i><i></i><i></i><i></i></div>`,
      onclick: () => {
        s.boardTheme = t.id;
        for (const c of themeRow.children) c.classList.remove('on');
        sw.classList.add('on');
        save(); preview();
      },
    });
    themeRow.append(sw);
  }

  const pieceRow = el('div', { class: 'piece-preview' });
  for (const ps of PIECE_SETS) {
    const b = el('button', {
      class: s.pieceSet === ps.id ? 'on' : '', title: ps.name,
      html: `<div style="color:var(--piece-white);width:100%;height:100%;display:grid;place-items:center">${pieceMarkup(ps.id, 'n', 'w')}</div>`,
      onclick: () => { s.pieceSet = ps.id; for (const c of pieceRow.children) c.classList.remove('on'); b.classList.add('on'); save(); preview(); },
    });
    pieceRow.append(b);
  }

  const previewHost = el('div', { style: 'width:220px' });
  const boardCard = el('div', { class: 'card', style: 'margin-bottom:14px;display:flex;gap:18px;flex-wrap:wrap' },
    el('div', { style: 'flex:1;min-width:260px' },
      el('div', { class: 'card-head' }, el('h3', { text: 'Board & pieces' })),
      el('div', { class: 'dim', style: 'font-size:.8rem;margin-bottom:6px', text: 'Board theme' }), themeRow,
      el('div', { class: 'dim', style: 'font-size:.8rem;margin:12px 0 6px', text: 'Piece design' }), pieceRow,
      el('div', { style: 'margin-top:10px' },
        toggle('whiteOnBottom', 'White always at the bottom', 'Off: the side you play is at the bottom (recommended).'),
        toggle('coords', 'Coordinates', ''),
        toggle('animate', 'Animate moves', ''))),
    previewHost);
  host.append(boardCard);

  let previewBoard = null;
  async function preview() {
    const { createBoard } = await import('../ui/board.js');
    previewHost.innerHTML = '';
    previewBoard = createBoard(previewHost, {
      fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 2 4',
      theme: s.boardTheme, pieceSet: s.pieceSet, coords: s.coords, animate: false, interactive: false,
    });
  }
  preview();

  // ---------------------------------------------------------------- sound
  const vol = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(s.volume) });
  vol.addEventListener('input', () => { s.volume = Number(vol.value); sound.configure({ vol: s.volume }); save(); });
  const soundCard = el('div', { class: 'card', style: 'margin-bottom:14px' },
    el('div', { class: 'card-head' }, el('h3', { text: 'Sound' })),
    toggle('sound', 'Move sounds', 'Synthesised with WebAudio — no audio files, works offline.'),
    el('label', { class: 'field', style: 'max-width:320px' }, el('span', { text: 'Volume' }), vol),
    el('div', { class: 'row' },
      ...['move', 'capture', 'check', 'promote', 'win'].map((n) => el('button', { class: 'btn sm', text: n, onclick: () => { sound.unlock(); sound.play(n); } }))));
  host.append(soundCard);

  // ---------------------------------------------------------------- data
  const bundleInput = el('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
  bundleInput.addEventListener('change', async () => {
    const f = bundleInput.files && bundleInput.files[0];
    if (!f) return;
    try {
      const text = await fileToText(f);
      importBundle(text);
    } catch (e) { toast(String(e.message || e), 'bad'); }
    bundleInput.value = '';
  });

  const dataCard = el('div', { class: 'card', style: 'margin-bottom:14px' },
    el('div', { class: 'card-head' }, el('h3', { text: 'Your data' })),
    el('p', { class: 'dim', style: 'font-size:.84rem', html: 'The bundle is one JSON file with settings, repertoires, sets, imported games, memory games and progress. PGN export writes game records only.' }),
    el('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
      el('button', { class: 'btn', html: `${icon('download')}<span>Export bundle</span>`, onclick: exportBundle }),
      el('button', { class: 'btn', html: `${icon('upload')}<span>Import bundle</span>`, onclick: () => bundleInput.click() }),
      el('button', { class: 'btn', text: 'Export games (PGN)', onclick: exportGames }),
      el('button', { class: 'btn', text: 'Export settings (JSON)', onclick: exportSettings }),
      bundleInput),
    el('div', { class: 'row', style: 'margin-top:12px' },
      el('button', {
        class: 'btn danger', text: 'Reset progress',
        onclick: async () => {
          if (await confirmDialog({ title: 'Reset all progress?', text: 'Solved puzzles, drills and lines are forgotten. Your repertoires, sets and games stay.' })) {
            state.progress = {};
            persist('progress', true);
            toast('Progress cleared', 'ok');
          }
        },
      }),
      el('button', {
        class: 'btn danger', text: 'Erase everything',
        onclick: async () => {
          if (await confirmDialog({ title: 'Erase all local data?', text: 'Settings, repertoires, sets, games and progress will be deleted from this device.' })) {
            const { store } = await import('../app.js');
            await store.clearAll();
            location.reload();
          }
        },
      })),
    el('div', { class: 'faint', style: 'font-size:.78rem;margin-top:10px' },
      el('span', { id: 'storageInfo', text: 'Storage: —' })));
  host.append(dataCard);

  (async () => {
    try {
      const est = await navigator.storage.estimate();
      const used = (est.usage / 1048576).toFixed(1);
      const info = document.getElementById('storageInfo');
      if (info) info.textContent = `Storage used: ${used} MB${est.quota ? ` of ${(est.quota / 1048576).toFixed(0)} MB available` : ''}`;
    } catch (e) { /* ignore */ }
  })();

  function exportBundle() {
    const bundle = makeBundle(state);
    download(`${exportName()}.json`, serializeBundle(bundle), 'application/json');
    toast('Bundle exported', 'ok');
  }

  function exportSettings() {
    download(`${exportName('snart-chess-settings')}.json`, JSON.stringify(state.settings, null, 2), 'application/json');
    toast('Settings exported', 'ok');
  }

  function exportGames() {
    const pgns = (state.games || []).map((g) => buildPGN({
      headers: { Event: g.event, Date: g.date || '????.??.??', White: g.white, Black: g.black, Result: g.result || '*' },
      moves: g.moves, result: g.result || '*', startFen: g.startFen,
    }));
    download(`${exportName('snart-chess-games')}.pgn`, pgns.join('\n'), 'application/x-chess-pgn');
    toast('Games exported', 'ok');
  }

  function importBundle(text) {
    const b = parseBundle(text);
    const mode = el('select', {}, el('option', { value: 'merge', text: 'Merge with what is here (recommended)' }), el('option', { value: 'replace', text: 'Replace everything' }));
    const summary = el('div', { class: 'dim', style: 'font-size:.84rem', html:
      `Backup from ${b.exportedAt || 'unknown date'}:<br>${b.repertoires.length} repertoires · ${b.sets.length} sets · ${b.games.length} games · ${b.memoryGames.length} memory games · ${Object.keys(b.progress).length} progress entries` });
    modal({
      title: 'Import bundle',
      body: el('div', {}, summary, el('label', { class: 'field', style: 'margin-top:12px' }, el('span', { text: 'Import mode' }), mode)),
      actions: [
        { label: 'Cancel' },
        {
          label: 'Import', primary: true, onClick: () => {
            const m = mode.value;
            if (b.settings) state.settings = { ...state.settings, ...b.settings };
            state.repertoires = mergeById(state.repertoires, b.repertoires, { mode });
            state.sets = mergeById(state.sets, b.sets, { mode });
            state.games = mergeById(state.games, b.games, { mode });
            state.memoryGames = mergeById(state.memoryGames, b.memoryGames, { mode });
            state.progress = mergeProgress(state.progress, b.progress);
            for (const k of ['repertoires', 'sets', 'games', 'memoryGames', 'progress']) persist(k, true);
            saveSettings();
            toast('Backup imported', 'ok');
            navigate('/home');
          },
        },
      ],
    });
  }

  // ---------------------------------------------------------------- about
  host.append(el('div', { class: 'card' },
    el('h3', { text: 'About' }),
    el('div', { class: 'dim', style: 'font-size:.84rem' },
      el('p', { html: `<b>SnartChessBox</b> v${VERSION} · AGPL-3.0-or-later` }),
      el('p', { html: 'A local-first training tool. The board, the opening tree, the puzzles and the engine all run in your browser; installing the app caches everything so it works with no network at all.' }),
      el('p', { html: 'Engine: <a href="https://github.com/nmrugg/stockfish.js" target="_blank" rel="noopener">Stockfish.js 19</a> (GPL-3.0). Rules: <a href="https://github.com/jhlywa/chess.js" target="_blank" rel="noopener">chess.js</a> (BSD-2-Clause). Openings: <a href="https://github.com/lichess-org/chess-openings" target="_blank" rel="noopener">Lichess opening database</a> (CC0). Puzzles: <a href="https://database.lichess.org/#puzzles" target="_blank" rel="noopener">Lichess puzzle database</a> (CC0).' }),
      el('p', { class: 'faint', html: 'Data stays on this device. Exports are the only way data leaves it.' }))));
  host.append(el('div', { style: 'height:30px' }));

  function save() { saveSettings(); }

  return { destroy() { if (previewBoard) previewBoard.destroy(); } };
}
