/*
 * Typed access to the client's webmonterey.json.
 *
 * THIN BY DESIGN. Everything here is a binding of a pure helper in config.ts to the real config,
 * which arrives through the `virtual:webm/site` module the integration provides. The logic is
 * tested without a build; this file is what wires it up.
 *
 * The question everything asks of this file is whether a field has actually been filled in yet.
 * `client` and `domain` ship as the literal CHANGEME, and five surfaces depend on knowing that -
 * each wanting a DIFFERENT answer to "what should I do about it":
 *
 *   Credit.astro     throw, because a credit link with a placeholder in utm_content is worse
 *                    than no build
 *   robots.txt       omit the Sitemap: line, because pointing crawlers at a sitemap that does
 *                    not exist is worse than omitting it
 *   structured data  emit nothing at all, because @id values need a real origin
 *   email            fall back to the domain, because failing a live enquiry over a cosmetic
 *                    subject-line prefix trades a real loss for a trivial one
 *
 * So this module answers the question and deliberately does NOT decide the consequence.
 */
import site from 'virtual:webm/site';
import {
  DEFAULT_LOCALE,
  DEFAULT_TIME_ZONE,
  isStagingDeployment,
  zonedHour,
  isConfigured,
  PLACEHOLDER,
  resolveDisplayName,
  type Organization,
  type SiteConfig,
  type SiteFeatures,
} from './config.ts';

export { PLACEHOLDER, isConfigured, isStagingDeployment };
export type { SiteConfig, SiteFeatures, Organization };

export const config: SiteConfig = site;

export const client = site.client;
export const domain = site.domain;
export const features: SiteFeatures = site.features ?? {};
export const organization: Organization = site.organization ?? {};

/** The short name for titles, falling back to the display name. See SiteConfig.shortName. */
export const shortName = isConfigured(site.shortName) ? site.shortName! : displayName();

/** Whether to append the site name to a page title. See SiteConfig.brandTitles. */
export const brandTitles = site.brandTitles !== false;

/**
 * The Google Tag Manager container id, or '' when the site has not set one.
 *
 * `isConfigured` rather than a plain read, so the literal CHANGEME never reaches a script tag:
 * GTM would request a container by that name, 404, and leave a broken third-party request on
 * every page of the site.
 */
export const gtmId = isConfigured(site.gtmId) ? site.gtmId! : '';

/**
 * What this deployment is FOR. See SiteConfig.environment.
 *
 * Unset means production — see the field's own note for why that default is the safe one.
 */
export const environment = site.environment ?? 'production';

/** True when this deployment must not touch a client's real contacts. */
export const isStaging = environment === 'staging';
export const isProduction = !isStaging;

/**
 * Where staging email goes instead of its real recipients, or '' when the site has not said.
 * There is no default - see SiteConfig.stagingEmail. sendEmail refuses on '' rather than guessing.
 */
export const stagingEmail = isConfigured(site.stagingEmail) ? site.stagingEmail! : '';

export const hasClient = isConfigured(client);
export const hasDomain = isConfigured(domain);

/*
 * THE PHONE NUMBER, from organization.telephone.
 *
 * Stored in E.164 - a leading + and country code, no punctuation - because that is what Google
 * expects in structured data. That is also exactly what a `tel:` href wants, so the same value
 * serves the JSON-LD and the call link on a mobile menu, and there is one place to change it.
 *
 * The human-readable form is a display decision and belongs in the component that shows it.
 *
 * Added because webmonterey.com had already patched this into its own copy of this file. That
 * is the copy-forward failure the package exists to end: a fix made in one site's src/includes/
 * reaches no other site, ever, and nothing reports that it is missing.
 */
export const telephone = organization.telephone ?? '';
export const hasTelephone = isConfigured(telephone);

/** Never returns 'CHANGEME'. See resolveDisplayName. */
export function displayName(): string {
  return resolveDisplayName(client, domain);
}

/**
 * IANA zone for every client-facing date. Everything stored is UTC, so nothing reaches a person
 * without passing through this - a prerendered page especially, which bakes in build-time values
 * and must be handed the zone explicitly rather than trusting the build machine's clock.
 */
export const timeZone = site.timeZone ?? DEFAULT_TIME_ZONE;
export const locale = site.locale ?? DEFAULT_LOCALE;

/**
 * The hour, 0-23, in THIS site's zone. See zonedHour in config.ts for why a scheduled job needs
 * it and why it cannot use a fixed UTC hour.
 *
 *     export default defineWorker({
 *       scheduled: (c, env, ctx) => {
 *         if (hourNow(new Date(c.scheduledTime)) !== 21) return;   // 9pm local, all year
 *         ctx.waitUntil(sendSummaries(env));
 *       },
 *     });
 */
export function hourNow(at: Date = new Date()): number {
  return zonedHour(at, timeZone);
}

/**
 * Format a date in the client's zone and locale.
 *
 * Never call toLocaleString without a zone on a prerendered route: the build machine's clock is
 * the developer's and the Worker's is UTC, so a date rendered at build is wrong in one of them.
 */
export function formatDate(
  value: Date | string | number,
  options: Intl.DateTimeFormatOptions = {},
): string {
  return new Intl.DateTimeFormat(locale, { timeZone, ...options }).format(new Date(value));
}
