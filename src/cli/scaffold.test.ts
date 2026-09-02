import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scaffold } from './scaffold.ts';
import { MCP_NAMES, mcpConfig } from './mcp.ts';

const files = (over = {}) =>
  scaffold({
    domain: 'autire.com',
    client: 'Autire Technologies',
    packageVersion: '1.0.0',
    today: '2026-08-26',
    ...over,
  });

const json = (f: Record<string, string>, path: string) => JSON.parse(f[path]!);

test('three names, three jobs: repo, slug, Cloudflare', () => {
  const f = files();
  const site = json(f, 'webmonterey.json');
  // Repo carries the full domain with UNDERSCORES; Cloudflare carries the slug, no TLD.
  assert.equal(site.repo, 'webmonterey/autire_com');
  assert.equal(site.worker, 'webm-autire');
  assert.equal(site.slug, 'autire');
  assert.match(f['wrangler.jsonc']!, /"name": "webm-autire"/);
  assert.match(f['README.md']!, /webm-autire-db/);
});

test('MCP is declared AND pre-approved - a declaration alone is inert', () => {
  const f = files();
  // Both halves come from src/cli/mcp.ts, so this asserts against that list rather than a literal
  // that has to be edited every time a server is added - which is how it fell one behind before.
  assert.deepEqual(json(f, '.mcp.json'), mcpConfig());
  assert.deepEqual(json(f, '.claude/settings.json').enabledMcpjsonServers, MCP_NAMES);
});

test('Mailgun and Stripe are never scaffolded into a client repo', () => {
  // A session there could send mail as any client, or issue refunds.
  const all = Object.values(files()).join('\n').toLowerCase();
  assert.ok(!all.includes('mailgun-mcp'), 'mailgun MCP must not appear');
  assert.ok(!/stripe.*mcp|mcp.*stripe/.test(all), 'stripe MCP must not appear');
});

test('the registry and the block union both start empty - the package ships no components', () => {
  const f = files();
  assert.match(
    f['src/components/registry.ts']!,
    /blocks: Record<string, AstroComponentFactory> = \{\}/,
  );
  assert.match(f['src/content.config.ts']!, /webmontereyCollections\(\[\]\)/);
});

test('postinstall runs webm sync, or a repo has no fleet skills and no error saying why', () => {
  assert.equal(json(files(), 'package.json').scripts.postinstall, 'webm sync');
});

test('no .npmrc is scaffolded - the package is on the public registry', () => {
  const f = files();
  assert.equal(f['.npmrc'], undefined);
  const all = Object.values(f).join('\n');
  assert.ok(!all.includes('NODE_AUTH_TOKEN'), 'no registry credential anywhere in the scaffold');
});

test('stagingEmail is the address passed in, and empty rather than invented when none is', () => {
  // The package carries no inbox. A default address in a public package would mean a stranger's
  // staging site mails the author; `webm new` supplies the git user's email instead.
  assert.equal(
    json(files({ stagingEmail: 'me@example.com' }), 'webmonterey.json').stagingEmail,
    'me@example.com',
  );
  assert.equal(json(files(), 'webmonterey.json').stagingEmail, '');
  assert.ok(!Object.values(files()).join('\n').includes('webmonterey.com'), 'no agency inbox');
});

test('run_worker_first starts with the actions endpoint and carries its warning', () => {
  const w = files()['wrangler.jsonc']!;
  assert.match(w, /"run_worker_first": \["\/_actions\/\*"\]/);
  assert.match(w, /BOTH SLASH FORMS/);
  assert.match(w, /Sec-Fetch-Dest/);
});

test('secrets are gitignored and the example names the password-manager habit', () => {
  const f = files();
  assert.match(f['.gitignore']!, /^\.dev\.vars$/m);
  assert.match(f['.dev.vars.example']!, /password manager/);
});

test('an unnamed client gets CHANGEME, which go-live refuses to launch with', () => {
  const site = json(files({ client: undefined }), 'webmonterey.json');
  assert.equal(site.client, 'CHANGEME');
});

test('timeZone defaults to a real IANA zone', () => {
  assert.equal(json(files(), 'webmonterey.json').timeZone, 'America/Los_Angeles');
});

test('features are technical switches, and carry no plan or tier', () => {
  const site = json(files(), 'webmonterey.json');
  assert.deepEqual(Object.keys(site.features).sort(), [
    'compliance',
    'd1',
    'platform',
    'turnstile',
  ]);
  // The app namespace is reserved on every site from day one - off, folder fixed, path public.
  assert.deepEqual(site.app, { enabled: false, path: 'webapp', label: 'Portal' });

  /*
   * Check the DATA, not the `//`-prefixed keys - those are inline documentation and one of them
   * says "Nothing here reads a tier", which a blunt substring check flags as the very thing it
   * forbids.
   */
  const data = Object.fromEntries(Object.entries(site).filter(([k]) => !k.startsWith('//')));
  const raw = JSON.stringify(data).toLowerCase();
  for (const word of ['basic', 'standard', 'premium', 'plan_label', 'tier', 'billable', 'credit']) {
    assert.ok(!raw.includes(word), `webmonterey.json must not know about "${word}"`);
  }
});

