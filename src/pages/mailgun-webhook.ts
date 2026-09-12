/*
 * POST /_webm/mailgun - Mailgun's event webhook, for the list.
 *
 * Configured once per site in Mailgun for the MARKETING domain: the unsubscribed, complained
 * and permanent-failed events, to https://<domain>/_webm/mailgun. Verified before it is read
 * (webhook.ts), then applied to the subscriber row. 200 for anything verified, whether or not it
 * changed a row - Mailgun retries on anything else, and an event about an address that never
 * subscribed is not an error. 401 for anything not verified, with no look at the body.
 */
import type { APIRoute } from 'astro';
import { getBinding } from '../includes/cloudflare/workers/env.ts';
import { classifyEvent, verifyWebhookSignature } from '../includes/sinch/mailgun/webhook.ts';
import { applyListEvent } from '../includes/webmonterey/marketing/index.ts';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  let payload: { signature?: unknown; 'event-data'?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return new Response(null, { status: 400 });
  }

  const key = getBinding<string>('MAILGUN_WEBHOOK_SIGNING_KEY');
  const verified = await verifyWebhookSignature(
    payload.signature as Parameters<typeof verifyWebhookSignature>[0],
    key,
  );
  if (!verified) return new Response(null, { status: 401 });

  const event = classifyEvent(payload['event-data']);
  if (event) await applyListEvent(event);
  return new Response(null, { status: 200 });
};

export const GET: APIRoute = () => new Response(null, { status: 405 });
