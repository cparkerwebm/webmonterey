/*
 * The page-view beacon. POST /_webm/beacon, from the one-line script base.astro writes on a
 * production page: `navigator.sendBeacon('/_webm/beacon', JSON.stringify({ p, r }))`.
 *
 * WHY A BEACON. Every page on these sites is prerendered, so the asset router serves it and the
 * Worker never sees a page view. This is the only way a page view reaches Analytics Engine, and
 * it is a cookieless, aggregate count: a path and a referrer HOST, no identifier of any kind -
 * see datapoint.ts for what is refused. That is what lets it run without consent.
 *
 * ON DEMAND, so it must be in run_worker_first - the scaffold lists `/_webm/*`, and the
 * analytics-binding doctor check insists on it. Answers 204 to anything well-formed and 204 to
 * anything not, because a beacon has no reader and an error would only be a log line.
 */
import type { APIRoute } from 'astro';
import { parseBeacon, track } from '../includes/cloudflare/analytics/track.ts';

export const prerender = false;

const NO_CONTENT = () => new Response(null, { status: 204 });

export const POST: APIRoute = async ({ request, url }) => {
  const raw = await request.text().catch(() => '');
  const input = parseBeacon(raw, url.hostname);
  if (input) track(input);
  return NO_CONTENT();
};

/* A GET is a bot or a curious person; there is nothing to show. */
export const GET: APIRoute = () => new Response(null, { status: 405 });
