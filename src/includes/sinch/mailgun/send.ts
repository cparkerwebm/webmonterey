/*
 * Mailgun (a Sinch product) — transactional email.
 *
 * Used for form notifications and autoresponders. There is no SDK: Mailgun's API is a
 * form-encoded POST, and adding a Node-oriented SDK to a Worker is more trouble than the
 * twenty lines below.
 *
 * Secrets: MAILGUN_API_KEY and MAILGUN_DOMAIN. Local values in .dev.vars; production via
 * `npx wrangler secret put MAILGUN_API_KEY`.
 *
 * The route that calls this needs `export const prerender = false`.
 *
 * Sending domain convention is `webm.<client-domain>` — keeps client deliverability separate
 * from their own mail, so a bounce problem on one never poisons the other. The mailbox is
 * `website@`, giving `website@webm.<client-domain>` for every template the site sends.
 */

import { environment, stagingEmail } from '../../webmonterey/site.ts';
import { isStagingDeployment } from '../../webmonterey/config.ts';
import { redirectRecipients, redirectedSubject } from './redirect.ts';

export interface SendEmailOptions {
  apiKey: string;
  /** The Mailgun sending domain, e.g. `webm.example.com`. */
  domain: string;
  /** `Name <address@webm.example.com>` — must be on the sending domain. */
  from: string;
  to: string | string[];
  subject: string;
  /** Provide `text`, `html`, or both. Both is best for deliverability. */
  text?: string;
  html?: string;
  /** Set this to the visitor's address so a reply reaches them, not the Worker. */
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  /** Mailgun tags, for filtering in their dashboard. */
  tags?: string[];
  /** EU-hosted accounts must pass 'eu'; sending to the wrong region fails auth. */
  region?: 'us' | 'eu';
  /*
   * Files to attach.
   *
   * Added because friendsofthemarinalibrary.org attaches an .ics to its registration
   * confirmation, and had put this field on a private copy of this file to do it. The rebuild
   * pointed that site's action back here and the calendar invite silently stopped being sent -
   * silently because an attachment is passed inside a conditional spread, where TypeScript's
   * excess-property check does not apply, so nothing failed and nothing was said.
   *
   * That is the shape of a missing seam: a site needing one field kept a whole file to get it,
   * and the copy is what a rebuild threw away. One optional field here costs nothing and ends it.
   *
   * `content` is a string rather than a Blob so callers stay easy to test - every generator in
   * the fleet returns text - and the Blob is built at the last moment below.
   */
  attachments?: Array<{ filename: string; content: string; contentType: string }>;
  /**
   * The hostname this send is happening on, when there is a request to take one from.
   *
   * Only ever used to REDIRECT recipients away from real people on a preview — see
   * isStagingDeployment. Omit it and the decision falls to `environment` alone, which is
   * correct for a scheduled handler: a cron has no request, and a production cron must still
   * send for real.
   */
  hostname?: string | null;
}

export interface SendEmailResult {
  id: string;
  message: string;
}

const ENDPOINTS = {
  us: 'https://api.mailgun.net/v3',
  eu: 'https://api.eu.mailgun.net/v3',
} as const;

/**
 * Send one email. Throws on any non-2xx, with Mailgun's own message included — a silent
 * failure here means a client never learns someone tried to contact them.
 */
export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  const {
    apiKey,
    domain,
    from,
    to,
    subject,
    text,
    html,
    replyTo,
    cc,
    bcc,
    tags,
    region,
    attachments,
    hostname,
  } = options;

  if (!text && !html) {
    throw new Error('[webm] sendEmail needs at least one of `text` or `html`.');
  }

  const body = new FormData();
  body.set('from', from);

  /*
   * STAGING NEVER MAILS A REAL PERSON.
   *
   * Applied here, at the one place every template in the fleet passes through, rather than at
   * each call site: the form pipeline, this site's registration action and the nightly sweep
   * all reach Mailgun through this function, and a guard that has to be remembered per call is
   * one that will be missed. See redirect.ts for what is rewritten and why.
   */
  const staging = isStagingDeployment(environment, hostname);

  if (staging) {
    /*
     * REFUSE RATHER THAN GUESS. There is no default inbox in the package, so a staging site that
     * has not named one has nowhere safe to send - and the alternative, sending to the real
     * recipients, is the exact thing staging exists to prevent. `webm doctor` catches this
     * before a form ever gets submitted.
     */
    if (!stagingEmail) {
      throw new Error(
        '[webm] This is a staging deployment and webmonterey.json has no "stagingEmail". ' +
          'Refusing to send: without one the only alternative is the real recipients. Set ' +
          'stagingEmail to the inbox that should receive test mail.',
      );
    }
    const redirected = redirectRecipients({ to, cc, bcc, replyTo }, stagingEmail);

    body.set('subject', redirectedSubject(subject, redirected.original));
    for (const address of redirected.to) body.append('to', address);
    for (const [name, value] of Object.entries(redirected.headers)) body.set(`h:${name}`, value);
    body.set('h:Reply-To', redirected.replyTo);

    /* Filterable in Mailgun, so a shared dev inbox never muddles the client's own traffic. */
    body.append('o:tag', 'staging');
  } else {
    body.set('subject', subject);

    for (const address of Array.isArray(to) ? to : [to]) body.append('to', address);
    if (cc) for (const address of Array.isArray(cc) ? cc : [cc]) body.append('cc', address);
    if (bcc) for (const address of Array.isArray(bcc) ? bcc : [bcc]) body.append('bcc', address);
    if (replyTo) body.set('h:Reply-To', replyTo);
  }

  if (text) body.set('text', text);
  if (html) body.set('html', html);
  if (tags) for (const tag of tags) body.append('o:tag', tag);

  for (const file of attachments ?? []) {
    body.append('attachment', new Blob([file.content], { type: file.contentType }), file.filename);
  }

  const endpoint = `${ENDPOINTS[region ?? 'us']}/${domain}/messages`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      // Mailgun uses HTTP basic auth with the literal username "api".
      Authorization: `Basic ${btoa(`api:${apiKey}`)}`,
    },
    body,
  });

  if (!response.ok) {
    /*
     * Neither the domain nor the key is interpolated here. MAILGUN_API_KEY and
     * MAILGUN_DOMAIN sit on adjacent lines in .dev.vars.example, and a swap would otherwise
     * put the API key into this message — which `observability` then persists into Cloudflare
     * Workers Logs, and which reaches the browser if a caller echoes `e.message`.
     * Mailgun's own body is capped for the same reason: it is unbounded remote input.
     */
    const detail = (await response.text()).slice(0, 200);
    throw new Error(
      `[webm] Mailgun refused the message (${response.status}): ${detail}\n` +
        `  - 401: wrong API key, or an EU account being sent to the US endpoint\n` +
        `  - 404: the sending domain does not exist on this account (check MAILGUN_DOMAIN)\n` +
        `  - 400: the "from" address is not on the sending domain`,
    );
  }

  return (await response.json()) as SendEmailResult;
}
