// js/version.js — the single source of truth for the app version.
//
// The service worker keeps its own cache version (it must change on every asset
// change, independent of the app's semantic version), but everything a person
// sees — About page, Settings, the beta banner — reads from here. tests/pwa.test.mjs
// asserts that package.json, the manifest and the SW cache tag agree with this file.

export const VERSION = '1.18.1-beta.1';
export const CHANNEL = 'beta';           // 'beta' | 'stable'
export const BUILD = '2026-10-20';
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
    version: '1.18.1-beta.1',
    date: '2026-10-21',
    channel: 'beta',
    notes: [
      'Importing a big collection no longer freezes the page: the import hands control back to the browser every ~40 ms and updates its progress line as it goes. During the 9,834-game example import the longest stall dropped from 2.1 s to 0.2 s, and the page stays clickable throughout.',
      'Building the position index for a collection imported before 1.17 works the same way, and says what it is doing while it runs.',
    ],
  },
  {
    version: '1.18.0-beta.1',
    date: '2026-10-21',
    channel: 'beta',
    notes: [
      'A position search no longer comes up empty when the FEN has the side to move the wrong way round: it says so and offers the games with exactly those pieces and the other colour to move, each row showing whose move it is. (A FEN typed by hand, or set up on the board without flipping the turn, is the usual cause.)',
      'Import parses each game with one board instead of rebuilding it from a FEN for every move, which is ~10% faster; the real cost is chess.js validating every SAN, so a 10,000-game collection still takes about two minutes (SCID is faster because it stores moves in a binary format with its own C move generator — a different architecture, not a tuning matter).',
    ],
  },
  {
    version: '1.17.0-beta.1',
    date: '2026-10-21',
    channel: 'beta',
    notes: [
      'Position search in the PGN database is now indexed, the way SCID does it: the first search builds a position index once (about a minute for 10,000 games, with progress) and every search after that is instant — one hash lookup instead of replaying the games.',
      'Freshly imported games are appended to the index, so a new collection is searchable immediately; deleting games or copying a result set into another database rebuilds it on the next search.',
      'The old step-by-step replay is still there as a fallback for browsers where the index cannot be stored, with the "Scan the rest" button.',
    ],
  },
  {
    version: '1.16.0-beta.1',
    date: '2026-10-21',
    channel: 'beta',
    notes: [
      'The PGN database can be searched by position: paste a FEN in the new field and every game is replayed to find the ones that reach it. Each result says at which move the position occurs.',
      'A Board… button beside the field opens the position editor, so you can set the pieces up and use that position without writing a FEN by hand.',
      '"Same position" is the same pieces with the same side to move — castling rights, the en passant square and the clocks are ignored, so a transposition is found too. The player, year and rating filters still narrow the scan first.',
    ],
  },
  {
    version: '1.15.0-beta.1',
    date: '2026-10-21',
    channel: 'beta',
    notes: [
      'The PGN database filters by rating: a White Elo range and a Black Elo range. Fill both ends for 2000-2300, or only “from” for 2700+.',
      'Ratings come from the PGN’s WhiteElo/BlackElo headers (and the WhiteRating/“White rating” spellings some bulletins use) and are shown next to the players in the results.',
      'A game whose PGN carries no rating only matches when no rating bound is set — the filter line says how many such games the database holds. Importing the same PGN again fills those ratings in without duplicating anything.',
      'The import line now keeps its “ratings updated on N” message instead of being wiped as the card redraws.',
    ],
  },
  {
    version: '1.14.1-beta.1',
    date: '2026-10-20',
    channel: 'beta',
    notes: [
      'The logo in the upper-left corner is now the app icon itself — the same toolbox artwork as the installed app — instead of the old letter tile.',
      'On a phone, where the sidebar is hidden, the icon sits at the left of the top bar instead.',
    ],
  },
  {
    version: '1.14.0-beta.1',
    date: '2026-10-20',
    channel: 'beta',
    notes: [
      'Book moves now have their own colour: in a repertoire (browse, edit and the trainer) the move the line plays is a solid violet arrow and the alternatives are dimmer violet, so a green arrow always means the engine.',
      'The Arrows switch now governs every arrow on the board — repertoire moves and the engine’s alike — instead of only the engine layer.',
      'Hints in puzzles and memory quizzes keep their own toggles; they are unaffected.',
    ],
  },
  {
    version: '1.13.0-beta.1',
    date: '2026-10-20',
    channel: 'beta',
    notes: [
      'Set up any position on the analysis board: pick a piece from the palette and click a square, drag pieces around, drag one off the board (or right-click) to remove it.',
      'The setup has its own controls — who is to move, the four castling rights, and an en passant square, which is only offered where a capture can really be made.',
      'Nothing reaches the analysis board unchecked: one king per side, no pawns on the first or last rank, no more pieces than a game can produce, the side that just moved not left in check, castling rights only where the king and rook still stand, and a legal en passant square. Finished positions load with a note instead of silence.',
      'Quick positions to start from: start position, empty board, K+Q vs K, K+R vs K, K+P vs K, the Lucena position and the Philidor position.',
      'Offline fix: the Analyse screen and its editor were missing from the service-worker precache, so they failed with the network off. A test now asserts that every shipped module is precached.',
    ],
  },
  {
    version: '1.12.0-beta.1',
    date: '2026-10-20',
    channel: 'beta',
    notes: [
      'New Analyse board (menu entry after Play): paste a position (FEN) or a whole game (PGN), play any move — a different move becomes a variation beside the recorded one — and step through it with the strip. The session is remembered.',
      'The engine now draws its top three moves as arrows, ranked by thickness and colour: a wide green arrow is what it wants, thin warm arrows are the alternatives (a move that loses ground turns orange or red).',
      'The eval bar shows win/draw/loss (UCI_ShowWDL): three segments plus the numbers, White’s wins first, so a drawn-looking +0.3 is no longer confused with a winning one.',
      'A Think deeper switch keeps the engine on across screens and searches about four times longer per position; it is also in Settings → Engine.',
      'Clicking one of the engine’s moves on the Analyse board plays it; hovering still shows the whole line.',
    ],
  },
  {
    version: '1.11.0-beta.1',
    date: '2026-10-20',
    channel: 'beta',
    notes: [
      'Two display switches beside the engine switch on every board: Arrows shows or hides the engine arrows, Moves shows or hides the engine’s top three moves.',
      'Hover a move in that list (or tap it on a phone) to see the rest of the line — “1. e4 e5 2. Nf3 Nc6 3. Bb5”. Both switches remember their state.',
    ],
  },
  {
    version: '1.10.1-beta.1',
    date: '2026-10-20',
    channel: 'beta',
    notes: [
      'New app icon: a white toolbox holding a gold king with a knight and a rook. Traced to vector, so it stays crisp at every size — and the file is 9.8 kB instead of a raster image.',
      'Install it again (or update it) to see the new icon on your home screen; browsers keep the old artwork until the app updates.',
    ],
  },
  {
    version: '1.10.0-beta.1',
    date: '2026-10-19',
    channel: 'beta',
    notes: [
      'Play is a first-class menu item: opening it offers the new-game dialog (colour, time control, engine strength, which repertoires the engine may use as a book, optional start position), and resumes an unfinished game instead if there is one.',
      'Database search can filter White and Black players separately (the existing “any player” box still matches either side).',
      'About gains a Support section: Ko-fi for the app, and links to Lichess (the openings and puzzles) and The Week in Chess (the example database). Entirely voluntary.',
    ],
  },
  {
    version: '1.9.0-beta.1',
    date: '2026-10-19',
    channel: 'beta',
    notes: [
      'The menu can be rearranged by dragging items in the sidebar (or focus one and press Alt+↑/↓). The order is saved in settings, follows your backups, and the mobile “More” sheet uses it too.',
      'Settings → Menu resets the order to the default.',
    ],
  },
  {
    version: '1.8.0-beta.1',
    date: '2026-10-19',
    channel: 'beta',
    notes: [
      'PGN database: several named databases with a switcher, create/rename/delete; searching, importing and clearing all act on the active database only.',
      'Backup and restore databases as a zip containing the PGN plus a manifest; import a zip into the active database or as a new one.',
      'New database from the current search results in one click.',
      'My games: collections — create, rename, delete, filter by collection, and move games between them.',
    ],
  },
  {
    version: '1.7.0-beta.1',
    date: '2026-10-19',
    channel: 'beta',
    notes: [
      'Game memory (study): a toggle for the move arrow, plus notes — comments and arrows per position, stored with the game and written into the exported PGN as {comment [%cal ...]}. Comments already in an imported PGN are picked up automatically.',
      'Annotations are hidden in quiz mode so they cannot give the answer away.',
      'Back/forward are now two compact buttons (← / → work too, Home/End jump to the ends).',
      'Endgames: the bogus “rook and pawn vs king — bridge” drill is gone. The rook group now has the real Lucena position (+6.6, bridge technique) and the Philidor position (0.00, third-rank defence), both taken from the literature and re-verified with Stockfish.',
    ],
  },
  {
    version: '1.6.0-beta.1',
    date: '2026-10-19',
    channel: 'beta',
    notes: [
      'Starter packs: Rubinstein (White), Rubinstein (Black) and Caro-Kann (Black) repertoires ship with the app — one click builds the tree locally and it behaves like your own repertoire.',
      'Bundled example database (9,834 master games: TWIC 1666 plus Rubinstein) can be imported from the Database screen; it downloads only when asked for.',
    ],
  },
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
