// Models how a static host resolves a path, so we can tell the difference
// between a URL that works, one that silently redirects, and one that 404s
// — without deploying anything.
//
// Netlify semantics that actually matter here:
//   - A published file wins over a redirect rule, UNLESS the rule is forced
//     (`!`). So `/foo.html  /foo  301` never fires while foo.html is
//     published, and both URLs then serve 200 — duplicate content.
//   - status 200 is a *rewrite*: the URL stays put and the target is served.
//     A rewrite to a published file is a perfectly good final URL.
//   - Requesting `/dir` where only `dir/index.html` exists gets a 301 that
//     appends the trailing slash. That redirect is easy to advertise by
//     accident in a canonical or a sitemap.
import fs from 'node:fs';
import path from 'node:path';

const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };

export function parseRedirects(text) {
  const rules = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2 || !parts[0].startsWith('/')) continue;
    let [from, to, status = '301'] = parts;
    const force = status.endsWith('!');
    if (force) status = status.slice(0, -1);
    const code = parseInt(status, 10);
    if (Number.isFinite(code)) rules.push({ from, to, code, force });
  }
  return rules;
}

// Which published file a host serves for this path, and by what route.
// `dir-index` is deliberately NOT a clean hit: the host 301s first.
export function staticFile(buildDir, pathname) {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  if (pathname.endsWith('/')) {
    const f = path.join(buildDir, rel, 'index.html');
    return isFile(f) ? { file: f, how: 'index' } : null;
  }
  const exact = path.join(buildDir, rel);
  if (isFile(exact)) return { file: exact, how: 'exact' };
  const pretty = path.join(buildDir, rel + '.html');
  if (isFile(pretty)) return { file: pretty, how: 'pretty' };
  const dirIndex = path.join(buildDir, rel, 'index.html');
  if (isFile(dirIndex)) return { file: dirIndex, how: 'dir-index' };
  return null;
}

function match(rule, pathname) {
  if (rule.from.endsWith('/*')) {
    const prefix = rule.from.slice(0, -1);
    return pathname.startsWith(prefix) ? pathname.slice(prefix.length) : null;
  }
  return rule.from === pathname ? '' : null;
}

function apply(cfg, rule, splat) {
  const target = rule.to.replace(':splat', splat);
  if (rule.code === 200) {
    if (/^https?:/i.test(target)) return { status: 'ok', proxy: target };
    const hit = staticFile(cfg.buildDir, target);
    return hit ? { status: 'ok', file: hit.file, rewrite: target }
               : { status: 'missing', reason: `rewrite target ${target} not published` };
  }
  if (rule.code === 404) return { status: 'missing', reason: 'matched 404 rule' };
  return { status: 'redirect', to: target, code: rule.code };
}

export function resolve(cfg, pathname) {
  for (const r of cfg.rules) {              // forced rules beat published files
    if (!r.force) continue;
    const m = match(r, pathname);
    if (m !== null) return apply(cfg, r, m);
  }
  const hit = staticFile(cfg.buildDir, pathname);
  if (hit && hit.how !== 'dir-index') return { status: 'ok', file: hit.file };
  for (const r of cfg.rules) {
    const m = match(r, pathname);
    if (m !== null) return apply(cfg, r, m);
  }
  if (hit) return { status: 'redirect', to: pathname + '/', code: 301,
                    reason: 'host appends trailing slash for directory index' };
  return { status: 'missing', reason: 'no published file and no matching rule' };
}

// Rules a published file prevents from ever firing. A shadowed *rewrite*
// that lands on the same file is merely redundant, so it is not reported;
// a shadowed *redirect* is not, because both URLs then serve 200 and the
// canonicalization the rule was written to perform silently does not happen.
export function shadowedRules(cfg) {
  const out = [];
  for (const r of cfg.rules) {
    if (r.force || r.from.includes('*')) continue;
    const served = staticFile(cfg.buildDir, r.from);
    if (!served || served.how === 'dir-index') continue;
    if (r.code === 200) {
      const target = staticFile(cfg.buildDir, r.to);
      if (target && target.file === served.file) continue;   // redundant, harmless
      out.push({ ...r, kind: 'shadowed-rewrite' });
    } else {
      out.push({ ...r, kind: 'dead-redirect' });
    }
  }
  return out;
}
