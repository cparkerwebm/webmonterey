import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHECKS,
  onDemandRoutes,
  PACKAGE_SECRETS,
  stripComments,
  type CheckContext,
} from './checks.ts';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MCP_NAMES, MCP_SERVERS, mcpConfig } from './mcp.ts';

const base = (over: Partial<CheckContext> = {}): CheckContext => ({
  site: { client: 'Acme', domain: 'acme.com' },
  wrangler: { assets: { run_worker_first: ['/_actions/*'] } },
  pages: new Map(),
  components: new Map(),
  today: '2026-08-26',
  workerEntry: null,
  contentPages: [],
  content: new Map(),
  actions: new Map(),
  includes: new Map(),
  emails: new Map(),
  migrations: new Map(),
  migrationsMktg: new Map(),
  registry: null,
  contentConfig: null,
  devVarsExample: null,
  present: {},
  placeholders: [],
  sync: { version: '1.0.0', skills: ['launch'] },
  mcp: { declared: mcpConfig().mcpServers, enabled: [...MCP_NAMES] },
  version: '1.0.0',
  worker: { name: 'acme', deployments: 1, skipped: null },
  ...over,
});

const runCheck = (id: string, ctx: CheckContext) => CHECKS.find((c) => c.id === id)!.run(ctx);

