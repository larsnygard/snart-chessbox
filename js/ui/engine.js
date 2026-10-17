// js/ui/engine.js — Stockfish (WASM, in a Web Worker) with UCI.
//
// One Engine instance = one worker. Requests are serialised through a promise
// queue so screens can fire analysis without racing each other.
//
// Strength model (Stockfish 19 lite):
//   UCI_LimitStrength + UCI_Elo   — the honest way to play weaker (>=1320)
//   Skill Level                   — sub-1320, where UCI_Elo bottoms out
//   MultiPV + eval spread         — "human-ish" move choice (see core/evalband)
//
// Everything is local: no network, no server, fully offline once installed.

import { pickWithin } from '../core/evalband.js';
import { scoreToCp } from '../core/chessutil.js';

// The multi-threaded "lite" build needs SharedArrayBuffer (cross-origin
// isolation headers), which a plain static host cannot provide — so the app
// ships the single-threaded build, which works everywhere.
const DEFAULT_SCRIPT = 'engines/stockfish-19-lite-single.js';

export class Engine {
  constructor({ script = DEFAULT_SCRIPT, name = 'Stockfish 19 lite' } = {}) {
    this.script = script;
    this.name = name;
    this.worker = null;
    this.ready = false;
    this.starting = null;
    this.queue = Promise.resolve();
    this.onInfo = null;
    this.lastError = null;
    this._state = null;
  }

