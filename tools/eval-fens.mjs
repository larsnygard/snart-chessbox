// tools/eval-fens.mjs — evaluate candidate FENs with a local Stockfish binary.
// Usage: node tools/eval-fens.mjs <fen>...   (or pass a JSON file of {fen,label})
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Chess } from '../vendor/chess.mjs';

const ENGINE = process.env.SF || '/home/lars/.src-archive/SnartSimChess-native-engines/stockfish-19';
const args = process.argv.slice(2);
let items = args;
if (args[0] && args[0].endsWith('.json')) {
  items = JSON.parse(readFileSync(args[0], 'utf8')).map((x) => (typeof x === 'string' ? x : `${x.fen}\t${x.label || ''}`));
}

function uci(fen) {
  return new Promise((resolve) => {
    const p = spawn(ENGINE, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '', info = null, done = false;
    const finish = (res) => { if (done) return; done = true; try { p.stdin.write('quit\n'); } catch (e) {} setTimeout(() => p.kill(), 150); resolve(res); };
    p.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (line.startsWith('info') && line.includes(' pv ')) info = line;
        if (line.startsWith('bestmove')) {
          const m = /score (cp|mate) (-?\d+)/.exec(info || '');
          finish({ best: line.split(/\s+/)[1], type: m ? m[1] : '?', score: m ? +m[2] : null, pv: (info || '').slice(-60) });
        }
      }
    });
    p.stdin.write('uci\nsetoption name Threads value 1\nsetoption name Hash value 64\nisready\n');
    setTimeout(() => p.stdin.write(`position fen ${fen}\ngo depth 22\n`), 100);
    setTimeout(() => finish({ best: null, score: null }), 25000);
  });
}

for (const raw of items) {
  const [fen, label] = String(raw).split('\t');
  let legal = true;
  try { const c = new Chess(fen); if (!c.moves().length) legal = 'no-moves'; } catch (e) { legal = 'illegal'; }
  if (legal !== true) { console.log(`INVALID ${legal}: ${fen} (${label || ''})`); continue; }
  const r = await uci(fen);
  const val = r.type === 'mate' ? `M${r.score}` : (r.score / 100).toFixed(2);
  console.log(`${(label || '').padEnd(24)} ${fen.padEnd(48)} turn=${fen.split(' ')[1]} eval=${val.padStart(7)} best=${r.best}`);
}
