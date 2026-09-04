/*
 * The WebMonterey Astro integration.
 *
 * A client's astro.config.mjs is this, and nothing else:
 *
 *     import { defineConfig } from 'astro/config';
 *     import webmonterey, { adapter } from '@cparkerwebm/webmonterey';
 *     export default defineConfig({ adapter: adapter(), integrations: [webmonterey()] });
 *
 * The adapter is named there and not set from in here - see integration/adapter.ts for why it
 * cannot be, and what the build does when it is missing.
 *
 * Generation 2's astro.config.mjs was ninety lines, most of them comments explaining traps that
 * a reader had to keep true by hand: derive `site` from webmonterey.json, keep NOINDEX_ROUTES in
 * step with every `<Base noindex>`, remember imageService: 'compile'. Each of those is now a
 * decision made once, here, and a fix propagates on `npm update` rather than never.
 *
 * >> WRITTEN AGAINST THE ASTRO INTEGRATION API FROM RECALL, NOT FROM THE DOCS MCP, which was not
 * >> available in the session that wrote it. Verify hook names, `updateConfig` merge semantics
 * >> and `injectRoute` options against docs.astro.build before this ships. Astro moves fast and
 * >> much of the training corpus is two majors out of date - that is rule 9, and it applies to
 * >> the package as much as to a client site.
 */
import type { AstroIntegration } from 'astro';
import sitemap from '@astrojs/sitemap';

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileToCss } from '../design/compile.ts';
import { imageSize } from './image-size.ts';
import { loadForms, loadSiteFiles, resolveSiteUrl } from './config.ts';
import {
  APP_DIR,
  appEnabled,
  previewReason,
  resolveAppPath,
} from '../includes/webmonterey/config.ts';

export interface WebmontereyOptions {
  /**
   * Routes kept out of the sitemap. Each must ALSO pass `noindex` to the base layout - this list
   * only controls the sitemap.
   *
   * Deliberately NOT added to robots.txt. Disallowing a path there stops crawlers fetching it,
   * so they never see the noindex tag, and an inbound link can get the URL indexed anyway with
   * no description. To exclude a page you must let it be crawled.
   */
  noindexRoutes?: string[];
  /** Skip the block router, for a site that defines all its own routes. Rare. */
  router?: boolean;
  /**
   * Serve `/robots.txt`. Default true.
   *
   * Set false for a site that needs its own — a staging host disallowing everything, or a client
   * with real crawl rules. Until 1.5 this route was injected unconditionally and a static
   * `public/robots.txt` lost to it with nothing said.
   */
  robots?: boolean;
  /**
   * Serve `/webm`, the component scratch page, in `astro dev`. Default true.
   *
   * DEV ONLY. It is a workbench for building a block in isolation, and a workbench has no
   * business on a client's production domain - it used to be injected into every build, noindex
   * but live, with a comment asking people to remember to empty it. Now it simply does not exist
   * outside the dev server.
   */
  diagnosticsPage?: boolean;
  /**
   * Add `@astrojs/sitemap`. Default true whenever `domain` is set.
   *
   * Set false for a site publishing a sitemap another way, rather than having two disagree.
   */
  sitemap?: boolean;
  /**
   * Serve `/webmaster` and its share image. Default true.
   *
   * The page every site has: who built it, who to call. The footer credit links to it. A client
   * who will not have it sets this false and the credit then has nowhere to point - so the
   * footer should drop the credit too, and the agreement should say so.
   */
  webmaster?: boolean;
  /**
   * The branch Workers Builds deploys to production. Default `main`.
   *
   * Every other branch is a PREVIEW - and so is every build, on any branch and from any machine,
   * of a site whose webmonterey.json says `environment: "staging"`. A preview build is different
   * on purpose: every page is noindex with no canonical, there is no sitemap, robots.txt
   * disallows everything, and Google Tag Manager does not load - so a client's review link can
   * never be indexed, a site that has not launched cannot be indexed before it exists, and
   * clicking around either never lands in their analytics. The branch comes from
   * WORKERS_CI_BRANCH, which Workers Builds injects; the decision is `isPreviewBuild` in
   * includes/webmonterey/config.ts.
   */
  productionBranch?: string;
}

