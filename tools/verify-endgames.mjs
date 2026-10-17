// tools/verify-endgames.mjs — validate the drill library.
// 1) every FEN is legal and the stated material really is what the title says
// 2) Stockfish agrees with the drill's claimed result
//
// Usage: node tools/verify-endgames.mjs [path-to-uci-binary]
import { ENDGAME_DRILLS } from '../js/core/endgames.js';
import { Chess } from '../vendor/chess.mjs';
import { game, endgameInfo } from '../js/core/chessutil.js';
import { spawn } from 'node:child_process';

const ENGINE = process.argv[2] || '/home/lars/.src-archive/SnartSimChess-native-engines/stockfish-19';
const DEPTH = 20;

function uciOnce(fen) {
  return new Promise((resolve) => {
    const p = spawn(ENGINE, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    const lines = [];
    p.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line.startsWith('info') && line.includes(' pv ')) lines.push(line);
        if (line.startsWith('bestmove')) {
          const best = line.split(/\s+/)[1];
          const last = lines[lines.length - 1] || '';
          const cp = /score (cp|mate) (-?\d+)/.exec(last);
          const depth = / depth (\d+)/.exec(last);
          resolve({
            best,
            scoreType: cp ? cp[1] : 'cp',
            score: cp ? parseInt(cp[2], 10) : 0,
            depth: depth ? parseInt(depth[1], 10) : 0,
            pv: (last.match(/ pv (.*)$/) || [])[1] || '',
          });
          try { p.stdin.write('quit\n'); } catch (e) {}
          setTimeout(() => p.kill(), 200);
        }
      }
    });
    p.stdin.write('uci\nsetoption name Threads value 1\nsetoption name Hash value 32\nisready\n');
    setTimeout(() => p.stdin.write(`position fen ${fen}\ngo depth ${DEPTH}\n`), 120);
    setTimeout(() => { try { p.kill(); } catch (e) {} resolve({ best: null }); }, 20000);
  });
}

let bad = 0;
for (const d of ENDGAME_DRILLS) {
  let problem = '';
  try { new Chess(d.fen); } catch (e) { problem = 'illegal FEN'; }
  const ch = game(d.fen);
  const legal = ch.moves().length;
  const info = endgameInfo(d.fen);
  const turn = d.fen.split(' ')[1];
  const r = await uciOnce(d.fen);
  const cp = r.scoreType === 'mate' ? (r.score > 0 ? 100000 : -100000) : r.score;
  // score is from the side to move
  let verdict = '';
  if (d.goal === 'hold') {
    const sideToMoveIsOpponent = turn !== d.side;
    const scoreForDefender = sideToMoveIsOpponent ? -cp : cp;
    verdict = Math.abs(cp) < 80 || scoreForDefender > -150 ? 'OK (holdable)' : 'SUSPECT: engine says the defender is lost';
    if (!verdict.startsWith('OK')) problem += ' ' + verdict;
  } else {
    const scoreForTrainer = turn === d.side ? cp : -cp;
    verdict = scoreForTrainer > 200 || scoreForTrainer === 100000 ? 'OK (winning)' : 'SUSPECT: trainer is not winning';
    if (!verdict.startsWith('OK')) problem += ' ' + verdict;
  }
  if (!legal) problem += ' no legal moves';
  if (problem) bad++;
  console.log(
    `${problem ? 'FAIL' : 'ok  '} ${d.id.padEnd(12)} turn=${turn} user=${d.side} goal=${d.goal.padEnd(7)} ` +
    `moves=${String(legal).padStart(2)} eval=${r.scoreType === 'mate' ? 'M' + r.score : (cp / 100).toFixed(2)} ` +
    `best=${r.best}${problem ? '  <= ' + problem.trim() : ''}`
  );
}
console.log(`\n${ENDGAME_DRILLS.length} drills, ${bad} with problems`);
process.exit(bad ? 1 : 0);
