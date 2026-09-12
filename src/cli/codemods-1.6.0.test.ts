/*
 * The 1.6.0 codemod, against a site laid out the 1.5.0 way.
 *
 * Both registry forms are covered because the fleet uses both, and the intro link is asserted
 * untouched because it is the one place AGENCY_LINK_ATTRS legitimately stays.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CODEMODS } from './codemods.ts';

const codemod = CODEMODS.find((c) => c.version === '1.6.0')!;

const OLD_LAYOUT =
  `---\nimport { AGENCY_LINK_ATTRS, type WebmasterPageProps } from '@cparkerwebm/webmonterey/webmonterey/webmaster';\n` +
  `const { title, intro, body, cta } = Astro.props;\n---\n` +
  `<h1>{title}</h1>\n<p set:html={intro} />\n` +
  `<p><a class="button button--outline" href={cta.href} {...AGENCY_LINK_ATTRS}>{cta.label}</a></p>\n`;

function site(registry: string, layout = OLD_LAYOUT): string {
  const root = mkdtempSync(join(tmpdir(), 'webm-codemod-'));
  mkdirSync(join(root, 'src/components/general'), { recursive: true });
  writeFileSync(join(root, 'src/components/registry.ts'), registry);
  writeFileSync(join(root, 'src/components/general/webmaster-page.astro'), layout);
  return root;
}

const layoutOf = (root: string) =>
  readFileSync(join(root, 'src/components/general/webmaster-page.astro'), 'utf8');

test('the re-export registry form: the button is rewritten and the import follows', () => {
  const root = site(`export { default as webmasterPage } from './general/webmaster-page.astro';\n`);
  const changes = codemod.run(root);
  assert.equal(changes.length, 1);
  const after = layoutOf(root);
  assert.match(after, /href=\{cta\.href\} \{\.\.\.AGENCY_CTA_ATTRS\}/);
  assert.doesNotMatch(after, /AGENCY_LINK_ATTRS/, 'the old constant is no longer imported');
  assert.match(after, /import \{ type WebmasterPageProps, AGENCY_CTA_ATTRS \} from/);
});

test('the named-const registry form is found too', () => {
  const root = site(
    `import WebmasterPage from './general/webmaster-page.astro';\n` +
      `export const webmasterPage = WebmasterPage;\n`,
  );
  assert.equal(codemod.run(root).length, 1);
  assert.match(layoutOf(root), /\{\.\.\.AGENCY_CTA_ATTRS\}/);
});

test('idempotent: the second run changes nothing', () => {
  const root = site(`export { default as webmasterPage } from './general/webmaster-page.astro';\n`);
  codemod.run(root);
  const once = layoutOf(root);
  assert.deepEqual(codemod.run(root), []);
  assert.equal(layoutOf(root), once);
});

test('a layout that still uses AGENCY_LINK_ATTRS elsewhere keeps the import', () => {
  const root = site(
    `export { default as webmasterPage } from './general/webmaster-page.astro';\n`,
    OLD_LAYOUT + `<a href="https://webmonterey.com/" {...AGENCY_LINK_ATTRS}>plain</a>\n`,
  );
  codemod.run(root);
  const after = layoutOf(root);
  assert.match(after, /import \{ AGENCY_LINK_ATTRS, type WebmasterPageProps, AGENCY_CTA_ATTRS \}/);
  assert.match(after, /href=\{cta\.href\} \{\.\.\.AGENCY_CTA_ATTRS\}/);
  assert.match(after, /plain<\/a>/);
});

test('a site with no webmasterPage export, or no registry, is left alone', () => {
  assert.deepEqual(codemod.run(site(`export const blocks = {};\n`)), []);
  assert.deepEqual(codemod.run(mkdtempSync(join(tmpdir(), 'webm-codemod-'))), []);
});

const OLD_WRANGLER = `{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "acme",
  "compatibility_date": "2026-08-01",
  "assets": {
    "directory": "./dist/client",
    // BOTH SLASH FORMS.
    "run_worker_first": ["/_actions/*", "/portal/*", "/portal", "/portal/"]
  },
  "observability": { "enabled": true },
  "workers_dev": true
}
`;

function oldSite(): string {
  const root = mkdtempSync(join(tmpdir(), 'webm-codemod-'));
  writeFileSync(join(root, 'wrangler.jsonc'), OLD_WRANGLER);
  writeFileSync(
    join(root, 'webmonterey.json'),
    JSON.stringify(
      {
        '//client': 'x',
        client: 'Acme',
        domain: 'acme.com',
        features: { compliance: true, d1: true },
      },
      null,
      2,
    ) + '\n',
  );
  return root;
}

test('analytics is switched on for a 1.5 site: the binding above observability, the route, the flag', () => {
  const root = oldSite();
  const changes = codemod.run(root);
  assert.equal(changes.length, 3, changes.join('; '));
  const wrangler = readFileSync(join(root, 'wrangler.jsonc'), 'utf8');
  assert.match(
    wrangler,
    /"analytics_engine_datasets": \[\{ "binding": "ANALYTICS", "dataset": "acme" \}\],\n\n  "observability"/,
  );
  assert.match(
    wrangler,
    /"run_worker_first": \["\/_actions\/\*", "\/portal\/\*", "\/portal", "\/portal\/", "\/_webm\/\*"\]/,
  );
  assert.match(wrangler, /\/\/ BOTH SLASH FORMS\./, "the site's comments survive: edited as text");
  const site = JSON.parse(readFileSync(join(root, 'webmonterey.json'), 'utf8'));
  assert.equal(site.features.analytics, true);
  assert.equal(site.features.d1, true);
  assert.equal(Object.keys(site)[0], '//client', 'key order kept');
  assert.deepEqual(codemod.run(root), [], 'idempotent');
});

test('a multi-line run_worker_first array gets the route inside it', () => {
  const root = oldSite();
  writeFileSync(
    join(root, 'wrangler.jsonc'),
    OLD_WRANGLER.replace(
      '"run_worker_first": ["/_actions/*", "/portal/*", "/portal", "/portal/"]',
      '"run_worker_first": [\n      "/_actions/*",\n      "/contact",\n    ]',
    ),
  );
  codemod.run(root);
  const wrangler = readFileSync(join(root, 'wrangler.jsonc'), 'utf8');
  assert.match(
    wrangler,
    /"\/contact", "\/_webm\/\*",?\n    \]/,
    'inside the array, the trailing comma kept',
  );
});
