/*
 * The doctor's checks, as data.
 *
 * Every one maps to a trap that produced a real client incident, or to a decision that is
 * invisible when it drifts. Nothing here is style: each failure is silent in normal use, which
 * is the whole reason a command has to look for it.
 *
 * Pure - each check takes a context and returns a result, with no I/O of its own - so the suite
 * is testable without a site on disk.
 */
import { isValidTimeZone, PLACEHOLDER, isConfigured } from '../includes/webmonterey/config.ts';
import type { SiteConfig } from '../includes/webmonterey/config.ts';
import { MCP_NAMES, MCP_SERVERS, mcpGaps } from './mcp.ts';
import { compareVersions } from './codemods.ts';
import { WRANGLER_FLOOR } from './toolchain.ts';

export type Status = 'pass' | 'warn' | 'fail';

export interface CheckResult {
  status: Status;
  /** What is wrong, and what it looks like when it goes wrong. */
  detail?: string;
}

export interface CheckContext {
  site: SiteConfig;
  /** Parsed wrangler.jsonc, or null when absent. */
  wrangler: {
    name?: string;
    assets?: { run_worker_first?: string[] };
    compatibility_date?: string;
    triggers?: { crons?: string[] };
    main?: string;
    d1_databases?: Array<{
      binding?: string;
      database_name?: string;
      database_id?: string;
      migrations_dir?: string;
    }>;
    queues?: {
      producers?: Array<{ binding?: string; queue?: string }>;
      consumers?: Array<{ queue?: string; dead_letter_queue?: string }>;
    };
    analytics_engine_datasets?: Array<{ binding?: string; dataset?: string }>;
    secrets_store_secrets?: Array<{ binding?: string; store_id?: string; secret_name?: string }>;
  } | null;
  /** Source of the custom Worker entrypoint named by wrangler `main`, or null. */
  workerEntry: string | null;
  /** Today, YYYY-MM-DD, for the compatibility-date check. */
  today: string;
  /** Route file path -> its source, for every file under src/pages/. */
  pages: Map<string, string>;
  /** Component file path -> its source, for every file under src/components/. */
  components: Map<string, string>;
  /** Page JSON basenames without extension, e.g. ['home', 'privacy']. */
  contentPages: string[];
  /** Page JSON path -> raw contents, for the block-type check. */
  content: Map<string, string>;
  /** src/actions/ source, keyed by path. Where a site's own actions are declared. */
  actions: Map<string, string>;
  /** src/includes/ source - the site's own modules, not the package's. */
  includes: Map<string, string>;
  /** src/emails/ source - client-owned templates. */
  emails: Map<string, string>;
  /** migrations/*.sql, keyed by path. */
  migrations: Map<string, string>;
  /** migrations-mktg/*.sql - the marketing database's own folder - keyed by path. */
  migrationsMktg: Map<string, string>;
  /** Source of src/components/registry.ts, or null when the site has none. */
  registry: string | null;
  /** Source of src/content.config.ts, or null when the site has none. */
  contentConfig: string | null;
  /** Contents of .dev.vars.example, or null when absent. Committed, unlike .dev.vars. */
  devVarsExample: string | null;
  /** Files that must exist on disk, mapped to whether they do. */
  present: Record<string, boolean>;
  /** public/ files that are byte-identical to the package's seeded placeholder. */
  placeholders: string[];
  /** Contents of .claude/skills/webm/.webm-sync.json, or null. */
  sync: { version: string; skills: string[] } | null;
  /** .mcp.json's servers and .claude/settings.json's pre-approval list, each null when absent. */
  mcp: {
    declared: Record<string, { url?: string }> | null;
    enabled: string[] | null;
  };
  /** The installed package version. */
  version: string;
  /**
   * The site's installed toolchain, read from each package's manifest in node_modules - never
   * from the range in package.json, which says what the site would accept, not what it has.
   * Null when the package is not installed.
   */
  toolchain: { wrangler: string | null };
  /**
   * Whether the Worker named in wrangler.jsonc exists on the account, asked of wrangler by the
   * doctor. `deployments` is how many it listed - null when the question was not asked, and
   * `skipped` then says why: wrangler not installed, not logged in, no network.
   */
  worker: { name: string | null; deployments: number | null; skipped: string | null };
}

export interface Check {
  id: string;
  title: string;
  /** What the failure looks like from outside, so the report explains itself. */
  silentAs: string;
  run(ctx: CheckContext): CheckResult;
}

/**
 * THE CHROME: the registry exports that are components the package's OWN routes render. Base
 * renders header, footer and panels on every route that uses it; the marketing outcome pages
 * render marketingPage or pageHeader; /webmaster renders webmasterPage. structuredData is data,
 * not a component, and `blocks` is the map the page router reads.
 */
export const CHROME_EXPORTS = [
  'header',
  'footer',
  'panels',
  'pageHeader',
  'marketingPage',
  'webmasterPage',
] as const;

const REGISTRY_PATH = 'src/components/registry.ts';

/** A relative import resolved against the importing file; null for a package or bare import. */
export function resolveImport(from: string, spec: string): string | null {
  if (!/^\.\.?\//.test(spec)) return null;
  const parts = from.split('/');
  parts.pop();
  for (const seg of spec.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

/** Every module a file imports or re-exports from, with the default-import identifier when there is one. */
function importsOf(code: string): Array<{ ident: string | null; spec: string }> {
  const out: Array<{ ident: string | null; spec: string }> = [];
  for (const m of code.matchAll(
    /import\s+(?:type\s+)?(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{[^}]*\}|\*\s+as\s+[\w$]+)?\s*from\s*['"]([^'"]+)['"]/g,
  )) {
    out.push({ ident: m[1] ?? null, spec: m[2]! });
  }
  for (const m of code.matchAll(/export\s*\{[^}]*\}\s*from\s*['"]([^'"]+)['"]/g)) {
    out.push({ ident: null, spec: m[1]! });
  }
  return out;
}

/**
 * The files the registry's chrome exports resolve to, keyed by file, valued by the export name.
 *
 * Three ways a site writes one, all seen in the fleet:
 *   export { default as footer } from './regions/footer.astro';
 *   import footer from './regions/footer.astro';  export { footer };   // or  { footer as header }
 *   import region from './regions/footer.astro';  export const footer = region;
 * An export set to null - `export const marketingPage = null` - is a site declining it.
 */
export function chromeFiles(registry: string): Map<string, string> {
  const code = stripComments(registry);
  const byIdent = new Map<string, string>();
  for (const { ident, spec } of importsOf(code)) {
    const file = ident && resolveImport(REGISTRY_PATH, spec);
    if (ident && file) byIdent.set(ident, file);
  }
  const out = new Map<string, string>();
  const claim = (file: string | null | undefined, name: string) => {
    if (file && !out.has(file)) out.set(file, name);
  };
  for (const m of code.matchAll(/export\s*\{([^}]*)\}(?:\s*from\s*['"]([^'"]+)['"])?/g)) {
    const from = m[2] ? resolveImport(REGISTRY_PATH, m[2]) : null;
    for (const entry of m[1]!.split(',')) {
      const [local, exported = local] = entry
        .trim()
        .split(/\s+as\s+/)
        .map((s) => s.trim());
      if (!local || !(CHROME_EXPORTS as readonly string[]).includes(exported!)) continue;
      claim(m[2] ? from : byIdent.get(local), exported!);
    }
  }
  for (const m of code.matchAll(
    /export\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*([A-Za-z_$][\w$]*)\s*;/g,
  )) {
    if ((CHROME_EXPORTS as readonly string[]).includes(m[1]!)) claim(byIdent.get(m[2]!), m[1]!);
  }
  return out;
}

