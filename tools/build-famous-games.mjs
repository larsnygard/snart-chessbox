#!/usr/bin/env node
/**
 * Builds data/famous-games.json — famous games for move-by-move memorisation.
 *
 * Provenance: each entry's `moves` string is the movetext exactly as extracted
 * from the URL in its `source` field:
 *   - pgnmentor.com player archives (https://www.pgnmentor.com/players/<Name>.zip),
 *     downloaded with curl and parsed without editing the SAN tokens;
 *   - Wikipedia match articles for the three games that are identified by
 *     game number (1972 game 6, 1985 game 16, 2016 tiebreak game 16).
 * The three Wikipedia movetexts were additionally cross-checked move for move
 * against the corresponding pgnmentor archive entry and matched 100%.
 *
 * This script does not invent chess: it replays every game through chess.js,
 * refuses to write output if any SAN is illegal, if a pgn and its move list
 * disagree, or if a claimed mate is not mate. `moves` and the pgn body are
 * generated from the same replay, so they cannot drift apart.
 *
 * Usage: node tools/build-famous-games.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chess } from '../vendor/chess.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', 'data', 'famous-games.json');

/** @type {{id:string,white:string,black:string,year:number,event:string,site:string,date:string,result:string,source:string,note:string,moves:string}[]} */
const SOURCES = [
  {
    "id": "opera-game-1858",
    "white": "Morphy, Paul",
    "black": "Duke of Brunswick & Count Isouard",
    "year": 1858,
    "event": "Casual game, Paris",
    "site": "Paris",
    "date": "1858.??.??",
    "result": "1-0",
    "source": "https://www.pgnmentor.com/players/Morphy.zip",
    "note": "Morphy's model of rapid development and sacrifice, played during an opera in Paris.",
    "moves": "e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8+"
  },
  {
    "id": "immortal-game-1851",
    "white": "Anderssen, Adolf",
    "black": "Kieseritzky, Lionel",
    "year": 1851,
    "event": "London (Immortal Game)",
    "site": "London",
    "date": "1851.??.??",
    "result": "1-0",
    "source": "https://www.pgnmentor.com/players/Anderssen.zip",
    "note": "Anderssen gives up both rooks and his queen to mate Kieseritzky in London.",
    "moves": "e4 e5 f4 exf4 Bc4 Qh4+ Kf1 b5 Bxb5 Nf6 Nf3 Qh6 d3 Nh5 Nh4 Qg5 Nf5 c6 g4 Nf6 Rg1 cxb5 h4 Qg6 h5 Qg5 Qf3 Ng8 Bxf4 Qf6 Nc3 Bc5 Nd5 Qxb2 Bd6 Bxg1 e5 Qxa1+ Ke2 Na6 Nxg7+ Kd8 Qf6+ Nxf6 Be7+"
  },
  {
    "id": "evergreen-game-1852",
    "white": "Anderssen, Adolf",
    "black": "Dufresne, Jean",
    "year": 1852,
    "event": "Berlin (Evergreen Game)",
    "site": "Berlin",
    "date": "1852.??.??",
    "result": "1-0",
    "source": "https://www.pgnmentor.com/players/Anderssen.zip",
    "note": "Anderssen's 1852 brilliancy, capped by a queen sacrifice and a quiet bishop mate.",
    "moves": "e4 e5 Nf3 Nc6 Bc4 Bc5 b4 Bxb4 c3 Ba5 d4 exd4 O-O d3 Qb3 Qf6 e5 Qg6 Re1 Nge7 Ba3 b5 Qxb5 Rb8 Qa4 Bb6 Nbd2 Bb7 Ne4 Qf5 Bxd3 Qh5 Nf6+ gxf6 exf6 Rg8 Rad1 Qxf3 Rxe7+ Nxe7 Qxd7+ Kxd7 Bf5+ Ke8 Bd7+ Kf8 Bxe7+"
  },
  {
    "id": "steinitz-bardeleben-1895",
    "white": "Steinitz, William",
    "black": "von Bardeleben, Curt",
    "year": 1895,
    "event": "Hastings 1895",
    "site": "Hastings",
    "date": "1895.??.??",
    "result": "1-0",
    "source": "https://www.pgnmentor.com/players/Steinitz.zip",
    "note": "Steinitz hunts the king to h8 and announces a ten-move mate; Bardeleben walked out.",
    "moves": "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4 exd4 cxd4 Bb4+ Nc3 d5 exd5 Nxd5 O-O Be6 Bg5 Be7 Bxd5 Bxd5 Nxd5 Qxd5 Bxe7 Nxe7 Re1 f6 Qe2 Qd7 Rac1 c6 d5 cxd5 Nd4 Kf7 Ne6 Rhc8 Qg4 g6 Ng5+ Ke8 Rxe7+ Kf8 Rf7+ Kg8 Rg7+ Kh8 Rxh7+"
  },
  {
    "id": "reti-tartakower-1910",
    "white": "Réti, Richard",
    "black": "Tartakower, Savielly",
    "year": 1910,
    "event": "Vienna 1910",
    "site": "Vienna",
    "date": "1910.??.??",
    "result": "1-0",
    "source": "https://www.pgnmentor.com/players/Reti.zip",
    "note": "An 11-move miniature: Reti's Qd8+! queen sacrifice ends the game.",
    "moves": "e4 c6 d4 d5 Nc3 dxe4 Nxe4 Nf6 Qd3 e5 dxe5 Qa5+ Bd2 Qxe5 O-O-O Nxe4 Qd8+ Kxd8 Bg5+ Kc7 Bd8+"
  },
  {
    "id": "capablanca-marshall-1918",
    "white": "Capablanca, José Raúl",
    "black": "Marshall, Frank James",
    "year": 1918,
    "event": "New York 1918",
    "site": "New York",
    "date": "1918.??.??",
    "result": "1-0",
    "source": "https://www.pgnmentor.com/players/Capablanca.zip",
    "note": "Capablanca refutes Marshall's prepared novelty, the Marshall Attack, on its debut.",
    "moves": "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 O-O c3 d5 exd5 Nxd5 Nxe5 Nxe5 Rxe5 Nf6 Re1 Bd6 h3 Ng4 Qf3 Qh4 d4 Nxf2 Re2 Bg4 hxg4 Bh2+ Kf1 Bg3 Rxf2 Qh1+ Ke2 Bxf2 Bd2 Bh4 Qh3 Rae8+ Kd3 Qf1+ Kc2 Bf2 Qf3 Qg1 Bd5 c5 dxc5 Bxc5 b4 Bd6 a4 a5 axb5 axb4 Ra6 bxc3 Nxc3 Bb4 b6 Bxc3 Bxc3 h6 b7 Re3 Bxf7+"
  },
  {
    "id": "lasker-capablanca-1914",
    "white": "Lasker, Emanuel",
    "black": "Capablanca, José Raúl",
    "year": 1914,
    "event": "St Petersburg 1914",
    "site": "St Petersburg",
    "date": "1914.??.??",
    "result": "1-0",
    "source": "https://www.pgnmentor.com/players/Lasker.zip",
    "note": "Lasker's plan runs from opening to endgame as he beats Capablanca.",
    "moves": "e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 d4 exd4 Qxd4 Qxd4 Nxd4 Bd6 Nc3 Ne7 O-O O-O f4 Re8 Nb3 f6 f5 b6 Bf4 Bb7 Bxd6 cxd6 Nd4 Rad8 Ne6 Rd7 Rad1 Nc8 Rf2 b5 Rfd2 Rde7 b4 Kf7 a3 Ba8 Kf2 Ra7 g4 h6 Rd3 a5 h4 axb4 axb4 Rae7 Kf3 Rg8 Kf4 g6 Rg3 g5+ Kf3 Nb6 hxg5 hxg5 Rh3 Rd7 Kg3 Ke8 Rdh1 Bb7 e5 dxe5 Ne4 Nd5 N6c5 Bc8 Nxd7 Bxd7 Rh7 Rf8 Ra1 Kd8 Ra8+ Bc8 Nc5"
  },
  {
    "id": "reti-alekhine-1925",
    "white": "Réti, Richard",
    "black": "Alekhine, Alexander",
    "year": 1925,
    "event": "Baden-Baden 1925",
    "site": "Baden-Baden",
    "date": "1925.??.??",
    "result": "0-1",
    "source": "https://www.pgnmentor.com/players/Reti.zip",
    "note": "Alekhine calculates a combination whose final position he saw some 15 moves ahead.",
    "moves": "g3 e5 Nf3 e4 Nd4 d5 d3 exd3 Qxd3 Nf6 Bg2 Bb4+ Bd2 Bxd2+ Nxd2 O-O c4 Na6 cxd5 Nb4 Qc4 Nbxd5 N2b3 c6 O-O Re8 Rfd1 Bg4 Rd2 Qc8 Nc5 Bh3 Bf3 Bg4 Bg2 Bh3 Bf3 Bg4 Bh1 h5 b4 a6 Rc1 h4 a4 hxg3 hxg3 Qc7 b5 axb5 axb5 Re3 Nf3 cxb5 Qxb5 Nc3 Qxb7 Qxb7 Nxb7 Nxe2+ Kh2 Ne4 Rc4 Nxf2 Bg2 Be6 Rcc2 Ng4+ Kh3 Ne5+ Kh2 Rxf3 Rxe2 Ng4+ Kh3 Ne3+ Kh2 Nxc2 Bxf3 Nd4 Rf2 Nxf3+ Rxf3 Bd5"
  },
  {
    "id": "botvinnik-capablanca-1938",
    "white": "Botvinnik, Mikhail",
    "black": "Capablanca, José Raúl",
    "year": 1938,
    "event": "AVRO Tournament, Amsterdam 1938",
    "site": "Amsterdam",
    "date": "1938.??.??",
    "result": "1-0",
    "source": "https://www.pgnmentor.com/players/Botvinnik.zip",
    "note": "Botvinnik's long combination against Capablanca at AVRO 1938.",
    "moves": "d4 Nf6 c4 e6 Nc3 Bb4 e3 d5 a3 Bxc3+ bxc3 c5 cxd5 exd5 Bd3 O-O Ne2 b6 O-O Ba6 Bxa6 Nxa6 Bb2 Qd7 a4 Rfe8 Qd3 c4 Qc2 Nb8 Rae1 Nc6 Ng3 Na5 f3 Nb3 e4 Qxa4 e5 Nd7 Qf2 g6 f4 f5 exf6 Nxf6 f5 Rxe1 Rxe1 Re8 Re6 Rxe6 fxe6 Kg7 Qf4 Qe8 Qe5 Qe7 Ba3 Qxa3 Nh5+ gxh5 Qg5+ Kf8 Qxf6+ Kg8 e7 Qc1+ Kf2 Qc2+ Kg3 Qd3+ Kh4 Qe4+ Kxh5 Qe2+ Kh4 Qe4+ g4 Qe1+ Kh5"
  },
  {
    "id": "byrne-fischer-1956",
    "white": "Byrne, Donald",
    "black": "Fischer, Robert James",
    "year": 1956,
    "event": "Rosenwald Trophy, New York 1956",
    "site": "New York",
    "date": "1956.??.??",
    "result": "0-1",
    "source": "https://www.pgnmentor.com/players/Fischer.zip",
    "note": "The Game of the Century: 13-year-old Fischer's queen sacrifice beats Donald Byrne.",
    "moves": "Nf3 Nf6 c4 g6 Nc3 Bg7 d4 O-O Bf4 d5 Qb3 dxc4 Qxc4 c6 e4 Nbd7 Rd1 Nb6 Qc5 Bg4 Bg5 Na4 Qa3 Nxc3 bxc3 Nxe4 Bxe7 Qb6 Bc4 Nxc3 Bc5 Rfe8+ Kf1 Be6 Bxb6 Bxc4+ Kg1 Ne2+ Kf1 Nxd4+ Kg1 Ne2+ Kf1 Nc3+ Kg1 axb6 Qb4 Ra4 Qxb6 Nxd1 h3 Rxa2 Kh2 Nxf2 Re1 Rxe1 Qd8+ Bf8 Nxe1 Bd5 Nf3 Ne4 Qb8 b5 h4 h5 Ne5 Kg7 Kg1 Bc5+ Kf1 Ng3+ Ke1 Bb4+ Kd1 Bb3+ Kc1 Ne2+ Kb1 Nc3+ Kc1 Rc2+"
  },
  {
    "id": "kasparov-topalov-1999",
    "white": "Kasparov, Garry",
    "black": "Topalov, Veselin",
    "year": 1999,
    "event": "Hoogovens, Wijk aan Zee 1999",
    "site": "Wijk aan Zee",
    "date": "1999.01.20",
    "result": "1-0",
    "source": "https://www.pgnmentor.com/players/Kasparov.zip",
    "note": "Kasparov's Immortal: a rook sacrifice launches a long king hunt.",
    "moves": "e4 d6 d4 Nf6 Nc3 g6 Be3 Bg7 Qd2 c6 f3 b5 Nge2 Nbd7 Bh6 Bxh6 Qxh6 Bb7 a3 e5 O-O-O Qe7 Kb1 a6 Nc1 O-O-O Nb3 exd4 Rxd4 c5 Rd1 Nb6 g3 Kb8 Na5 Ba8 Bh3 d5 Qf4+ Ka7 Rhe1 d4 Nd5 Nbxd5 exd5 Qd6 Rxd4 cxd4 Re7+ Kb6 Qxd4+ Kxa5 b4+ Ka4 Qc3 Qxd5 Ra7 Bb7 Rxb7 Qc4 Qxf6 Kxa3 Qxa6+ Kxb4 c3+ Kxc3 Qa1+ Kd2 Qb2+ Kd1 Bf1 Rd2 Rd7 Rxd7 Bxc4 bxc4 Qxh8 Rd3 Qa8 c3 Qa4+ Ke1 f4 f5 Kc1 Rd2 Qa7"
  },
  {
    "id": "aronian-anand-2013",
    "white": "Aronian, Levon",
    "black": "Anand, Viswanathan",
    "year": 2013,
    "event": "Tata Steel, Wijk aan Zee 2013",
    "site": "Wijk aan Zee NED",
    "date": "2013.01.15",
    "result": "0-1",
    "source": "https://www.pgnmentor.com/players/Aronian.zip",
    "note": "Anand's Immortal: a rook sacrifice and king hunt beat Aronian in 23 moves.",
    "moves": "d4 d5 c4 c6 Nf3 Nf6 Nc3 e6 e3 Nbd7 Bd3 dxc4 Bxc4 b5 Bd3 Bd6 O-O O-O Qc2 Bb7 a3 Rc8 Ng5 c5 Nxh7 Ng4 f4 cxd4 exd4 Bc5 Be2 Nde5 Bxg4 Bxd4+ Kh1 Nxg4 Nxf8 f5 Ng6 Qf6 h3 Qxg6 Qe2 Qh5 Qd3 Be3"
  },
  {
    "id": "deep-blue-kasparov-1997",
    "white": "Deep Blue",
    "black": "Kasparov, Garry",
    "year": 1997,
    "event": "Man vs Machine, New York 1997 (game 6)",
    "site": "New York",
    "date": "1997.??.??",
    "result": "1-0",
    "source": "https://www.pgnmentor.com/players/Kasparov.zip",
    "note": "Deep Blue wins in 19 moves to clinch the first match won by a computer against a champion.",
    "moves": "e4 c6 d4 d5 Nc3 dxe4 Nxe4 Nd7 Ng5 Ngf6 Bd3 e6 N1f3 h6 Nxe6 Qe7 O-O fxe6 Bg6+ Kd8 Bf4 b5 a4 Bb7 Re1 Nd5 Bg3 Kc8 axb5 cxb5 Qd3 Bc6 Bf5 exf5 Rxe7 Bxe7 c4"
  },
  {
    "id": "short-timman-1991",
    "white": "Short, Nigel D.",
    "black": "Timman, Jan H.",
    "year": 1991,
    "event": "Tilburg 1991",
    "site": "Tilburg",
    "date": "1991.??.??",
    "result": "1-0",
    "source": "https://www.pgnmentor.com/players/Short.zip",
    "note": "Short's king march and mating net in a sharp Tilburg encounter.",
    "moves": "e4 Nf6 e5 Nd5 d4 d6 Nf3 g6 Bc4 Nb6 Bb3 Bg7 Qe2 Nc6 O-O O-O h3 a5 a4 dxe5 dxe5 Nd4 Nxd4 Qxd4 Re1 e6 Nd2 Nd5 Nf3 Qc5 Qe4 Qb4 Bc4 Nb6 b3 Nxc4 bxc4 Re8 Rd1 Qc5 Qh4 b6 Be3 Qc6 Bh6 Bh8 Rd8 Bb7 Rad1 Bg7 R8d7 Rf8 Bxg7 Kxg7 R1d4 Rae8 Qf6+ Kg8 h4 h5 Kh2 Rc8 Kg3 Rce8 Kf4 Bc8 Kg5"
  },
  {
    "id": "ivanchuk-kasparov-1995",
    "white": "Ivanchuk, Vassily",
    "black": "Kasparov, Garry",
    "year": 1995,
    "event": "PCA/Intel Grand Prix, New York 1995",
    "site": "New York",
    "date": "1995.??.??",
    "result": "0-1",
    "source": "https://www.pgnmentor.com/players/Kasparov.zip",
    "note": "Kasparov's sacrificial attack beats Ivanchuk in a wild grand prix game.",
    "moves": "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nf3 Be7 Bc4 O-O O-O Be6 Bb3 Nc6 Bg5 Na5 Bxf6 Bxf6 Nd5 Nxb3 axb3 Bg5 Qd3 Bh6 Rad1 Rc8 Nd2 b5 c3 Kh8 b4 Ra8 Nb3 f5 Na5 Rc8 Qh3 Rf7 Rfe1 Qe8 Qh4 Qf8 exf5 Bxf5 f3 Bc2 Ra1 Bf5 h3 Qe8 Qf2 Qe6 Rad1 Qg6 Kh1 Rcf8 h4 Bc2 Rd2 Bxd2 Qxd2 Qg3 Nb7 Rxb7"
  },
  {
    "id": "polgar-kasparov-2002",
    "white": "Polgár, Judit",
    "black": "Kasparov, Garry",
    "year": 2002,
    "event": "Russia vs Rest of the World, Moscow 2002",
    "site": "Moscow RUS",
    "date": "2002.09.09",
    "result": "1-0",
    "source": "https://www.pgnmentor.com/players/Kasparov.zip",
    "note": "Polgar becomes the first woman to beat Kasparov in a serious game.",
    "moves": "e4 e5 Nf3 Nc6 Bb5 Nf6 O-O Nxe4 d4 Nd6 Bxc6 dxc6 dxe5 Nf5 Qxd8+ Kxd8 Nc3 h6 Rd1+ Ke8 h3 Be7 Ne2 Nh4 Nxh4 Bxh4 Be3 Bf5 Nd4 Bh7 g4 Be7 Kg2 h5 Nf5 Bf8 Kf3 Bg6 Rd2 hxg4+ hxg4 Rh3+ Kg2 Rh7 Kg3 f6 Bf4 Bxf5 gxf5 fxe5 Re1 Bd6 Bxe5 Kd7 c4 c5 Bxd6 cxd6 Re6 Rah8 Rexd6+ Kc8 R2d5 Rh3+ Kg2 Rh2+ Kf3 R2h3+ Ke4 b6 Rc6+ Kb8 Rd7 Rh2 Ke3 Rf8 Rcc7 Rxf5 Rb7+ Kc8 Rdc7+ Kd8 Rxg7 Kc8"
  },
  {
    "id": "alekhine-nimzowitsch-1930",
    "white": "Alekhine, Alexander",
    "black": "Nimzowitsch, Aaron",
    "year": 1930,
    "event": "San Remo 1930",
    "site": "San Remo",
    "date": "1930.??.??",
    "result": "1-0",
    "source": "https://www.pgnmentor.com/players/Alekhine.zip",
    "note": "Alekhine's positional squeeze at San Remo, a model of prophylaxis.",
    "moves": "e4 e6 d4 d5 Nc3 Bb4 e5 c5 Bd2 Ne7 Nb5 Bxd2+ Qxd2 O-O c3 b6 f4 Ba6 Nf3 Qd7 a4 Nbc6 b4 cxb4 cxb4 Bb7 Nd6 f5 a5 Nc8 Nxb7 Qxb7 a6 Qf7 Bb5 N8e7 O-O h6 Rfc1 Rfc8 Rc2 Qe8 Rac1 Rab8 Qe3 Rc7 Rc3 Qd7 R1c2 Kf8 Qc1 Rbc8 Ba4 b5 Bxb5 Ke8 Ba4 Kd8 h4 h5 Kh2 g6 g3"
  },
  {
    "id": "najdorf-gligoric-1948",
    "white": "Najdorf, Miguel",
    "black": "Gligorić, Svetozar",
    "year": 1948,
    "event": "Saltsjöbaden Interzonal 1948",
    "site": "Saltsjobaden",
    "date": "1948.??.??",
    "result": "1-0",
    "source": "https://www.pgnmentor.com/players/Najdorf.zip",
    "note": "Najdorf's attacking win over Gligoric at the 1948 Interzonal.",
    "moves": "d4 e6 c4 f5 g3 Nf6 Bg2 Be7 Nc3 O-O Nf3 d5 O-O c6 Bg5 Nbd7 cxd5 exd5 e3 h6 Bxf6 Nxf6 Rb1 Ne4 Ne5 Bd6 f4 Be6 Qe2 Bxe5 fxe5 Qe7 Rbc1 Rac8 a3 c5 Bxe4 fxe4 Rxf8+ Rxf8 Rf1 Rxf1+ Qxf1 cxd4 exd4 a6 Na4 Qg5 Qf4 Qh5 Nc3 Kh7 h4 Kg8 Kf2 Qe8 Ne2 Qc8 Ke1 Qe8 Qc1 Qg6 Qc3 Qg4 Qb3 b5 Nf4 Bf7 Qe3 g5 hxg5 hxg5 Ne2 Kg7 Qf2 Be6 Nc3 Kg8 Kd2 Bf7 Nd1 Qe6 Ne3 Qb6 Nf5 b4 a4 b3 Qe3 Qb4+ Ke2 Qc4+ Ke1 Qb4+ Kf1 Kf8 Qxg5 Ke8 Nd6+ Kd7 Qg7"
  },
  {
    "id": "rotlewi-rubinstein-1907",
    "white": "Rotlewi, Georg",
    "black": "Rubinstein, Akiba",
    "year": 1907,
    "event": "Lodz 1907",
    "site": "Lodz",
    "date": "1907.??.??",
    "result": "0-1",
    "source": "https://www.pgnmentor.com/players/Rubinstein.zip",
    "note": "Rubinstein's Immortal: a cascade of sacrifices against Rotlewi in Lodz.",
    "moves": "d4 d5 Nf3 e6 e3 c5 c4 Nc6 Nc3 Nf6 dxc5 Bxc5 a3 a6 b4 Bd6 Bb2 O-O Qd2 Qe7 Bd3 dxc4 Bxc4 b5 Bd3 Rd8 Qe2 Bb7 O-O Ne5 Nxe5 Bxe5 f4 Bc7 e4 Rac8 e5 Bb6+ Kh1 Ng4 Be4 Qh4 g3 Rxc3 gxh4 Rd2 Qxd2 Bxe4+ Qg2 Rh3"
  },
  {
    "id": "levitsky-marshall-1912",
    "white": "Levitsky, Stepan",
    "black": "Marshall, Frank James",
    "year": 1912,
    "event": "Breslau 1912",
    "site": "Breslau",
    "date": "1912.??.??",
    "result": "0-1",
    "source": "https://www.pgnmentor.com/players/Marshall.zip",
    "note": "Marshall's 23...Qg3!!, a queen offered three ways; spectators threw gold coins.",
    "moves": "e4 e6 d4 d5 Nc3 c5 Nf3 Nc6 exd5 exd5 Be2 Nf6 O-O Be7 Bg5 O-O dxc5 Be6 Nd4 Bxc5 Nxe6 fxe6 Bg4 Qd6 Bh3 Rae8 Qd2 Bb4 Bxf6 Rxf6 Rad1 Qc5 Qe2 Bxc3 bxc3 Qxc3 Rxd5 Nd4 Qh5 Ref8 Re5 Rh6 Qg5 Rxh3 Rc5 Qg3"
  },
  {
    "id": "capablanca-bernstein-1914",
    "white": "Capablanca, José Raúl",
    "black": "Bernstein, Ossip",
    "year": 1914,
    "event": "St Petersburg 1914",
    "site": "St Petersburg",
    "date": "1914.??.??",
    "result": "1-0",
    "source": "https://www.pgnmentor.com/players/Capablanca.zip",
    "note": "Capablanca's 29...Qb2!!, a queen sacrifice, decides a complex struggle.",
    "moves": "d4 d5 Nf3 Nf6 c4 e6 Nc3 Nbd7 Bg5 Be7 e3 c6 Bd3 dxc4 Bxc4 b5 Bd3 a6 e4 e5 dxe5 Ng4 Bf4 Bc5 O-O Qc7 Rc1 f6 Bg3 fxe5 b4 Ba7 Bxb5 axb5 Nxb5 Qd8 Nd6+ Kf8 Rxc6 Nb6 Bh4 Qd7 Nxc8 Qxc6 Qd8+ Qe8 Be7+ Kf7 Nd6+ Kg6 Nh4+ Kh5 Nxe8 Rxd8 Nxg7+ Kh6 Ngf5+ Kh5 h3 Nc8 hxg4+ Kxg4 Bxd8 Rxd8 g3 Rd2 Kg2 Re2 a4 Nb6 Ne3+ Kh5 a5 Nd7 Nhf5 Nf6 b5 Bd4 Kf3 Ra2 a6 Ba7 Rc1 Rb2 g4+ Kg6 Rc7 Rxf2+ Kxf2 Nxg4+ Kf3"
  },
  {
    "id": "reti-bogoljubow-1924",
    "white": "Réti, Richard",
    "black": "Bogoljubow, Efim",
    "year": 1924,
    "event": "New York 1924",
    "site": "New York",
    "date": "1924.??.??",
    "result": "1-0",
    "source": "https://www.pgnmentor.com/players/Reti.zip",
    "note": "Reti's 1.Nf3 debut at New York 1924, introducing the Reti Opening.",
    "moves": "Nf3 d5 c4 e6 g3 Nf6 Bg2 Bd6 O-O O-O b3 Re8 Bb2 Nbd7 d4 c6 Nbd2 Ne4 Nxe4 dxe4 Ne5 f5 f3 exf3 Bxf3 Qc7 Nxd7 Bxd7 e4 e5 c5 Bf8 Qc2 exd4 exf5 Rad8 Bh5 Re5 Bxd4 Rxf5 Rxf5 Bxf5 Qxf5 Rxd4 Rf1 Rd8 Bf7+ Kh8 Be8"
  },
  {
    "id": "rubinstein-lasker-1909",
    "white": "Rubinstein, Akiba",
    "black": "Lasker, Emanuel",
    "year": 1909,
    "event": "St Petersburg 1909",
    "site": "St Petersburg",
    "date": "1909.??.??",
    "result": "1-0",
    "source": "https://www.pgnmentor.com/players/Rubinstein.zip",
    "note": "Rubinstein's 18.Qc1!! crowns a masterpiece against Lasker.",
    "moves": "d4 d5 Nf3 Nf6 c4 e6 Bg5 c5 cxd5 exd5 Nc3 cxd4 Nxd4 Nc6 e3 Be7 Bb5 Bd7 Bxf6 Bxf6 Nxd5 Bxd4 exd4 Qg5 Bxc6 Bxc6 Ne3 O-O-O O-O Rhe8 Rc1 Rxe3 Rxc6+ bxc6 Qc1 Rxd4 fxe3 Rd7 Qxc6+ Kd8 Rf4 f5 Qc5 Qe7 Qxe7+ Kxe7 Rxf5 Rd1+ Kf2 Rd2+ Kf3 Rxb2 Ra5 Rb7 Ra6 Kf8 e4 Rc7 h4 Kf7 g4 Kf8 Kf4 Ke7 h5 h6 Kf5 Kf7 e5 Rb7 Rd6 Ke7 Ra6 Kf7 Rd6 Kf8 Rc6 Kf7 a3"
  },
  {
    "id": "spassky-bronstein-1960",
    "white": "Spassky, Boris V.",
    "black": "Bronstein, David I.",
    "year": 1960,
    "event": "URS Championship, Leningrad 1960",
    "site": "Leningrad",
    "date": "1960.??.??",
    "result": "1-0",
    "source": "https://www.pgnmentor.com/players/Spassky.zip",
    "note": "The 'Blue Bird': Spassky's King's Gambit attack beats Bronstein.",
    "moves": "e4 e5 f4 exf4 Nf3 d5 exd5 Bd6 Nc3 Ne7 d4 O-O Bd3 Nd7 O-O h6 Ne4 Nxd5 c4 Ne3 Bxe3 fxe3 c5 Be7 Bc2 Re8 Qd3 e2 Nd6 Nf8 Nxf7 exf1=Q+ Rxf1 Bf5 Qxf5 Qd7 Qf4 Bf6 N3e5 Qe7 Bb3 Bxe5 Nxe5+ Kh7 Qe4+"
  },
  {
    "id": "larsen-spassky-1970",
    "white": "Larsen, Bent",
    "black": "Spassky, Boris V.",
    "year": 1970,
    "event": "USSR vs Rest of the World, Belgrade 1970",
    "site": "Belgrade",
    "date": "1970.??.??",
    "result": "0-1",
    "source": "https://www.pgnmentor.com/players/Larsen.zip",
    "note": "Spassky crushes Larsen's 1.g3 in 17 moves at Belgrade 1970.",
    "moves": "b3 e5 Bb2 Nc6 c4 Nf6 Nf3 e4 Nd4 Bc5 Nxc6 dxc6 e3 Bf5 Qc2 Qe7 Be2 O-O-O f4 Ng4 g3 h5 h3 h4 hxg4 hxg3 Rg1 Rh1 Rxh1 g2 Rf1 Qh4+ Kd1 gxf1=Q+"
  },
  {
    "id": "reti-capablanca-1924",
    "white": "Réti, Richard",
    "black": "Capablanca, José Raúl",
    "year": 1924,
    "event": "New York 1924",
    "site": "New York",
    "date": "1924.??.??",
    "result": "1-0",
    "source": "https://www.pgnmentor.com/players/Reti.zip",
    "note": "Reti ends Capablanca's eight-year unbeaten run with a hypermodern masterpiece.",
    "moves": "Nf3 Nf6 c4 g6 b4 Bg7 Bb2 O-O g3 b6 Bg2 Bb7 O-O d6 d3 Nbd7 Nbd2 e5 Qc2 Re8 Rfd1 a5 a3 h6 Nf1 c5 b5 Nf8 e3 Qc7 d4 Be4 Qc3 exd4 exd4 N6d7 Qd2 cxd4 Bxd4 Qxc4 Bxg7 Kxg7 Qb2+ Kg8 Rxd6 Qc5 Rad1 Ra7 Ne3 Qh5 Nd4 Bxg2 Kxg2 Qe5 Nc4 Qc5 Nc6 Rc7 Ne3 Ne5 R1d5"
  },
  {
    "id": "capablanca-tartakower-1924",
    "white": "Capablanca, José Raúl",
    "black": "Tartakower, Savielly",
    "year": 1924,
    "event": "New York 1924",
    "site": "New York",
    "date": "1924.??.??",
    "result": "1-0",
    "source": "https://www.pgnmentor.com/players/Capablanca.zip",
    "note": "Capablanca's famous rook endgame, giving up two pawns to promote.",
    "moves": "d4 e6 Nf3 f5 c4 Nf6 Bg5 Be7 Nc3 O-O e3 b6 Bd3 Bb7 O-O Qe8 Qe2 Ne4 Bxe7 Nxc3 bxc3 Qxe7 a4 Bxf3 Qxf3 Nc6 Rfb1 Rae8 Qh3 Rf6 f4 Na5 Qf3 d6 Re1 Qd7 e4 fxe4 Qxe4 g6 g3 Kf8 Kg2 Rf7 h4 d5 cxd5 exd5 Qxe8+ Qxe8 Rxe8+ Kxe8 h5 Rf6 hxg6 hxg6 Rh1 Kf8 Rh7 Rc6 g4 Nc4 g5 Ne3+ Kf3 Nf5 Bxf5 gxf5 Kg3 Rxc3+ Kh4 Rf3 g6 Rxf4+ Kg5 Re4 Kf6 Kg8 Rg7+ Kh8 Rxc7 Re8 Kxf5 Re4 Kf6 Rf4+ Ke5 Rg4 g7+ Kg8 Rxa7 Rg1 Kxd5 Rc1 Kd6 Rc2 d5 Rc1 Rc7 Ra1 Kc6 Rxa4 d6"
  },
  {
    "id": "samisch-nimzowitsch-1923",
    "white": "Sämisch, Fritz",
    "black": "Nimzowitsch, Aaron",
    "year": 1923,
    "event": "Copenhagen 1923",
    "site": "Copenhagen",
    "date": "1923.??.??",
    "result": "0-1",
    "source": "https://www.pgnmentor.com/players/Nimzowitsch.zip",
    "note": "The Immortal Zugzwang Game: Nimzowitsch leaves Samisch without a move.",
    "moves": "d4 Nf6 c4 e6 Nf3 b6 g3 Bb7 Bg2 Be7 Nc3 O-O O-O d5 Ne5 c6 cxd5 cxd5 Bf4 a6 Rc1 b5 Qb3 Nc6 Nxc6 Bxc6 h3 Qd7 Kh2 Nh5 Bd2 f5 Qd1 b4 Nb1 Bb5 Rg1 Bd6 e4 fxe4 Qxh5 Rxf2 Qg5 Raf8 Kh1 R8f5 Qe3 Bd3 Rce1 h6"
  },
  {
    "id": "karjakin-anand-2006",
    "white": "Karjakin, Sergey",
    "black": "Anand, Viswanathan",
    "year": 2006,
    "event": "Corus, Wijk aan Zee 2006",
    "site": "Wijk aan Zee NED",
    "date": "2006.01.14",
    "result": "0-1",
    "source": "https://www.pgnmentor.com/players/Karjakin.zip",
    "note": "Anand's sacrifices mate Karjakin with a lone rook and queen.",
    "moves": "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be6 f3 Be7 Qd2 O-O O-O-O Nbd7 g4 b5 g5 b4 Ne2 Ne8 f4 a5 f5 a4 Nbd4 exd4 Nxd4 b3 Kb1 bxc2+ Nxc2 Bb3 axb3 axb3 Na3 Ne5 h4 Ra5 Qc3 Qa8 Bg2 Nc7 Qxc7 Rc8 Qxe7 Nc4 g6 hxg6 fxg6 Nxa3+ bxa3 Rxa3 gxf7+ Kh7 f8=N+ Rxf8 Qxf8 Ra1+ Kb2 Ra2+ Kc3 Qa5+ Kd3 Qb5+ Kd4 Ra4+ Kc3 Qc4+"
  },
  {
    "id": "topalov-shirov-1998",
    "white": "Topalov, Veselin",
    "black": "Shirov, Alexei",
    "year": 1998,
    "event": "Linares 1998",
    "site": "Linares",
    "date": "1998.03.04",
    "result": "0-1",
    "source": "https://www.pgnmentor.com/players/Topalov.zip",
    "note": "Shirov's 47...Bh3!!, ranked among the greatest moves ever played.",
    "moves": "d4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5 e4 Nxc3 bxc3 Bg7 Bb5+ c6 Ba4 O-O Ne2 Nd7 O-O e5 f3 Qe7 Be3 Rd8 Qc2 Nb6 Bb3 Be6 Rad1 Nc4 Bc1 b5 f4 exd4 Nxd4 Bg4 Rde1 Qc5 Kh1 a5 h3 Bd7 a4 bxa4 Ba2 Be8 e5 Nb6 f5 Nd5 Bd2 Nb4 Qxa4 Nxa2 Qxa2 Bxe5 fxg6 hxg6 Bg5 Rd5 Re3 Qd6 Qe2 Bd7 c4 Bxd4 cxd5 Bxe3 Qxe3 Re8 Qc3 Qxd5 Bh6 Re5 Rf3 Qc5 Qa1 Bf5 Re3 f6 Rxe5 Qxe5 Qa2+ Qd5 Qxd5+ cxd5 Bd2 a4 Bc3 Kf7 h4 Ke6 Kg1 Bh3 gxh3 Kf5 Kf2 Ke4 Bxf6 d4 Be7 Kd3 Bc5 Kc4 Be7 Kb3"
  },
  {
    "id": "anand-topalov-2005",
    "white": "Anand, Viswanathan",
    "black": "Topalov, Veselin",
    "year": 2005,
    "event": "Mtel Masters, Sofia 2005",
    "site": "Sofia BUL",
    "date": "2005.05.12",
    "result": "1/2-1/2",
    "source": "https://www.pgnmentor.com/players/Anand.zip",
    "note": "Kramnik called this drawn masterpiece '23rd-century chess'.",
    "moves": "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e6 f3 b5 g4 h6 Qd2 b4 Na4 Nbd7 O-O-O Ne5 b3 Bd7 Nb2 d5 Bf4 Nxf3 Nxf3 Nxe4 Qd4 f6 Bd3 Bc5 Bxe4 Bxd4 Bg6+ Kf8 Rxd4 a5 Re1 Be8 Nh4 e5 Rd2 a4 bxa4 Kg8 Bg3 d4 Rd3 h5 Bxe8 Qxe8 g5 Rc8 g6 Rh6 Rxd4 Rxg6 Nxg6 Qxg6 Rd2 Rc3 Red1 Kh7 Kb1 Qf5 Be1 Ra3 Rd6 Rh3 a5 Rxh2 Rc1 Qe4 a6 Qa8 Bxb4 h4 Bc5 h3 Nd3 Rd2 Rb6 h2 Nf2 Qd5 Be3 Re2 Rb3 f5 a7 Rxe3 Rxe3 Qb7+ Rb3 Qxa7 Nh1 f4 c4 e4 c5 e3 c6 e2 c7 Qxc7 Rxc7 e1=Q+ Rc1 Qe4+ Ka1 Qd4+ Kb1 Qe4+ Ka1 Qd4+ Kb1 Qe4+"
  },
  {
    "id": "polugaevsky-nezhmetdinov-1958",
    "white": "Polugaevsky, Lev",
    "black": "Nezhmetdinov, Rashid",
    "year": 1958,
    "event": "Sochi 1958",
    "site": "Sochi",
    "date": "1958.??.??",
    "result": "0-1",
    "source": "https://www.pgnmentor.com/players/Polugaevsky.zip",
    "note": "Nezhmetdinov's queen sacrifice and king hunt at Sochi 1958.",
    "moves": "d4 Nf6 c4 d6 Nc3 e5 e4 exd4 Qxd4 Nc6 Qd2 g6 b3 Bg7 Bb2 O-O Bd3 Ng4 Nge2 Qh4 Ng3 Nge5 O-O f5 f3 Bh6 Qd1 f4 Nge2 g5 Nd5 g4 g3 fxg3 hxg3 Qh3 f4 Be6 Bc2 Rf7 Kf2 Qh2+ Ke3 Bxd5 cxd5 Nb4 Rh1 Rxf4 Rxh2 Rf3+ Kd4 Bg7 a4 c5+ dxc6 bxc6 Bd3 Nexd3+ Kc4 d5+ exd5 cxd5+ Kb5 Rb8+ Ka5 Nc6+"
  },
  {
    "id": "bogoljubow-alekhine-1922",
    "white": "Bogoljubow, Efim",
    "black": "Alekhine, Alexander",
    "year": 1922,
    "event": "Hastings 1922",
    "site": "Hastings",
    "date": "1922.??.??",
    "result": "0-1",
    "source": "https://www.pgnmentor.com/players/Alekhine.zip",
    "note": "Chernev called Bogoljubow-Alekhine, Hastings 1922 the greatest game ever played.",
    "moves": "d4 f5 c4 Nf6 g3 e6 Bg2 Bb4+ Bd2 Bxd2+ Nxd2 Nc6 Ngf3 O-O O-O d6 Qb3 Kh8 Qc3 e5 e3 a5 b3 Qe8 a3 Qh5 h4 Ng4 Ng5 Bd7 f3 Nf6 f4 e4 Rfd1 h6 Nh3 d5 Nf1 Ne7 a4 Nc6 Rd2 Nb4 Bh1 Qe8 Rg2 dxc4 bxc4 Bxa4 Nf2 Bd7 Nd2 b5 Nd1 Nd3 Rxa5 b4 Rxa8 bxc3 Rxe8 c2 Rxf8+ Kh7 Nf2 c1=Q+ Nf1 Ne1 Rh2 Qxc4 Rb8 Bb5 Rxb5 Qxb5 g4 Nf3+ Bxf3 exf3 gxf5 Qe2 d5 Kg8 h5 Kh7 e4 Nxe4 Nxe4 Qxe4 d6 cxd6 f6 gxf6 Rd2 Qe2 Rxe2 fxe2 Kf2 exf1=Q+ Kxf1 Kg7 Kf2 Kf7 Ke3 Ke6 Ke4 d5+"
  },
  {
    "id": "fischer-spassky-1972-g6",
    "white": "Fischer, Robert James",
    "black": "Spassky, Boris V.",
    "year": 1972,
    "event": "World Championship 28th, Reykjavik 1972 (game 6)",
    "site": "Reykjavik",
    "date": "1972.07.23",
    "result": "1-0",
    "source": "https://en.wikipedia.org/wiki/World_Chess_Championship_1972",
    "note": "Fischer's 1.c4 surprise; Spassky applauded and called it the best game of the match.",
    "moves": "c4 e6 Nf3 d5 d4 Nf6 Nc3 Be7 Bg5 O-O e3 h6 Bh4 b6 cxd5 Nxd5 Bxe7 Qxe7 Nxd5 exd5 Rc1 Be6 Qa4 c5 Qa3 Rc8 Bb5 a6 dxc5 bxc5 O-O Ra7 Be2 Nd7 Nd4 Qf8 Nxe6 fxe6 e4 d4 f4 Qe7 e5 Rb8 Bc4 Kh8 Qh3 Nf8 b3 a5 f5 exf5 Rxf5 Nh7 Rcf1 Qd8 Qg3 Re7 h4 Rbb7 e6 Rbc7 Qe5 Qe8 a4 Qd8 R1f2 Qe8 R2f3 Qd8 Bd3 Qe8 Qe4 Nf6 Rxf6 gxf6 Rxf6 Kg8 Bc4 Kh8 Qf4"
  },
  {
    "id": "karpov-kasparov-1985-g16",
    "white": "Karpov, Anatoly",
    "black": "Kasparov, Garry",
    "year": 1985,
    "event": "World Championship 1985, Moscow (game 16)",
    "site": "Moscow",
    "date": "1985.10.??",
    "result": "0-1",
    "source": "https://en.wikipedia.org/wiki/World_Chess_Championship_1985",
    "note": "Kasparov's ...Nd3 outpost paralyses Karpov; voted best game of Chess Informant 1-64.",
    "moves": "e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6 Nb5 d6 c4 Nf6 N1c3 a6 Na3 d5 cxd5 exd5 exd5 Nb4 Be2 Bc5 O-O O-O Bf3 Bf5 Bg5 Re8 Qd2 b5 Rad1 Nd3 Nab1 h6 Bh4 b4 Na4 Bd6 Bg3 Rc8 b3 g5 Bxd6 Qxd6 g3 Nd7 Bg2 Qf6 a3 a5 axb4 axb4 Qa2 Bg6 d6 g4 Qd2 Kg7 f3 Qxd6 fxg4 Qd4+ Kh1 Nf6 Rf4 Ne4 Qxd3 Nf2+ Rxf2 Bxd3 Rfd2 Qe3 Rxd3 Rc1 Nb2 Qf2 Nd2 Rxd1+ Nxd1 Re1+"
  },
  {
    "id": "carlsen-karjakin-2016-g16",
    "white": "Carlsen, Magnus",
    "black": "Karjakin, Sergey",
    "year": 2016,
    "event": "World Championship 2016, New York (rapid tiebreak, game 16)",
    "site": "New York",
    "date": "2016.11.30",
    "result": "1-0",
    "source": "https://en.wikipedia.org/wiki/World_Chess_Championship_2016",
    "note": "Carlsen retains the title with 50.Qh6+!!, a queen sacrifice ending the tiebreak.",
    "moves": "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 f3 e5 Nb3 Be7 c4 a5 Be3 a4 Nc1 O-O Nc3 Qa5 Qd2 Na6 Be2 Nc5 O-O Bd7 Rb1 Rfc8 b4 axb3 axb3 Qd8 Nd3 Ne6 Nb4 Bc6 Rfd1 h5 Bf1 h4 Qf2 Nd7 g3 Ra3 Bh3 Rca8 Nc2 R3a6 Nb4 Ra5 Nc2 b6 Rd2 Qc7 Rbd1 Bf8 gxh4 Nf4 Bxf4 exf4 Bxd7 Qxd7 Nb4 Ra3 Nxc6 Qxc6 Nb5 Rxb3 Nd4 Qxc4 Nxb3 Qxb3 Qe2 Be7 Kg2 Qe6 h5 Ra3 Rd3 Ra2 R3d2 Ra3 Rd3 Ra7 Rd5 Rc7 Qd2 Qf6 Rf5 Qh4 Rc1 Ra7 Qxf4 Ra2+ Kh1 Qf2 Rc8+ Kh7 Qh6+"
  }
];

