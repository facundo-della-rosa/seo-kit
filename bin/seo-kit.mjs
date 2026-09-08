#!/usr/bin/env node
// Local SEO/agent-readiness checks that need no network, no credits, and no
// deploy. Deliberately narrow: this only checks things an external scanner
// structurally cannot see, because it does not know what your repo is
// supposed to contain. Robots parsing, schema validation and readiness
// heuristics are left to the remote scanners in scan-agent-ready.sh.
import fs from 'node:fs';
import path from 'node:path';
import { parseRedirects, resolve, shadowedRules } from '../lib/resolve.mjs';
import { collect, walk, fromHtml } from '../lib/extract.mjs';

// --config lets one repo hold several sites, each with its own config.
// Paths inside a config are relative to that config's own directory.
const argv = process.argv.slice(2);
const ci = argv.indexOf('--config');
const CONFIG = ci === -1 ? path.join(process.cwd(), 'seo.config.json')
                         : path.resolve(argv[ci + 1]);
const ROOT = path.dirname(CONFIG);

// How much a redirecting URL actually matters, by where it appears.
const DEFAULT_SEVERITY = {
  canonical: 'error',   // page nominates a redirecting URL as its preferred one
  hreflang:  'error',   // Google may drop the annotation entirely
  sitemap:   'error',   // Search Console reports these as "Page with redirect"
  'og:url':  'warn',
  'llms.txt': 'warn',   // agents follow it; one wasted hop on a curated file
  ard:       'warn',
  jsonld:    'info',    // normalized through redirects in practice
  href:      'info',    // one round trip for the user, nothing more
};

function loadConfig() {
  if (!fs.existsSync(CONFIG)) {
    console.error(`no seo.config.json in ${ROOT}\nSee seo-kit/README.md`);
    process.exit(2);
  }
  const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  cfg.buildDir = path.resolve(ROOT, cfg.buildDir ?? 'build');
  cfg.severity = { ...DEFAULT_SEVERITY, ...(cfg.severity ?? {}) };
  const rf = path.join(cfg.buildDir, cfg.redirectsFile ?? '_redirects');
  cfg.rules = fs.existsSync(rf) ? parseRedirects(fs.readFileSync(rf, 'utf8')) : [];
  return cfg;
}

const rel = p => path.relative(ROOT, p);

// Only our own URLs are resolvable; external ones we cannot judge offline.
function toPath(cfg, url) {
  if (url.startsWith('/')) return url.split(/[?#]/)[0];
  for (const base of [cfg.baseUrl, ...(cfg.altBaseUrls ?? [])]) {
    if (base && url.startsWith(base)) {
      const p = url.slice(base.length).split(/[?#]/)[0];
      return p === '' ? '/' : p;
    }
  }
  return null;
}

function check(cfg, { json = false } = {}) {
  const findings = [];
  for (const hit of collect(cfg)) {
    const p = toPath(cfg, hit.url);
    if (p === null) continue;
    const r = resolve(cfg, p);
    if (r.status === 'ok') continue;
    const severity = r.status === 'missing'
      ? 'error'                                  // dead is dead, wherever it appears
      : cfg.severity[hit.context] ?? 'info';
    findings.push({
      severity, kind: r.status, context: hit.context, url: hit.url,
      detail: r.status === 'redirect' ? `${r.code} → ${r.to}` : r.reason,
      file: rel(hit.file),
    });
  }

  const shadowed = shadowedRules(cfg).map(r => ({
    severity: r.kind === 'dead-redirect' ? 'warn' : 'error',
    kind: r.kind, context: '_redirects', url: r.from,
    detail: r.kind === 'dead-redirect'
      ? `published file shadows "${r.from} → ${r.to} ${r.code}", so both URLs `
        + `serve 200 (duplicate content). Add ! to force, or stop publishing the file.`
      : `published file shadows the rewrite to ${r.to}; the wrong file is served`,
    file: cfg.redirectsFile ?? '_redirects',
  }));

  const all = [...findings, ...shadowed];
  if (json) { console.log(JSON.stringify(all, null, 2)); return all; }

  const order = { error: 0, warn: 1, info: 2 };
  const icon = { error: '❌', warn: '⚠️ ', info: 'ℹ️ ' };
  const groups = new Map();
  for (const f of all.sort((a, b) => order[a.severity] - order[b.severity])) {
    const key = `${f.severity}|${f.kind}|${f.context}|${f.url}|${f.detail}`;
    if (!groups.has(key)) groups.set(key, { ...f, files: [] });
    groups.get(key).files.push(f.file);
  }
  for (const g of groups.values()) {
    console.log(`${icon[g.severity]} ${g.context}: ${g.url}`);
    console.log(`     ${g.detail}`);
    console.log(`     ${g.files.length > 3
      ? `${g.files.slice(0, 3).join(', ')} … +${g.files.length - 3} more`
      : g.files.join(', ')}`);
  }
  const n = s => all.filter(f => f.severity === s).length;
  console.log(`\n${n('error')} error · ${n('warn')} warn · ${n('info')} info` +
              `  (${groups.size} distinct)`);
  return all;
}

// A normalized dump of what each page claims about itself. Commit it, and
// any unintended change to the site's SEO surface shows up as a git diff.
function snapshot(cfg) {
  const out = {};
  for (const f of walk(cfg.buildDir, '.html').sort()) {
    const route = '/' + path.relative(cfg.buildDir, f).replace(/\\/g, '/');
    const hits = fromHtml(fs.readFileSync(f, 'utf8'), f)
      .filter(h => h.context !== 'href');
    const page = {};
    for (const h of hits) (page[h.context] ??= []).push(h.url);
    for (const k of Object.keys(page)) page[k] = [...new Set(page[k])].sort();
    out[route] = page;
  }
  const dest = path.resolve(ROOT, cfg.snapshotFile ?? 'seo-snapshot.json');
  fs.writeFileSync(dest, JSON.stringify(out, null, 2) + '\n');
  console.log(`wrote ${rel(dest)} — ${Object.keys(out).length} routes`);
}

const [cmd, ...args] = argv;
const cfg = loadConfig();
if (cmd === 'check') {
  const found = check(cfg, { json: args.includes('--json') });
  const fail = args.includes('--strict') ? ['error', 'warn'] : ['error'];
  process.exit(found.some(f => fail.includes(f.severity)) ? 1 : 0);
} else if (cmd === 'snapshot') {
  snapshot(cfg);
} else {
  console.log('usage: seo-kit <check [--json] [--strict] | snapshot>');
  process.exit(2);
}