const IMAGE_USE = /<Image\b|<Picture\b|getImage\s*\(/;
const GUARDED = /Astro\.isPrerendered/;

/**
 * Every file the chrome reaches - the exports above and, transitively, what they import from the
 * site's own tree - that uses <Image>, <Picture> or getImage without an Astro.isPrerendered branch.
 * Each hit names the file and the chrome export it was reached from.
 *
 * A file that imports the registry is rendering blocks by type - a footer region that maps a
 * footer's block list through `blocks` - so every block in the registry is reachable from it.
 * Package imports are not followed: the package's own components are the package's problem, and
 * its tests. Sources are keyed the way the doctor reads them, `src/components/...`.
 */
export function chromeImageHits(registry: string, sources: Map<string, string>): string[] {
  const registryCode = stripComments(registry);
  const blockFiles = importsOf(registryCode)
    .map(({ ident, spec }) => (ident ? resolveImport(REGISTRY_PATH, spec) : null))
    .filter((f): f is string => f !== null);
  const find = (file: string): [string, string] | null => {
    for (const candidate of [file, `${file}.astro`, `${file}.ts`, `${file}/index.ts`]) {
      const src = sources.get(candidate);
      if (src !== undefined) return [candidate, src];
    }
    return null;
  };

  const queue = [...chromeFiles(registry)].map(([file, via]) => ({ file, via }));
  const seen = new Set<string>();
  const hits: string[] = [];
  while (queue.length) {
    const { file, via } = queue.shift()!;
    const found = find(file);
    if (!found || seen.has(found[0])) continue;
    seen.add(found[0]);
    const code = stripComments(found[1]);
    if (IMAGE_USE.test(code) && !GUARDED.test(code)) hits.push(`${found[0]} (reached from ${via})`);
    for (const { spec } of importsOf(code)) {
      const next = resolveImport(found[0], spec);
      if (!next) continue;
      if (next === REGISTRY_PATH || `${next}.ts` === REGISTRY_PATH) {
        for (const block of blockFiles)
          queue.push({ file: block, via: `${via}, through the registry's blocks` });
        continue;
      }
      queue.push({ file: next, via });
    }
  }
  return hits;
}

/**
 * Source with comments removed.
 *
 * EVERY CHECK THAT SCANS SOURCE MUST USE THIS. Three separate checks have now fired on their own
 * documentation: a scaffold test flagged the word "tier" inside a comment saying "nothing here
 * reads a tier", an import rule flagged a comment explaining which import is forbidden, and this
 * file's querySelector rule flagged a component comment that cites the rule by name.
 *
 * The pattern is not a coincidence. Good code explains its traps in prose, using the exact words
 * the trap is about, so a naive substring scan is guaranteed to hit the explanation. A false
 * positive here is worse than a miss: it teaches people the doctor cries wolf.
 */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/<!--[\s\S]*?-->/g, ' ');
}

const pass: CheckResult = { status: 'pass' };
const fail = (detail: string): CheckResult => ({ status: 'fail', detail });
const warn = (detail: string): CheckResult => ({ status: 'warn', detail });

/** Routes declaring `export const prerender = false`, as url paths. */
export function onDemandRoutes(pages: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [file, source] of pages) {
    if (!/export\s+const\s+prerender\s*=\s*false/.test(source)) continue;
    const route =
      '/' +
      file
        .replace(/^.*src\/pages\//, '')
        .replace(/\.(astro|ts|js|md)$/, '')
        .replace(/\/index$/, '')
        .replace(/^index$/, '');
    out.push(route === '/' ? '/' : route);
  }
  return out;
}

/**
 * Action names the PACKAGE's server provides. A site gets these for free by spreading it.
 *
 * Hard-coded rather than imported because this file must stay a pure function of its context -
 * importing the action module would pull astro:actions into the CLI. One name today; when the
 * package gains another, it goes here, and the test below is what notices.
 */
const PACKAGE_ACTIONS = ['submitForm'];

/**
 * Secret names the PACKAGE reads, in every spelling it reads them - the mode-read pair in both.
 * A site's own source never mentions these, so without this list a Secrets Store binding for
 * the Mailgun webhook signing key would be reported as read by nothing. Hard-coded for the same
 * reason as PACKAGE_ACTIONS; the test scans the package's own source for getSecret calls and
 * fails when this list drifts from it.
 */
export const PACKAGE_SECRETS = [
  'MAILGUN_API_KEY',
  'MAILGUN_DOMAIN',
  'MAILGUN_MKTG_API_KEY',
  'MAILGUN_MKTG_API_KEY_TEST',
  'MAILGUN_MKTG_DOMAIN',
  'MAILGUN_MKTG_DOMAIN_TEST',
  'MAILGUN_WEBHOOK_SIGNING_KEY',
  'TURNSTILE_SECRET_KEY',
];

