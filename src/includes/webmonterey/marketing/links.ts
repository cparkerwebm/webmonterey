/*
 * The marketing routes and the links into them - pure.
 *
 * Three routes the integration injects when `features.marketing` is on. The two pages are on
 * demand (they write to D1), and the webhook is a POST from Mailgun; all three must be in
 * run_worker_first, in the forms the asset router needs - `webm doctor` checks.
 */
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

/** `site` is the production origin, e.g. https://example.com/ - links in mail are absolute. */
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
