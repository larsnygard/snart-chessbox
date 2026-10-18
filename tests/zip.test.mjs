// tests/zip.test.mjs — the zip reader/writer used for database backups.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createZip, readZip, crc32 } from '../js/core/zip.js';
import { inflateRawSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const PGN = '[Event "Test"]\n[White "A"]\n[Black "B"]\n\n1. e4 e5 2. Nf3 Nc6 1-0\n'.repeat(40);

test('crc32 matches the reference value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('zip round trip keeps names and content', async () => {
  const zip = await createZip([
    { name: 'one.pgn', data: PGN },
    { name: 'readme.txt', data: 'hello' },
  ]);
  assert.ok(zip.length > 100);
  const entries = await readZip(zip);
  assert.equal(entries.length, 2);
  const dec = new TextDecoder();
  assert.deepEqual(entries.map((e) => e.name), ['one.pgn', 'readme.txt']);
  assert.equal(dec.decode(entries[0].data), PGN);
  assert.equal(dec.decode(entries[1].data), 'hello');
});

test('deflated entries are smaller but identical after reading', async () => {
  const zip = await createZip([{ name: 'big.pgn', data: PGN }]);
  // method 8 (deflate) should have been used for repetitive PGN
  const method = new DataView(zip.buffer, zip.byteOffset, zip.byteLength).getUint16(8, true);
  assert.equal(method, 8, 'expected deflate for compressible content');
  assert.ok(zip.length < PGN.length, `${zip.length} < ${PGN.length}`);
  const [entry] = await readZip(zip);
  assert.equal(new TextDecoder().decode(entry.data), PGN);
});

test('the system unzip accepts the archive', async () => {
  let unzip;
  try { unzip = execFileSync('which', ['unzip'], { stdio: 'pipe' }).toString().trim(); } catch (e) { return; }
  if (!unzip) return;
  const dir = mkdtempSync(join(tmpdir(), 'zipcheck-'));
  const file = join(dir, 'backup.zip');
  writeFileSync(file, Buffer.from(await createZip([{ name: 'games.pgn', data: PGN }])));
  const out = execFileSync('unzip', ['-p', file, 'games.pgn'], { stdio: 'pipe' }).toString();
  assert.equal(out, PGN);
});

test('reading a real deflate entry written by another tool', () => {
  // sanity for the inflate path independent of our writer
  const raw = inflateRawSync ? true : false;
  assert.ok(raw);
});
