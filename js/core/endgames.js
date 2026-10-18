// js/core/endgames.js — the endgame drill library.
//
// Every drill is a position with a concrete, machine-checkable goal:
//   goal 'mate'    — deliver checkmate within `maxMoves` of your own moves
//   goal 'promote' — promote a pawn (typically inside a won ending)
//   goal 'hold'    — survive `maxMoves` moves without losing (drawish defence)
// Positions were checked with Stockfish so the stated result matches the board
// (see tools/verify-endgames.mjs).

export const ENDGAME_GROUPS = [
  { id: 'mates', title: 'Basic mates', blurb: 'The checkmates every player must be able to deliver without thinking.' },
  { id: 'pawn', title: 'Pawn endings', blurb: 'King activity, the square rule, key squares and stalemate traps.' },
  { id: 'rook', title: 'Rook endings', blurb: 'Lucena and Philidor ideas: bridge building and cutting the king off.' },
  { id: 'patterns', title: 'Mate patterns', blurb: 'Recognise the finishing patterns: back rank, ladder, smothered.' },
];

export const ENDGAME_DRILLS = [
  {
    id: 'kqk-1', group: 'mates', title: 'King + Queen vs King', goal: 'mate', side: 'w',
    fen: '8/8/8/4k3/8/8/4K3/6Q1 w - - 0 1', maxMoves: 20, level: 1,
    tags: ['mate', 'queen'], hint: 'Box the king in with the queen, then walk your king up. Never stalemate.',
  },
  {
    id: 'kqk-2', group: 'mates', title: 'Queen mate, king in the centre', goal: 'mate', side: 'w',
    fen: '8/8/3k4/8/8/8/8/6QK w - - 0 1', maxMoves: 20, level: 1,
    tags: ['mate', 'queen'], hint: 'Shrink the box one rank and one file at a time.',
  },
  {
    id: 'kqk-3', group: 'mates', title: 'Queen mate, king on the edge', goal: 'mate', side: 'w',
    fen: '8/8/8/8/8/2k5/8/1Q1K4 w - - 0 1', maxMoves: 16, level: 1,
    tags: ['mate', 'queen'], hint: 'When the king reaches the edge, bring your own king one move closer then mate.',
  },
  {
    id: 'krk-1', group: 'mates', title: 'King + Rook vs King', goal: 'mate', side: 'w',
    fen: '8/8/8/4k3/8/8/4K3/6R1 w - - 0 1', maxMoves: 30, level: 2,
    tags: ['mate', 'rook'], hint: 'Use the rook to cut the king off, then oppose kings ("the opposition") to drive it back.',
  },
  {
    id: 'krk-2', group: 'mates', title: 'Rook mate, king near the corner', goal: 'mate', side: 'w',
    fen: '8/8/8/8/2k5/8/8/K2R4 w - - 0 1', maxMoves: 24, level: 2,
    tags: ['mate', 'rook'], hint: 'The rook checks from a distance; the king does the escorting.',
  },
  {
    id: 'kbbk-1', group: 'mates', title: 'King + Two Bishops vs King', goal: 'mate', side: 'w',
    fen: '8/8/8/4k3/8/8/2BBK3/8 w - - 0 1', maxMoves: 30, level: 3,
    tags: ['mate', 'bishops'], hint: 'Drive the king to a corner of the bishops\u2019 colour: build a diagonal wall and advance the king.',
  },
  {
    id: 'kbnk-1', group: 'mates', title: 'King + Bishop + Knight vs King', goal: 'mate', side: 'w',
    fen: '8/8/8/4k3/8/8/2NBK3/8 w - - 0 1', maxMoves: 40, level: 4,
    tags: ['mate', 'bishop', 'knight'], hint: 'Force the king to the corner that matches your bishop, then use the "W" knight manoeuvre.',
  },
  {
    id: 'kpk-win-1', group: 'pawn', title: 'King + Pawn vs King — win it', goal: 'promote', side: 'w',
    fen: '4k3/8/8/8/8/8/4K1P1/8 w - - 0 1', maxMoves: 24, level: 2,
    tags: ['pawn', 'promotion'], hint: 'King in front of the pawn, take the opposition, then push.',
  },
  {
    id: 'kpk-win-2', group: 'pawn', title: 'King + Pawn vs King — king ahead', goal: 'promote', side: 'w',
    fen: '8/8/8/8/7k/8/4K1P1/8 w - - 0 1', maxMoves: 26, level: 2,
    tags: ['pawn', 'promotion'], hint: 'Lead with the king. The pawn only moves when the king has taken the key square.',
  },
  {
    id: 'kpk-hold-1', group: 'pawn', title: 'Rook pawn — hold the draw', goal: 'hold', side: 'b',
    fen: 'k7/8/K7/P7/8/8/8/8 w - - 0 1', maxMoves: 20, level: 3,
    tags: ['pawn', 'defence'], hint: 'Stay in the corner. The rook pawn never wins once the defending king reaches a8.',
  },
  {
    id: 'kpk-hold-2', group: 'pawn', title: 'In front of the pawn — hold the draw', goal: 'hold', side: 'b',
    fen: '8/8/8/8/8/5k2/5P2/5K2 b - - 0 1', maxMoves: 20, level: 2,
    tags: ['pawn', 'defence'], hint: 'Keep the opposition: when the white king steps up, step in front of it.',
  },
  {
    id: 'k2pk-1', group: 'pawn', title: 'Two pawns vs king', goal: 'promote', side: 'w',
    fen: '8/8/8/8/4k3/8/3PP1K1/8 w - - 0 1', maxMoves: 24, level: 2,
    tags: ['pawn', 'promotion'], hint: 'Connected pawns win as a pair: push the one the king does not attack.',
  },
  {
    id: 'kpkpk-1', group: 'pawn', title: 'Outside passed pawn — K+2P vs K+P', goal: 'promote', side: 'w',
    fen: '8/8/4k3/8/4p3/2P5/4P3/4K3 w - - 0 1', maxMoves: 30, level: 3,
    tags: ['pawn', 'outside'], hint: 'Trade the e-pawns, walk the king to the queenside and win the black pawn — the c-pawn runs.',
  },
  {
    // The Lucena position as given in the literature: White Kb8, pawn b7, rook c1;
    // Black Kd8, rook a2. White wins (Stockfish +6.6) by building the bridge — the
    // king on b8 blocks its own pawn until it steps out behind the rook.
    id: 'lucena-1', group: 'rook', title: 'Lucena position — build the bridge', goal: 'promote', side: 'w',
    fen: '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1', maxMoves: 40, level: 4,
    tags: ['rook', 'technique', 'lucena'],
    hint: 'The bridge: put the rook on the fourth rank, then walk the king out of the checks — the rook is your shield, and on a7/b8 the pawn promotes safely.',
  },
  {
    // Philidor position (1777): White defends with Ke1, Ra3 against Black Kf4, Pe4,
    // Rh2. Draw (Stockfish 0.00) with the rook staying on the third rank.
    id: 'philidor-1', group: 'rook', title: 'Philidor position — hold the draw', goal: 'hold', side: 'w',
    fen: '8/8/8/8/4pk2/R7/7r/4K3 w - - 0 1', maxMoves: 30, level: 4,
    tags: ['rook', 'defence', 'philidor'],
    hint: 'Third-rank defence: keep the rook on the third rank so the black king can never reach e3, and keep your king in front of the pawn on e1/e2.',
  },
  {
    id: 'backrank-1', group: 'patterns', title: 'Back rank mate in one', goal: 'mate', side: 'w',
    fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', maxMoves: 1, level: 1,
    tags: ['mate', 'backRank'], hint: 'Their king has no escape square: a single rook check ends it.',
  },
  {
    id: 'backrank-2', group: 'patterns', title: 'Back rank — remove the defender', goal: 'mate', side: 'w',
    fen: '3r2k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', maxMoves: 3, level: 3,
    tags: ['mate', 'backRank', 'deflection'], hint: 'Equal rooks on the d-file. Trade on d8 and the back rank falls, because their f8 square is gone.',
  },
];