test('there is no orphan stylesheet entry point in the site', () => {
  /*
   * The scaffold used to write src/styles/index.css importing the package's stylesheet and then
   * custom/. Nothing imported it. A client could write a rule in custom/_index.css, see the
   * import chain in their own repo, and never see the rule on the page - the file was not in the
   * module graph at all.
   *
   * base.astro now pulls custom/ in through virtual:webm/custom, so there is nothing here to
   * keep in step, and a file that looks like an entry point but is not is worse than none.
   */
  const f = files();
  assert.equal(f['src/styles/index.css'], undefined, 'no orphan entry point');
  assert.ok(f['src/styles/custom/_index.css'], 'the override seam itself still ships');
  assert.match(
    f['src/styles/custom/_index.css']!,
    /NOTHING IMPORTS THIS FILE FROM THIS REPO/,
    'and it says so, so nobody goes looking for the import',
  );
});

test('astro.config names the adapter, or the build dies on the first on-demand route', () => {
  /*
   * An adapter set through updateConfig from inside the integration does not run its own hooks.
   * A fully static site never notices, which is how it went unnoticed for a whole build-out.
   */
  const config = files()['astro.config.mjs']!;
  assert.match(config, /import webmonterey, \{ adapter \} from '@cparkerwebm\/webmonterey'/);
  assert.match(config, /adapter:\s*adapter\(\)/);
  assert.match(config, /integrations:\s*\[webmonterey\(\)\]/);
  /*
   * Check the IMPORTS, not the whole file - the config's own comment explains that the site takes
   * no direct dependency on @astrojs/cloudflare, and a substring check flags the explanation as
   * the thing it forbids.
   */
  const imports = config.split('\n').filter((l) => l.trimStart().startsWith('import '));
  assert.ok(
    !imports.some((l) => l.includes('@astrojs/')),
    `the site must not import an Astro integration directly: ${imports.join(' | ')}`,
  );
});

test('the scaffolded site wires the form pipeline by re-export, not by copy', () => {
  // The re-export is the propagation seam: a fix to validation, Turnstile, the D1 write or an
  // email template reaches the site on npm update. A copied pipeline never receives one.
  const actions = files()['src/actions/index.ts']!;
  assert.match(actions, /export \{ server \} from '@cparkerwebm\/webmonterey\/actions'/);
  assert.match(actions, /wrap rather than fork/i);
});

test('compatibility_date is the date passed in, never a constant baked into the package', () => {
  /*
   * The bug this exists to prevent, and it is the nastiest one found in the whole build-out: a
   * compatibility_date a few months behind the installed workerd renders EVERY page as the
   * string "[object Object]". 15 bytes, no warning, exit code 0, and `astro build` says
   * "Complete!". It was hardcoded to 2026-01-01 with a comment claiming the caller overwrote it.
   *
   * It is now derived from the argument rather than equal to it - see the fortnight margin in
   * scaffold.ts, which exists because a date NEWER than the installed runtime does not build at
   * all. Both directions are traps and they pull in opposite ways.
   */
  const config = scaffold({ domain: 'a.com', packageVersion: '1.0.0', today: '2026-08-26' })[
    'wrangler.jsonc'
  ]!;
  assert.match(config, /"compatibility_date":\s*"2026-08-12"/, 'derived from it, a fortnight back');

  const other = scaffold({ domain: 'a.com', packageVersion: '1.0.0', today: '2027-03-04' })[
    'wrangler.jsonc'
  ]!;
  assert.match(other, /"compatibility_date":\s*"2027-02-18"/, 'and it still tracks the argument');
});

test('a malformed date is refused rather than written into wrangler.jsonc', () => {
  assert.throws(
    () => scaffold({ domain: 'a.com', packageVersion: '1.0.0', today: 'today' }),
    /YYYY-MM-DD/,
  );
});

test('the scaffolded compatibility_date is never in the future of the installed runtime', () => {
  /*
   * A date newer than the runtime the installed wrangler bundles is refused outright - miniflare
   * throws ERR_FUTURE_COMPATIBILITY_DATE and the site does not build AT ALL, from the moment it
   * is scaffolded. Writing today's date walks into that for anyone whose wrangler is a few weeks
   * old, which is most people most of the time. Two client sites hit it independently.
   *
   * Measured: on wrangler 4.126 the ceiling is today, so today's date happens to work on a
   * machine that just installed. The margin is for every machine that did not.
   */
  const written = (today: string) =>
    scaffold({ domain: 'a.com', packageVersion: '1.0.0', today })['wrangler.jsonc']!.match(
      /"compatibility_date":\s*"([\d-]+)"/,
    )![1]!;

  for (const today of ['2026-08-27', '2026-01-01', '2026-03-01', '2027-12-31']) {
    const gap = (Date.parse(today) - Date.parse(written(today))) / 86_400_000;
    assert.equal(
      gap,
      14,
      `${today} should scaffold a date a fortnight back, got ${written(today)}`,
    );
  }
});

test('the margin crosses a month and a year boundary correctly', () => {
  // Naive string arithmetic gets 2026-01-05 minus 14 days wrong; this is why it goes through Date.
  const at = (today: string) =>
    scaffold({ domain: 'a.com', packageVersion: '1.0.0', today })['wrangler.jsonc']!.match(
      /"compatibility_date":\s*"([\d-]+)"/,
    )![1]!;
  assert.equal(at('2026-01-05'), '2025-12-22');
  assert.equal(at('2026-03-05'), '2026-02-19', 'and February');
});
