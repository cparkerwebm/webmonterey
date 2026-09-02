import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attr, audit, auditSitemap, hasAttr, imagesWithoutAlt, links, resolves } from './audit.ts';

const build = (
  files: Record<string, string>,
  extra: Partial<Parameters<typeof audit>[0]> = {},
) => ({
  pages: new Map(Object.entries(files).filter(([k]) => k.endsWith('.html'))),
  exists: (rel: string) => rel in files,
  read: (rel: string) => files[rel] ?? null,
  workerFirst: ['/_actions/*'],
  origin: 'https://example.com',
  ...extra,
});

test('attr reads quoted and bare values, and hasAttr sees a valueless attribute', () => {
  assert.equal(attr('<img src="a.png" alt="A thing">', 'alt'), 'A thing');
  assert.equal(attr("<img src='a.png' alt=''>", 'alt'), '');
  assert.equal(attr('<img src=a.png>', 'src'), 'a.png');
  assert.equal(attr('<img src="a.png">', 'alt'), null);
  assert.equal(hasAttr('<img src="a.png" alt>', 'alt'), true);
  assert.equal(hasAttr('<img src="a.png" data-alt="x">', 'alt'), false, 'data-alt is not alt');
});

test('an image with no alt attribute is reported; an empty alt is a decorative declaration', () => {
  const html = `<img src="/hero.jpg"><img src="/deco.svg" alt=""><img alt="Fine" src="/ok.png"><IMG SRC="/caps.png">`;
  assert.deepEqual(imagesWithoutAlt(html), ['/hero.jpg', '/caps.png']);
});

test('links are split into internal paths and external URLs, skipping non-navigations', () => {
  const html = `
    <a href="/about">a</a> <a href="/about/">b</a> <a href="mailto:x@y.z">m</a> <a href="#top">t</a>
    <a href="https://example.com/contact">own origin</a> <a href="https://other.test/x">ext</a>
    <a href="//cdn.test/file">proto-relative</a> <a href="tel:+1">p</a>`;
  const { internal, external } = links(html, 'https://example.com');
  assert.deepEqual(internal.sort(), ['/about', '/about/', '/contact']);
  assert.deepEqual(external.sort(), ['https://cdn.test/file', 'https://other.test/x']);
});

test('an internal link resolves to a built file in any of the forms the router serves', () => {
  const input = build({
    'index.html': '',
    'about/index.html': '',
    'privacy.html': '',
    'a.pdf': '',
  });
  for (const href of [
    '/',
    '/about',
    '/about/',
    '/about#team',
    '/about?x=1',
    '/privacy',
    '/a.pdf',
  ]) {
    assert.equal(resolves(href, input), true, href);
  }
  assert.equal(resolves('/missing', input), false);
});

test('an on-demand route in run_worker_first is not reported as broken', () => {
  const input = build(
    { 'index.html': '' },
    { workerFirst: ['/_actions/*', '/contact', '/contact/', '/app/*'] },
  );
  assert.equal(resolves('/contact', input), true);
  assert.equal(resolves('/contact/', input), true);
  assert.equal(resolves('/app/dashboard', input), true);
  assert.equal(resolves('/app', input), true);
  assert.equal(resolves('/elsewhere', input), false);
});

test('the sitemap must exist, be advertised, and every URL must land', () => {
  const ok = build({
    'index.html': '',
    'about/index.html': '',
    'robots.txt': 'User-agent: *\nAllow: /\n\nSitemap: https://example.com/sitemap-index.xml\n',
    'sitemap-index.xml':
      '<sitemapindex><sitemap><loc>https://example.com/sitemap-0.xml</loc></sitemap></sitemapindex>',
    'sitemap-0.xml':
      '<urlset><url><loc>https://example.com/</loc></url><url><loc>https://example.com/about/</loc></url></urlset>',
  });
  assert.deepEqual(auditSitemap(ok), { problems: [], urls: 2 });

  const bad = build({
    'index.html': '',
    'robots.txt': 'User-agent: *\n',
    'sitemap-index.xml':
      '<sitemapindex><sitemap><loc>https://example.com/sitemap-0.xml</loc></sitemap></sitemapindex>',
    'sitemap-0.xml':
      '<urlset><url><loc>https://example.com/gone/</loc></url><url><loc>https://wrong.test/</loc></url></urlset>',
  });
  const { problems } = auditSitemap(bad);
  assert.ok(problems.some((p) => p.includes('robots.txt')));
  assert.ok(problems.some((p) => p.includes('/gone/') && p.includes('no page')));
  assert.ok(problems.some((p) => p.includes('wrong.test')));
});

test('a missing sitemap says why when the domain is unset', () => {
  const { problems } = auditSitemap(build({ 'index.html': '' }, { origin: undefined }));
  assert.match(problems[0]!, /domain/);
});

test('audit assembles every finding with the page it was found on', () => {
  const report = audit(
    build({
      'index.html': '<img src="/x.png"><a href="/nope">n</a><a href="https://ext.test/">e</a>',
      'about/index.html': '<img src="/y.png" alt="Y"><a href="/">home</a>',
      'robots.txt': 'Sitemap: https://example.com/sitemap-index.xml',
      'sitemap-index.xml':
        '<sitemapindex><sitemap><loc>https://example.com/sitemap-0.xml</loc></sitemap></sitemapindex>',
      'sitemap-0.xml': '<urlset><url><loc>https://example.com/</loc></url></urlset>',
    }),
  );
  assert.deepEqual(report.missingAlt, [{ page: 'index.html', src: '/x.png' }]);
  assert.deepEqual(report.brokenInternal, [{ page: 'index.html', href: '/nope' }]);
  assert.deepEqual(report.external, ['https://ext.test/']);
  assert.deepEqual(report.sitemap.problems, []);
});