export function drillById(id) { return ENDGAME_DRILLS.find((d) => d.id === id) || null; }

export function drillsByGroup(group) { return ENDGAME_DRILLS.filter((d) => d.group === group); }

export function goalLabel(goal) {
  return { mate: 'Deliver mate', promote: 'Promote the pawn', hold: 'Hold the draw' }[goal] || goal;
}

/**
 * Judge a drill after the user's move.
 * ctx: { goal, maxMoves, movesPlayed, chess (after move), materialBefore, materialAfter }
 * returns { status:'running'|'win'|'fail', reason }
 */
export function judgeDrill(ctx) {
  const { goal, maxMoves, movesPlayed, state } = ctx;
  const s = state || {};
  if (goal === 'mate') {
    if (s.mate) return { status: 'win', reason: 'Checkmate!' };
    if (s.stalemate) return { status: 'fail', reason: 'Stalemate — the king had no legal move.' };
    if (s.draw) return { status: 'fail', reason: 'The position is drawn.' };
  }
  if (goal === 'promote') {
    if (s.promo) return { status: 'win', reason: 'Pawn promoted!' };
    if (s.mate) return { status: 'win', reason: 'Even better: checkmate!' };
    if (s.stalemate) return { status: 'fail', reason: 'Stalemate — the pawn could not promote.' };
    if (s.draw && !s.promo) return { status: 'fail', reason: 'Drawn: the pawn will not promote.' };
  }
  if (goal === 'hold') {
    if (s.mate) return { status: 'fail', reason: 'Mated — the defence broke.' };
    if (s.stalemate || s.draw) return { status: 'win', reason: 'Held the draw.' };
    if (movesPlayed >= maxMoves) return { status: 'win', reason: 'Held the draw.' };
  }
  if (movesPlayed >= maxMoves) {
    return goal === 'hold'
      ? { status: 'win', reason: 'Held the draw.' }
      : { status: 'fail', reason: `Out of moves (limit ${maxMoves}).` };
  }
  return { status: 'running' };
}

export const ENDGAME_COUNT = ENDGAME_DRILLS.length;
