/*
 * The shape of webmonterey.json, and the virtual module that carries it.
 *
 * A PACKAGE CANNOT REACH THE CLIENT'S FILE. In generation 2 four separate files each did
 * `import site from '../../../webmonterey.json'`, which worked because everything lived in one
 * repo. Here the config sits in the client repo and the code sits in node_modules, so the
 * integration resolves `virtual:webm/site` to the real file at build time and every consumer
 * goes through site.ts.
 *
 * Consolidating on one seam is an improvement rather than a workaround: there is now exactly one
 * place that reads the config, so a field rename is one edit and `webm doctor` has one thing to
 * validate.
 */

export interface SiteFeatures {
  /**
   * Cookie consent, GPC honoring and Consent Mode v2. Defaults ON. Set false and every
   * consent-gated feature runs unconditionally - `whenConsented` fires immediately.
   */
  compliance?: boolean;
  d1?: boolean;
  turnstile?: boolean;
  /**
   * RESERVED, and inert today. Will route transactional mail through the platform rather than a
   * site-held Mailgun key once the relay exists. Declared now so switching it on later is a
   * config edit rather than a codemod.
   */
  platform?: boolean;
}

/**
 * Feeds the JSON-LD graph. EVERY field is omitted from output when empty - never guess one to
 * fill it in, because wrong opening hours in structured data is materially worse than none:
 * search engines surface it as fact.
 *
 * There is deliberately no ratings field. Google forbids a business publishing aggregateRating
 * about itself, and doing it anyway risks a manual action.
 */
export interface Organization {
  /**
   * One or two sentences describing the business, emitted on the organization node.
   *
   * Distinct from a page's meta description: this one describes the ORGANISATION and is the same
   * on every page. Omitted when unset rather than falling back to the homepage's description,
   * which would describe a page and claim it was the business.
   */
  description?: string;
  /**
   * The organisation's LOGO, as a path under public/. Not the share image.
   *
   * This is the mark a knowledge panel draws, and Google wants at least 112x112. Omitted from the
   * structured data entirely when unset - a wrong logo is worse than no logo, so it never falls
   * back to the Open Graph card.
   */
  logo?: string;
  /** Leave as Organization unless the client has a real address the public can visit. */
  type?: string;
  legalName?: string;
  telephone?: string;
  email?: string;
  streetAddress?: string;
  addressLocality?: string;
  addressRegion?: string;
  postalCode?: string;
  addressCountry?: string;
  /** Social and profile URLs. */
  sameAs?: string[];
  /*
   * EVERYTHING BELOW WAS ALREADY READ BY StructuredData.astro AND NOT DECLARED HERE.
   *
   * `tsc --noEmit` does not parse .astro, so the package's own layouts and includes are outside
   * `npm run check` - which is why an interface could drift this far from the code reading it
   * without a word. A client authoring webmonterey.json got no completion and no error for any
   * of these, which is a good way to discover a field does nothing only after publishing.
   */
  /** The person behind the business. Emitted as a Person node, linked from the organization. */
  founder?: {
    name?: string;
    jobTitle?: string;
    /** A sentence or two. Distinct from the organization's own description. */
    description?: string;
    /** A path under public/, resolved against the site origin. */
    image?: string;
    sameAs?: string[];
  };
  /** Places served, for a business whose catchment is wider than its address. */
  areaServed?: string[];
  /** Google's coarse price band - "$", "$$", "$$$". Not a number. */
  priceRange?: string;
  /** Named services, emitted as an OfferCatalog. */
  services?: string[];
  /** Opening hours. `days` are schema.org day names. */
  hours?: { days?: string[]; opens?: string; closes?: string };
}

export interface SiteConfig {
  /**
   * Overrides for any word this package puts in front of a visitor — the consent banner, the 404,
   * form errors, email boilerplate, the back-to-top label.
   *
   * Partial and merged over the defaults at any depth, so a site states only what it disagrees
   * with. See includes/webmonterey/copy-defaults.ts for the full shape and the reasoning: the
   * package owns the mechanism, the client owns what is said, and a site working in another
   * language or another voice should not have to fork a component to say so.
   */
  copy?: Record<string, unknown>;

