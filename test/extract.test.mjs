import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromHtml, fromSitemap } from '../lib/extract.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, 'fixtures/build/index.html'), 'utf8');
const hits = fromHtml(html, 'index.html');
const urlsFor = ctx => hits.filter(h => h.context === ctx).map(h => h.url);

// Regression: html-minifier-terser's removeAttributeQuotes strips quotes, and
// a quoted-only attribute regex silently found nothing — a broken extractor
// reads as a clean build, which is the worst possible failure mode.
test('unquoted attributes are parsed', () => {
  assert.deepEqual(urlsFor('canonical'), ['https://example.com/mx']);
  assert.deepEqual(urlsFor('hreflang'), ['https://example.com/mx']);
  assert.deepEqual(urlsFor('og:url'), ['https://example.com/']);
});

test('quoted attributes still parse', () => {
  const q = fromHtml('<link rel="canonical" href="https://example.com/a">', 'f');
  assert.deepEqual(q.map(h => h.url), ['https://example.com/a']);
});

test('canonical and hreflang are distinguished, not collapsed', () => {
  assert.equal(hits.filter(h => h.context === 'canonical').length, 1);
  assert.equal(hits.filter(h => h.context === 'hreflang').length, 1);
});

test('anchors and JSON-LD urls are collected', () => {
  assert.deepEqual(urlsFor('href').sort(),
    ['https://example.com/mx/fichas', 'https://example.com/nope']);
  assert.deepEqual(urlsFor('jsonld'), ['https://example.com/mx']);
});

test('sitemap locs are collected', () => {
  const xml = fs.readFileSync(path.join(here, 'fixtures/build/sitemap.xml'), 'utf8');
  assert.deepEqual(fromSitemap(xml, 'sitemap.xml').map(h => h.url),
    ['https://example.com/mx', 'https://example.com/mx/fichas']);
});
