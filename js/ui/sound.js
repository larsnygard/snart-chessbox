// js/ui/sound.js — move sounds, synthesised with WebAudio (no sample files).
// The context is created on the first user gesture; the mute switch only ramps
// the master gain, so toggling sound never throws on autoplay policy.

let ctx = null;
let master = null;
let enabled = true;
let volume = 0.6;

export function configure({ sound, vol } = {}) {
  if (typeof sound === 'boolean') enabled = sound;
  if (typeof vol === 'number') volume = Math.max(0, Math.min(1, vol));
  if (ctx && master) master.gain.value = enabled ? volume : 0;
}

/** Must be called from a user gesture before the first sound. */
export function unlock() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = enabled ? volume : 0;
    master.connect(ctx.destination);
  } catch (e) { ctx = null; }
}

function now() { return ctx ? ctx.currentTime : 0; }

function blip({ freq = 440, dur = 0.06, type = 'sine', gain = 0.3, slide = 0, delay = 0 }) {
  if (!ctx || !enabled) return;
  const t = now() + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function knock({ gain = 0.22, freq = 190, dur = 0.05, delay = 0 }) {
  if (!ctx || !enabled) return;
  const t = now() + delay;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const env = Math.pow(1 - i / len, 2.6);
    data[i] = (Math.random() * 2 - 1) * env;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filt = ctx.createBiquadFilter();
  filt.type = 'bandpass';
  filt.frequency.value = freq * 4;
  filt.Q.value = 0.9;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(filt).connect(g).connect(master);
  src.start(t);
}

export const SOUNDS = {
  move: () => { knock({ gain: 0.18, freq: 210, dur: 0.045 }); blip({ freq: 320, dur: 0.035, type: 'triangle', gain: 0.05 }); },
  capture: () => { knock({ gain: 0.3, freq: 120, dur: 0.09 }); blip({ freq: 180, dur: 0.09, type: 'sawtooth', gain: 0.08, slide: -60 }); },
  castle: () => { knock({ gain: 0.2, freq: 220, dur: 0.05 }); knock({ gain: 0.2, freq: 190, dur: 0.05, delay: 0.09 }); },
  check: () => { blip({ freq: 760, dur: 0.08, type: 'triangle', gain: 0.16 }); blip({ freq: 1040, dur: 0.1, type: 'triangle', gain: 0.14, delay: 0.08 }); },
  promote: () => { [523, 659, 784].forEach((f, i) => blip({ freq: f, dur: 0.12, type: 'triangle', gain: 0.12, delay: i * 0.06 })); },
  illegal: () => { blip({ freq: 140, dur: 0.11, type: 'square', gain: 0.09 }); },
  correct: () => { [660, 880].forEach((f, i) => blip({ freq: f, dur: 0.1, type: 'sine', gain: 0.13, delay: i * 0.08 })); },
  wrong: () => { blip({ freq: 220, dur: 0.14, type: 'sawtooth', gain: 0.1, slide: -80 }); },
  win: () => { [523, 659, 784, 1047].forEach((f, i) => blip({ freq: f, dur: 0.16, type: 'triangle', gain: 0.14, delay: i * 0.09 })); },
  lose: () => { [392, 330, 262].forEach((f, i) => blip({ freq: f, dur: 0.2, type: 'triangle', gain: 0.13, delay: i * 0.12 })); },
  click: () => { blip({ freq: 520, dur: 0.03, type: 'sine', gain: 0.05 }); },
};

export function play(name) {
  if (!enabled) return;
  const fn = SOUNDS[name];
  if (fn) { unlock(); try { fn(); } catch (e) { /* audio is never fatal */ } }
}

/** Sound for a move result object from chessutil.applyUci. */
export function playForMove(res) {
  if (!res) return;
  if (res.mate) return play('check');
  if (res.promo) return play('promote');
  if (res.check) return play('check');
  if (res.captured) return play('capture');
  if (res.flags && (res.flags.includes('k') || res.flags.includes('q'))) return play('castle');
  play('move');
}

export function isEnabled() { return enabled; }