  client: string;
  domain: string;
  repo?: string;
  worker?: string;
  launched?: string | null;

  /**
   * What this deployment is FOR. Defaults to 'production' when unset.
   *
   * The default is load-bearing: every site that predates this field has no value for it, so any
   * other default would silently redirect a live client's email the moment they ran
   * `npm update`. A site opts INTO staging; it never falls into production by accident.
   *
   * Distinct from `launched`, which records whether the site has ever gone live. The two
   * disagree routinely — a launched site still has staging previews — so neither substitutes
   * for the other.
   *
   * Read it anywhere via `environment`, `isStaging` and `isProduction` from webmonterey/site.
   * The first consumer is transactional email, which redirects every recipient to `stagingEmail`
   * on a staging deployment rather than mailing the client's real contacts from a preview.
   *
   * THE SECOND CONSUMER IS INDEXABILITY. A staging site is a PREVIEW BUILD on every hostname and
   * in every build - laptop, `main` on Workers Builds, anywhere: every page is noindex with no
   * canonical, there is no sitemap, robots.txt disallows everything, and Google Tag Manager does
   * not load. Until this switch existed a site that had not launched was crawlable on its
   * workers.dev URL the moment `main` deployed, because only a non-production BRANCH was a
   * preview. See `isPreviewBuild`. Flipping this to production is therefore what makes a site
   * indexable, which is why /webm:launch does it only once the custom domain is live.
   */
  environment?: 'production' | 'staging';

  /**
   * Where a staging deployment's email goes instead of its real recipients.
   *
   * NO DEFAULT, on purpose. The package is public, and an inbox baked into it means a stranger's
   * staging site mails the author. `webm new` fills this from `git config user.email`;
   * `webm doctor` fails a staging site that has it empty; sendEmail refuses rather than guesses.
   */
  stagingEmail?: string;

  /**
   * IANA zone name. D1 stores UTC via datetime('now'), so nothing reaches a person without
   * passing through this. `America/Los_Angeles` - there is no `Pacific/LA`, and an invalid name
   * makes Intl.DateTimeFormat throw rather than merely show the wrong hour.
   */
  /**
   * A SHORT name for `<title>`, when the display name is too long for one.
   *
   * "About | Friends of the Marina Library" is 44 characters before the page name; Google
   * truncates a title around 60. The suffix is meant to say whose site this is, and a suffix
   * that eats the title defeats itself.
   *
   * Falls back to the display name, so a client whose name is already short sets nothing.
   * Generation 2 hardcoded this per site as BRAND_SHORT in its own copy of site.ts.
   */
  shortName?: string;
  /**
   * Append the site name to every page `<title>`. Default true.
   *
   * Set FALSE for a site whose pages author their OWN full titles. stevenglaze.com writes
   * "Tone Freq Studios | Recording Studio in San Jose, CA" in the page's own JSON; appending the
   * client name to that produces a title too long for any search result to show, with the useful
   * half truncated away.
   *
   * The per-title guard only catches a title that already contains the short name verbatim, and
   * a site with several brands on one domain will not trip it - so this has to be a decision.
   */
  brandTitles?: boolean;
  /**
   * Google Tag Manager container, `GTM-XXXXXXX`.
   *
   * TRACKED HERE RATHER THAN IN `.env`, and that is the whole point of the field. The id is
   * PUBLIC by design - it appears in the source of every page - so there is nothing to protect,
   * while `.env` is gitignored and therefore absent on Workers Builds. A container id set only
   * in the environment works perfectly on a laptop and silently loads nothing in production,
   * which is a failure with no error and no visible symptom: the pages render, the tags never
   * fire, and the client discovers it in an empty analytics report weeks later.
   *
   * `PUBLIC_GTM_ID` in the environment still WINS, for pointing a branch at a different
   * container. Leave both unset and no GTM renders at all.
   */
  gtmId?: string;
  timeZone?: string;
  /** Date order, number separators, currency. The formatting half of `brand.voice`. */
  locale?: string;

  organization?: Organization;
  features?: SiteFeatures;

