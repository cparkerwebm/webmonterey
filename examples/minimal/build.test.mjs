/*
 * REGRESSION TESTS AGAINST BUILT OUTPUT.
 *
 * Every trap in /webm:traps that produced a real client incident and CAN be observed in dist/ is
 * asserted here. `webm doctor` catches the ones a person introduces in a client repo; these catch
 * the ones a change to the PACKAGE would introduce in every repo at once - which is the failure
 * mode generation 2 had no defence against.
 *
 * Requires a build first:  npm run build  (from examples/minimal)
 *
 * These are deliberately assertions about the OUTPUT, not the source. The layer-order bug was
 * invisible in source and in `astro dev`; it existed only in the emitted document.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/*
 * ASSETS BUILD TO dist/client/, NOT dist/ - one of the traps, and this file walked straight into
 * it. Astro's own docs and most tutorials say ./dist. With an adapter and any on-demand route the
 * static output moves under client/, and wrangler.jsonc's assets.directory has to agree or the
 * deploy serves nothing.
 */
const ROOT = new URL('./', import.meta.url).pathname;
const DIST = ['dist/client/', 'dist/']
  .map((d) => join(ROOT, d))
  .find((d) => existsSync(join(d, 'index.html')));

if (!DIST) {
  throw new Error(`No build under ${ROOT}dist. Run \`npm run build\` first.`);
}

const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const css = readdirSync(join(DIST, '_astro'))
  .filter((f) => f.endsWith('.css'))
  .map((f) => readFileSync(join(DIST, '_astro', f), 'utf8'))
  .join('\n');

/* ------------------------------------------------------------------ cascade */

test('the @layer order statement is emitted inline', () => {
  // A bare @layer statement does not survive bundling - it is attached to no rule, so nothing
  // carries it into the output chunk. base.astro emits it inline for exactly this reason.
  assert.match(html, /@layer webm\.reset, webm\.tokens, webm\.base/);
});

test('the layer statement comes BEFORE every stylesheet, or it does not hold the order', () => {
  const statement = html.indexOf('@layer webm.reset');
  const firstSheet = html.indexOf('<link rel="stylesheet"');
  assert.ok(statement > -1, 'no inline layer statement');
  if (firstSheet > -1) {
    assert.ok(
      statement < firstSheet,
      'the statement must precede the first stylesheet - after it, order falls back to whatever ' +
        'the bundler emitted, which is how a 180px logo rendered at 883px',
    );
  }
});

test('the layer statement lists every layer, in order', () => {
  const match = html.match(/@layer ([^;]+);/);
  assert.ok(match);
  const layers = match[1].split(',').map((s) => s.trim());
  assert.deepEqual(layers, [
    'webm.reset',
    'webm.tokens',
    'webm.base',
    'webm.layout',
    'webm.components.core',
    'webm.components.custom',
    'webm.utilities',
    'webm.overrides',
  ]);
});

/* ------------------------------------------------------------------- tokens */

