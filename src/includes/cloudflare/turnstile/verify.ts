/*
 * Cloudflare Turnstile — server-side verification.
 *
 * There is NO official Astro or Workers integration. `@cloudflare/pages-plugin-turnstile` is
 * a Pages Functions plugin and does not work here. Verification is this one POST.
 *
 * TWO KEYS, do not mix them up:
 *   SITE key   — public. Goes in `vars` in wrangler.jsonc, rendered into the widget markup.
 *   SECRET key — never leaves the server. `npx wrangler secret put TURNSTILE_SECRET_KEY`.
 *
 * The route that calls this needs `export const prerender = false`.
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** The field Turnstile injects into the form. */
export const TURNSTILE_FIELD = 'cf-turnstile-response';

/** Give up rather than hold a Worker request open on a hung connection. */
const TIMEOUT_MS = 10_000;

export interface TurnstileResult {
  success: boolean;
  /** Failure reasons — Cloudflare's codes, plus `hostname-mismatch` / `action-mismatch`. */
  errorCodes: string[];
  challengeTs?: string;
  /** The hostname the challenge was actually solved on. */
  hostname?: string;
  /** The action the widget was configured with, if any. */
  action?: string;
}

export interface VerifyOptions {
  /** The widget's SECRET key. */
  secretKey: string;
  /** The token from the `cf-turnstile-response` form field. */
  token: string;
  /**
   * The hostname this submission must have been solved on — pass `Astro.url.hostname`.
   *
   * REQUIRED, and not ceremony. A Turnstile token is bound to the sitekey/secret pair, NOT
   * to a site or a form. If one widget is ever reused across client sites (or one widget
   * lists several hostnames), an attacker solves the challenge once on site A and replays
   * the token at site B's form — siteverify returns success, and without this check nobody
   * notices. Verifying the hostname is what binds the token to this site.
   */
  expectedHostname: string;
  /**
   * The `data-action` on the widget, if set. When provided, a token minted by a different
   * form on the same site is rejected — otherwise a newsletter widget's token replays
   * against the contact form.
   */
  expectedAction?: string;
  /** Visitor IP. Pass `request.headers.get('CF-Connecting-IP')`. */
  remoteIp?: string | null;
  /**
   * Idempotency key for safely retrying ONE submission attempt.
   *
   * Must be freshly generated per attempt (`crypto.randomUUID()`). Never a constant, never
   * derived from user input: Cloudflare returns the CACHED result for a repeated key, which
   * defeats the single-use guarantee (`timeout-or-duplicate`) that stops token replay. A
   * hardcoded value turns one solved challenge into unlimited accepted submissions.
   */
  idempotencyKey?: string;
}

/**
 * Verify a Turnstile token.
 *
 * Returns `success: false` rather than throwing on a failed challenge — a bot submission is
 * an expected outcome, not an exception. It DOES throw if Cloudflare is unreachable, times
 * out, or answers with a non-2xx, because that is a real fault and should not be silently
 * counted as spam.
 *
 * A caught error MUST reject the submission, never admit it. Failing open here hands an
 * attacker a bypass: make the siteverify call fail and every submission sails through.
 *
 *     export const prerender = false;
 *
 *     const form = await request.formData();
 *     let result;
 *     try {
 *       result = await verifyTurnstile({
 *         secretKey: getBinding<string>('TURNSTILE_SECRET_KEY'),
 *         token: String(form.get(TURNSTILE_FIELD) ?? ''),
 *         expectedHostname: Astro.url.hostname,
 *         remoteIp: request.headers.get('CF-Connecting-IP'),
 *       });
 *     } catch {
 *       return new Response('Verification unavailable', { status: 503 }); // reject, not admit
 *     }
 *     if (!result.success) return new Response('Failed verification', { status: 400 });
 */
export async function verifyTurnstile(options: VerifyOptions): Promise<TurnstileResult> {
  const { secretKey, token, expectedHostname, expectedAction, remoteIp, idempotencyKey } = options;

  // An empty token means the widget never solved — no point spending a round trip.
  if (!token) {
    return { success: false, errorCodes: ['missing-input-response'] };
  }

  const response = await fetch(SITEVERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: secretKey,
      response: token,
      ...(remoteIp ? { remoteip: remoteIp } : {}),
      ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `[webm] Turnstile siteverify returned ${response.status}. This is an outage or a ` +
        `malformed request, not a failed challenge - reject the submission, do not admit it.`,
    );
  }

  const data = (await response.json()) as {
    success: boolean;
    'error-codes'?: string[];
    challenge_ts?: string;
    hostname?: string;
    action?: string;
  };

  const result: TurnstileResult = {
    success: data.success === true,
    errorCodes: data['error-codes'] ?? [],
    challengeTs: data.challenge_ts,
    hostname: data.hostname,
    action: data.action,
  };

  if (!result.success) return result;

  // Cloudflare said the challenge was solved. Now confirm it was solved HERE, for THIS form.
  if (result.hostname !== expectedHostname) {
    return {
      ...result,
      success: false,
      errorCodes: [...result.errorCodes, 'hostname-mismatch'],
    };
  }

  if (expectedAction !== undefined && result.action !== expectedAction) {
    return {
      ...result,
      success: false,
      errorCodes: [...result.errorCodes, 'action-mismatch'],
    };
  }

  return result;
}