  /**
   * THE WEB APP NAMESPACE, reserved on every site whether or not it ever grows one.
   *
   * A URL namespace is the one thing that is expensive to retrofit: once a site has real pages,
   * carving out `/portal` later means checking every existing URL for a collision. Reserving it
   * costs one field and an empty folder, so every site has it from day one.
   *
   * The DIRECTORY is fixed: src/pages/webapp/, on every site, always. `path` is the PUBLIC url
   * segment. It defaults to the folder name so the common case needs no rewrite; a client whose
   * customers log in sets `portal`, `members` or `account`, and the integration rewrites
   * `/<path>/*` onto the folder. Everything else - the noindex flag, the sitemap exclusion, the
   * run_worker_first entries, the doctor checks - derives from this one field.
   *
   * Every page under the folder must be `prerender = false`: the app needs bindings, and a
   * rewrite can only reach a route the Worker renders. `webm doctor` checks.
   *
   * What is NOT reserved: auth, sessions, user tables. Those get built for the first client who
   * needs them, in that client's repo, and promoted here only when a second one does.
   */
  app?: { enabled?: boolean; path?: string; label?: string };
}

/** The app folder under src/pages/. Fixed on every site; only the public path varies. */
export const APP_DIR = 'webapp';
export const DEFAULT_TIME_ZONE = 'America/Los_Angeles';

/**
 * The hour, 0-23, at an instant, in a given IANA zone.
 *
 * THIS EXISTS BECAUSE CRON RUNS IN UTC AND NOTHING IN CLOUDFLARE CAN CHANGE THAT. A job that has
 * to land at a local hour cannot be pinned to a UTC hour: Pacific is UTC-8 in winter and UTC-7 in
 * summer, so any fixed schedule is an hour wrong for half the year. The pattern that works is to
 * fire the cron HOURLY and let the handler ask what time it is where the client is; the other 23
 * runs cost one comparison and return.
 *
 * Generalized from the version friendsofthemarinalibrary.org has used for its evening summary
 * sweep since generation 2.
 *
 * `hourCycle: 'h23'` is load-bearing. The obvious `hour12: false` renders midnight as 24 in
 * several implementations, so a job scheduled for hour 0 never fires and one testing `hour < 1`
 * fires twice. It is the kind of thing that is wrong for a year before anyone notices.
 *
 * Lives here rather than in site.ts because this file is pure - site.ts imports a virtual module
 * that only exists inside a build, so nothing in it can be unit tested.
 */
export function zonedHour(at: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(at);

  return Number(parts.find((part) => part.type === 'hour')?.value ?? NaN);
}
export const DEFAULT_LOCALE = 'en-US';

/* --------------------------------------------------------------------------
 * Pure helpers.
 *
 * These take config as an argument rather than reading the virtual module, so they are testable
 * with `node --test` and no build. site.ts is the thin layer that binds them to the real file.
 * -------------------------------------------------------------------------- */

/** The literal value every unconfigured field ships with. */
export const PLACEHOLDER = 'CHANGEME';

/** True once a field holds a real value rather than the placeholder or nothing. */
export function isConfigured(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0 && value !== PLACEHOLDER;
}

/**
 * The client's display name, falling back to the domain and then to a generic label.
 *
 * NEVER returns 'CHANGEME'. That string reaches a visitor and a client's inbox, so a placeholder
 * leaking through is worse than a generic label.
 */
export function resolveDisplayName(client: string | undefined, domain: string | undefined): string {
  if (isConfigured(client)) return client;
  if (isConfigured(domain)) return domain;
  return 'This website';
}

/**
 * Whether a string is a zone Intl actually knows.
 *
 * `Pacific/LA` does not exist - the Pacific/* zones are Pacific Ocean locations - and an invalid
 * name makes Intl.DateTimeFormat throw at runtime rather than merely show the wrong hour. Checked
 * at build by `webm doctor` so it fails on a laptop, not in a Worker.
 */
export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Whether the site has switched its web app on. Off is the scaffold's state. */
export function appEnabled(config: Pick<SiteConfig, 'app'>): boolean {
  return config.app?.enabled === true;
}

/**
 * The public url segment for the app, normalized without slashes. Falls back to the folder name
 * so an empty or all-slash value cannot produce a route of `/`.
 */
