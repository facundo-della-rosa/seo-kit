# seo-kit

Local SEO / agent-readiness checks. No network, no API keys, no credits, no
deploy. Zero dependencies — Node 18+ and nothing else.

## Why this exists

Remote scanners (isitagentready, ora.ai, Magister, OpenSEO) fetch one URL and
grade it. They are good at what they do, and this tool deliberately does not
duplicate any of it — no robots parsing, no schema validation, no readiness
heuristics. Those change as crawlers change, and a local copy would drift.

What a remote scanner *structurally cannot* do is notice that your sitemap
advertises a URL your redirect table sends somewhere else, because it has no
idea what your repo is supposed to contain. That class of bug — the link graph
drifting out of sync with the redirect table — is invisible to every external
tool, survives careful manual sweeps, and is what this checks.

## Commands

    npx seo-kit check                 # exit 1 on any error
    npx seo-kit check --strict        # exit 1 on warnings too (CI)
    npx seo-kit check --json          # machine-readable
    npx seo-kit snapshot              # write seo-snapshot.json
    npx seo-kit check --config sites/mx/seo.config.json

Without `--config` it reads `seo.config.json` from the working directory.
Paths inside a config are resolved relative to that config's own directory,
so one repo can hold several sites.

`check` runs against the **build output**, not the source tree, so build first
or you will be reading a stale answer.

`snapshot` dumps what every page claims about itself (canonical, og:url,
hreflang, JSON-LD urls) into a committed file. Any unintended change to the
site's SEO surface then shows up as a reviewable git diff.

## Severity

Findings are ranked by where the URL appeared, not by how many there are:

| Context | Default | Why |
|---|---|---|
| `canonical` | error | the page nominates a redirecting URL as its preferred one |
| `hreflang` | error | Google may drop the annotation entirely |
| `sitemap` | error | Search Console reports these as "Page with redirect" |
| `og:url`, `llms.txt`, `ard` | warn | curated files agents read; one wasted hop |
| `jsonld` | info | normalized through redirects in practice |
| `href` | info | one round trip for the user, nothing more |

A URL that resolves to nothing is an error in every context.

It also reports redirect rules a published file shadows. On Netlify a rule
only fires when no file exists at that path (unless forced with `!`), so
`/foo.html  /foo  301` silently does nothing while `foo.html` is published —
and both URLs serve 200, which is duplicate content.

## Installing

    npm i -D github:facundo-della-rosa/seo-kit

The repo is private, so installing it needs GitHub auth — an SSH key
(`npm i -D git+ssh://git@github.com/facundo-della-rosa/seo-kit.git`) or a
token in the environment. Make it public to drop that requirement.

Then add `seo.config.json` at the repo root:

```json
{
  "buildDir": "build",
  "baseUrl": "https://example.com",
  "redirectsFile": "_redirects",
  "sources": ["sitemap.xml", "llms.txt", ".well-known/ai-catalog.json"],
  "snapshotFile": "seo-snapshot.json"
}
```

- `buildDir` — publish directory, relative to the repo root.
- `baseUrl` — your canonical origin. `altBaseUrls` accepts extra origins
  (e.g. a www variant) that should also be treated as internal.
- `redirectsFile` — relative to `buildDir`. Omit if the host has no such file;
  resolution then falls back to published files alone.
- `sources` — non-HTML files to scan for advertised URLs.
- `severity` — override any row in the table above.

Wire it into the repo's own scripts:

```json
"scripts": {
  "seo:check": "seo-kit check",
  "seo:snapshot": "seo-kit snapshot",
  "test": "npm run build && npm run seo:check"
}
```

## Host semantics

The resolver models Netlify `_redirects`. On a host with different rules
(Vercel, Cloudflare Pages) two things need adjusting, both in `lib/resolve.mjs`:
`shadowedRules` (does a published file beat a redirect rule?) and the
`dir-index` branch of `resolve` (does requesting `/dir` 301 to `/dir/`?).

## Tests

    npm test

The suite pins the two bugs found while writing this, because both fail
silently rather than loudly:

- `/mx` resolving as OK via `mx/index.html`, hiding every trailing-slash
  finding the tool exists to produce.
- An attribute regex that only matched quoted values, which found nothing at
  all against minified HTML (`removeAttributeQuotes`) and so reported a clean
  build. A checker that cannot parse the page is worse than no checker.
