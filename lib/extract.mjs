// Pulls every internal URL a site advertises, tagged with the context it
// appeared in. Context matters more than count: a redirecting <link rel=
// canonical> is a contradictory signal, while a redirecting nav <a href>
// costs one round trip and nothing else.
import fs from 'node:fs';
import path from 'node:path';

const TAG = /<(link|meta|a)\b([^>]*)>/gis;
// Minifiers strip attribute quotes (html-minifier-terser's
// removeAttributeQuotes), so unquoted values have to parse too.
const ATTR = /([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+))/g;
const LDJSON = /<script[^>]+application\/ld\+json[^>]*>(.*?)<\/script>/gis;

function attrs(s) {
  const out = {};
  for (const m of s.matchAll(ATTR)) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return out;
}

export function fromHtml(html, file) {
  const hits = [];
  const add = (context, url) => url && hits.push({ context, url, file });
  for (const [, tag, rest] of html.matchAll(TAG)) {
    const a = attrs(rest);
    const t = tag.toLowerCase();
    if (t === 'link' && a.rel === 'canonical') add('canonical', a.href);
    else if (t === 'link' && a.hreflang) add('hreflang', a.href);
    else if (t === 'meta' && a.property === 'og:url') add('og:url', a.content);
    else if (t === 'a') add('href', a.href);
  }
  for (const [, body] of html.matchAll(LDJSON)) {
    for (const m of body.matchAll(/"(?:url|item|@id)"\s*:\s*"([^"]+)"/g)) add('jsonld', m[1]);
  }
  return hits;
}

export function fromSitemap(xml, file) {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)]
    .map(m => ({ context: 'sitemap', url: m[1], file }));
}

export function fromText(text, file, context) {
  return [...text.matchAll(/https?:\/\/[^\s"'<>)\]]+/g)]
    .map(m => ({ context, url: m[0].replace(/[.,;:]+$/, ''), file }));
}

export function walk(dir, ext) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, ext));
    else if (p.endsWith(ext)) out.push(p);
  }
  return out;
}

// Everything the site says about itself, from every file type we understand.
export function collect(cfg) {
  const hits = [];
  for (const f of walk(cfg.buildDir, '.html')) {
    hits.push(...fromHtml(fs.readFileSync(f, 'utf8'), f));
  }
  for (const rel of cfg.sources ?? []) {
    const f = path.join(cfg.buildDir, rel);
    if (!fs.existsSync(f)) continue;
    const body = fs.readFileSync(f, 'utf8');
    if (rel.endsWith('.xml')) hits.push(...fromSitemap(body, f));
    else hits.push(...fromText(body, f, rel.includes('llms') ? 'llms.txt' : 'ard'));
  }
  return hits;
}