  async start() {
    if (this.ready) return this;
    if (this.starting) return this.starting;
    this.starting = new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Engine did not start (timeout)'));
      }, 45000);
      try {
        this.worker = new Worker(this.script, { type: 'classic' });
      } catch (e) {
        clearTimeout(timer);
        settled = true;
        reject(new Error(`Could not start engine: ${e.message}`));
        return;
      }
      let uciok = false;
      this.worker.onmessage = (ev) => this._line(String(ev.data), () => {
        uciok = true;
        this._send('isready');
      }, () => {
        if (!uciok || settled) return;
        settled = true;
        clearTimeout(timer);
        this.ready = true;
        resolve(this);
      });
      this.worker.onerror = (e) => {
        this.lastError = e.message || 'worker error';
        if (!settled) { settled = true; clearTimeout(timer); reject(new Error(this.lastError)); }
      };
      this._send('uci');
    });
    return this.starting;
  }

  _send(cmd) {
    if (this.worker) this.worker.postMessage(cmd);
  }

  _line(line, onUciok, onReadyok) {
    if (line === 'uciok') { onUciok && onUciok(); return; }
    if (line === 'readyok') { onReadyok && onReadyok(); return; }
    const st = this._state;
    if (!st) return;
    if (line.startsWith('info ') && line.includes(' depth ')) {
      const depth = num(/ depth (\d+)/, line);
      const multipv = num(/ multipv (\d+)/, line) ?? 1;
      const cpM = / score (cp|mate) (-?\d+)/.exec(line);
      const pv = (line.match(/ pv (.*)$/) || [])[1] || '';
      const move = pv.split(' ')[0] || null;
      if (cpM) {
        const entry = {
          multipv,
          depth,
          move,
          cp: cpM[1] === 'cp' ? parseInt(cpM[2], 10) : null,
          mate: cpM[1] === 'mate' ? parseInt(cpM[2], 10) : null,
          pv,
        };
        st.lines.set(multipv, entry);
        if (this.onInfo && multipv === 1) this.onInfo(entry);
      }
      return;
    }
    if (line.startsWith('bestmove')) {
      const parts = line.split(/\s+/);
      const best = parts[1] && parts[1] !== '(none)' ? parts[1] : null;
      const lines = Array.from(st.lines.values()).sort((a, b) => a.multipv - b.multipv);
      st.resolve({ best, lines, depth: lines.length ? Math.max(...lines.map((l) => l.depth || 0)) : 0 });
      this._state = null;
    }
  }

  _enqueue(fn) {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  async _configure(opts) {
    const { elo, movetime, multipv } = opts;
    const cmds = ['setoption name Threads value ' + (opts.threads || 1), 'setoption name Hash value ' + (opts.hash || 64)];
    if (multipv && multipv > 1) cmds.push(`setoption name MultiPV value ${Math.min(8, multipv)}`);
    else cmds.push('setoption name MultiPV value 1');
    if (elo && elo >= 1320) {
      cmds.push('setoption name UCI_LimitStrength value true');
      cmds.push(`setoption name UCI_Elo value ${Math.min(3190, Math.round(elo))}`);
      cmds.push('setoption name Skill Level value 20');
    } else if (elo) {
      // Below Stockfish's Elo floor: clamp the Elo and drop the skill level too.
      cmds.push('setoption name UCI_LimitStrength value true');
      cmds.push('setoption name UCI_Elo value 1320');
      const skill = Math.max(0, Math.min(4, Math.round((elo - 400) / 240)));
      cmds.push(`setoption name Skill Level value ${skill}`);
    } else {
      cmds.push('setoption name UCI_LimitStrength value false');
      cmds.push('setoption name Skill Level value 20');
    }
    // The worker treats each message as ONE UCI command — a newline-joined
    // string silently does nothing, which is exactly how MultiPV (and the whole
    // eval-spread feature) can appear to work while only ever returning the best move.
    for (const cmd of cmds) this._send(cmd);
    return movetime;
  }

  /** One search. Resolves { best, lines:[{move, cp, mate, multipv, pv}], depth }. */
  analyse({ fen, movetime = 400, depth = 0, multipv = 1, elo = 0, nodes = 0 } = {}) {
    return this._enqueue(async () => {
      await this.start();
      await this._configure({ elo, multipv });
      this._state = { lines: new Map(), resolve: null };
      const p = new Promise((resolve) => { this._state.resolve = resolve; });
      this._send(`position fen ${fen}`);
      const go = nodes ? `go nodes ${nodes}` : depth ? `go depth ${depth}` : `go movetime ${Math.max(30, Math.round(movetime))}`;
      this._send(go);
      const budget = nodes ? 30000 : (depth ? 30000 : movetime + 5000);
      const result = await Promise.race([p, new Promise((r) => setTimeout(() => r(null), budget))]);
      if (!result) {
        this._send('stop');
        const late = await Promise.race([p, new Promise((r) => setTimeout(() => r(null), 1500))]);
        this._state = null;
        return late || { best: null, lines: [], depth: 0 };
      }
      return result;
    });
  }

  /**
   * Choose a move, optionally inside the "top N within +/- spread" window.
   * Returns { uci, lines, best, chosen }.
   */
  pickMove({ fen, movetime = 400, spreadCp = 0, elo = 0, weighting = 'uniform', rng = Math.random, maxCandidates = 4 } = {}) {
    const multipv = spreadCp > 0 ? Math.max(3, Math.min(5, maxCandidates)) : 1;
    return this.analyse({ fen, movetime, multipv, elo }).then((res) => {
      const lines = res.lines.filter((l) => l.move);
      if (!lines.length) return { uci: res.best, lines: [], best: null };
      // Side-to-move scores arrive from the engine's point of view already.
      const scored = lines.map((l) => ({ move: l.move, score: { cp: l.cp ?? undefined, mate: l.mate ?? undefined }, raw: l }));
      const pick = spreadCp > 0 ? pickWithin(scored, spreadCp, rng, weighting) : scored[0];
      const chosen = pick || scored[0];
      return {
        uci: chosen.move,
        chosen: chosen.raw,
        best: scored[0].raw,
        bestValue: scoreToCp(scored[0].score),
        lines: scored.map((s) => s.raw),
      };
    });
  }

  /** Single evaluation from the side-to-move's point of view. */
  async evalFen(fen, { movetime = 150, elo = 0 } = {}) {
    const res = await this.analyse({ fen, movetime, multipv: 1, elo });
    const l = res.lines[0];
    if (!l) return { cp: 0, mate: null, best: res.best };
    return { cp: l.cp, mate: l.mate, best: res.best };
  }

  /** MultiPV scores for given candidate moves at one position: { uci: cp }. */
  async evalMoves(fen, ucis, { movetime = 200 } = {}) {
    const multipv = Math.min(8, Math.max(2, ucis.length));
    const res = await this.analyse({ fen, movetime, multipv });
    const out = new Map();
    for (const l of res.lines) if (l.move) out.set(l.move, scoreToCp({ cp: l.cp ?? undefined, mate: l.mate ?? undefined }));
    return out;
  }

  stop() { this._send('stop'); }

  terminate() {
    try { this._send('quit'); } catch (e) { /* ignore */ }
    try { this.worker && this.worker.terminate(); } catch (e) { /* ignore */ }
    this.worker = null;
    this.ready = false;
    this.starting = null;
  }
}

function num(re, line) {
  const m = re.exec(line);
  return m ? parseInt(m[1], 10) : null;
}

/** Shared engine used by the training screens (created lazily). */
let shared = null;
export function getEngine() {
  if (!shared) shared = new Engine();
  return shared;
}