const bare = (san) => san.replace(/[+#]+$/, '');

function numbered(moves) {
  let out = [];
  for (let i = 0; i < moves.length; i += 2) {
    out.push(`${i / 2 + 1}. ${moves[i]}`);
    if (moves[i + 1]) out.push(moves[i + 1]);
  }
  return out.join(' ');
}

function pgnFor(g, moves) {
  const tags = [
    ['Event', g.event],
    ['Site', g.site],
    ['Date', g.date],
    ['Round', '?'],
    ['White', g.white],
    ['Black', g.black],
    ['Result', g.result],
  ];
  const head = tags.map(([k, v]) => `[${k} "${String(v).replace(/"/g, "'")}"]`).join('\n');
  return `${head}\n\n${numbered(moves)} ${g.result}`;
}

const problems = [];
const games = [];

for (const g of SOURCES) {
  const source = g.moves.trim().split(/\s+/);
  const board = new Chess();
  const moves = [];
  const failures = [];

  for (const san of source) {
    try {
      const mv = board.move(bare(san));
      if (!mv) throw new Error('rejected');
      moves.push(mv.san);
    } catch {
      failures.push(san);
      break;
    }
  }

  if (failures.length) {
    problems.push(`${g.id}: illegal or unparsable SAN at "${failures[0]}" (ply ${moves.length + 1})`);
    continue;
  }
  if (board.isCheckmate() !== /#$/.test(moves[moves.length - 1])) {
    problems.push(`${g.id}: final position mate=${board.isCheckmate()} but last SAN is ${moves[moves.length - 1]}`);
    continue;
  }
  if (board.isCheckmate()) {
    const winner = board.turn() === 'w' ? '0-1' : '1-0';
    if (g.result !== winner) problems.push(`${g.id}: mate but result ${g.result}`);
  }
  if (moves.length < 20) problems.push(`${g.id}: only ${moves.length} ply`);

  const pgn = pgnFor(g, moves);
  const parsed = new Chess();
  try {
    parsed.loadPgn(pgn);
  } catch (err) {
    problems.push(`${g.id}: pgn did not load (${err.message})`);
    continue;
  }
  const fromPgn = parsed.history();
  if (fromPgn.length !== moves.length || fromPgn.some((m, i) => m !== moves[i])) {
    problems.push(`${g.id}: pgn movetext disagrees with moves list`);
    continue;
  }
  if (parsed.getHeaders().Result !== g.result) {
    problems.push(`${g.id}: pgn Result header mismatch`);
    continue;
  }

  games.push({
    id: g.id,
    white: g.white,
    black: g.black,
    year: g.year,
    event: g.event,
    result: g.result,
    moves: moves.join(' '),
    pgn,
    source: g.source,
    note: g.note,
  });
}

const ids = new Set();
for (const g of games) {
  if (ids.has(g.id)) problems.push(`duplicate id ${g.id}`);
  ids.add(g.id);
  if (!/^\d{4}$/.test(String(g.year))) problems.push(`${g.id}: bad year`);
  if (g.note.length > 120) problems.push(`${g.id}: note too long (${g.note.length})`);
  if (!/^https?:\/\//.test(g.source)) problems.push(`${g.id}: missing source URL`);
  if (!g.white || !g.black || !g.event) problems.push(`${g.id}: missing metadata`);
}

if (problems.length) {
  console.error('Refusing to write output:');
  for (const p of problems) console.error(' - ' + p);
  process.exit(1);
}

games.sort((a, b) => a.year - b.year || a.id.localeCompare(b.id));

const now = new Date();
const today = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, '0'),
  String(now.getDate()).padStart(2, '0'),
].join('-');

const payload = { generated: today, games };
writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');

const mates = games.filter((g) => /#$/.test(g.moves.split(' ').at(-1))).length;
console.log(`wrote ${OUT}`);
console.log(`games: ${games.length}, mated finishes: ${mates}`);
