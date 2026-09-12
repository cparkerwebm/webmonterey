/*
 * What the site writes to Workers Analytics Engine - the pure half. track.ts is the Worker half.
 *
 * ONE COLUMN CONTRACT, fleet-wide, written down here because two parties depend on it: the
 * package writes it and the platform queries it, and the SQL API has no schema to disagree with.
 * Analytics Engine columns are positional - blob1..blob20, double1..double20, one index - so a
 * change here is a change to every query the platform runs.
 *
 *  | 'form.autoresponse_failed'
  | 'marketing.signup'
  | 'marketing.confirmed'
  | 'marketing.unsubscribed'
  | 'campaign.batch_sent'; index1   event       the sampling key: one event kind samples independently of another
 *   blob1    event       repeated as a blob, because index1 is not selectable in every query
 *   blob2    host        the request hostname - a preview and production are told apart here
 *   blob3    path        the pathname only; never a query string, which can carry a token
 *   blob4    form        the form id, for form events; empty otherwise
 *   blob5    detail      an outcome or a referrer HOST - never a full referrer, never an address
 *   double1  duration    milliseconds, for events that have one; 0 otherwise
 *
 * Counts are SUM(_sample_interval), never COUNT(): Analytics Engine samples under load and the
 * column says by how much.
 *
 * WHAT IS NOT WRITTEN, on purpose: no visitor identifier, no cookie, no IP, no user agent, no full
 * referrer. The page-view beacon is cookieless and aggregate, which is what lets it run without
 * consent; a field that would identify a person is a field this module has no slot for.
 *
 * Reads stay out of this package. The SQL API needs an account-level token, which belongs to
 * the platform; the package writes, the platform queries.
 */

/** Every event the package writes. A site may write its own kind through the same helper. */
export type AnalyticsEvent =
  | 'page.view'
  | 'form.submitted'
  | 'form.honeypot'
  | 'form.turnstile_failed'
  | 'form.stored'
  | 'form.queued'
  | 'form.notify_sent'
  | 'form.notify_failed'
  | 'form.autoresponse_failed';

export interface EventInput {
  event: AnalyticsEvent | (string & {});
  host: string;
  path?: string;
  form?: string;
  detail?: string;
  /** Milliseconds. */
  duration?: number;
}

/** The shape `writeDataPoint` takes. */
export interface DataPoint {
  indexes: [string];
  blobs: [string, string, string, string, string];
  doubles: [number];
}

/** The binding every site's Worker writes through. */
export const ANALYTICS_BINDING = 'ANALYTICS';

/** Analytics Engine's per-index ceiling; a longer key is rejected, so it is cut here. */
const MAX_INDEX_BYTES = 96;

/** A blob is capped well under the 16 KB limit: nothing here is legitimately long. */
const MAX_BLOB_CHARS = 512;

const clip = (value: string | undefined, max = MAX_BLOB_CHARS): string =>
  (value ?? '').slice(0, max);

export function dataPoint(input: EventInput): DataPoint {
  const event = clip(input.event, MAX_INDEX_BYTES);
  return {
    indexes: [event],
    blobs: [
      event,
      clip(input.host),
      clip(pathOnly(input.path)),
      clip(input.form),
      clip(input.detail),
    ],
    doubles: [Number.isFinite(input.duration) ? Math.max(0, input.duration!) : 0],
  };
}

/** The pathname of a path or URL, and nothing after it. */
export function pathOnly(value: string | undefined): string {
  if (!value) return '';
  const cut = value.search(/[?#]/);
  const path = cut === -1 ? value : value.slice(0, cut);
  return path.startsWith('/') ? path : `/${path}`;
}

/** The host of a referrer, or empty. The full referrer can carry a path a person typed. */
export function referrerHost(referrer: string | undefined): string {
  if (!referrer) return '';
  try {
    return new URL(referrer).hostname;
  } catch {
    return '';
  }
}

/**
 * What the beacon endpoint accepts from the page, and how strictly. The body is visitor-supplied,
 * so nothing in it is trusted past a short string - and only these two keys are read.
 */
export function parseBeacon(raw: string, requestHost: string): EventInput | null {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!body || typeof body !== 'object') return null;
  const { p, r } = body as { p?: unknown; r?: unknown };
  if (typeof p !== 'string' || p.length === 0 || p.length > MAX_BLOB_CHARS) return null;
  const referrer = typeof r === 'string' ? referrerHost(r) : '';
  return {
    event: 'page.view',
    host: requestHost,
    path: pathOnly(p),
    /* A same-site referrer is navigation, not a source; only another host is worth a column. */
    detail: referrer && referrer !== requestHost ? referrer : '',
  };
}
