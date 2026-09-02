import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHECKS, onDemandRoutes, type CheckContext } from './checks.ts';
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
  registry: null,
  present: {},
  placeholders: [],
  sync: { version: '1.0.0', skills: ['launch'] },
  mcp: { declared: mcpConfig().mcpServers, enabled: [...MCP_NAMES] },
  version: '1.0.0',
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

test('an enabled app with a custom path needs the PUBLIC path in run_worker_first', () => {
  const site = { client: 'A', domain: 'a.com', app: { enabled: true, path: 'portal' } };
  const pages = new Map([['src/pages/webapp/dashboard.astro', 'export const prerender = false;']]);

  const bad = base({ site, pages, wrangler: { assets: { run_worker_first: ['/_actions/*'] } } });
  const r = runCheck('app-namespace', bad);
  assert.equal(r.status, 'fail');
  assert.match(r.detail!, /\/portal\/\*/);
  /* And the generic route check asks for the public route, not the folder route. */
  assert.match(runCheck('run-worker-first', bad).detail!, /\/portal\/dashboard/);

  const good = base({
    site,
    pages,
    wrangler: { assets: { run_worker_first: ['/_actions/*', '/portal/*', '/portal', '/portal/'] } },
  });
  assert.equal(runCheck('app-namespace', good).status, 'pass');
  assert.equal(runCheck('run-worker-first', good).status, 'pass');
});

test('a page JSON named like the app path is a collision, and a prerendered app page is a fault', () => {
  const r = runCheck(
    'app-namespace',
    base({
      site: { client: 'A', domain: 'a.com', app: { enabled: true, path: 'portal' } },
      contentPages: ['home', 'portal'],
      pages: new Map([['src/pages/webapp/index.astro', '<h1>static</h1>']]),
      wrangler: {
        assets: { run_worker_first: ['/_actions/*', '/portal/*', '/portal', '/portal/'] },
      },
    }),
  );
  assert.equal(r.status, 'fail');
  assert.match(r.detail!, /collides/);
  assert.match(r.detail!, /prerender = false/);
});

test('app routes with the app switched off only warn, and no routes is silence', () => {
  assert.equal(runCheck('app-namespace', base()).status, 'pass');
  const r = runCheck(
    'app-namespace',
    base({ pages: new Map([['src/pages/webapp/x.astro', 'export const prerender = false;']]) }),
  );
  assert.equal(r.status, 'warn');
  assert.match(r.detail!, /app\.enabled/);
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
