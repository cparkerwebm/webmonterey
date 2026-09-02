/*
 * The files `webm new` writes into a fresh site.
 *
 * Pure: takes a domain and returns a map of path -> contents, so the whole scaffold is testable
 * without touching a disk. `new.ts` is the thin layer that writes them.
 *
 * WHAT IS DELIBERATELY ABSENT: any component. The package ships none, so a new site starts with
 * an empty registry and an empty block union. That is not a stub awaiting code - it is the
 * decision. Generation 1 shipped framework chrome and every client overrode it.
 */
import { resourceNames } from './slug.ts';
import { MCP_NAMES, mcpConfig } from './mcp.ts';

export interface ScaffoldOptions {
  domain: string;
  /** Display name. Falls back to CHANGEME, which `go-live` refuses to launch with. */
  client?: string;
  /** GitHub org for the repo. */
  org?: string;
  /**
   * Where a staging deployment's mail goes. `webm new` fills it from `git config user.email`;
   * the package itself carries no inbox, because a default address in a public package means a
   * stranger's staging site mails the author. Empty is allowed here and fails `webm doctor`.
   */
  stagingEmail?: string;
  packageVersion: string;
  /**
   * Today, as YYYY-MM-DD. REQUIRED, and deliberately not defaulted.
   *
   * It becomes `compatibility_date` in wrangler.jsonc, which pins Workers runtime behavior. This
   * used to be a hardcoded constant with a comment saying the caller would overwrite it. No
   * caller did, and the failure is the worst kind there is: a compatibility_date a few months
   * stale builds without a warning and renders EVERY PAGE as the literal string
   * "[object Object]". 15 bytes, no error, exit code 0.
   *
   * A required parameter is the fix - a constant can be forgotten, an argument cannot.
   */
  today: string;
}