test('an on-demand route not in run_worker_first fails, naming both slash forms', () => {
  const ctx = base({
    pages: new Map([['src/pages/contact.astro', 'export const prerender = false;']]),
  });
  const r = runCheck('run-worker-first', ctx);
  assert.equal(r.status, 'fail');
  assert.match(r.detail!, /\/contact/);
  assert.match(r.detail!, /\/contact\//);
});

test('a wildcard entry covers the route it prefixes', () => {
  const ctx = base({
    pages: new Map([['src/pages/api/lead.ts', 'export const prerender = false;']]),
    wrangler: { assets: { run_worker_first: ['/api/*'] } },
  });
  assert.equal(runCheck('run-worker-first', ctx).status, 'pass');
});

test('a prerendered route needs no entry', () => {
  const ctx = base({ pages: new Map([['src/pages/about.astro', '<h1>About</h1>']]) });
  assert.equal(runCheck('run-worker-first', ctx).status, 'pass');
});

test('CHANGEME anywhere in the config fails, naming the fields', () => {
  const r = runCheck('changeme', base({ site: { client: 'CHANGEME', domain: 'CHANGEME' } }));
  assert.equal(r.status, 'fail');
  assert.match(r.detail!, /client/);
  assert.match(r.detail!, /domain/);
});

test('Pacific/LA is caught before it reaches a Worker', () => {
  const r = runCheck(
    'timezone',
    base({ site: { client: 'A', domain: 'a.com', timeZone: 'Pacific/LA' } }),
  );
  assert.equal(r.status, 'fail');
  assert.match(r.detail!, /Pacific\/LA/);
});

test('a valid zone passes and an unset one only warns', () => {
  assert.equal(
    runCheck(
      'timezone',
      base({ site: { client: 'A', domain: 'a.com', timeZone: 'America/Los_Angeles' } }),
    ).status,
    'pass',
  );
  assert.equal(runCheck('timezone', base()).status, 'warn');
});

test('a missing sync directory fails and names --ignore-scripts', () => {
  const r = runCheck('skills-synced', base({ sync: null }));
  assert.equal(r.status, 'fail');
  assert.match(r.detail!, /ignore-scripts/);
});

test('a stale sync warns rather than fails - the skills still work', () => {
  assert.equal(
    runCheck('skills-synced', base({ sync: { version: '0.9.0', skills: [] } })).status,
    'warn',
  );
});

test('querySelector<HTMLSelectElement> is caught, and the message says to cast', () => {
  const ctx = base({
    components: new Map([
      ['src/components/x.astro', 'document.querySelector<HTMLSelectElement>("#t")'],
    ]),
  });
  const r = runCheck('select-element', ctx);
  assert.equal(r.status, 'fail');
  assert.match(r.detail!, /Cast instead/);
});

test('<Image> on an on-demand route fails unless it branches on isPrerendered', () => {
  const bad = base({
    pages: new Map([['src/pages/x.astro', 'export const prerender = false;\n<Image src={a} />']]),
  });
  assert.equal(runCheck('image-on-demand', bad).status, 'fail');

  const guarded = base({
    pages: new Map([
      [
        'src/pages/x.astro',
        'export const prerender = false;\nAstro.isPrerendered ? <Image src={a}/> : <img/>',
      ],
    ]),
  });
  assert.equal(runCheck('image-on-demand', guarded).status, 'pass');
});

test('a literal color in component CSS warns, but a token declaration does not', () => {
  const bad = base({
    components: new Map([['src/components/x.astro', '<style>.a{color:#ff0000}</style>']]),
  });
  assert.equal(runCheck('literal-values', bad).status, 'warn');

  const ok = base({
    components: new Map([['src/components/x.astro', '<style>.a{color:var(--webm-text)}</style>']]),
  });
  assert.equal(runCheck('literal-values', ok).status, 'pass');
});

test('onDemandRoutes maps file paths to url paths', () => {
  const pages = new Map([
    ['src/pages/contact.astro', 'export const prerender = false'],
    ['src/pages/api/lead.ts', 'export const prerender = false'],
    ['src/pages/about.astro', 'static'],
  ]);
  assert.deepEqual(onDemandRoutes(pages).sort(), ['/api/lead', '/contact']);
});

test('a block type missing from the registry FAILS, naming the file it is in', () => {
  /*
   * The one that costs an hour. A block whose type is not registered renders as nothing: 200 on
   * the route, clean build, section simply absent - which looks exactly like a CSS bug.
   */
  const ctx = base({
    registry: `export const blocks = { 'content-000001': Content };`,
    content: new Map([['src/content/pages/home.json', '{"blocks":[{"type":"content-000002"}]}']]),
  });
  const result = runCheck('block-types-registered', ctx);
  assert.equal(result.status, 'fail');
  assert.match(result.detail!, /content-000002/);
  assert.match(result.detail!, /home\.json/, 'the message names the file to open');
});

test('a registered block type passes', () => {
  const ctx = base({
    registry: `export const blocks = { 'content-000001': Content, 'regions-000004': Hero };`,
    content: new Map([
      [
        'src/content/pages/home.json',
        '{"blocks":[{"type":"content-000001"},{"type":"regions-000004"}]}',
      ],
    ]),
  });
  assert.equal(runCheck('block-types-registered', ctx).status, 'pass');
});

test('a freshly scaffolded site passes - empty registry, no content, not a failure', () => {
  // `webm new` produces exactly this, and a doctor that fails on a brand new site trains people
  // to ignore it.
  const ctx = base({ registry: `export const blocks = {};`, content: new Map() });
  assert.equal(runCheck('block-types-registered', ctx).status, 'pass');
});

test('a missing _headers warns rather than fails, and says how to get it back', () => {
  const ctx = base({ present: { 'public/_headers': false, 'public/favicon.ico': true } });
  const result = runCheck('seeded-files', ctx);
  assert.equal(result.status, 'warn');
  assert.match(result.detail!, /public\/_headers/);
  assert.match(result.detail!, /webm sync/);
});

test('a compatibility_date past the measured breaking point FAILS, naming the symptom', () => {
  /*
   * 2026-01-01 against 2026-08-26 is 237 days, and that exact pair was observed rendering
   * [object Object] on wrangler 4.126. It has to FAIL, not warn - the first draft of this check
   * warned here, which is the check being wrong in the only direction that matters.
   */
  const ctx = base({
    today: '2026-08-26',
    wrangler: { compatibility_date: '2026-01-01', assets: { run_worker_first: ['/_actions/*'] } },
  });
  const result = runCheck('compatibility-date', ctx);
  assert.equal(result.status, 'fail');
  assert.match(result.detail!, /\[object Object\]/, 'names the symptom someone would google');
});

test('a four-month-stale date warns - not broken yet, but one cycle from it', () => {
  const ctx = base({
    today: '2026-08-26',
    wrangler: { compatibility_date: '2026-04-20', assets: { run_worker_first: ['/_actions/*'] } },
  });
  assert.equal(runCheck('compatibility-date', ctx).status, 'warn');
});

test('a current compatibility_date passes', () => {
  const ctx = base({
    today: '2026-08-26',
    wrangler: { compatibility_date: '2026-08-01', assets: { run_worker_first: ['/_actions/*'] } },
  });
  assert.equal(runCheck('compatibility-date', ctx).status, 'pass');
});

test('a site with components but no credit import warns', () => {
  const ctx = base({
    components: new Map([['src/components/regions/footer/footer.astro', '<footer>hi</footer>']]),
  });
  const result = runCheck('webmaster-credit', ctx);
  assert.equal(result.status, 'warn');
  assert.match(result.detail!, /footer component/);
});

test('a footer that imports the credit passes', () => {
  const ctx = base({
    components: new Map([
      [
        'src/components/regions/footer/footer.astro',
        `import Webmaster from '@cparkerwebm/webmonterey/webmonterey/webmaster/Webmaster.astro';`,
      ],
    ]),
  });
  assert.equal(runCheck('webmaster-credit', ctx).status, 'pass');
});

test('a site with no components yet is not nagged', () => {
  assert.equal(runCheck('webmaster-credit', base()).status, 'pass');
});

test('a comment explaining a trap does not trip the check that enforces it', () => {
  /*
   * Three checks have now fired on their own documentation. Good code explains its traps using
   * the exact words the trap is about, so a naive substring scan is guaranteed to hit the prose.
   */
  const ctx = base({
    components: new Map([
      [
        'src/components/regions/header/header.astro',
        `/*\n * No querySelector<HTMLSelectElement> generic - see CLAUDE.md.\n */\nconst el = root.querySelector('.thing');`,
      ],
    ]),
    pages: new Map([
      [
        'src/pages/thing.astro',
        `// querySelector<HTMLSelectElement> is what this file avoids\nconst x = 1;`,
      ],
    ]),
  });
  assert.equal(runCheck('select-element', ctx).status, 'pass');
});

test('the real thing is still caught once the comments are gone', () => {
  const ctx = base({
    components: new Map([
      ['src/components/a.astro', `const el = root.querySelector<HTMLSelectElement>('.thing');`],
    ]),
  });
  assert.equal(runCheck('select-element', ctx).status, 'fail');
});

test("WebMonterey's own site is not asked to credit itself", () => {
  const ctx = base({
    site: { client: 'WebMonterey', domain: 'webmonterey.com' },
    components: new Map([['src/components/regions/footer/footer.astro', '<footer>x</footer>']]),
  });
  assert.equal(runCheck('webmaster-credit', ctx).status, 'pass');
});

test('a cron with no custom entrypoint FAILS, and names the fix', () => {
  /*
   * Measured against @astrojs/cloudflare 14.2.5: triggers.crons merges into the generated
   * wrangler.json and deploys clean, and the generated entry exports fetch only. Firing
   * /__scheduled against that build returns 404 from the asset router.
   */
  const ctx = base({
    wrangler: { triggers: { crons: ['0 * * * *'] }, assets: { run_worker_first: ['/_actions/*'] } },
  });
  const result = runCheck('cron-without-handler', ctx);
  assert.equal(result.status, 'fail');
  assert.match(result.detail!, /main/);
  assert.match(result.detail!, /@astrojs\/cloudflare\/handler/);
});

test('a cron WITH a proper custom entrypoint passes - this is the supported path', () => {
  // friendsofthemarinalibrary.org has run its evening summary sweep this way since generation 2.
  const ctx = base({
    wrangler: {
      main: './src/worker.ts',
      triggers: { crons: ['0 * * * *'] },
      assets: { run_worker_first: ['/_actions/*'] },
    },
    workerEntry: `import { handle } from '@astrojs/cloudflare/handler';
      export default {
        async fetch(request, env, ctx) { return handle(request, env, ctx); },
        async scheduled(controller, env, ctx) { ctx.waitUntil(sweep(env)); },
      } satisfies ExportedHandler<Env>;`,
  });
  assert.equal(runCheck('cron-without-handler', ctx).status, 'pass');
});

test('an entrypoint that forgets the adapter handler FAILS - it would unserve the whole site', () => {
  const ctx = base({
    wrangler: {
      main: './src/worker.ts',
      triggers: { crons: ['0 * * * *'] },
      assets: { run_worker_first: [] },
    },
    workerEntry: `export default { async scheduled(c, env, ctx) { ctx.waitUntil(sweep(env)); } };`,
  });
  const result = runCheck('cron-without-handler', ctx);
  assert.equal(result.status, 'fail');
  assert.match(result.detail!, /stops being served|@astrojs\/cloudflare\/handler/);
});

test('the Pages-era main value is refused by name', () => {
  const ctx = base({
    wrangler: {
      main: './dist/_worker.js/index.js',
      triggers: { crons: ['0 * * * *'] },
      assets: { run_worker_first: [] },
    },
  });
  assert.match(runCheck('cron-without-handler', ctx).detail!, /build output|SOURCE/);
});

test('a compatibility_date in the FUTURE fails - the site would not build at all', () => {
  /*
   * The direction the check originally missed. A date newer than the runtime bundled with the
   * installed wrangler is refused outright: miniflare throws ERR_FUTURE_COMPATIBILITY_DATE. Two
   * client sites hit it and it was diagnosed twice, independently, because the check only ever
   * looked for a date that was too old.
   */
  const ctx = base({
    today: '2026-08-27',
    wrangler: { compatibility_date: '2026-12-31', assets: { run_worker_first: ['/_actions/*'] } },
  });
  const result = runCheck('compatibility-date', ctx);
  assert.equal(result.status, 'fail');
  assert.match(result.detail!, /FUTURE/);
  assert.match(result.detail!, /ERR_FUTURE_COMPATIBILITY_DATE/);
});

test('a nested schema.org type is not mistaken for a block type', () => {
  /*
   * A page describing a physical place carries `place.type: "BookStore"`, and a form field
   * carries its own `type`. Matching every "type" key in the file reported a real site as broken
   * for having a bookshop on a page.
   */
  const ctx = base({
    registry: `export const blocks = { 'content-000001': C };`,
    content: new Map([
      [
        'src/content/pages/bookstore.json',
        JSON.stringify({
          place: { type: 'BookStore', name: 'The Shop' },
          blocks: [{ type: 'content-000001', fields: [{ type: 'email' }] }],
        }),
      ],
    ]),
  });
  assert.equal(runCheck('block-types-registered', ctx).status, 'pass');
});

test('an unregistered BLOCK type is still caught', () => {
  const ctx = base({
    registry: `export const blocks = { 'content-000001': C };`,
    content: new Map([
      ['src/content/pages/home.json', JSON.stringify({ blocks: [{ type: 'content-000009' }] })],
    ]),
  });
  assert.match(runCheck('block-types-registered', ctx).detail!, /content-000009/);
});

test('a worker entry using defineWorker satisfies the cron check', () => {
  // defineWorker supplies the adapter's fetch; requiring the raw import flagged every site
  // using the package helper as broken.
  const ctx = base({
    wrangler: {
      main: './src/worker.ts',
      triggers: { crons: ['0 * * * *'] },
      assets: { run_worker_first: [] },
    },
    workerEntry: `import { defineWorker } from '@cparkerwebm/webmonterey/worker';
      export default defineWorker({ scheduled: (c, env, ctx) => ctx.waitUntil(sweep(env)) });`,
  });
  assert.equal(runCheck('cron-without-handler', ctx).status, 'pass');
});

test("a placeholder favicon still in public/ fails - it is the agency's mark on a client site", () => {
  /*
   * Caught on a rebuild: the client had .ico and PNG icons but no SVG, the scaffold seeds one,
   * and browsers PREFER SVG - so WebMonterey's own mark became the client's icon. Nobody looks
   * at a favicon, which is exactly why it would have stayed there.
   */
  const ctx = base({
    site: { client: 'Acme', domain: 'acme.com', launched: '2026-03-01' },
    placeholders: ['public/favicon.svg', 'public/opengraph.png'],
  });
  const result = runCheck('placeholder-branding', ctx);
  assert.equal(result.status, 'fail', 'a LAUNCHED site shipping the agency mark is a fault');
  assert.match(result.detail!, /favicon\.svg/);
});

test('a site that replaced the artwork passes', () => {
  assert.equal(runCheck('placeholder-branding', base()).status, 'pass');
});

test("the agency's own launched site passes with the seed in place - the seed is its mark", () => {
  const placeholders = ['public/favicon.svg', 'public/opengraph.png'];
  const launched = '2026-03-01';
  const agency = base({
    site: { client: 'WebMonterey', domain: 'webmonterey.com', launched },
    placeholders,
  });
  assert.equal(runCheck('placeholder-branding', agency).status, 'pass');

  /* The same context on any other domain is still the fault it always was. */
  const client = base({ site: { client: 'Acme', domain: 'acme.com', launched }, placeholders });
  assert.equal(runCheck('placeholder-branding', client).status, 'fail');
});

test('a registry keyed by name rather than by number is understood', () => {
  /*
   * Most of the fleet numbers its components; autire names them "hero.standard", "article.feed".
   * Requiring the numbered form meant none of its 39 registrations matched and every block on
   * the site was reported unregistered. A convention is not a syntax.
   */
  const ctx = base({
    registry: `export const blocks = { 'hero.standard': H, 'article.feed': A, faq: F };`,
    content: new Map([
      [
        'src/content/pages/home.json',
        JSON.stringify({ blocks: [{ type: 'hero.standard' }, { type: 'article.feed' }] }),
      ],
    ]),
  });
  assert.equal(runCheck('block-types-registered', ctx).status, 'pass');
});

test('the chrome exports in a registry are not read as block types', () => {
  /*
   * `header`, `footer`, `pageHeader`, `structuredData` and `webmasterPage` sit in the same file
   * as `blocks`, in either export form. None is a block type, and none may make the check trip
   * over a registry that is otherwise complete.
   */
  const ctx = base({
    registry: [
      `import WebmasterPage from './general/webmaster-page.astro';`,
      `export const blocks = { 'content-000001': C };`,
      `export const registeredTypes = () => Object.keys(blocks);`,
      `export { default as pageHeader } from './general/page-header.astro';`,
      `export const webmasterPage = WebmasterPage;`,
    ].join('\n'),
    content: new Map([
      ['src/content/pages/home.json', JSON.stringify({ blocks: [{ type: 'content-000001' }] })],
    ]),
  });
  assert.equal(runCheck('block-types-registered', ctx).status, 'pass');
});

test('a site that has not launched only gets a warning about placeholders', () => {
  /*
   * `webm new` seeds every one of these, so a freshly scaffolded site has the full set. The
   * check first shipped as a hard failure and the end-to-end test caught it immediately: it
   * scaffolds a site and the doctor failed it. A check that fails on the scaffold's own output
   * is one people learn to skip.
   */
  const ctx = base({
    site: { client: 'Acme', domain: 'acme.com' },
    placeholders: ['public/favicon.svg'],
  });
  assert.equal(runCheck('placeholder-branding', ctx).status, 'warn');
});

/*
 * THE THREE CHECKS THAT EXIST BECAUSE OF THE AUGUST 2026 REBUILD AUDIT.
 *
 * Each one reproduces a real failure that shipped and stayed quiet: an action the rebuild
 * dropped while the button kept calling it, migrations left behind in the old repo while
 * production ran on tables that already existed, and a D1 feature flag with nothing bound.
 *
 * The negative cases matter as much as the positive ones. `actions` is an ordinary English word
 * and SQL keywords are ordinary English words; a check that cries wolf on either gets ignored,
 * and an ignored check is worse than no check.
 */
test('actions-exist catches a call to an action nothing exports', () => {
  const r = runCheck(
    'actions-exist',
    base({
      components: new Map([
        [
          'src/components/x.astro',
          `import { actions } from 'astro:actions';\nactions.registerForEvent(fd);`,
        ],
      ]),
      actions: new Map([
        ['src/actions/index.ts', `export { server } from '@cparkerwebm/webmonterey/actions';`],
      ]),
    }),
  );
  assert.equal(r.status, 'fail');
  assert.match(r.detail!, /registerForEvent/);
});

test('actions-exist accepts an action the site adds beside the package server', () => {
  const r = runCheck(
    'actions-exist',
    base({
      components: new Map([
        [
          'src/components/x.astro',
          `import { actions } from 'astro:actions';\nactions.registerForEvent(fd);`,
        ],
      ]),
      actions: new Map([
        [
          'src/actions/index.ts',
          `import { server as webm } from '@cparkerwebm/webmonterey/actions';\nimport { registerForEvent } from './events';\nexport const server = {\n  ...webm,\n  registerForEvent,\n}`,
        ],
        ['src/actions/events.ts', `export const registerForEvent = defineAction({});`],
      ]),
    }),
  );
  assert.equal(r.status, 'pass');
});

test('actions-exist accepts the package action with no site actions file at all', () => {
  const r = runCheck(
    'actions-exist',
    base({
      components: new Map([
        [
          'src/components/x.astro',
          `import { actions } from 'astro:actions';\nactions.submitForm(fd);`,
        ],
      ]),
    }),
  );
  assert.equal(r.status, 'pass');
});

test('actions-exist ignores a variable that merely happens to be called actions', () => {
  /* webmonterey.com really has this: a DOM node named `actions`, and no astro:actions import. */
  const r = runCheck(
    'actions-exist',
    base({
      components: new Map([
        [
          'src/components/header.astro',
          `const actions = header.querySelector('[data-actions]');\nactions.getBoundingClientRect();`,
        ],
      ]),
    }),
  );
  assert.equal(r.status, 'pass');
});

test('migrations-cover-tables catches a table no migration creates', () => {
  const r = runCheck(
    'migrations-cover-tables',
    base({
      site: { client: 'Acme', domain: 'acme.com', features: { d1: true } },
      includes: new Map([
        ['src/includes/events/store.ts', 'const q = `SELECT id FROM events WHERE x = ?`;'],
      ]),
      migrations: new Map([
        ['migrations/0001_create_submissions.sql', 'CREATE TABLE submissions (id INTEGER);'],
      ]),
    }),
  );
  assert.equal(r.status, 'fail');
  assert.match(r.detail!, /events/);
});

test('migrations-cover-tables passes once the migration is there', () => {
  const r = runCheck(
    'migrations-cover-tables',
    base({
      site: { client: 'Acme', domain: 'acme.com', features: { d1: true } },
      includes: new Map([['src/includes/events/store.ts', 'const q = `SELECT id FROM events`;']]),
      migrations: new Map([
        ['migrations/0001.sql', 'CREATE TABLE submissions (id INTEGER);'],
        ['migrations/0002.sql', 'CREATE TABLE IF NOT EXISTS events (id INTEGER);'],
      ]),
    }),
  );
  assert.equal(r.status, 'pass');
});

test('migrations-cover-tables does not read an import statement as SQL', () => {
  /* Lowercase `from` is every import in the repo. Only uppercase SQL counts. */
  const r = runCheck(
    'migrations-cover-tables',
    base({
      site: { client: 'Acme', domain: 'acme.com', features: { d1: true } },
      includes: new Map([
        ['src/includes/a.ts', `import { all } from 'astro:content';\nimport x from './y';`],
      ]),
      migrations: new Map([['migrations/0001.sql', 'CREATE TABLE submissions (id INTEGER);']]),
    }),
  );
  assert.equal(r.status, 'pass');
});

test('d1-binding catches features.d1 with nothing bound', () => {
  const r = runCheck(
    'd1-binding',
    base({
      site: { client: 'Acme', domain: 'acme.com', features: { d1: true } },
      wrangler: {},
    }),
  );
  assert.equal(r.status, 'fail');
});

test('d1-binding stays quiet when the site does not use D1', () => {
  const r = runCheck(
    'd1-binding',
    base({
      site: { client: 'Acme', domain: 'acme.com', features: { d1: false } },
      wrangler: {},
    }),
  );
  assert.equal(r.status, 'pass');
});

test('a staging site with no stagingEmail FAILS - every send would throw', () => {
  const r = runCheck(
    'staging-email',
    base({ site: { client: 'A', domain: 'a.com', environment: 'staging', stagingEmail: '' } }),
  );
  assert.equal(r.status, 'fail');
  assert.match(r.detail!, /stagingEmail/);
});

test('a staging site with an address passes, and production never needs one', () => {
  assert.equal(
    runCheck(
      'staging-email',
      base({
        site: { client: 'A', domain: 'a.com', environment: 'staging', stagingEmail: 'me@a.com' },
      }),
    ).status,
    'pass',
  );
  assert.equal(
    runCheck('staging-email', base({ site: { client: 'A', domain: 'a.com' } })).status,
    'pass',
  );
});

test('a fully wired site passes the docs-server check', () => {
  assert.equal(runCheck('mcp-docs', base()).status, 'pass');
});

test('a site with no .mcp.json at all fails rather than passing quietly', () => {
  const r = runCheck('mcp-docs', base({ mcp: { declared: null, enabled: null } }));
  assert.equal(r.status, 'fail');
  assert.match(r.detail!, /no \.mcp\.json/);
});

/*
 * The regression that motivated the check: MDN was added to the scaffold after sites existed, so
 * a site can hold a perfectly valid .mcp.json that simply predates a server.
 */
test('a server missing from .mcp.json is named, not just counted', () => {
  const { mdn, ...rest } = mcpConfig().mcpServers;
  void mdn;
  const r = runCheck('mcp-docs', base({ mcp: { declared: rest, enabled: ['astro-docs'] } }));
  assert.equal(r.status, 'fail');
  assert.match(r.detail!, /missing from \.mcp\.json: mdn/);
});

test('a declared but un-approved server fails, because it is inert until someone clicks', () => {
  const r = runCheck('mcp-docs', base({ mcp: { declared: mcpConfig().mcpServers, enabled: [] } }));
  assert.equal(r.status, 'fail');
  assert.match(r.detail!, /enabledMcpjsonServers/);
  assert.match(r.detail!, /astro-docs/);
  assert.match(r.detail!, /mdn/);
});

test('a server pointed at the wrong url is caught, and both urls are shown', () => {
  const declared = { ...mcpConfig().mcpServers, mdn: { type: 'http', url: 'https://example.com' } };
  const r = runCheck('mcp-docs', base({ mcp: { declared, enabled: [...MCP_NAMES] } }));
  assert.equal(r.status, 'fail');
  assert.match(r.detail!, /example\.com/);
  assert.ok(r.detail!.includes(MCP_SERVERS.mdn.url));
});

/* --- the Worker exists --------------------------------------------------- */

test('a Worker with no deployment warns and says how to create it', () => {
  /* A repo, a database and nothing serving: the failure /webm:start used to end on. */
  const r = runCheck(
    'worker-exists',
    base({ worker: { name: 'acme', deployments: 0, skipped: null } }),
  );
  assert.equal(r.status, 'warn');
  assert.match(r.detail!, /"acme"/);
  assert.match(r.detail!, /wrangler deploy/);
  assert.match(r.detail!, /Settings → Builds/);
});

test('an unanswerable question skips with the reason, and is not a failure', () => {
  const r = runCheck(
    'worker-exists',
    base({ worker: { name: 'acme', deployments: null, skipped: 'wrangler is not logged in' } }),
  );
  assert.equal(r.status, 'pass');
  assert.match(r.detail!, /skipped: wrangler is not logged in/);
});

test('a deployed Worker passes', () => {
  assert.equal(runCheck('worker-exists', base()).status, 'pass');
});

test('a launched site still declared staging fails, and the message names the search consequence', () => {
  const r = runCheck(
    'environment',
    base({
      site: { client: 'A', domain: 'a.com', environment: 'staging', launched: '2026-09-01' },
    }),
  );
  assert.equal(r.status, 'fail');
  assert.match(r.detail!, /noindex/);
  assert.match(r.detail!, /out of search/);
});

test('a D1 binding named after the database, not DB, is told what to rename', () => {
  /*
   * `wrangler d1 create <slug> --update-config` without --binding prompts for a binding name and,
   * in a session with no terminal, defaults it to the database name. The site then fails this
   * check until someone renames it by hand - so the message names the rename.
   */
  const r = runCheck(
    'd1-binding',
    base({
      site: { client: 'Acme', domain: 'acme.com', features: { d1: true } },
      wrangler: { d1_databases: [{ binding: 'acme', database_name: 'acme', database_id: 'x' }] },
    }),
  );
  assert.equal(r.status, 'fail');
  assert.match(r.detail!, /"acme"/);
  assert.match(r.detail!, /Rename the binding to DB/);
  assert.match(r.detail!, /--binding=DB/);
});

test('a component in the registry but not the union, or the reverse, is a warning naming it', () => {
  const contentConfig =
    `import { webmontereyCollections } from '@cparkerwebm/webmonterey/content';\n` +
    `import { schema as hero } from './components/content/content-000001/schema.ts';\n` +
    `import { schema as faq } from './components/content/content-000010/schema.ts';\n` +
    `export const collections = webmontereyCollections([hero, faq]);\n`;
  const registry = `export const blocks = { 'content-000001': A, 'region-000001': R };`;
  const r = runCheck('union-matches-registry', base({ contentConfig, registry }));
  assert.equal(r.status, 'warn');
  assert.match(r.detail!, /not in the union[^;]*region-000001/);
  assert.match(r.detail!, /not in src\/components\/registry\.ts: content-000010/);
});

test('a union and registry that agree pass, whatever the local names; empty and empty pass', () => {
  const contentConfig =
    `import { schema as whateverIWant } from './components/content/content-000001/schema.ts';\n` +
    `export const collections = webmontereyCollections([whateverIWant]);\n`;
  const registry = `export const blocks = { 'content-000001': A };`;
  assert.equal(
    runCheck('union-matches-registry', base({ contentConfig, registry })).status,
    'pass',
  );
  assert.equal(
    runCheck(
      'union-matches-registry',
      base({
        contentConfig: `export const collections = webmontereyCollections([]);\n`,
        registry: `export const blocks = {};`,
      }),
    ).status,
    'pass',
    'a fresh scaffold',
  );
  assert.equal(runCheck('union-matches-registry', base()).status, 'pass');
});

test('a mode-read secret read with plain getBinding elsewhere, or listed without its twin, warns', () => {
  const includes = new Map([
    ['src/includes/pay.ts', `const k = getBindingForMode<string>('STRIPE_SECRET_KEY', host);`],
  ]);
  const actions = new Map([['src/actions/index.ts', `getBinding<string>('STRIPE_SECRET_KEY')`]]);
  const r = runCheck('binding-modes', base({ includes, actions }));
  assert.equal(r.status, 'warn');
  assert.match(
    r.detail!,
    /STRIPE_SECRET_KEY is read with plain getBinding in src\/actions\/index\.ts/,
  );

  const twinless = runCheck(
    'binding-modes',
    base({ includes, devVarsExample: `# STRIPE_SECRET_KEY=\n# MAILGUN_API_KEY=\n` }),
  );
  assert.equal(twinless.status, 'warn');
  assert.match(twinless.detail!, /lists STRIPE_SECRET_KEY but STRIPE_SECRET_KEY_TEST is neither/);
});

test('a consistent mode-read secret passes, and a site using no mode helper is silent', () => {
  const includes = new Map([
    ['src/includes/pay.ts', `getBindingForMode<string>('STRIPE_SECRET_KEY', host)`],
  ]);
  const ok = base({
    includes,
    devVarsExample: `# STRIPE_SECRET_KEY=\n# STRIPE_SECRET_KEY_TEST=\n`,
    actions: new Map([['src/actions/index.ts', `getBinding<string>('TURNSTILE_SECRET_KEY')`]]),
  });
  assert.equal(runCheck('binding-modes', ok).status, 'pass');
  assert.equal(runCheck('binding-modes', base()).status, 'pass');
});

test('getSecret is a spelling of the same read: plain in one file, ForMode in another, warns', () => {
  const includes = new Map([
    ['src/includes/pay.ts', `const k = await getSecretForMode('STRIPE_SECRET_KEY', host);`],
  ]);
  const actions = new Map([['src/actions/index.ts', `await getSecret('STRIPE_SECRET_KEY_TEST')`]]);
  const r = runCheck('binding-modes', base({ includes, actions }));
  assert.equal(r.status, 'warn');
  assert.match(r.detail!, /STRIPE_SECRET_KEY_TEST is read with plain getSecret in src\/actions/);
});

test('a _TEST twin bound through secrets_store_secrets satisfies the twin check', () => {
  const includes = new Map([
    ['src/includes/pay.ts', `await getSecretForMode('STRIPE_SECRET_KEY', host)`],
  ]);
  const store = [
    { binding: 'STRIPE_SECRET_KEY_TEST', store_id: 'abc', secret_name: 'STRIPE_SECRET_KEY_TEST' },
  ];
  const ctx = base({
    includes,
    devVarsExample: `# STRIPE_SECRET_KEY=\n`,
    wrangler: { secrets_store_secrets: store },
  });
  assert.equal(runCheck('binding-modes', ctx).status, 'pass');
  assert.equal(
    runCheck('binding-modes', { ...ctx, wrangler: {} }).status,
    'warn',
    'the same site without the store binding is the twinless case',
  );
});

test('a secrets_store_secrets binding nothing reads warns; one the site or the package reads passes', () => {
  const bound = (...names: string[]) => ({
    secrets_store_secrets: names.map((binding) => ({
      binding,
      store_id: 'abc',
      secret_name: binding,
    })),
  });
  const unread = runCheck(
    'binding-modes',
    base({ wrangler: bound('MAILGUN_WEBHOOK_SIGNING_KEY', 'STRIPE_KEY') }),
  );
  assert.equal(unread.status, 'warn');
  assert.match(
    unread.detail!,
    /binds STRIPE_KEY through secrets_store_secrets but nothing reads it/,
  );
  assert.doesNotMatch(unread.detail!, /MAILGUN_WEBHOOK_SIGNING_KEY/, 'the package reads that one');

  const siteReads = base({
    wrangler: bound('STRIPE_SECRET_KEY', 'STRIPE_SECRET_KEY_TEST', 'MAPS_KEY'),
    includes: new Map([
      [
        'src/includes/pay.ts',
        `await getSecretForMode('STRIPE_SECRET_KEY', host); hasBinding('MAPS_KEY');`,
      ],
    ]),
  });
  assert.equal(runCheck('binding-modes', siteReads).status, 'pass');

  const nameMismatch = runCheck(
    'binding-modes',
    base({ wrangler: bound('MAILGUN_WEBHOOK_KEY'), includes: new Map() }),
  );
  assert.equal(nameMismatch.status, 'warn', 'the store name is not the name the code reads');
});

test('PACKAGE_SECRETS is exactly what the package source reads with getSecret', () => {
  /*
   * The list is hard-coded in checks.ts because the checks must stay a pure function of their
   * context; this is what keeps it honest. Every getSecret / getSecretForMode call in the
   * package's non-test source, the ForMode ones in both spellings.
   */
  const src = fileURLToPath(new URL('../', import.meta.url));
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|astro)$/.test(entry) && !/\.test\.ts$/.test(entry)) files.push(full);
    }
  };
  walk(src);
  const read = new Set<string>();
  for (const file of files) {
    /* Comments stripped: env.ts documents the helpers with a Stripe example nothing reads. */
    const source = stripComments(readFileSync(file, 'utf8'));
    for (const m of source.matchAll(/\bgetSecret\s*\(\s*['"]([A-Z0-9_]+)['"]/g)) read.add(m[1]!);
    for (const m of source.matchAll(/\bgetSecretForMode\s*\(\s*['"]([A-Z0-9_]+)['"]/g)) {
      read.add(m[1]!).add(`${m[1]!}_TEST`);
    }
  }
  assert.deepEqual([...read].sort(), [...PACKAGE_SECRETS].sort());
});

test('features.queue needs a producer bound as QUEUE, a consumer for the same queue, and a handler', () => {
  const site = { client: 'Acme', domain: 'acme.com', features: { queue: true } };
  const entry = `import { defineWorker } from '@cparkerwebm/webmonterey/worker';
import { formQueue } from '@cparkerwebm/webmonterey/cloudflare/queues';
export default defineWorker({ queue: formQueue() });`;

  const none = runCheck('queue-binding', base({ site, wrangler: {} }));
  assert.equal(none.status, 'fail');
  assert.match(none.detail!, /no queues\.producers entry binding QUEUE/);

  const noConsumer = runCheck(
    'queue-binding',
    base({ site, wrangler: { queues: { producers: [{ binding: 'QUEUE', queue: 'acme' }] } } }),
  );
  assert.equal(noConsumer.status, 'fail');
  assert.match(noConsumer.detail!, /no consumer/);

  const wrangler = {
    main: './src/worker.ts',
    queues: {
      producers: [{ binding: 'QUEUE', queue: 'acme' }],
      consumers: [{ queue: 'acme', dead_letter_queue: 'acme-fail' }],
    },
  };
  const noHandler = runCheck(
    'queue-binding',
    base({ site, wrangler, workerEntry: `export default defineWorker({});` }),
  );
  assert.equal(noHandler.status, 'fail');
  assert.match(noHandler.detail!, /exports no queue\(\) handler/);

  assert.equal(
    runCheck('queue-binding', base({ site, wrangler, workerEntry: entry })).status,
    'pass',
  );

  const noDlq = runCheck(
    'queue-binding',
    base({
      site,
      workerEntry: entry,
      wrangler: { ...wrangler, queues: { ...wrangler.queues, consumers: [{ queue: 'acme' }] } },
    }),
  );
  assert.equal(noDlq.status, 'warn');
  assert.match(noDlq.detail!, /dead_letter_queue/);
});

test('with features.queue off the queue check is silent, whatever wrangler says', () => {
  assert.equal(runCheck('queue-binding', base({ wrangler: {} })).status, 'pass');
});

test('features.analytics needs the ANALYTICS binding and the beacon route in run_worker_first', () => {
  const site = { client: 'Acme', domain: 'acme.com', features: { analytics: true } };
  const unbound = runCheck(
    'analytics-binding',
    base({ site, wrangler: { assets: { run_worker_first: ['/_actions/*', '/_webm/*'] } } }),
  );
  assert.equal(unbound.status, 'fail');
  assert.match(unbound.detail!, /binding ANALYTICS/);

  const datasets = [{ binding: 'ANALYTICS', dataset: 'acme' }];
  const unrouted = runCheck(
    'analytics-binding',
    base({
      site,
      wrangler: {
        analytics_engine_datasets: datasets,
        assets: { run_worker_first: ['/_actions/*'] },
      },
    }),
  );
  assert.equal(unrouted.status, 'fail');
  assert.match(unrouted.detail!, /\/_webm\/\*/);

  const ok = base({
    site,
    wrangler: {
      analytics_engine_datasets: datasets,
      assets: { run_worker_first: ['/_actions/*', '/_webm/*'] },
    },
  });
  assert.equal(runCheck('analytics-binding', ok).status, 'pass');
});

test('a bound dataset with the feature off is a warning, and neither is silence', () => {
  const bound = runCheck(
    'analytics-binding',
    base({ wrangler: { analytics_engine_datasets: [{ binding: 'ANALYTICS', dataset: 'acme' }] } }),
  );
  assert.equal(bound.status, 'warn');
  assert.equal(runCheck('analytics-binding', base()).status, 'pass');
});

test('features.marketing needs DB_MKTG with its own migrations folder, the routes, and the secrets named', () => {
  const site = { client: 'Acme', domain: 'acme.com', features: { marketing: true } };
  const bare = runCheck('mktg-binding', base({ site, wrangler: {} }));
  assert.equal(bare.status, 'fail');
  assert.match(bare.detail!, /binds DB_MKTG/);
  assert.match(bare.detail!, /migrations-mktg\/ is empty/);
  assert.match(bare.detail!, /\/subscribe\/confirm/);

  const wrangler = {
    assets: {
      run_worker_first: [
        '/_actions/*',
        '/_webm/*',
        '/subscribe/*',
        '/unsubscribe',
        '/unsubscribe/',
      ],
    },
    d1_databases: [
      { binding: 'DB', database_id: 'a' },
      { binding: 'DB_MKTG', database_id: 'b', migrations_dir: 'migrations-mktg' },
    ],
  };
  const migrationsMktg = new Map([
    ['migrations-mktg/0001.sql', 'CREATE TABLE IF NOT EXISTS subscribers (id INTEGER);'],
  ]);
  const devVarsExample =
    '# MAILGUN_MKTG_API_KEY=\n# MAILGUN_MKTG_DOMAIN=\n# MAILGUN_WEBHOOK_SIGNING_KEY=\n';
  assert.equal(
    runCheck('mktg-binding', base({ site, wrangler, migrationsMktg, devVarsExample })).status,
    'pass',
  );

  const wrongDir = runCheck(
    'mktg-binding',
    base({
      site,
      migrationsMktg,
      devVarsExample,
      wrangler: { ...wrangler, d1_databases: [{ binding: 'DB_MKTG', database_id: 'b' }] },
    }),
  );
  assert.equal(wrongDir.status, 'fail');
  assert.match(wrongDir.detail!, /migrations_dir/);

  const unnamed = runCheck(
    'mktg-binding',
    base({ site, wrangler, migrationsMktg, devVarsExample: '# MAILGUN_API_KEY=\n' }),
  );
  assert.match(
    unnamed.detail!,
    /does not name MAILGUN_MKTG_API_KEY, MAILGUN_MKTG_DOMAIN, MAILGUN_WEBHOOK_SIGNING_KEY/,
  );
});

test('with features.marketing off the marketing check is silent', () => {
  assert.equal(runCheck('mktg-binding', base({ wrangler: {} })).status, 'pass');
});