/** `actions.<name>` used in files that actually import astro:actions. */
export function actionsCalled(sources: Map<string, string>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [file, raw] of sources) {
    /*
     * ONLY FILES THAT IMPORT THE ACTIONS API. `actions` is an ordinary word - a component with
     * `const actions = header.querySelector(...)` then calls `actions.getBoundingClientRect()`,
     * and an array of them gets `.map`. Both look exactly like an action call to a regex. The
     * import is the one signal that separates the API from a variable someone named well.
     */
    if (!/from\s+['"]astro:actions['"]/.test(raw)) continue;
    const src = stripComments(raw);
    for (const m of src.matchAll(/\bactions\.([a-zA-Z][a-zA-Z0-9]*)/g)) {
      const name = m[1];
      out.set(name, [...(out.get(name) ?? []), file]);
    }
  }
  return out;
}

/** Names the site's own src/actions/ adds to the server, by any of the ways it can. */
export function actionsExported(actions: Map<string, string>): string[] {
  const names = new Set<string>();
  for (const [, raw] of actions) {
    const src = stripComments(raw);
    /* `foo: defineAction({...})` and `export const foo = defineAction({...})` */
    for (const m of src.matchAll(/([a-zA-Z][a-zA-Z0-9]*)\s*:\s*defineAction\b/g)) names.add(m[1]);
    for (const m of src.matchAll(/export\s+const\s+([a-zA-Z][a-zA-Z0-9]*)\s*=\s*defineAction\b/g))
      names.add(m[1]);
    /*
     * The server object's own shorthand members - `export const server = { ...webm, portal }` -
     * which is how a namespaced group of actions arrives. Read from the literal rather than by
     * following the import, because the import may point anywhere.
     */
    const server = src.match(/export\s+const\s+server\s*=\s*\{([\s\S]*?)\n\}/);
    if (server) {
      for (const m of server[1].matchAll(/^\s*([a-zA-Z][a-zA-Z0-9]*)\s*(?:,|:)/gm)) names.add(m[1]);
    }
  }
  return [...names];
}

/** CREATE TABLE / CREATE VIEW names declared across migrations/. */
export function tablesCreated(migrations: Map<string, string>): string[] {
  const names = new Set<string>();
  for (const [, raw] of migrations) {
    for (const m of stripComments(raw).matchAll(
      /CREATE\s+(?:TABLE|VIEW)(?:\s+IF\s+NOT\s+EXISTS)?\s+[`"\[]?([a-zA-Z_][a-zA-Z0-9_]*)/gi,
    ))
      names.add(m[1].toLowerCase());
  }
  return [...names];
}

/**
 * Table names read or written in source.
 *
 * UPPERCASE KEYWORDS ONLY, deliberately. Lowercase `from` is an import on every line of every
 * TypeScript file in the repo; SQL in this codebase is written in caps, and requiring that is
 * what keeps this from reporting the whole project.
 */
export function tablesReferenced(sources: Map<string, string>[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const group of sources) {
    for (const [file, raw] of group) {
      for (const m of stripComments(raw).matchAll(
        /\b(?:FROM|INSERT\s+INTO|UPDATE|DELETE\s+FROM|JOIN)\s+[`"\[]?([a-z_][a-zA-Z0-9_]*)/g,
      )) {
        const name = m[1].toLowerCase();
        if (name === 'sqlite_master' || name.startsWith('sqlite_')) continue;
        out.set(name, [...(out.get(name) ?? []), file]);
      }
    }
  }
  return out;
}

export const CHECKS: Check[] = [
  {
    id: 'actions-exist',
    title: 'Every action a page calls is one the server exports',
    silentAs:
      'the button posts to an action that is not there - no build error, and nothing said at runtime until somebody submits',
    run(ctx) {
      const called = actionsCalled(new Map([...ctx.pages, ...ctx.components, ...ctx.includes]));
      if (called.size === 0) return pass;

      const available = new Set([...PACKAGE_ACTIONS, ...actionsExported(ctx.actions)]);
      const missing = [...called].filter(([name]) => !available.has(name));
      if (missing.length === 0) return pass;

      return fail(
        missing
          .map(([name, files]) => `actions.${name} (${files[0]}) is not exported by src/actions/`)
          .join('; '),
      );
    },
  },
  {
    id: 'migrations-cover-tables',
    title: 'Every table the code reads has a migration that creates it',
    silentAs:
      'production keeps working against tables that already exist there while local dev has none - and the repo can no longer rebuild its own database',
    run(ctx) {
      if (!ctx.site.features?.d1) return pass;
      if (ctx.migrations.size === 0) return pass;

      const created = new Set(tablesCreated(ctx.migrations));
      const referenced = tablesReferenced([ctx.includes, ctx.pages, ctx.components, ctx.actions]);
      const missing = [...referenced].filter(([t]) => !created.has(t));
      if (missing.length === 0) return pass;

      return fail(
        missing
          .map(([t, files]) => `${t} (used in ${files[0]}) has no CREATE in migrations/`)
          .join('; '),
      );
    },
  },
  {
    id: 'd1-binding',
    title: 'features.d1 has a database bound to write to',
    silentAs:
      'the form validates, thanks the visitor and stores nothing, because the binding it writes through does not exist',
    run(ctx) {
      if (!ctx.site.features?.d1) return pass;
      const bindings = ctx.wrangler?.d1_databases ?? [];
      if (bindings.some((b) => b.binding === 'DB' && b.database_id)) return pass;
      /*
       * The common shape of this failure: `wrangler d1 create --update-config` without
       * `--binding=DB` names the binding after the database, so the entry is there with the
       * wrong name. Say which name to change rather than that something is missing.
       */
      const misnamed = bindings.find((b) => b.database_id && b.binding && b.binding !== 'DB');
      if (misnamed) {
        return fail(
          `features.d1 is true and wrangler binds the database as "${misnamed.binding}" - the ` +
            `package writes through DB. Rename the binding to DB in wrangler.jsonc (the create ` +
            `command takes --binding=DB to get it right first time).`,
        );
      }
      return fail(
        bindings.length === 0
          ? 'features.d1 is true and wrangler has no d1_databases block'
          : 'features.d1 is true but no d1_databases entry binds DB with a database_id',
      );
    },
  },
  {
    id: 'queue-binding',
    title: 'features.queue has a queue to send through and a consumer to read it',
    silentAs:
      'the action falls back to sending inline on every submission, so the queue changes nothing and nobody notices; or messages are produced and never consumed, and every notification sits in the queue until it expires',
    run(ctx) {
      if (!ctx.site.features?.queue) return pass;
      const queues = ctx.wrangler?.queues;
      const producer = (queues?.producers ?? []).find((p) => p.binding === 'QUEUE' && p.queue);
      if (!producer) {
        return fail(
          'features.queue is true but wrangler.jsonc has no queues.producers entry binding QUEUE. ' +
            'The scaffold left the block commented out until the queues exist - create them and ' +
            'uncomment it, or switch the feature off.',
        );
      }
      const consumer = (queues?.consumers ?? []).find((c) => c.queue === producer.queue);
      if (!consumer) {
        return fail(
          `the Worker produces to "${producer.queue}" but declares no consumer for it, so every ` +
            `message waits in the queue until it expires. Add the queues.consumers entry.`,
        );
      }
      if (!consumer.dead_letter_queue) {
        return warn(
          `the consumer for "${producer.queue}" has no dead_letter_queue, so a notification that ` +
            `fails every retry is dropped rather than kept where a person can see it.`,
        );
      }
      /*
       * The consumer is a `queue` export on the Worker entrypoint, and the adapter's generated
       * entry has none - the same trap as a cron, see cron-without-handler.
       */
      if (!ctx.wrangler?.main) {
        return fail(
          'a consumer is declared but wrangler.jsonc sets no "main", so the Worker has no queue() ' +
            'handler to receive it. Point "main" at src/worker.ts exporting defineWorker({ queue }).',
        );
      }
      if (ctx.workerEntry === null) {
        return warn(
          `"main" is ${ctx.wrangler.main} but that file was not found from the site root.`,
        );
      }
      const source = stripComments(ctx.workerEntry);
      if (!/\bqueue\b\s*[(:]/.test(source) && !/\bformQueue\b/.test(source)) {
        return fail(
          `${ctx.wrangler.main} exports no queue() handler, so the declared consumer has nothing ` +
            `to run. defineWorker({ queue: formQueue() }) is the shape.`,
        );
      }
      return pass;
    },
  },
  {
    id: 'analytics-binding',
    title: 'features.analytics has a dataset to write to and a route for the beacon',
    silentAs:
      'every event is dropped before it is written, or every page view 404s in a browser and is counted in curl',
    run(ctx) {
      const bound = (ctx.wrangler?.analytics_engine_datasets ?? []).some(
        (d) => d.binding === 'ANALYTICS',
      );
      if (!ctx.site.features?.analytics) {
        return bound
          ? warn(
              'wrangler.jsonc binds ANALYTICS but features.analytics is off, so nothing is ever ' +
                'written to it. Switch the feature on, or drop the binding.',
            )
          : pass;
      }
      if (!bound) {
        return fail(
          'features.analytics is true but wrangler.jsonc has no analytics_engine_datasets entry ' +
            'binding ANALYTICS. Add { "binding": "ANALYTICS", "dataset": "<slug>" } - nothing ' +
            'needs creating, the dataset appears on first write.',
        );
      }
      const listed = ctx.wrangler?.assets?.run_worker_first ?? [];
      const covered = listed.some(
        (e) => e === '/_webm/*' || (e.endsWith('/*') && '/_webm/beacon'.startsWith(e.slice(0, -1))),
      );
      if (!covered) {
        return fail(
          'the page-view beacon posts to /_webm/beacon, an on-demand route, and run_worker_first ' +
            'does not cover it - so the asset router answers a document-style request with the ' +
            '404 page. Add "/_webm/*".',
        );
      }
      return pass;
    },
  },
  {
    id: 'mktg-binding',
    title: 'features.marketing has its database, its migrations and its routes',
    silentAs:
      'a signup throws after the enquiry is stored, a confirm link 404s in a browser, or the webhook never reaches the Worker and the list drifts from what Mailgun knows',
    run(ctx) {
      if (!ctx.site.features?.marketing) return pass;
      const problems: string[] = [];

      const entry = (ctx.wrangler?.d1_databases ?? []).find((d) => d.binding === 'DB_MKTG');
      if (!entry?.database_id) {
        problems.push(
          'no d1_databases entry binds DB_MKTG - the list lives in a SECOND database, <slug>-mktg ' +
            '(npx wrangler d1 create <slug>-mktg --binding=DB_MKTG --update-config)',
        );
      } else if (entry.migrations_dir !== 'migrations-mktg') {
        problems.push(
          `the DB_MKTG entry needs "migrations_dir": "migrations-mktg", so its migrations are not ` +
            `applied to the submissions database`,
        );
      }

      if (ctx.migrationsMktg.size === 0) {
        problems.push(
          'migrations-mktg/ is empty - webm sync seeds it once features.marketing is on',
        );
      } else if (
        ![...ctx.migrationsMktg.values()].some((sql) =>
          /CREATE TABLE[^;]*\bsubscribers\b/i.test(sql),
        )
      ) {
        problems.push('migrations-mktg/ has no migration creating the subscribers table');
      }

      const listed = ctx.wrangler?.assets?.run_worker_first ?? [];
      const covered = (p: string) =>
        listed.some((e) => e === p || (e.endsWith('/*') && p.startsWith(e.slice(0, -1))));
      const routes = [
        '/subscribe/confirm',
        '/subscribe/confirm/',
        '/unsubscribe',
        '/unsubscribe/',
        '/_webm/mailgun',
      ];
      const absent = routes.filter((r) => !covered(r));
      if (absent.length) {
        problems.push(
          `run_worker_first does not cover ${absent.join(', ')} - add "/subscribe/*", "/unsubscribe", ` +
            `"/unsubscribe/" and "/_webm/*"`,
        );
      }

      const example = ctx.devVarsExample ?? '';
      const named = [
        'MAILGUN_MKTG_API_KEY',
        'MAILGUN_MKTG_DOMAIN',
        'MAILGUN_WEBHOOK_SIGNING_KEY',
      ].filter((n) => !new RegExp(`^\\s*#?\\s*${n}`, 'm').test(example));
      if (ctx.devVarsExample !== null && named.length) {
        problems.push(`.dev.vars.example does not name ${named.join(', ')}`);
      }

      return problems.length ? fail(problems.join('; ')) : pass;
    },
  },
  {
    id: 'run-worker-first',
    title: 'Every on-demand route is in run_worker_first, in both slash forms',
    silentAs: '200 to curl, a 404 page in Chrome - the router branches on Sec-Fetch-Dest',
    run(ctx) {
      const listed = ctx.wrangler?.assets?.run_worker_first ?? [];
      const missing: string[] = [];
      for (const route of onDemandRoutes(ctx.pages)) {
        const covered = (p: string) =>
          listed.some(
            (entry) => entry === p || (entry.endsWith('/*') && p.startsWith(entry.slice(0, -1))),
          );
        for (const form of [route, `${route}/`]) if (!covered(form)) missing.push(form);
      }
      return missing.length ? fail(`not listed: ${[...new Set(missing)].join(', ')}`) : pass;
    },
  },
  {
    id: 'changeme',
    title: 'No CHANGEME left in webmonterey.json',
    silentAs: 'a placeholder in a credit link, an email subject, or structured data',
    run(ctx) {
      const stale = Object.entries(ctx.site)
        .filter(([, v]) => v === PLACEHOLDER)
        .map(([k]) => k);
      return stale.length ? fail(`still placeholder: ${stale.join(', ')}`) : pass;
    },
  },
  {
    id: 'timezone',
    title: 'timeZone is a real IANA zone',
    silentAs: 'Intl.DateTimeFormat throws at runtime, in a Worker, not on your laptop',
    run(ctx) {
      const zone = ctx.site.timeZone;
      if (!zone) return warn('unset - defaults to America/Los_Angeles');
      return isValidTimeZone(zone)
        ? pass
        : fail(
            `"${zone}" is not a zone Intl knows. There is no Pacific/LA; the Pacific/* zones are ocean locations.`,
          );
    },
  },
  {
    id: 'skills-synced',
    title: 'Fleet skills are materialized and match the installed version',
    silentAs: 'no /webm: skills in the session, and no error saying why',
    run(ctx) {
      if (!ctx.sync) {
        return fail(
          '.claude/skills/webm/ is missing. `npm install --ignore-scripts` skips the postinstall sync silently - run `npx webm sync`.',
        );
      }
      return ctx.sync.version === ctx.version
        ? pass
        : warn(`synced v${ctx.sync.version}, installed v${ctx.version} - run \`npx webm sync\``);
    },
  },
  {
    id: 'toolchain-floor',
    title: `wrangler is at or above the toolchain floor (${WRANGLER_FLOOR})`,
    silentAs:
      'a dependency advisory in miniflare, workerd or sharp stays open on this site alone; the build passes and nothing names it',
    run(ctx) {
      /*
       * THE FLOOR IS HOW A SITE THAT HAS NOT UPGRADED FINDS OUT. `webm upgrade` raises wrangler
       * on every site as it upgrades; a site that has not is on whatever its lockfile had, and
       * its build says nothing about it. Read from the installed manifest, not the range: a
       * range of ^4.118.0 with 4.131.1 in the lockfile is fine, and the reverse cannot happen.
       * Not installed is not this check's problem - the site cannot build at all, which is loud.
       */
      const installed = ctx.toolchain.wrangler;
      if (!installed) return pass;
      return compareVersions(installed, WRANGLER_FLOOR) < 0
        ? warn(
            `wrangler ${installed} is installed; this release's floor is ${WRANGLER_FLOOR}. ` +
              `\`npx webm upgrade\` raises it.`,
          )
        : pass;
    },
  },
  {
    /*
     * THE DOCS SERVERS, AND WHY A CHECK RATHER THAN TRUST.
     *
     * Astro ships majors faster than any training corpus turns over and the web platform moves
     * continuously, so a session working from recall writes code against an API that changed. The
     * servers are the fix; this check is what notices when a site has quietly lost them - a
     * merge that dropped .mcp.json, a settings file rewritten by hand, a site scaffolded before
     * the server existed. None of those announce themselves. The site keeps building, and the
     * only symptom is worse code, months later, with nothing to point at.
     *
     * DECLARED IS NOT ENOUGH. A server missing from `enabledMcpjsonServers` prompts for approval
     * on every machine, so the rule that depends on it holds only for whoever happened to hit
     * Approve. That is reported separately because the fix is different.
     */
    id: 'mcp-docs',
    title: 'The four documentation servers are wired and pre-approved',
    silentAs: 'code written from training-data recall instead of current docs',
    run(ctx) {
      if (!ctx.mcp.declared) return fail('no .mcp.json - run `npx webm upgrade` to restore it');
      const { undeclared, unapproved, wrongUrl } = mcpGaps(ctx.mcp.declared, ctx.mcp.enabled);
      const problems = [
        undeclared.length && `missing from .mcp.json: ${undeclared.join(', ')}`,
        unapproved.length &&
          `declared but not in enabledMcpjsonServers, so inert until someone approves them by ` +
            `hand: ${unapproved.join(', ')}`,
        wrongUrl.length &&
          wrongUrl
            .map(
              (n) => `${n} points at ${ctx.mcp.declared?.[n]?.url}, expected ${MCP_SERVERS[n].url}`,
            )
            .join('; '),
      ].filter(Boolean);
      return problems.length
        ? fail(`${problems.join('. ')}. \`npx webm upgrade\` adds what is missing, in place.`)
        : pass;
    },
  },
  {
    id: 'staging-email',
    title: 'A staging site has somewhere to send its mail',
    silentAs: 'every form submission on the preview throws instead of arriving anywhere',
    run(ctx) {
      /*
       * The package carries no inbox of its own - a default address in a public package would
       * mean a stranger's staging site mails the author - so a staging site has to name one.
       * sendEmail refuses rather than guesses, which is correct and also the kind of failure
       * that only shows up when somebody submits a form on a preview.
       */
      if (ctx.site.environment !== 'staging') return pass;
      return isConfigured(ctx.site.stagingEmail)
        ? pass
        : fail(
            'environment is "staging" but stagingEmail is empty. Every message this site tries ' +
              'to send will throw. Set "stagingEmail" in webmonterey.json to the inbox that ' +
              'should receive test mail.',
          );
    },
  },
  {
    id: 'select-element',
    title: 'No querySelector<HTMLSelectElement>',
    silentAs: 'ts(2344), which reads like a typo rather than a type conflict',
    run(ctx) {
      const hits: string[] = [];
      for (const [file, src] of [...ctx.pages, ...ctx.components]) {
        if (/querySelector<\s*HTMLSelectElement/.test(stripComments(src))) hits.push(file);
      }
      return hits.length
        ? fail(
            `${hits.join(', ')} - HTMLRewriter's Element interface merges with lib.dom's, and only ` +
              `HTMLSelectElement shadows remove(). Cast instead: \`as HTMLSelectElement | null\`.`,
          )
        : pass;
    },
  },
  {
    id: 'image-on-demand',
    title:
      'No <Image>, <Picture> or getImage on an on-demand route, or in the chrome those routes render',
    silentAs: 'a dead /_image URL, in production only - astro dev serves it happily',
    run(ctx) {
      /*
       * TWO PLACES, ONE TRAP. The site's own `prerender = false` routes are the obvious one. The
       * other is the PACKAGE's on-demand routes - /subscribe/confirm, /unsubscribe - which render
       * the site's chrome from the registry: header, footer, panels, and the marketing page or
       * page header, plus whatever those import (a connect block in the footer region, say). An
       * <Image> in any of them emits /_image on those routes, and only there: every page the site
       * wrote is prerendered, so the component looks fine everywhere a person checks.
       */
      const routes = new Set(onDemandRoutes(ctx.pages));
      const hits: string[] = [];
      for (const [file, src] of ctx.pages) {
        if (!/export\s+const\s+prerender\s*=\s*false/.test(src)) continue;
        const code = stripComments(src);
        if (IMAGE_USE.test(code) && !GUARDED.test(code)) hits.push(file);
      }
      if (ctx.registry !== null) {
        hits.push(...chromeImageHits(ctx.registry, new Map([...ctx.components, ...ctx.includes])));
      }
      return hits.length
        ? fail(
            `${hits.join(', ')} - imageService: 'compile' ships no runtime endpoint, and the ` +
              `package's own on-demand routes (/subscribe/confirm, /unsubscribe) render the chrome. ` +
              `Branch on Astro.isPrerendered and fall back to a plain <img src={image.src}>. ` +
              `(${routes.size} on-demand routes of the site's own)`,
          )
        : pass;
    },
  },
  {
    id: 'compatibility-date',
    title: 'compatibility_date is not stale',
    silentAs: 'EVERY page renders as the literal text "[object Object]" - build succeeds, no error',
    run(ctx) {
      /*
       * The worst failure found in the whole build-out, and the reason this check exists.
       *
       * compatibility_date pins Workers runtime behavior. Let it fall far enough behind the
       * installed workerd and Astro's renderer stops producing HTML: every page becomes the
       * 15-byte string "[object Object]". `astro build` prints "Complete!" and exits 0. Nothing
       * anywhere says the word "compatibility".
       *
       * Measured, not guessed: on wrangler 4.126 / astro 7.2, a date 207 days behind was broken
       * and one 148 days behind was fine. So the fail threshold is 180 - inside the range where
       * breakage is demonstrated - and the warning starts at 90, which is roughly one release
       * cycle of warning before that. An earlier draft of this check warned at 180 and failed at
       * 365; a site that was ACTUALLY rendering [object Object] got a warning from it, which is
       * the check being wrong in the only direction that matters.
       */
      const date = ctx.wrangler?.compatibility_date;
      if (!date) return ctx.wrangler ? warn('wrangler.jsonc sets no compatibility_date') : pass;

      const age = (Date.parse(ctx.today) - Date.parse(date)) / 86_400_000;
      if (Number.isNaN(age)) return warn(`compatibility_date is not a date: ${date}`);

      /*
       * THE OTHER DIRECTION, and it is the one that bites on day one. A compatibility_date newer
       * than the runtime the installed wrangler bundles is refused outright - miniflare throws
       * ERR_FUTURE_COMPATIBILITY_DATE and the site does not build at all. Two client sites hit
       * this and it was diagnosed twice, independently, because the check only ever looked for a
       * date that was too old.
       */
      if (age < 0) {
        return fail(
          `compatibility_date is ${date}, which is in the FUTURE. The runtime bundled with your ` +
            `wrangler refuses a date it does not know, so the site will not build - miniflare ` +
            `reports ERR_FUTURE_COMPATIBILITY_DATE. Set it to a date at least a fortnight behind ` +
            `today, which is what \`webm new\` now scaffolds.`,
        );
      }

      if (age > 180) {
        return fail(
          `compatibility_date is ${date}, ${Math.round(age)} days old. Run \`npm run preview\` ` +
            `and open a page: if it says "[object Object]", this is why. Bump it to today, ` +
            `redeploy, and check the site still behaves - the date pins runtime behavior.`,
        );
      }
      if (age > 90) {
        return warn(
          `compatibility_date is ${date}, ${Math.round(age)} days old. Not broken yet. Bump it ` +
            `on the next deploy, and verify on a preview URL rather than in production.`,
        );
      }
      return pass;
    },
  },
  {
    id: 'cron-without-handler',
    title: 'A Cron Trigger has a scheduled() handler to run',
    silentAs: 'the cron fires on schedule and does nothing at all, forever',
    run(ctx) {
      /*
       * The adapter GENERATES dist/server/entry.mjs, and that entry exports fetch and nothing
       * else - so a cron against the default setup invokes a handler the Worker does not have.
       * Verified by building examples/minimal with a cron and firing it: /__scheduled returned
       * 404 from the asset router.
       *
       * THE ESCAPE HATCH IS REAL AND DOCUMENTED, and this check exists to point at it rather
       * than to forbid crons. Setting `main` to a source file that re-exports the adapter's own
       * handler leaves room for the extra exports the generated entry has no place for:
       *
       *     import { handle } from '@astrojs/cloudflare/handler';
       *     export default {
       *       async fetch(request, env, ctx) { return handle(request, env, ctx); },
       *       async scheduled(controller, env, ctx) { ctx.waitUntil(work(env)); },
       *     } satisfies ExportedHandler<Env>;
       *
       * friendsofthemarinalibrary.org has run its evening summary sweep this way since
       * generation 2. The trap is only the DEFAULT, and the config half of it works perfectly:
       * triggers.crons merges into the generated wrangler.json and deploys without a warning.
       */
      const crons = ctx.wrangler?.triggers?.crons ?? [];
      if (crons.length === 0) return pass;

      const main = ctx.wrangler?.main;

      if (!main) {
        return fail(
          `wrangler.jsonc declares ${crons.length} Cron Trigger(s) (${crons.join(', ')}) but sets ` +
            `no "main". The adapter's generated Worker exports only fetch, so Cloudflare invokes ` +
            `a scheduled handler that does not exist and nothing reports it. Point "main" at a ` +
            `source entrypoint that re-exports @astrojs/cloudflare/handler and adds scheduled().`,
        );
      }

      /*
       * The Pages-era value. It names a BUILD ARTEFACT rather than a source file and fails the
       * build with "main field doesn't point to an existing file" - a different failure, but the
       * same wrong idea, and it is what someone reaches for first.
       */
      if (/dist\//.test(main)) {
        return fail(
          `"main" is ${main}, which points into the build output. It must name a SOURCE ` +
            `entrypoint - the adapter builds it. The Pages-era ./dist/_worker.js/index.js is the ` +
            `value not to use.`,
        );
      }

      if (ctx.workerEntry === null) {
        return warn(`"main" is ${main} but that file was not found from the site root.`);
      }

      const source = stripComments(ctx.workerEntry);

      if (!/\bscheduled\b\s*[(:]/.test(source)) {
        return fail(
          `${main} does not export a scheduled() handler, so the ${crons.length} declared cron(s) ` +
            `have nothing to run.`,
        );
      }

      /*
       * EITHER shape is correct. `defineWorker` from the package supplies the adapter's fetch and
       * is the recommended form; importing `handle` directly is the underlying mechanism and is
       * what a generation-2 site wrote by hand. Accepting only the second reported every site
       * using the package helper as broken - which is the check being wrong, and a false alarm
       * here teaches people to skip the whole report.
       */
      if (!/@astrojs\/cloudflare\/handler/.test(source) && !/\bdefineWorker\b/.test(source)) {
        return fail(
          `${main} neither calls defineWorker nor imports handle from ` +
            `@astrojs/cloudflare/handler. Replacing the generated entrypoint without one of them ` +
            `means every page, action and API route on the site stops being served - the cron ` +
            `would work and nothing else would.`,
        );
      }

      return pass;
    },
  },
  {
    id: 'block-types-registered',
    title: 'Every block type used in content is in the registry',
    silentAs: 'the block renders as NOTHING - no error, no warning, no gap in the page',
    run(ctx) {
      /*
       * The worst failure mode in this architecture, and the reason it gets a check rather than a
       * line in CLAUDE.md. The router looks up `type` in the registry and renders what it finds;
       * a miss renders nothing at all. The page returns 200, the build passes, and the section is
       * simply absent - which reads as a CSS problem and gets debugged as one for an hour.
       *
       * Typo, a type copied from another client, or a component deleted without grepping the
       * content: all three land here.
       */
      if (ctx.registry === null) return pass;

      /*
       * ANY quoted key, not just the numbered convention. The pattern used to require
       * `name-000000`, which is what most of the fleet uses - and autire's blocks are named
       * "hero.standard", "article.feed", so NONE of its 39 registrations matched and the check
       * reported every block on the site as unregistered. A convention is not a syntax.
       */
      const registered = new Set(
        [...ctx.registry.matchAll(/['"]([A-Za-z][\w.-]*)['"]\s*:/g)].map((m) => m[1]!),
      );
      /* An empty registry on a site with no content yet is the scaffold's normal state. */
      if (registered.size === 0 && ctx.content.size === 0) return pass;

      /*
       * PARSED, and only `blocks[].type`. A regex over every "type" key in the file also catches
       * types that are nothing to do with the registry: a schema.org `place.type` of "BookStore",
       * a form field's `type`, an icon's. It reported a real site as broken for having a bookshop
       * on a page - the fourth false positive this build-out has produced from matching text
       * where it should have been reading structure.
       */
      const missing = new Map<string, string[]>();
      for (const [file, raw] of ctx.content) {
        let parsed: { blocks?: Array<{ type?: unknown }> };
        try {
          parsed = JSON.parse(raw) as typeof parsed;
        } catch {
          /* A malformed page fails the content schema with a better message than this check. */
          continue;
        }
        for (const block of parsed.blocks ?? []) {
          const type = block?.type;
          if (typeof type !== 'string' || registered.has(type)) continue;
          missing.set(type, [...(missing.get(type) ?? []), file]);
        }
      }

      if (missing.size === 0) return pass;
      const lines = [...missing].map(([type, files]) => `${type} (${files.join(', ')})`);
      return fail(
        `not in src/components/registry.ts: ${lines.join('; ')}. ` +
          `Those blocks render as nothing. Either register the component or remove the block.`,
      );
    },
  },
  {
    id: 'union-matches-registry',
    title: 'The block union and the registry name the same components',
    silentAs:
      'a component in the registry but not the union rejects every page that uses it at build, and one in the union but not the registry renders as nothing',
    run(ctx) {
      /*
       * Adding a component is three things - the folder, the registry, the union - and the
       * skill says so, which is exactly why this gets a check: the third step is the one that is
       * forgotten, and each half fails differently. Registry-only: the page JSON fails the
       * schema, naming the type as invalid, on a component that plainly exists. Union-only: the
       * schema accepts the block and the router renders nothing.
       *
       * Read from structure. The union is the identifiers passed to webmontereyCollections,
       * each resolved through its import to a `<kind>/<id>/schema.ts` path, so the folder ID is
       * what is compared - not the local variable name, which is anything the author liked.
       */
      if (ctx.registry === null || ctx.contentConfig === null) return pass;
      const config = stripComments(ctx.contentConfig);

      const call = config.match(/webmontereyCollections\s*\(\s*\[([^\]]*)\]/);
      if (!call) return pass;
      const idents = call[1]!
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const byIdent = new Map<string, string>();
      for (const m of config.matchAll(
        /import\s*\{\s*schema\s+as\s+([A-Za-z_$][\w$]*)\s*\}\s*from\s*['"][^'"]*\/([^/'"]+)\/schema\.ts['"]/g,
      )) {
        byIdent.set(m[1]!, m[2]!);
      }
      const union = new Set(idents.map((i) => byIdent.get(i) ?? i));

      const registered = new Set(
        [...stripComments(ctx.registry).matchAll(/['"]([A-Za-z][\w.-]*)['"]\s*:/g)].map(
          (m) => m[1]!,
        ),
      );
      if (union.size === 0 && registered.size === 0) return pass;

      const unionOnly = [...union].filter((t) => !registered.has(t));
      const registryOnly = [...registered].filter((t) => !union.has(t));
      if (unionOnly.length === 0 && registryOnly.length === 0) return pass;

      const parts: string[] = [];
      if (registryOnly.length) {
        parts.push(
          `in src/components/registry.ts but not in the union passed to webmontereyCollections: ` +
            `${registryOnly.join(', ')} - a page using one fails the content schema`,
        );
      }
      if (unionOnly.length) {
        parts.push(
          `in the union but not in src/components/registry.ts: ${unionOnly.join(', ')} - a page ` +
            `using one renders it as nothing`,
        );
      }
      return warn(parts.join('; '));
    },
  },
  {
    id: 'binding-modes',
    title: 'Every secret is read the way it is bound, in the mode it is bound',
    silentAs:
      'one mode is unconfigured - the staging site reads a live key, or the launched site reads a test one - or a Secrets Store binding sits on the Worker that nothing reads',
    run(ctx) {
      /*
       * Source-level, and that is its limit: secret values cannot be read back from wrangler, so
       * this checks what the code EXPECTS against what wrangler.jsonc DECLARES, never what is set
       * on the Worker. Three disagreements are visible from here. A name read through a ForMode
       * helper in one file and through the plain one - getBinding or getSecret, in either
       * spelling - in another bypasses the selection in the second place. A mode-read name
       * listed in .dev.vars.example without its _TEST twin, and no twin bound from the Secrets
       * Store either, means the next session copies the example and local dev, which is a
       * staging deployment, reads a secret that is not there. And a secrets_store_secrets entry
       * whose binding name nothing reads - not the site, not the package - is a typo or a
       * leftover: the secret it names is bound to the Worker for no one, and the name the code
       * does read is still missing.
       */
      const sources = [ctx.actions, ctx.includes, ctx.pages, ctx.components, ctx.emails]
        .flatMap((m) => [...m.entries()])
        .map(([file, src]) => [file, stripComments(src)] as const);
      if (ctx.workerEntry) sources.push(['worker entry', stripComments(ctx.workerEntry)]);

      const moded = new Map<string, string>();
      const plain = new Map<string, Array<{ file: string; helper: string }>>();
      for (const [file, src] of sources) {
        for (const m of src.matchAll(
          /\b(?:get|has)(?:Binding|Secret)ForMode\s*(?:<[^>]*>)?\s*\(\s*['"]([A-Z0-9_]+)['"]/g,
        )) {
          if (!moded.has(m[1]!)) moded.set(m[1]!, file);
        }
        for (const m of src.matchAll(
          /\b((?:get|has)(?:Binding|Secret))\s*(?:<[^>]*>)?\s*\(\s*['"]([A-Z0-9_]+)['"]/g,
        )) {
          plain.set(m[2]!, [...(plain.get(m[2]!) ?? []), { file, helper: m[1]! }]);
        }
      }

      const problems: string[] = [];
      for (const [name, file] of moded) {
        for (const spelling of [name, `${name}_TEST`]) {
          const reads = plain.get(spelling);
          if (reads) {
            problems.push(
              `${spelling} is read with plain ${reads[0]!.helper} in ${reads[0]!.file} but ` +
                `${name} is read through the ForMode helper in ${file} - the first ignores the mode`,
            );
          }
        }
      }

      /*
       * The Secrets Store side: the binding name is what env exposes and what the code reads;
       * secret_name is the store's name for it and may differ.
       */
      const storeBound = new Set(
        (ctx.wrangler?.secrets_store_secrets ?? [])
          .map((entry) => entry.binding)
          .filter((name): name is string => typeof name === 'string' && name.length > 0),
      );

      const example = ctx.devVarsExample;
      if (example !== null) {
        const listed = new Set(
          [...example.matchAll(/^\s*#?\s*([A-Z0-9_]+)\s*=/gm)].map((m) => m[1]!),
        );
        for (const name of moded.keys()) {
          const twin = `${name}_TEST`;
          if (listed.has(name) && !listed.has(twin) && !storeBound.has(twin)) {
            problems.push(
              `.dev.vars.example lists ${name} but ${twin} is neither there nor bound through ` +
                `secrets_store_secrets - local dev is a staging deployment and reads the _TEST value`,
            );
          }
        }
      }

      if (storeBound.size) {
        const read = new Set<string>([...PACKAGE_SECRETS, ...plain.keys()]);
        for (const name of moded.keys()) read.add(name).add(`${name}_TEST`);
        for (const name of storeBound) {
          if (!read.has(name)) {
            problems.push(
              `wrangler.jsonc binds ${name} through secrets_store_secrets but nothing reads it - ` +
                `a binding name that does not match the name the code reads, or a secret the site ` +
                `no longer uses`,
            );
          }
        }
      }

      return problems.length ? warn(problems.join('; ')) : pass;
    },
  },
  {
    id: 'webmaster-credit',
    title: 'Something renders the webmaster credit',
    silentAs:
      'the site ships with no "Powered by WebMonterey", the /webmaster page is orphaned, and nobody notices for months',
    run(ctx) {
      /*
       * The package ships no footer - it ships no components at all - so the credit is imported
       * by whichever site component renders the footer. That is the right seam and it is also
       * easy to simply never do, which is how live client sites ended up without it. Without it
       * the /webmaster page the package injects is reachable from nothing.
       *
       * A warning, not a failure: a site mid-build has no footer yet, and failing there trains
       * people to ignore the doctor. `/webm:launch` is where it becomes blocking.
       */
      if (ctx.components.size === 0) return pass;

      /*
       * WebMonterey's own site does not credit itself. Checking the domain rather than adding a
       * config flag: there is exactly one agency site in the fleet and it is not a preference.
       */
      if (ctx.site.domain === 'webmonterey.com') return pass;

      for (const src of ctx.components.values()) {
        if (/webmonterey\/webmaster/.test(stripComments(src))) return pass;
      }
      return warn(
        'no component imports @cparkerwebm/webmonterey/webmonterey/webmaster/Webmaster.astro. ' +
          'The footer component is where it goes; it links to the /webmaster page.',
      );
    },
  },
  {
    id: 'placeholder-branding',
    title: "No placeholder mark is being served as the client's",
    silentAs: "the client's site shows WebMonterey's favicon, and nobody looks at a favicon",
    run(ctx) {
      /*
       * `webm new` seeds default favicons and a share image so a fresh site is not broken. They
       * are placeholders, and a rebuild is exactly where one survives: the client had .ico and
       * PNGs but no SVG, the seed supplied an SVG, and browsers prefer SVG - so the agency's own
       * mark became the client's icon. Nobody looks at a favicon, which is why it would have
       * stayed there.
       *
       * Byte-identical to what the package ships is the test. A client who genuinely wants the
       * default has still made a choice, but they will not have made it by accident.
       */
      if (ctx.placeholders.length === 0) return pass;

      /*
       * The seed IS WebMonterey's mark, so on the agency's own site the files are identical by
       * right, and a check that fails that repo forever is one people learn to skip. One agency
       * site in the fleet; a domain check rather than a config flag, for the same reason as the
       * credit check above.
       */
      if (ctx.site.domain === 'webmonterey.com') return pass;

      const detail =
        `still the package's placeholder, byte for byte: ${ctx.placeholders.join(', ')}. ` +
        `Replace with the client's own artwork before launch.`;

      /*
       * A WARNING UNTIL THE SITE HAS LAUNCHED, and a failure after.
       *
       * `webm new` seeds every one of these, so a freshly scaffolded site has the full set - and
       * a check that fails on the scaffold's own output is one people learn to skip. It caught
       * exactly that: the end-to-end test scaffolds a site and the doctor failed it.
       *
       * Once `launched` is set the site is somebody's, and shipping the agency's mark on it is a
       * real fault rather than an unfinished one. /webm:launch is where the warning becomes
       * blocking for a site that has not launched yet.
       */
      return isConfigured(ctx.site.launched) ? fail(detail) : warn(detail);
    },
  },
  {
    id: 'environment',
    title: 'The declared environment matches where the site actually is',
    silentAs:
      "a launched site whose client email is still being diverted to the agency's inbox, and " +
      'whose every page is noindex',
    run(ctx) {
      const declared = ctx.site.environment;

      if (declared !== undefined && declared !== 'production' && declared !== 'staging') {
        return fail(
          `environment is "${String(declared)}"; it must be "production" or "staging". ` +
            `An unrecognised value is treated as production, so this site is mailing real people.`,
        );
      }

      /*
       * BOTH DIRECTIONS ARE SILENT, which is the whole reason this check exists.
       *
       * Left on staging after launch, every enquiry a client should have received goes to the
       * agency instead - the form says thank you, the client's inbox stays empty, and the first
       * report is a customer asking why nobody called back.
       *
       * Left on production before launch, testing a preview mails the client's real contacts:
       * the contact form notifies their own inbox and the nightly sweep mails whoever organises
       * a programme. `launched` is the only signal available here for which side of that line a
       * site is on, and it is the same one the placeholder-artwork check reads.
       */
      if (declared === 'staging' && isConfigured(ctx.site.launched)) {
        return fail(
          `this site launched on ${ctx.site.launched} but is still declared staging, so every ` +
            `email it sends is being redirected away from its real recipients - and since 1.3.0 ` +
            `every build of a staging site is a preview: noindex on every page, no canonical, ` +
            `no sitemap, robots.txt disallowing everything. The live site is dropping out of ` +
            `search. Set "environment": "production" in webmonterey.json.`,
        );
      }

      if (declared !== 'staging' && !isConfigured(ctx.site.launched)) {
        return warn(
          `this site has no launch date but is treated as production, so testing a form will ` +
            `email the client's real contacts and every page is indexable on its workers.dev ` +
            `hostname. Set "environment": "staging" in webmonterey.json until /webm:launch.`,
        );
      }

      return pass;
    },
  },
  {
    /*
     * THE WORKER EXISTS. /webm:start used to end with a repo, a D1 database and an instruction
     * to create the Worker in the dashboard by hand - and on one site nobody did. Nothing local
     * notices: the build is green, every other check here is green, and the site is a
     * workers.dev hostname that answers nothing. The Worker is the one resource whose absence
     * has no symptom on disk, so this asks Cloudflare through wrangler - the one thing a laptop
     * can ask - and steps aside with a note when it cannot.
     */
    id: 'worker-exists',
    title: 'The Worker exists',
    silentAs: 'a site with a repo, a database and nothing serving',
    run(ctx) {
      if (ctx.worker.skipped) return { status: 'pass', detail: `skipped: ${ctx.worker.skipped}` };
      if (!ctx.worker.name) {
        return warn('wrangler.jsonc names no Worker, so there is nothing to look for');
      }
      if (!ctx.worker.deployments) {
        return warn(
          `no deployment of a Worker named "${ctx.worker.name}" on this account. Create it once ` +
            `from the laptop - npm run build && npx wrangler deploy - then connect the repo to ` +
            `it in the dashboard (Worker → Settings → Builds). /webm:start, steps 5 and 6.`,
        );
      }
      return pass;
    },
  },
  {
    id: 'seeded-files',
    title: 'The files Astro copies verbatim are present',
    silentAs: 'a missing favicon or an absent _headers - no build error either way',
    run(ctx) {
      /*
       * public/ is copied verbatim into the build. Nothing validates it, so a deleted _headers
       * costs the site every security header it had and the build says nothing at all.
       */
      const gone = Object.entries(ctx.present)
        .filter(([, there]) => !there)
        .map(([file]) => file);
      return gone.length
        ? warn(`missing: ${gone.join(', ')}. \`webm sync\` restores package-owned ones.`)
        : pass;
    },
  },
  {
    id: 'literal-values',
    title: 'Component CSS contains no literal colors or sizes',
    silentAs: 'drift away from the token system, one component at a time',
    run(ctx) {
      const hits: string[] = [];
      for (const [file, src] of ctx.components) {
        const styles = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
          .map((m) => m[1]!)
          .join('\n');
        if (!styles) continue;
        const withoutVars = stripComments(styles).replace(/--webm-[\w-]+\s*:[^;]+;/g, '');
        if (/#[0-9a-fA-F]{3,8}\b|\brgb a?\(|\bhsl a?\(/.test(withoutVars)) hits.push(file);
      }
      return hits.length ? warn(`literal colors in: ${hits.join(', ')}`) : pass;
    },
  },
];
