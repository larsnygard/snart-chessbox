// js/ui/orientation.js — whose side of the board is at the bottom.
//
// Default: the side you are playing sits at the bottom. The setting
// "White always on the bottom" overrides that for players who read the board
// from White's side no matter what they play.

export function orientationFor(settings, color) {
  if (settings && settings.whiteOnBottom) return 'w';
  return color === 'b' ? 'b' : 'w';
}

export const ORIENTATION_HINT = 'Off: the side you play is at the bottom. On: White is always at the bottom.';
