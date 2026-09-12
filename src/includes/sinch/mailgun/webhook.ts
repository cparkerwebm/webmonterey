/*
 * Mailgun's event webhooks - the pure half. The route is pages/mailgun-webhook.ts.
 *
 * WHY THE SITE LISTENS. The subscriber list lives in the site's own D1, and Mailgun only sends;
 * so when a person unsubscribes through the header Mailgun adds, complains, or bounces
 * permanently, Mailgun knows and the site does not - until this. The email spec calls that list
 * hygiene and makes it a requirement: suppress complainers, remove permanent failures.
 *
 * SIGNED, and verified before anything is read. Every Mailgun webhook carries
 * `signature: { timestamp, token, signature }` where signature is the hex HMAC-SHA256 of
 * `timestamp + token` under the account's webhook signing key. An unsigned or mis-signed POST is
 * anyone on the internet, and is answered 401 without a look at the body.
 *
 * Web Crypto rather than node:crypto, because this runs in a Worker; Node 24 has the same API,
 * which is how it is tested.
 */

export interface WebhookSignature {
  timestamp: string;
  token: string;
  signature: string;
}

const encoder = new TextEncoder();

/* Web Crypto wants a BufferSource; TextEncoder's typed array is typed over ArrayBufferLike. */
const bytes = (value: string): ArrayBuffer => encoder.encode(value).buffer as ArrayBuffer;

export async function verifyWebhookSignature(
  sig: Partial<WebhookSignature> | undefined,
  signingKey: string,
): Promise<boolean> {
  if (!sig || !sig.timestamp || !sig.token || !sig.signature) return false;
  if (!/^[0-9a-f]{64}$/i.test(sig.signature)) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    bytes(signingKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, bytes(sig.timestamp + sig.token)),
  );
  const expected = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqualHex(expected, sig.signature.toLowerCase());
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** What the site does about an event: stop mailing the address, and why. */
export type SuppressionReason = 'provider' | 'complaint' | 'bounce';

export interface ListEvent {
  recipient: string;
  reason: SuppressionReason;
}

/**
 * The events that change a subscriber's status, from Mailgun's `event-data`. Everything else -
 * delivered, opened, clicked, a temporary failure - is null: nothing to do.
 */
export function classifyEvent(eventData: unknown): ListEvent | null {
  if (!eventData || typeof eventData !== 'object') return null;
  const data = eventData as {
    event?: unknown;
    recipient?: unknown;
    severity?: unknown;
  };
  if (typeof data.recipient !== 'string' || !data.recipient) return null;
  const recipient = data.recipient.trim().toLowerCase();

  switch (data.event) {
    case 'unsubscribed':
      return { recipient, reason: 'provider' };
    case 'complained':
      return { recipient, reason: 'complaint' };
    case 'failed':
      /* A temporary failure retries on Mailgun's side; only a permanent one is a suppression. */
      return data.severity === 'permanent' ? { recipient, reason: 'bounce' } : null;
    default:
      return null;
  }
}