export function resolveAppPath(config: Pick<SiteConfig, 'app'>): string {
  const raw = (config.app?.path ?? APP_DIR).replace(/^\/+|\/+$/g, '');
  return raw || APP_DIR;
}

/**
 * Every path that must appear in wrangler.jsonc's `assets.run_worker_first`.
 *
 * BOTH SLASH FORMS, always. The asset router treats `/portal/` and `/portal` as different paths,
 * and a missing entry produces a route that returns 200 to curl and a 404 page to Chrome -
 * because the interception keys off `Sec-Fetch-Dest: document`, which browsers send and curl does
 * not. The PUBLIC path, not the folder: the router sees the URL, the rewrite happens after.
 */
export function workerFirstPaths(config: Pick<SiteConfig, 'app'>): string[] {
  const paths = ['/_actions/*'];
  if (appEnabled(config)) {
    const app = resolveAppPath(config);
    paths.push(`/${app}/*`, `/${app}`, `/${app}/`);
  }
  return paths;
}

/**
 * Is this deployment allowed to mail real people?
 *
 * TWO INDEPENDENT SIGNALS, because each covers the other's blind spot.
 *
 * `environment` is build-time config, so it is the only one of the two a SCHEDULED handler can
 * read — a cron has no request and therefore no hostname. Without it the nightly sweep would
 * mail a client's real contacts from a preview Worker, which is exactly the case that has no
 * symptom until an organizer asks why they were emailed twice.
 *
 * The hostname covers the opposite mistake: webmonterey.json is committed, so a branch preview
 * of a LAUNCHED site inherits `production` from main and would send for real. Anything served
 * from workers.dev is a preview by definition, whatever the config claims.
 *
 * Deliberately NOT "redirect unless the hostname matches the canonical domain". `domain` is
 * stored bare, so the day a site answers on www. every enquiry from that hostname would be
 * redirected away from the client — a silent outage of real mail caused by a hostname variant.
 * Testing for workers.dev instead fails in the safe direction: an unrecognised hostname sends.
 */
export function isStagingDeployment(
  environment: SiteConfig['environment'],
  hostname?: string | null,
): boolean {
  if (environment === 'staging') return true;

  /* Match the label, not a substring: a client domain ending "notworkers.dev" is not a preview. */
  return Boolean(hostname && /(^|\.)workers\.dev$/i.test(hostname));
}

/** Which signal made a build a preview, or null for production output. */
export type PreviewReason = 'staging' | 'branch' | null;

/**
 * Why this build is a preview - noindex on every page, no canonical, no sitemap, robots.txt
 * disallowing everything, no analytics - or null when it is production output.
 *
 * TWO INDEPENDENT SIGNALS, for the same reason `isStagingDeployment` has two.
 *
 * `environment` is what the deployment is FOR. A site that has not launched says `staging`, and
 * a site that has not launched must not be indexable ANYWHERE: not on a feature branch, not on
 * `main`, not from a laptop. Before this signal existed only a non-production branch was a
 * preview, so `main` on Workers Builds was production output for every site that had not gone
 * live yet - indexable pages with a canonical, a sitemap and `Allow: /` on a public workers.dev
 * hostname. autire.webmonterey.workers.dev was crawlable that way.
 *
 * The branch covers the opposite case: webmonterey.json is committed, so a feature branch of a
 * LAUNCHED site inherits `production` from main and would build indexable pages under a review
 * URL. Workers Builds injects WORKERS_CI_BRANCH; anything other than the production branch is a
 * preview whatever the config says.
 *
 * An unset environment is production, as it is everywhere else - see SiteConfig.environment for
 * why that default is the safe one - so a site predating the field builds exactly as before.
 * `branch` is null when nothing injected one, which is every laptop build.
 */
export function previewReason(input: {
  environment: SiteConfig['environment'] | undefined;
  branch: string | null | undefined;
  productionBranch?: string;
}): PreviewReason {
  if (input.environment === 'staging') return 'staging';
  const branch = input.branch ?? null;
  if (branch !== null && branch !== (input.productionBranch ?? 'main')) return 'branch';
  return null;
}

/** Whether this build is a preview. `previewReason` says which signal decided it. */
export function isPreviewBuild(input: Parameters<typeof previewReason>[0]): boolean {
  return previewReason(input) !== null;
}
