// js/ui/pieces.js — three piece designs, all dependency-free.
//
//   classic — DejaVu figurines: outlined white pieces, solid black pieces
//   solid   — the solid figurine shape for both colours (white gets a dark rim)
//   minimal — geometric silhouettes drawn for this app
//
// The classic/solid designs come from glyph outlines converted to paths by
// tools/make-pieces.py, so they look identical on every device and never depend
// on a chess font being installed. SVG pieces use currentColor, so one element
// works for both colours; the board CSS supplies --piece-*-stroke.

import { PIECE_PATHS } from './piece-paths.js';

const GEO = {
  p: `
    <circle cx="22.5" cy="15" r="6"/>
    <path d="M16.5 21.5c0 4.5 2 7.5 2 10.5h8c0-3 2-6 2-10.5z"/>
    <rect x="13" y="31.5" width="19" height="5" rx="2.5"/>`,
  r: `<path d="M12 11h4.5v4h3.75v-4h4.5v4h3.75v-4H33v7l-2 2v10h2v5H12v-5h2V20l-2-2z"/>`,
  n: `<path d="M15 32.5c0-6 2-9.5 5-12l-3.2 1.4-2.6-6.2 4.6-2.6c2-2.2 5-2.6 7.6-1 3.3 2 5 6.5 5.4 11.4.3 3.5.7 6.5.7 9z"/>
      <circle cx="20.4" cy="16" r="1.05" fill="var(--piece-white-stroke)"/>`,
  b: `
    <circle cx="22.5" cy="10.8" r="3.2"/>
    <rect x="18.6" y="13.6" width="7.8" height="2.6" rx="1.2"/>
    <path d="M22.5 15.8c7 3.2 9 10 0 14.4-9-4.4-7-11.2 0-14.4z"/>
    <rect x="13.2" y="30.2" width="18.6" height="5.4" rx="2.6"/>`,
  q: `
    <path d="M11.6 20.6 14.4 30h16.2l2.8-9.4-5.6 4-5.3-7.2-5.3 7.2z"/>
    <circle cx="11.8" cy="19" r="2.2"/>
    <circle cx="22.5" cy="15.4" r="2.5"/>
    <circle cx="33.2" cy="19" r="2.2"/>
    <rect x="11" y="29.8" width="23" height="5.4" rx="2.6"/>`,
  k: `
    <rect x="20.7" y="7.4" width="3.6" height="9.6" rx="1.2"/>
    <rect x="18" y="10" width="9" height="3.6" rx="1.2"/>
    <path d="M13 31c0-7 4-11 9.5-11S32 24 32 31z"/>
    <rect x="10.6" y="30.2" width="23.8" height="5.4" rx="2.6"/>`,
};

export const PIECE_SETS = [
  { id: 'classic', name: 'Classic', kind: 'svg' },
  { id: 'outline', name: 'Outline', kind: 'svg' },
  { id: 'minimal', name: 'Minimal', kind: 'svg' },
];

const BOX = 45;
const PAD = 2.8;

/**
 * Which glyph variant supplies the shape for this design + colour.
 *
 * 'classic' uses the SOLID silhouette for both colours and colours the fill:
 * filled white pieces with a dark rim read at 30-40 px, while the hollow
 * outline glyph (used by 'outline') turns into thin wireframe on a phone.
 */
function variantFor(setId, color) {
  if (setId === 'outline') return color === 'w' ? 'w' : 'b';
  return 'b';
}

export function pieceMarkup(setId, type, color) {
  const set = setId === 'minimal' ? 'minimal' : setId === 'outline' ? 'outline' : 'classic';
  if (set === 'minimal') {
    return `<svg viewBox="0 0 45 45" aria-hidden="true" fill="currentColor" stroke="var(--piece-${color === 'w' ? 'white' : 'black'}-stroke)" stroke-width="1.1" stroke-linejoin="round">${GEO[type] || GEO.p}</svg>`;
  }
  const glyph = PIECE_PATHS[variantFor(set, color)]?.[type];
  if (!glyph) return '';
  const [bx, by, bw, bh] = glyph.box;
  const scale = Math.min((BOX - 2 * PAD) / bw, (BOX - 2 * PAD) / bh);
  const tx = (BOX - bw * scale) / 2 - bx * scale;
  const ty = (BOX - bh * scale) / 2 - by * scale;
  // stroke width is in glyph units, so divide by the scale to keep it visually
  // constant; white pieces need a solid dark rim to stay readable on light squares
  const sw = (color === 'w' ? 2.1 : 0.9) / scale;
  return `<svg viewBox="0 0 45 45" aria-hidden="true" shape-rendering="geometricPrecision">
    <g transform="translate(${tx.toFixed(3)} ${ty.toFixed(3)}) scale(${scale.toFixed(4)})">
      <path d="${glyph.d}" fill="currentColor" fill-rule="evenodd"
        stroke="var(--piece-${color === 'w' ? 'white' : 'black'}-stroke)" stroke-width="${sw.toFixed(2)}" stroke-linejoin="round"/>
    </g></svg>`;
}

export function pieceClass(setId) {
  return setId === 'minimal' ? 'svg' : 'svg';
}

/** Preview grid markup for the settings screen. */
export function pieceSetPreview(setId) {
  return ['k', 'q', 'r', 'b', 'n', 'p']
    .map((t) => `<button data-set="${setId}" style="color:var(--piece-white)">${pieceMarkup(setId, t, 'w')}</button>`)
    .join('');
}

export const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
