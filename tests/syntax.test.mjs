// tests/syntax.test.mjs — parse every shipped module.
//
// A single stray paren takes the whole app down at boot (the browser only says
// "missing ) after argument list"), and the browser suites need a server to see
// it. This runs first and names the file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.js') || entry.endsWith('.mjs')) out.push(full);
  }
  return out;
}

test('every module parses', () => {
  const files = [...walk(join(ROOT, 'js')), join(ROOT, 'sw.js'), join(ROOT, 'vendor', 'chess.mjs')];
  const broken = [];
  for (const file of files) {
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (e) {
      broken.push(`${file.replace(ROOT + '/', '')}: ${String(e.stderr || e.message).split('\n').slice(0, 3).join(' ')}`);
    }
  }
  assert.deepEqual(broken, [], `syntax errors:\n${broken.join('\n')}`);
  assert.ok(files.length > 40, `only ${files.length} modules checked`);
});

test('no module imports a file that does not exist', () => {
  const files = walk(join(ROOT, 'js'));
  const missing = [];
  for (const file of files) {
    const src = execFileSync('node', ['-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(file)},'utf8'))`], { stdio: 'pipe' }).toString();
    for (const m of src.matchAll(/from\s+'(\.[^']+)'/g)) {
      const resolved = new URL(m[1], 'file://' + file).pathname;
      try { statSync(resolved); } catch (e) { missing.push(`${file.replace(ROOT + '/', '')} → ${m[1]}`); }
    }
  }
  assert.deepEqual(missing, [], `missing imports:\n${missing.join('\n')}`);
});
