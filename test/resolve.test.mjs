import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseRedirects, resolve, shadowedRules } from '../lib/resolve.mjs';

const buildDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/build');
const cfg = {
  buildDir,
  rules: parseRedirects(fs.readFileSync(path.join(buildDir, '_redirects'), 'utf8')),
};

test('a published file resolves cleanly', () => {
  assert.equal(resolve(cfg, '/mx/fichas.html').status, 'ok');
});

test('a 200 rewrite to a published file is a final URL, not a redirect', () => {
  const r = resolve(cfg, '/mx/fichas');
  assert.equal(r.status, 'ok');
  assert.match(r.file, /fichas\.html$/);
});

// Regression: /mx used to resolve "ok" via mx/index.html, hiding the whole
// class of bug this tool exists to find. The host 301s to add the slash.
test('a directory index without a trailing slash is a redirect', () => {
  const r = resolve(cfg, '/mx');
  assert.equal(r.status, 'redirect');
  assert.equal(r.to, '/mx/');
});

test('a trailing-slash directory index is fine', () => {
  assert.equal(resolve(cfg, '/mx/').status, 'ok');
});

test('an unmatched path is missing', () => {
  assert.equal(resolve(cfg, '/nope').status, 'missing');
});

test('a forced rule beats a published file', () => {
  const r = resolve(cfg, '/forced.html');
  assert.equal(r.status, 'redirect');
  assert.equal(r.to, '/mx/');
});

test('a published file shadows a 301, leaving two URLs serving 200', () => {
  const dead = shadowedRules(cfg).filter(r => r.kind === 'dead-redirect');
  assert.deepEqual(dead.map(r => r.from), ['/mx/fichas.html']);
});

test('a rewrite landing on the file the host would serve anyway is not reported', () => {
  assert.ok(!shadowedRules(cfg).some(r => r.from === '/mx/fichas'));
});