/** Shift a YYYY-MM-DD date by whole days, staying in UTC so a local zone cannot roll it over. */
function shiftDays(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

export function scaffold(options: ScaffoldOptions): Record<string, string> {
  const { domain, packageVersion } = options;
  const n = resourceNames(domain);
  const client = options.client ?? 'CHANGEME';
  const org = options.org ?? 'webmonterey';
  const { today } = options;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    throw new Error(`scaffold: today must be YYYY-MM-DD, got ${JSON.stringify(today)}`);
  }

  /*
   * COMPATIBILITY DATE IS TODAY MINUS A MARGIN, AND THE MARGIN IS THE WHOLE POINT.
   *
   * A compatibility_date NEWER than the runtime bundled with the installed wrangler is refused
   * outright - miniflare throws ERR_FUTURE_COMPATIBILITY_DATE and workerd reports "requires
   * compatibility date X, but the newest date supported by this server binary is Y". The site
   * simply does not build, from the moment it is scaffolded.
   *
   * Writing today's date walks straight into that for anyone whose wrangler is a few weeks old,
   * which is most people most of the time - a lockfile, an offline install, a CI image. Two
   * client sites hit exactly this and it was diagnosed twice, independently.
   *
   * A fortnight is comfortably more than Cloudflare's release cadence and costs nothing: an
   * older compatibility_date only means slightly more conservative runtime behavior, and the
   * doctor's staleness check does not even warn until 90 days. The failure this avoids is total;
   * the cost of avoiding it is unmeasurable.
   *
   * NOT clamped against the installed workerd, deliberately: `webm new` runs before the site has
   * a node_modules to inspect, and probing the CLI's own tree would bind the scaffold to however
   * the package happened to be installed.
   */
  const RUNTIME_LAG_DAYS = 14;
  const compatibilityDate = shiftDays(today, -RUNTIME_LAG_DAYS);

  const files: Record<string, string> = {};

  files['package.json'] =
    JSON.stringify(
      {
        name: n.worker,
        private: true,
        type: 'module',
        engines: { node: '>=22.18.0' },
        scripts: {
          /*
           * preinstall runs BEFORE node_modules exists, so it cannot call a bin from the package.
           * scripts/check-node.mjs is on disk for exactly that reason and `webm sync` refreshes it.
           */
          preinstall: 'node scripts/check-node.mjs',
          postinstall: 'webm sync',
          dev: 'wrangler types && astro dev',
          build: 'wrangler types && astro check && astro build',
          preview: 'astro preview',
          check: 'wrangler types && astro check',
          doctor: 'webm doctor',
          format: 'prettier --write .',
          /*
           * Component tests. --import scripts/test-hooks.mjs is what lets a test import './thing'
           * without an extension and a .json without an import attribute, the way Astro and Vite
           * do - so a test file reads like the app code it covers.
           */
          test: 'node --import ./scripts/test-hooks.mjs --test "src/**/*.test.ts"',
        },
        dependencies: { '@cparkerwebm/webmonterey': `^${packageVersion}`, astro: '^7.1.6' },
        devDependencies: {
          '@astrojs/check': '^0.9.10',
          prettier: '^3.9.6',
          typescript: '^6.0.3',
          wrangler: '^4.118.0',
        },
      },
      null,
      2,
    ) + '\n';

  files['astro.config.mjs'] =
    `// @ts-check\n` +
    `import { defineConfig } from 'astro/config';\n` +
    `import webmonterey, { adapter } from '@cparkerwebm/webmonterey';\n\n` +
    `/*\n` +
    ` * Two lines of configuration. Everything else - imageService, the sitemap, deriving site\n` +
    ` * from webmonterey.json, the noindex routes, the virtual modules - is decided inside the\n` +
    ` * integration, so a fix propagates on npm update rather than never.\n` +
    ` *\n` +
    ` * THE ADAPTER IS NAMED HERE AND NOT SET BY THE INTEGRATION. An adapter registered through\n` +
    ` * updateConfig does not run its own hooks, and the build then fails on the first on-demand\n` +
    ` * route with an error naming nothing you wrote. adapter() is the package's own, already\n` +
    ` * configured - the site takes no direct dependency on @astrojs/cloudflare.\n` +
    ` */\n` +
    `export default defineConfig({\n` +
    `  adapter: adapter(),\n` +
    `  integrations: [webmonterey()],\n` +
    `});\n`;

  files['webmonterey.json'] =
    JSON.stringify(
      {
        '//': 'Site identity. READ BY THE BUILD - editing this changes output, it is not documentation.',
        client,
        domain,
        repo: `${org}/${n.repo}`,
        worker: n.worker,
        slug: n.slug,
        launched: null,
        '//environment':
          "What this deployment is FOR. 'staging' redirects EVERY email the site sends to stagingEmail below, so testing a form on a preview cannot reach the client's real contacts. A new site starts here; /webm:launch flips it to 'production'. Anything served from workers.dev is treated as staging regardless, so a branch preview of a live site is covered too.",
        environment: 'staging',
        '//stagingEmail':
          'Where staging email goes instead of its real recipients. REQUIRED while environment is staging - a staging site with nowhere to send refuses to send rather than guessing. webm doctor checks.',
        stagingEmail: options.stagingEmail ?? '',
        '//gtmId':
          'Google Tag Manager container, GTM-XXXXXXX. PUBLIC by design - it is in the source of every page - so it is tracked here rather than in .env, which is gitignored and therefore absent on Workers Builds: a container id set only in the environment works locally and silently loads nothing in production. PUBLIC_GTM_ID in the environment overrides this, for pointing a branch at a different container. Leave empty and no GTM renders at all.',
        gtmId: '',
        '//locale':
          'IANA zone and locale for every client-facing date. D1 stores UTC, so nothing reaches a person without passing through these. There is no Pacific/LA.',
        timeZone: 'America/Los_Angeles',
        locale: 'en-US',
        '//organization':
          'Feeds the JSON-LD graph. EVERY empty field is omitted from output - never guess one, because wrong opening hours in structured data is worse than none.',
        organization: {
          type: 'Organization',
          legalName: '',
          telephone: '',
          email: '',
          streetAddress: '',
          addressLocality: '',
          addressRegion: '',
          postalCode: '',
          addressCountry: '',
          sameAs: [],
        },
        '//features':
          'Technical switches for what is WIRED on this site - not a commercial plan. Nothing here reads a tier. `platform` is reserved and inert until the platform mail relay ships.',
        features: { compliance: true, d1: false, turnstile: false, platform: false },
        '//app':
          'The web app namespace, reserved on every site. The folder is ALWAYS src/pages/webapp/; `path` is the public URL segment - set `portal`, `members` or `account` for a client whose customers log in, and the framework rewrites it onto the folder. Everything else derives from this field. Every page under the folder must be `prerender = false`.',
        app: { enabled: false, path: 'webapp', label: 'Portal' },
      },
      null,
      2,
    ) + '\n';

  files['design.json'] =
    JSON.stringify(
      {
        $schema: './node_modules/@cparkerwebm/webmonterey/schema/design.json',
        version: 1,
        brand: {
          name: client === 'CHANGEME' ? '' : client,
          voice: '',
          rules: [],
        },
      },
      null,
      2,
    ) + '\n';

  files['wrangler.jsonc'] =
    `{\n` +
    `  "$schema": "./node_modules/wrangler/config-schema.json",\n\n` +
    `  // MUST match the Worker name in the Cloudflare dashboard, or Workers Builds fails.\n` +
    `  "name": "${n.worker}",\n\n` +
    `  // The date this Worker was created, set a fortnight behind the scaffold so it cannot be newer
  // than the runtime the installed wrangler bundles - a compatibility_date in the future of that
  // binary refuses to build at all. Do not bump it casually; it pins runtime behavior.
  // Do not let it go stale either: a date a few months behind the installed workerd renders
  // every page as "[object Object]", with no error and a successful build. \`webm doctor\` checks.\n` +
    `  "compatibility_date": "${compatibilityDate}",\n` +
    `  "compatibility_flags": ["nodejs_compat"],\n\n` +
    `  // Astro's adapter builds static assets into dist/client, NOT dist.\n` +
    `  "assets": {\n` +
    `    "directory": "./dist/client",\n` +
    `    "not_found_handling": "404-page",\n\n` +
    `    /*\n` +
    `     * NOT REDUNDANT. Do not remove an entry because the path "already works" in curl.\n` +
    `     *\n` +
    `     * "404-page" intercepts NAVIGATION requests that match no static asset and serves\n` +
    `     * 404.html, so they never reach the Worker. Every \`prerender = false\` route is such a\n` +
    `     * path. The interception keys off \`Sec-Fetch-Dest: document\`, which a browser sends and\n` +
    `     * curl does not - so the same URL returns 200 to curl and the 404 page to Chrome.\n` +
    `     *\n` +
    `     * >> ADD EVERY ROUTE YOU GIVE \`prerender = false\`, IN BOTH SLASH FORMS. <<\n` +
    `     * \`npx webm doctor\` checks this.\n` +
    `     */\n` +
    `    "run_worker_first": ["/_actions/*"]\n` +
    `  },\n\n` +
    `  "observability": { "enabled": true },\n\n` +
    `  // Set BOTH explicitly. Toggling previews in the dashboard without updating this file\n` +
    `  // silently reverts it on the next deploy.\n` +
    `  "workers_dev": true,\n` +
    `  "preview_urls": true\n` +
    `}\n`;

  files['tsconfig.json'] =
    JSON.stringify(
      {
        extends: 'astro/tsconfigs/strict',
        include: ['.astro/types.d.ts', '**/*', 'worker-configuration.d.ts'],
        exclude: ['dist', 'node_modules'],
      },
      null,
      2,
    ) + '\n';

  files['.claude/settings.json'] =
    JSON.stringify(
      {
        '//': `Project settings for ${n.repo}.`,
        '//mcp':
          'A server declared in .mcp.json is INERT until approved on each machine. Without this line the rules that say consult the Astro and MDN docs before using an API would depend on whoever cloned the repo happening to hit Approve.',
        includeCoAuthoredBy: false,
        enabledMcpjsonServers: MCP_NAMES,
        permissions: {
          deny: [
            'Read(**/.dev.vars)',
            'Read(**/.dev.vars.*)',
            'Read(**/.env)',
            'Read(**/.env.*)',
            'Read(**/*.pem)',
            'Read(**/*.key)',
            'Read(**/.npmrc)',
            'Edit(**/.dev.vars)',
            'Edit(**/.env)',
            'Write(**/.dev.vars)',
            'Write(**/.env)',
          ],
        },
      },
      null,
      2,
    ) + '\n';

  files['.mcp.json'] = JSON.stringify(mcpConfig(), null, 2) + '\n';

  files['src/actions/index.ts'] =
    `/*\n` +
    ` * Form handlers.\n` +
    ` *\n` +
    ` * \`src/actions/index.ts\` is a FIXED path - Astro looks nowhere else - so this file has to live\n` +
    ` * in the client repo. What it contains is a re-export, and that is the whole point: the pipeline\n` +
    ` * itself is package-owned, so a fix to validation, Turnstile handling, the D1 write or an email\n` +
    ` * template reaches this site on npm update rather than never.\n` +
    ` *\n` +
    ` * The order inside it is load-bearing: validate, verify Turnstile, write to D1, notify, then\n` +
    ` * autorespond. Storing before sending means a Mailgun failure leaves an enquiry with\n` +
    ` * notified_at NULL rather than losing it.\n` +
    ` *\n` +
    ` * Forms are defined in src/forms/*.json, one per form, and the filename is the form id. There\n` +
    ` * is no registry to keep in step - adding src/forms/quote.json is the whole job.\n` +
    ` *\n` +
    ` * TO CUSTOMIZE: wrap rather than fork. Import the package's server, spread it, and add your own\n` +
    ` * action beside it. Copying the pipeline in here is how a site stops receiving fixes.\n` +
    ` */\n` +
    `export { server } from '@cparkerwebm/webmonterey/actions';\n`;

  files['src/components/registry.ts'] =
    `import type { AstroComponentFactory } from 'astro/runtime/server/index.js';\n\n` +
    `/*\n` +
    ` * THE BLOCK REGISTRY - client-owned, because every visible component is. The package ships\n` +
    ` * none.\n` +
    ` *\n` +
    ` * Maps a block \`type\` in page JSON to the component that renders it. Adding a component means\n` +
    ` * THREE things: the folder, an entry here, and its schema joining the union in\n` +
    ` * src/content.config.ts.\n` +
    ` *\n` +
    ` * FORGETTING THIS FILE IS THE MOST COMMON BUG. Nothing errors - the build succeeds and the\n` +
    ` * block renders as nothing. Miss the union instead and valid JSON fails to build.\n` +
    ` */\n` +
    `export const blocks: Record<string, AstroComponentFactory> = {};\n\n` +
    `export const registeredTypes = (): string[] => Object.keys(blocks);\n`;

  files['src/content.config.ts'] =
    `import { webmontereyCollections } from '@cparkerwebm/webmonterey/content';\n\n` +
    `/*\n` +
    ` * The block union is what makes a typo in page JSON a BUILD ERROR rather than a blank space.\n` +
    ` * Add each component's schema as you build it:\n` +
    ` *\n` +
    ` *   import { schema as content000001 } from './components/content/content-000001/schema.ts';\n` +
    ` *   export const collections = webmontereyCollections([content000001]);\n` +
    ` *\n` +
    ` * A union needs at least one member, so this stays commented until the first component exists.\n` +
    ` */\n` +
    `export const collections = webmontereyCollections([]);\n`;

  files['src/styles/custom/_index.css'] =
    `/*\n` +
    ` * The client override seam.\n` +
    ` *\n` +
    ` * webm.components.custom beats webm.components.core at identical specificity, so a rule here\n` +
    ` * lands without !important and stays legible as an override. webm.overrides is the last word.\n` +
    ` *\n` +
    ` * To retheme, change the TOKEN in design.json rather than the rule - one declaration cascades\n` +
    ` * everywhere. Reach for this file when the token system genuinely does not express something.\n` +
    ` *\n` +
    ` * NOTHING IMPORTS THIS FILE FROM THIS REPO. The package's base layout pulls it in through a\n` +
    ` * virtual module, so it ships automatically and there is no entry point here to keep in step.\n` +
    ` */\n\n` +
    `@layer webm.components.custom {\n}\n\n` +
    `@layer webm.overrides {\n}\n`;

  files['src/content/pages/home.json'] =
    JSON.stringify(
      {
        title: client === 'CHANGEME' ? 'Home' : client,
        showTitle: true,
        description: '',
        blocks: [],
      },
      null,
      2,
    ) + '\n';

  /*
   * The manifest, filled in rather than left on CHANGEME. Generation 2 shipped placeholders here
   * and they reached production on more than one site - a manifest is not a page, so nobody looks
   * at it, and "CHANGEME" only ever surfaces in an install prompt on someone's phone.
   */
  files['public/site.webmanifest'] =
    JSON.stringify(
      {
        name: client === 'CHANGEME' ? domain : client,
        short_name: client === 'CHANGEME' ? domain : client,
        icons: [
          { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
          {
            src: '/android-chrome-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
        theme_color: '#006abe',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
      },
      null,
      2,
    ) + '\n';

  files['.gitignore'] =
    `node_modules/\ndist/\n.astro/\n.wrangler/\nworker-configuration.d.ts\n.DS_Store\n\n` +
    `# Secrets. Never committed, never uploaded - wrangler secret put is the only path.\n` +
    `.dev.vars\n.dev.vars.*\n.env\n.env.*\n\n` +
    `# Refused by preinstall; here as belt and braces.\npnpm-lock.yaml\nyarn.lock\nbun.lock*\n`;

  files['.dev.vars.example'] =
    `# Copy to .dev.vars for local development. NEVER commit .dev.vars.\n` +
    `# Anything here must also exist as a real Worker secret - \`wrangler secret put\`.\n` +
    `# Record each one in the password manager as you create it: wrangler cannot read a secret back.\n\n` +
    `# TURNSTILE_SECRET_KEY=\n` +
    `# MAILGUN_API_KEY=\n` +
    `# MAILGUN_DOMAIN=\n`;

  files['.nvmrc'] = '24\n';

  files['README.md'] =
    `# ${client === 'CHANGEME' ? n.repo : client}\n\n` +
    `${domain} — built on [@cparkerwebm/webmonterey](https://github.com/cparkerwebm/webmonterey).\n\n` +
    `## Commands\n\n` +
    `| Command | Runs |\n| --- | --- |\n` +
    `| \`npm run dev\` | local dev server |\n` +
    `| \`npm run preview\` | **a real build on real workerd** — use this, not dev, for anything touching styles, routes or wrangler.jsonc |\n` +
    `| \`npm run check\` | types and content schema |\n` +
    `| \`npx webm doctor\` | the things that fail silently |\n\n` +
    `## Cloudflare\n\n` +
    `| | |\n| --- | --- |\n` +
    `| Worker | \`${n.worker}\` |\n| D1 | \`${n.d1}\` |\n| R2 media | \`${n.r2Media}\` |\n\n` +
    `The repo is named for the domain; Cloudflare resources use the slug, with no TLD, so a\n` +
    `preview hostname never embeds a domain Chrome could mistake for a lookalike.\n\n` +
    `## Deploying\n\n` +
    `Push to deploy. A \`wrangler deploy\` from a laptop creates a version no build produced, so\n` +
    `history stops describing what is live and the next push reverts it.\n`;

  return files;
}
