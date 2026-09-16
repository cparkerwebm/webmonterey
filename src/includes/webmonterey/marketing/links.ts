/*
 * The marketing routes and the links into them - pure.
 *
 * Three routes the integration injects when `features.marketing` is on. The two pages are on
 * demand (they write to D1), and the webhook is a POST from Mailgun; all three must be in
 * run_worker_first, in the forms the asset router needs - `webm doctor` checks.
 */
import { isStagingDeployment, type SiteConfig } from '../config.ts';

export const CONFIRM_PATH = '/subscribe/confirm';
export const UNSUBSCRIBE_PATH = '/unsubscribe';
export const WEBHOOK_PATH = '/_webm/mailgun';

/** The run_worker_first entries the three routes need. `/_webm/*` also covers the beacon. */
export const MARKETING_WORKER_FIRST = [
  '/subscribe/*',
  '/subscribe',
  '/subscribe/',
  '/unsubscribe',
  '/unsubscribe/',
  '/_webm/*',
] as const;

/**
 * The origin a link in mail is built on.
 *
 * Production: https://<domain>/. A STAGING DEPLOYMENT - environment "staging", or any
 * workers.dev host - builds on the hostname the message carries instead. Before launch the
 * client's domain is still the old site, so a confirmation link there is a 404 on the wrong
 * website; and a branch preview of a launched site is answering on workers.dev, where the link
 * has to come back to. The rule is the one mail already applies to its recipients and secrets,
 * so a preview never reaches production in any direction. A cron passes no hostname and falls
 * back to the domain: a scheduled send on a staging deployment is the one case that has nowhere
 * better to point, and the _TEST Mailgun pair means it reaches a sandbox anyway. Always https.
 */
export function mailOrigin(
  domain: string,
  environment: SiteConfig['environment'],
  hostname: string | null | undefined,
): string {
  const host = hostname && isStagingDeployment(environment, hostname) ? hostname : domain;
  return `https://${host}/`;
}

/** `site` is the origin from mailOrigin, e.g. https://example.com/ - links in mail are absolute. */
export function confirmUrl(site: string, token: string): string {
  return `${new URL(CONFIRM_PATH, site).href}?t=${encodeURIComponent(token)}`;
}

export function unsubscribeUrl(site: string, token: string): string {
  return `${new URL(UNSUBSCRIBE_PATH, site).href}?t=${encodeURIComponent(token)}`;
}

/**
 * The placeholder a campaign body carries where each recipient's unsubscribe link goes. Mailgun
 * substitutes it per recipient from recipient-variables, so one body serves a batch of 1,000.
 */
export const UNSUBSCRIBE_VARIABLE = '%recipient.unsubscribe%';

/** Lower-cased and trimmed: one row per address, whatever the visitor typed. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