test('tokens are compiled into the bundle from design.json', () => {
  assert.match(css, /--webm-action:\s*#/);
  assert.match(css, /--webm-space-md:/);
});

test('no token is referenced without a definition or a fallback', () => {
  /*
   * `var(--x)` with nothing behind it renders as nothing, silently. `var(--x, fallback)` does not,
   * which is the difference this checks.
   *
   * Two tokens are legitimately absent from the stylesheet and must not be flagged:
   * --webm-reveal-index is set per child by observe.ts at runtime, and --webm-slide-distance is
   * an opt-in a client sets inline. Both are always written with a fallback, so the rule below
   * covers them without an allowlist that would rot.
   */
  const defined = new Set([...css.matchAll(/(--webm-[\w-]+)\s*:/g)].map((m) => m[1]));

  const bare = [];
  for (const m of css.matchAll(/var\(\s*(--webm-[\w-]+)\s*([,)])/g)) {
    const [, name, next] = m;
    if (next === ')' && !defined.has(name)) bare.push(name);
  }

  assert.deepEqual(
    [...new Set(bare)],
    [],
    'referenced with no definition and no fallback - renders as nothing, with no error',
  );
});

test('[hidden] carries !important, or any component display beats it', () => {
  // The UA rule lives in the UA origin, so an author `display` wins and el.hidden = true appears
  // to do nothing, with no error.
  assert.match(css, /\[hidden\][^{]*\{[^}]*display:\s*none\s*!important/);
});

test('dialog keeps its auto margin, or every modal pins to the top-left', () => {
  // The blanket * { margin: 0 } otherwise overrides the UA stylesheet. Deleted once by accident.
  assert.match(css, /dialog[^{]*\{[^}]*margin:\s*auto/);
});

/* -------------------------------------------------------------------- links */

test('the footer credit is an internal link to the webmaster page', () => {
  // It used to leave the site. Now the visitor stays, and the page they land on carries the one
  // outbound link.
  const credit = html.match(/<a[^>]*href="\/webmaster"[^>]*>/);
  assert.ok(credit, 'no credit link to /webmaster in the built page');
  assert.doesNotMatch(credit[0], /target=/, 'an internal link must not open a new tab');
});

test('the webmaster page exists, is indexable, and carries the agency link with its UTMs', () => {
  const page = readFileSync(join(DIST, 'webmaster/index.html'), 'utf8');
  assert.doesNotMatch(page, /name="robots"[^>]*noindex/, 'the page must be indexable');
  assert.match(page, /rel="canonical"/);
  const link = page.match(/<a[^>]*href="https:\/\/webmonterey\.com\/[^"]*"[^>]*>/);
  assert.ok(link, 'no outbound agency link on the webmaster page');
  assert.match(link[0], /utm_campaign=webmaster/);
  assert.match(link[0], /utm_content=minimal_example_com/, 'the production domain, underscored');
  assert.match(link[0], /target="_blank"/);
  assert.match(link[0], /rel="[^"]*noopener/);
  assert.doesNotMatch(link[0], /noreferrer/, 'the referrer is the attribution');
});

test('the webmaster page declares its own share image and structured data', () => {
  const page = readFileSync(join(DIST, 'webmaster/index.html'), 'utf8');
  assert.match(
    page,
    /property="og:image" content="https:\/\/minimal\.example\.com\/webmaster\/og\.png"/,
  );
  assert.match(page, /og:image:width" content="1200"/);
  assert.ok(
    existsSync(join(DIST, 'webmaster/og.png')),
    'the share image is served from the package',
  );
  assert.match(page, /application\/ld\+json/);
  assert.match(page, /https:\/\/webmonterey\.com\/#organization/, 'points at the agency entity');
  assert.match(page, /<h1>Our Webmaster<\/h1>/);
});

test('the sitemap lists the webmaster page', () => {
  const sitemap = readFileSync(join(DIST, 'sitemap-0.xml'), 'utf8');
  assert.ok(sitemap.includes('/webmaster'), 'the page must be in the sitemap');
});

/* ------------------------------------------------------------------ indexing */

test('wrangler assets.directory matches where the build actually put things', () => {
  // Astro's docs say ./dist. With an adapter it is ./dist/client, and a mismatch deploys nothing.
  const wrangler = readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8');
  const dir = wrangler.match(/"directory":\s*"([^"]+)"/)?.[1];
  const built = DIST.replace(ROOT, './').replace(/\/$/, '');
  assert.equal(dir, built, `wrangler says ${dir}, the build produced ${built}`);
});

test('robots.txt names the sitemap, derived from the domain', () => {
  const robots = readFileSync(join(DIST, 'robots.txt'), 'utf8');
  assert.match(robots, /^Sitemap: https:\/\/[^\s]+\/sitemap-index\.xml$/m);
});

test('robots.txt disallows nothing that carries a noindex tag', () => {
  // Disallowing a path stops crawlers fetching it, so they never see the noindex - and an inbound
  // link can get it indexed anyway, with no description.
  const robots = readFileSync(join(DIST, 'robots.txt'), 'utf8');
  assert.ok(!/Disallow:\s*\/webm/.test(robots), '/webm must be crawlable so its noindex is seen');
});

test('the sitemap excludes the noindex workspace route', () => {
  const sitemap = readFileSync(join(DIST, 'sitemap-0.xml'), 'utf8');
  // /webm exactly - /webmaster is a real, indexable page and belongs there.
  assert.doesNotMatch(
    sitemap,
    /\/webm(<|\/)/,
    'listing a noindex page in a sitemap is a Search Console error',
  );
});

test('the 404 page is noindex and emits no canonical', () => {
  /*
   * A canonical on an error page tells a crawler that /404/ is the preferred version of itself,
   * which is an invitation to index it. Found on a rebuild: the generation-2 site marked its 404
   * noindex and the package's did not, so the rebuild gained a canonical the old site never had.
   */
  const html = readFileSync(join(DIST, '404.html'), 'utf8');
  assert.match(html, /<meta name="robots" content="noindex/, 'the 404 must be noindex');
  assert.doesNotMatch(html, /rel="canonical"/, 'and must not claim a canonical URL');
});

test('the focus ring is composed from its parts, so a component can override it', () => {
  /*
   * A custom property containing var() resolves where it is DECLARED. --webm-focus-ring is
   * declared on :root, so it resolves there and inherits down already resolved - a component
   * setting --webm-focus-color changed nothing. Any component on a colored surface was stuck
   * with the site-wide action color: an accessibility failure with no symptom in code review.
   */
  assert.match(
    css,
    /:focus-visible\{[^}]*outline:var\(--webm-focus-width\) solid var\(--webm-focus-color\)/,
  );
});
