// js/ui/components.js — tiny DOM helpers, icons, toasts, modals.
// No framework: everything returns real elements so screens stay readable.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of children.flat(3)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

const ICONS = {
  home: '<path d="M3 11.2 12 4l9 7.2V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5V5.5"/><path d="M9 7h7M9 11h7"/>',
  crown: '<path d="M3 18h18l-1.5-9-4.5 4L12 6l-3 7-4.5-4z"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  puzzle: '<path d="M10 4h4v3a2 2 0 1 0 4 0V4h3v6h-3a2 2 0 1 0 0 4h3v6h-6v-3a2 2 0 1 0-4 0v3H4v-6h3a2 2 0 1 0 0-4H4V4h6z"/>',
  brain: '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-1 5.8V16a3 3 0 0 0 4 2.8V4z"/><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 1 5.8V16a3 3 0 0 1-4 2.8V4z"/>',
  game: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h4M9 8v4M15 9h.01M17 12h.01M15 12h.01M17 9h.01"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  play: '<path d="M7 4.5v15l13-7.5z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
  start: '<path d="M18 5v14M17 12 5 5v14z"/>',
  end: '<path d="M6 5v14M7 12l12 7V5z"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 1 3.6 10.8c-.6.5-.6 1.2-.6 2.2h-6c0-1-.1-1.7-.6-2.2A6 6 0 0 1 12 3z"/>',
  download: '<path d="M12 4v10"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/>',
  upload: '<path d="M12 20V9"/><path d="m7 13 5-5 5 5"/><path d="M5 4h14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  check: '<path d="m5 13 4 4L19 7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  rotate: '<path d="M4 10a8 8 0 0 1 13.7-5.3L20 7"/><path d="M20 3v4h-4"/><path d="M20 14a8 8 0 0 1-13.7 5.3L4 17"/><path d="M4 21v-4h4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.5l4 2.4"/>',
  flame: '<path d="M12 3c3 4 5 6 5 9a5 5 0 0 1-10 0c0-1.4.6-2.6 1.5-3.7C9.7 10 12 8 12 3z"/>',
  star: '<path d="m12 4 2.4 5 5.6.8-4 4 .9 5.6-4.9-2.7-4.9 2.7.9-5.6-4-4 5.6-.8z"/>',
  dots: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.6v.1"/>',
  shuffle: '<path d="M17 4h4v4"/><path d="M21 4 4 21"/><path d="M17 20h4v-4"/><path d="M3 4l6 6"/>',
  pencil: '<path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m14.5 5.5 4 4"/>',
  plus2: '<path d="M12 6v12M6 12h12"/>',
};

export function icon(name, cls = 'ico') {
  const path = ICONS[name] || ICONS.info;
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

export function iconEl(name, cls = 'ico') {
  const span = document.createElement('span');
  span.innerHTML = icon(name, cls);
  return span.firstElementChild;
}

// ---- toasts -------------------------------------------------------------
let toastHost = null;
export function toast(msg, kind = '', ttl = 2600) {
  if (!toastHost) {
    toastHost = el('div', { class: 'toasts' });
    document.body.append(toastHost);
  }
  const t = el('div', { class: `toast ${kind}`, text: msg });
  toastHost.append(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .25s'; }, ttl);
  setTimeout(() => t.remove(), ttl + 320);
}

// ---- modal --------------------------------------------------------------
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const back = el('div', { class: 'modal-back' });
  const box = el('div', { class: 'modal', style: wide ? 'width:min(860px,100%)' : '' });
  const head = el('div', { class: 'modal-head' },
    el('h2', { text: title || '', style: 'margin:0;font-size:1.02rem' }),
    el('div', { class: 'spacer' }),
    el('button', { class: 'btn ghost icon', onclick: close, html: icon('x') }));
  const bodyEl = el('div', { class: 'modal-body' });
  if (body) bodyEl.append(body);
  const foot = el('div', { class: 'modal-foot' });
  for (const a of actions) {
    foot.append(el('button', {
      class: 'btn ' + (a.primary ? 'primary' : a.danger ? 'danger' : ''),
      text: a.label,
      onclick: async () => { const keep = a.onClick ? await a.onClick() : null; if (keep !== false) close(); },
    }));
  }
  box.append(head, bodyEl);
  if (actions.length) box.append(foot);
  back.append(box);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  document.body.append(back);
  function close() { back.remove(); document.removeEventListener('keydown', onKey); onClose && onClose(); }
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  return { close, body: bodyEl, el: box };
}

export function confirmDialog({ title = 'Are you sure?', text = '', confirmLabel = 'Delete', danger = true } = {}) {
  return new Promise((resolve) => {
    let decided = false;
    const m = modal({
      title,
      body: el('p', { text, class: 'dim' }),
      actions: [
        { label: 'Cancel', onClick: () => { decided = true; resolve(false); } },
        { label: confirmLabel, danger, onClick: () => { decided = true; resolve(true); } },
      ],
      onClose: () => { if (!decided) resolve(false); },
    });
    return m;
  });
}

export function sheet(title, items) {
  const back = el('div', { class: 'sheet-back' });
  const box = el('div', { class: 'sheet' });
  box.append(el('div', { style: 'font-size:.8rem;color:var(--text-faint);padding:0 4px 6px', text: title }));
  for (const it of items) {
    box.append(el('button', {
      class: 'nav-item', html: `${icon(it.icon)}<span>${it.label}</span>`,
      onclick: () => { back.remove(); it.onClick && it.onClick(); },
    }));
  }
  back.append(box);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) back.remove(); });
  document.body.append(back);
}

export function fmtPct(n) { return `${Math.round(n)}%`; }
export function pad2(n) { return String(n).padStart(2, '0'); }
export function fmtTime(ms) {
  if (ms === null || ms === undefined) return '–';
  const s = ms / 1000;
  return s < 1 ? `${Math.round(ms)} ms` : `${s.toFixed(s < 10 ? 1 : 0)} s`;
}
export function debounce(fn, ms = 180) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
