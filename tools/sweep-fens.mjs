// tools/sweep-fens.mjs — evaluate many candidate FENs through ONE engine process.
// Usage: node tools/sweep-fens.mjs candidates.txt   (one "<fen>\t<label>" per line)
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Chess } from '../vendor/chess.mjs';

const ENGINE = process.env.SF || '/home/lars/.src-archive/SnartSimChess-native-engines/stockfish-19';
const DEPTH = Number(process.env.DEPTH || 20);
const lines = readFileSync(process.argv[2], 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

const p = spawn(ENGINE, [], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '', info = null, queue = [], current = null;
p.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (line.startsWith('info') && line.includes(' pv ')) info = line;
    if (line.startsWith('bestmove') && current) {
      const m = /score (cp|mate) (-?\d+)/.exec(info || '');
      const val = m ? (m[1] === 'mate' ? `M${m[2]}` : (+m[2] / 100).toFixed(2)) : '?';
      console.log(`${current.label.padEnd(26)} turn=${current.turn} eval=${String(val).padStart(7)} best=${line.split(/\s+/)[1]}  ${current.fen}`);
      current = null;
      next();
    }
  }
});
function next() {
  const item = queue.shift();
  if (!item) { p.stdin.write('quit\n'); setTimeout(() => process.exit(0), 200); return; }
  current = item;
  info = null;
  p.stdin.write(`position fen ${item.fen}\ngo depth ${DEPTH}\n`);
}
for (const l of lines) {
  const [fen, label] = l.split('\t');
  try { const c = new Chess(fen); if (!c.moves().length) { console.log(`NO-MOVES ${fen}`); continue; } }
  catch (e) { console.log(`ILLEGAL ${fen} (${label || ''})`); continue; }
  queue.push({ fen, label: label || '', turn: fen.split(' ')[1] });
}
p.stdin.write('uci\nsetoption name Threads value 1\nsetoption name Hash value 64\nisready\n');
setTimeout(next, 300);