const VIRTUAL = {
  build: 'virtual:webm/build',
  site: 'virtual:webm/site',
  design: 'virtual:webm/design',
  tokens: 'virtual:webm/tokens.css',
  registry: 'virtual:webm/registry',
  forms: 'virtual:webm/forms',
  custom: 'virtual:webm/custom',
  shareImage: 'virtual:webm/share-image',
  icons: 'virtual:webm/icons',
  webmasterOg: 'virtual:webm/webmaster-og',
} as const;

/*
 * THE WEBMASTER PAGE'S SHARE IMAGE, read here and not in the endpoint that serves it. The
 * Cloudflare adapter builds server modules for the workerd target, where `import.meta.url` is
 * not a file URL, so a `new URL('../assets/...', import.meta.url)` inside a route throws
 * "Invalid URL string" at prerender. This integration runs in Node at config time, where the
 * path is real; the bytes travel to the endpoint as base64 through a virtual module.
 */
const WEBMASTER_OG = fileURLToPath(new URL('../assets/opengraph-webmaster.png', import.meta.url));

/** Vite resolves virtual ids to a `\0`-prefixed form so other plugins leave them alone. */
const resolved = (id: string) => `\0${id}`;

export default function webmonterey(options: WebmontereyOptions = {}): AstroIntegration {
  return {
    name: '@cparkerwebm/webmonterey',

    hooks: {
      'astro:config:setup': ({
        command,
        config,
        updateConfig,
        injectRoute,
        addMiddleware,
        addWatchFile,
        logger,
      }) => {
        const root = config.root.pathname;
        const files = loadSiteFiles(root);
        const site = resolveSiteUrl(files.site);
        const app = appEnabled(files.site);
        const appPath = resolveAppPath(files.site);

        /*
         * PREVIEW OR PRODUCTION, decided in one place - previewReason - from two signals. A site
         * whose webmonterey.json says `environment: "staging"` is a preview in every build,
         * whatever the branch and whatever the machine; and on a launched site any Workers
         * Builds branch other than the production one is a preview too. A local build of a
         * production site has no branch and is production output, which is what
         * `npm run preview` and the e2e need. See the option, and the function.
         */
        const branch = process.env.WORKERS_CI_BRANCH ?? null;
        const productionBranch = options.productionBranch ?? 'main';
        const reason = previewReason({
          environment: files.site.environment,
          branch,
          productionBranch,
        });
        const preview = reason !== null;
        if (reason === 'staging') {
          logger.info(
            'environment is "staging" in webmonterey.json: a preview build - noindex, no sitemap, no analytics',
          );
        } else if (reason === 'branch') {
          logger.info(
            `branch "${branch}" is not ${productionBranch}: a preview build - noindex, no sitemap, no analytics`,
          );
        }

        /*
         * Editing either config file must rebuild. Without this a palette change in design.json
         * shows nothing until the dev server is restarted, which reads as the compiler being
         * broken.
         */
        addWatchFile(files.paths.site);
        if (files.paths.design) addWatchFile(files.paths.design);

        /*
         * The adapter cannot be set from here - see integration/adapter.ts. Catch its absence with
         * a message that says what to do, instead of letting the build fail later with
         * "Cannot resolve entry module virtual:astro:legacy-ssr-entry", which names nothing the
         * reader wrote.
         */
        if (!config.adapter) {
          throw new Error(
            '[webm] No adapter. astro.config.mjs must set one:\n\n' +
              "    import webmonterey, { adapter } from '@cparkerwebm/webmonterey';\n\n" +
              '    export default defineConfig({\n' +
              '      adapter: adapter(),\n' +
              '      integrations: [webmonterey()],\n' +
              '    });\n\n' +
              'It cannot be set by the integration: an adapter registered through updateConfig does ' +
              'not run its own hooks, and the build then fails on the first on-demand route.',
          );
        }

        if (!site) {
          logger.warn(
            'webmonterey.json "domain" is still CHANGEME. Canonical tags, Open Graph URLs and ' +
              'the sitemap are suppressed until it is set - deliberately, since a canonical tag ' +
              'pointing at localhost is worse than none.',
          );
        }

        /* The app is authenticated, so it is never in the sitemap. Its PUBLIC path, not the folder. */
        const noindex = [
          '/webm',
          ...(app ? [`/${appPath}`] : []),
          ...(options.noindexRoutes ?? []),
        ];

        updateConfig({
          site,

          /*
           * Static by default: marketing pages prerender to plain HTML on the edge. A route
           * needing a binding opts out per file with `export const prerender = false` - and
           * every such route must also appear in wrangler.jsonc's run_worker_first, or it
           * returns 200 to curl and a 404 page to Chrome. `webm doctor` checks that.
           */
          output: 'static',

          integrations:
            site && !preview && options.sitemap !== false
              ? [
                  sitemap({
                    filter: (page) => {
                      const path = new URL(page).pathname.replace(/\/$/, '') || '/';
                      return !noindex.some((n) => path === n || path.startsWith(`${n}/`));
                    },
                  }),
                ]
              : [],

          vite: {
            /*
             * A site that adds a custom Worker entrypoint - the supported way to get a
             * scheduled() handler alongside the adapter's fetch - imports
             * @astrojs/cloudflare/handler. Vite pre-bundles that into node_modules/.vite/deps_ssr,
             * and any re-optimisation (which `astro check`, or a build running alongside
             * `astro dev`, triggers) changes its ?v= hash. The running dev server then 500s on
             * EVERY request with "The file does not exist at .../handler-*.js".
             *
             * Excluding it is the fix the error message itself suggests. It is an adapter
             * entrypoint that needs no bundling, so this costs nothing on a site that never adds
             * one - and it means a site that does cannot walk into a dev server that has stopped
             * serving anything at all.
             *
             * Found in friendsofthemarinalibrary.org, which has run a scheduled sweep this way
             * since generation 2 and had to work it out by hand.
             */
            optimizeDeps: {
              exclude: ['@astrojs/cloudflare/handler'],
            },
            ssr: {
              /*
               * PROCESS THIS PACKAGE'S SOURCE LIKE THE APP'S OWN.
               *
               * Vite externalizes node_modules by default, which is right for a compiled
               * dependency and wrong for this one: the package ships .ts source that imports
               * Astro and Cloudflare virtual modules - `cloudflare:workers` above all. Left
               * external, rolldown sees a bare specifier it cannot resolve and the build dies
               * with "Failed to resolve import cloudflare:workers", naming a file inside
               * node_modules that the reader did not write.
               *
               * This only bites once a site wires the form pipeline, because that is the first
               * thing to pull in includes/cloudflare/workers/env.ts. A site with no forms builds
               * cleanly without it - which is exactly how it went unnoticed.
               */
              noExternal: ['@cparkerwebm/webmonterey'],
            },
            plugins: [
              {
                name: 'webm:virtual',
                resolveId(id: string) {
                  if (Object.values(VIRTUAL).includes(id as never)) return resolved(id);
                  return null;
                },
                load(id: string) {
                  switch (id) {
                    case resolved(VIRTUAL.build):
                      return `export default ${JSON.stringify({ preview, reason, branch })};`;
                    case resolved(VIRTUAL.site):
                      return `export default ${JSON.stringify(files.site)};`;
                    case resolved(VIRTUAL.design):
                      return `export default ${JSON.stringify(files.design)};`;
                    case resolved(VIRTUAL.tokens):
                      return compileToCss(files.design);
                    case resolved(VIRTUAL.shareImage): {
                      /*
                       * The share image's REAL size, read from its header at build time.
                       *
                       * og:image:width and og:image:height have to match the file, and nothing
                       * else in the toolchain can check: public/ is copied verbatim, so a client
                       * dropping in a differently sized card publishes false dimensions and no
                       * build or test says a word. webmonterey.com shipped a 1280x672 image
                       * declaring 1200x630 for its whole life, with a comment warning about
                       * exactly that sitting in the same file.
                       *
                       * null when the file is absent or unreadable, and base.astro then omits
                       * both tags - the scrapers all measure the image themselves anyway, so
                       * saying nothing beats saying something wrong.
                       */
                      const size = imageSize(join(root, 'public/opengraph.png'));
                      return `export default ${JSON.stringify(size)};`;
                    }
                    case resolved(VIRTUAL.icons): {
                      /*
                       * WHICH ICON FILES THE SITE ACTUALLY HAS.
                       *
                       * The layout used to link favicon.svg unconditionally. A site without one
                       * then served the SEEDED PLACEHOLDER - WebMonterey's own mark - as the
                       * client's icon, and because browsers prefer SVG over .ico it was the one
                       * actually shown. Caught on a rebuild where the client had .ico and PNGs
                       * and no SVG at all.
                       *
                       * public/ is copied verbatim, so nothing else can see this.
                       */
                      const icons = Object.fromEntries(
                        [
                          'favicon.svg',
                          'favicon.ico',
                          'favicon-16x16.png',
                          'favicon-32x32.png',
                          'apple-touch-icon.png',
                          'site.webmanifest',
                        ].map((file) => [file, existsSync(join(root, 'public', file))]),
                      );
                      return `export default ${JSON.stringify(icons)};`;
                    }
                    case resolved(VIRTUAL.custom): {
                      /*
                       * THE CLIENT OVERRIDE SEAM, and it was disconnected until it was tested.
                       *
                       * base.astro imports the package's global.css by relative path, so the
                       * site's own src/styles/index.css - which the scaffold wrote as the entry
                       * point that pulls in custom/ - was imported by nothing at all. A client
                       * could write a rule in custom/_index.css, see it in the repo, and never
                       * see it on the page. No error, no warning: the file simply was not in the
                       * graph. That is webm.components.custom, the layer whose entire job is
                       * beating webm.components.core.
                       *
                       * A JS module that imports the real path, rather than the file's contents
                       * inlined: a virtual module has no directory, so relative @import inside
                       * the client's own CSS would not resolve if this returned text.
                       */
                      const custom = join(root, 'src/styles/custom/_index.css');
                      return existsSync(custom) ? `import ${JSON.stringify(custom)};` : '';
                    }
                    case resolved(VIRTUAL.forms):
                      return `export const FORMS = ${JSON.stringify(loadForms(root))};`;
                    case resolved(VIRTUAL.webmasterOg):
                      /* Bytes and the REAL size, so the page never declares dimensions the file does not have. */
                      return `export default ${JSON.stringify({
                        base64: readFileSync(WEBMASTER_OG, 'base64'),
                        ...(imageSize(WEBMASTER_OG) ?? { width: null, height: null }),
                      })};`;
                    case resolved(VIRTUAL.registry):
                      /*
                       * Re-exported from the client repo, because every visible component lives
                       * there - the package ships none. A site with no registry gets an empty
                       * one rather than a resolution failure, so `webm new` can scaffold in any
                       * order.
                       */
                      return [
                        `let mod = { blocks: {}, registeredTypes: () => [] };`,
                        `try { mod = await import(${JSON.stringify(root + 'src/components/registry.ts')}); } catch {}`,
                        `export const blocks = mod.blocks ?? {};`,
                        `export const registeredTypes = mod.registeredTypes ?? (() => Object.keys(blocks));`,
                        /*
                         * SITE CHROME. The package's layout has header and footer slots and
                         * ships nothing to fill them, and the router that renders every page is
                         * package-owned - so without this a site literally cannot get a header
                         * onto its own pages short of overriding the router and duplicating it.
                         *
                         * Deliberately NOT entries in `blocks`: a registered type is addressable
                         * from a page's JSON, and a page that lists its header as a block stacks
                         * a second one under the real one. Chrome is rendered once by the layout,
                         * so it is exported separately and named separately.
                         */
                        `export const header = mod.header ?? null;`,
                        `export const footer = mod.footer ?? null;`,
                        /* Overlays - a mobile menu, a CTA drawer - rendered at the end of body. */
                        `export const panels = mod.panels ?? [];`,
                        /*
                         * The page header. A site that declares one gets it in place of the
                         * router's plain <h1>; a site that does not keeps the <h1>.
                         */
                        `export const pageHeader = mod.pageHeader ?? null;`,
                        /*
                         * THE /webmaster PAGE'S BODY. The route, the copy, the share image and
                         * the agency graph stay the package's; a site whose document pages use
                         * a richer layout than an <h1> and a stack of paragraphs hands over the
                         * layout only. Without this a site's own src/pages/webmaster.astro
                         * collides with the injected route, and on one site the injected route
                         * won.
                         */
                        `export const webmasterPage = mod.webmasterPage ?? null;`,
                        /*
                         * THE SITE'S JSON-LD, rendered into <head> on every route. The package
                         * emits none of its own: what a business claims about itself is the
                         * site's to say, and every attempt to say it generically grew a field a
                         * day and still fit nobody. The builders in ./structured-data are the
                         * mechanism; this component is the content. /webm:launch is where it
                         * gets written.
                         */
                        `export const structuredData = mod.structuredData ?? null;`,
                      ].join('\n');
                    default:
                      return null;
                  }
                },
              },
            ],
          },
        });

        /*
         * EVERY INJECTED ROUTE HAS AN OFF SWITCH.
         *
         * Two of these had none. A site wanting its own /robots.txt - a staging host disallowing
         * everything, a client with crawl rules - had no way to say so, and a static
         * public/robots.txt lost to the injected route silently.
         *
         * The default is unchanged in each case; the point is only that "no" is now sayable.
         */
        if (options.router !== false) {
          injectRoute({ pattern: '/[...slug]', entrypoint: '@cparkerwebm/webmonterey/pages/slug' });
        }
        if (options.robots !== false) {
          injectRoute({
            pattern: '/robots.txt',
            entrypoint: '@cparkerwebm/webmonterey/pages/robots',
          });
        }
        /* The scratch page exists in the dev server and nowhere else - see the option's note. */
        if (options.diagnosticsPage !== false && command === 'dev') {
          injectRoute({ pattern: '/webm', entrypoint: '@cparkerwebm/webmonterey/pages/webm' });
        }

        /*
         * THE WEBMASTER PAGE, and its share image served from the package. Indexable and in the
         * sitemap - the footer credit links here rather than off the site. See pages/webmaster.
         */
        if (options.webmaster !== false) {
          injectRoute({
            pattern: '/webmaster',
            entrypoint: '@cparkerwebm/webmonterey/pages/webmaster',
          });
          injectRoute({
            pattern: '/webmaster/og.png',
            entrypoint: '@cparkerwebm/webmonterey/pages/webmaster-og',
          });
        }

        /*
         * THE WEB APP'S PUBLIC PATH. Only when the site has switched the app on AND named a path
         * other than the folder - with the default there is nothing to rewrite, and a middleware
         * that runs on every request of every site to do nothing is not free. See app-middleware.
         */
        if (app && appPath !== APP_DIR) {
          addMiddleware({ entrypoint: '@cparkerwebm/webmonterey/app-middleware', order: 'pre' });
        }

        /*
         * THE 404. Exported by the package since day one and injected by nobody, so every site
         * built on it served Cloudflare's default "page not found" instead of the client's.
         *
         * Astro turns the `/404` route into 404.html, which the Workers asset router serves for
         * any unmatched path. A site that wants its own overrides this the ordinary Astro way, by
         * having src/pages/404.astro - a file in the site beats an injected route, which is the
         * child-theme rule holding without anything special here.
         */
        injectRoute({ pattern: '/404', entrypoint: '@cparkerwebm/webmonterey/pages/404.astro' });
      },
    },
  };
}

export { adapter, type AdapterOptions } from './adapter.ts';
export type { SiteConfig, SiteFeatures, Organization } from '../includes/webmonterey/config.ts';
export type { DesignSystem } from '../design/types.ts';
