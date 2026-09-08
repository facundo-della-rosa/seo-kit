import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(here, '../bin/seo-kit.mjs');
const cwd = path.join(here, 'fixtures');

function run(args) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8' }) };
  } catch (e) {
    return { code: e.status, out: e.stdout ?? '' };
  }
}

test('check reports findings as JSON and exits 1 on an error', () => {
  const { code, out } = run(['check', '--json']);
  const found = JSON.parse(out);
  assert.equal(code, 1);
  const by = ctx => found.find(f => f.context === ctx);
  assert.equal(by('canonical').severity, 'error');   // nominates a redirecting URL
  assert.equal(by('hreflang').severity, 'error');
  assert.equal(by('sitemap').severity, 'error');
  assert.equal(by('jsonld').severity, 'info');       // same URL, lower stakes
});

test('a dead URL is an error whatever context it appears in', () => {
  const found = JSON.parse(run(['check', '--json']).out);
  const dead = found.find(f => f.url.endsWith('/nope'));
  assert.equal(dead.severity, 'error');
  assert.equal(dead.kind, 'missing');
});

test('shadowed 301 rules are reported', () => {
  const found = JSON.parse(run(['check', '--json']).out);
  const dead = found.find(f => f.kind === 'dead-redirect');
  assert.equal(dead.url, '/mx/fichas.html');
});

test('severity is overridable per repo via config', () => {
  const found = JSON.parse(run(['check', '--json', '--config', 'seo.override.json']).out);
  assert.equal(found.find(f => f.context === 'jsonld').severity, 'error');
  assert.equal(found.find(f => f.context === 'canonical').severity, 'info');
});

test('--config resolves paths relative to the config file, not the cwd', () => {
  const { code } = run(['check', '--config', 'seo.override.json']);
  assert.equal(code, 1);   // resolved the build dir; found the jsonld error
});
