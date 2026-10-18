// js/version.js — the single source of truth for the app version.
//
// The service worker keeps its own cache version (it must change on every asset
// change, independent of the app's semantic version), but everything a person
// sees — About page, Settings, the beta banner — reads from here. tests/pwa.test.mjs
// asserts that package.json, the manifest and the SW cache tag agree with this file.

export const VERSION = '1.5.0-beta.1';
export const CHANNEL = 'beta';           // 'beta' | 'stable'
export const BUILD = '2026-10-18';
export const IS_BETA = CHANNEL === 'beta';

export const BETA_NOTICE = 'Beta release: features, storage formats and export files may change between versions. Export a backup before updating.';

export const APP_NAME = 'SnartChessBox';
export const REPO_URL = 'https://github.com/larsnygard/snart-chessbox';
export const LIVE_URL = 'https://snart.com/chessbox';

/**
 * Release notes, newest first. Keep entries short and factual — this is what
 * the About page shows, and it doubles as the "what changed" for testers.
 */
export const CHANGELOG = [
  {
    version: '1.5.0-beta.1',
    date: '2026-10-18',
    channel: 'beta',
    notes: [
      'New About page with version, release notes and licence details.',
      'The app is now officially in beta: storage formats and exports may change.',
      'Version numbers come from one place (js/version.js) and are covered by a test.',
    ],
  },
  {
    version: '1.4.1',
    date: '2026-10-18',
    notes: [
      'Right-click annotations on every board: circles (green/red/yellow) and arrows, with Shift/Alt/Ctrl to pick a colour.',
      'Drawing the same arrow again removes it; Esc clears annotations.',
    ],
  },
  {
    version: '1.4.0',
    date: '2026-10-18',
    notes: [
      'Play vs engine is a real game board: new-game dialog (colour, time control, strength, book, start position).',
      'Clocks with increment, flag falls.',
      'Switch sides and export the game to a repertoire.',
      'Moves form a tree: jump back in the score sheet and play a variation; delete moves and variations.',
      'Syntax and import-resolution tests so a broken module cannot ship.',
    ],
  },
  {
    version: '1.3.1',
    date: '2026-10-18',
    notes: [
      'Simultan: animated board change (directional slide) and a configurable switch delay, including manual switching.',
    ],
  },
  {
    version: '1.3.0',
    date: '2026-10-18',
    notes: [
      'The side you play is at the bottom; setting for "White always at the bottom".',
      'The board no longer scrolls the page while playing.',
      'Sessions resume after leaving the board (and a "continue" card on Home).',
      'Engine settings dialog from any board; play with your repertoires as the engine’s book.',
      'New PGN database with import, search by player/event/year/result/ECO, and repertoire building.',
      'Repertoire creation and import from a PGN file with a player-name filter.',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-10-18',
    notes: [
      'Renamed to SnartChessBox (storage is migrated automatically).',
      'New Simultan module: several boards at once with background thinking debt.',
      'Mobile pieces redrawn as filled silhouettes; two-row tool strip on phones.',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-10-18',
    notes: [
      'Eval bar, engine switch, move navigation and "play engine from this position" on every board.',
      'Repertoire browse mode with arrows for every continuation and per-move editing.',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-10-18',
    notes: [
      'First release: openings, endgame drills, puzzles, game memory, game review, exercise sets, PWA/offline.',
    ],
  },
];

export function versionLabel() {
  return `${APP_NAME} ${VERSION}`;
}
