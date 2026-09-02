/*
 * STAGING EMAIL REDIRECTION — the recipient rewrite, as a pure function.
 *
 * Kept in its own file, importing nothing, for the same reason config.ts is separate from
 * site.ts: everything here is unit tested without a build, while send.ts reaches the network and
 * reads `virtual:webm/site`, which only exists inside one.
 *
 * WHAT THIS SOLVES. A preview deployment sends real email to real people. The contact form on
 * this fleet notifies the client's own inbox and the registration flow mails whoever organises a
 * programme, so testing a preview means a client receives test enquiries and an organizer is
 * told somebody signed up who did not. Nothing about that is visible to whoever is testing.
 *
 * WHY REWRITE RATHER THAN SUPPRESS. Mailgun's test mode accepts a message and never delivers it,
 * which verifies the API call and nothing else — not the rendering, not the deliverability, not
 * the attachment. The whole point of sending from staging is to see the real thing arrive, so
 * the message is sent for real and only its recipients are changed.
 */

/** Every field that can put a message in front of a person. */
export interface Recipients {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
}

export interface RedirectedRecipients {
  to: string[];
  /*
   * Absent, never redirected. A cc or bcc that survived would be a second real person receiving
   * a test — and bcc especially, because nothing in the delivered message would show it happened.
   */
  cc: undefined;
  bcc: undefined;
  replyTo: string;
  /**
   * Diagnostic headers naming who the message was really for, so a redirected copy is still
   * evidence of what production would have done.
   */
  headers: Record<string, string>;
  /** The addresses this message was addressed to, in order, for the subject annotation. */
  original: string[];
}

const list = (value: string | string[] | undefined): string[] =>
  value === undefined ? [] : (Array.isArray(value) ? value : [value]).filter(Boolean);

/**
 * Point every recipient at one address, preserving what was there.
 *
 * `replyTo` is rewritten as well as `to`. Leaving it alone is tempting — it does not cause
 * delivery — but this fleet deliberately INVERTS reply-to on registration mail so a registrant
 * reaching for reply gets the organizer. In a shared dev inbox that turns one careless reply
 * into a real message to a real organizer, which is the failure this whole module exists to
 * prevent. The original is kept in a header instead, where it can still be checked.
 */
export function redirectRecipients(
  recipients: Recipients,
  stagingEmail: string,
): RedirectedRecipients {
  const to = list(recipients.to);
  const cc = list(recipients.cc);
  const bcc = list(recipients.bcc);
  const original = [...to, ...cc, ...bcc];

  const headers: Record<string, string> = { 'X-Webm-Environment': 'staging' };
  if (to.length) headers['X-Webm-Original-To'] = to.join(', ');
  if (cc.length) headers['X-Webm-Original-Cc'] = cc.join(', ');
  if (bcc.length) headers['X-Webm-Original-Bcc'] = bcc.join(', ');
  if (recipients.replyTo) headers['X-Webm-Original-Reply-To'] = recipients.replyTo;

  return {
    to: [stagingEmail],
    cc: undefined,
    bcc: undefined,
    replyTo: stagingEmail,
    headers,
    original,
  };
}

/**
 * Mark the subject so a redirected message is never mistaken for a real one at a glance.
 *
 * The real recipients go in the subject rather than only in a header because a shared dev inbox
 * collects mail from every client site in the fleet, and "who was this actually for" is the
 * question being asked of it. Capped so a long cc list cannot push the real subject out of view.
 */
export function redirectedSubject(subject: string, original: string[]): string {
  if (!original.length) return `[staging] ${subject}`;

  const shown = original.slice(0, 3).join(', ');
  const more = original.length > 3 ? ` +${original.length - 3}` : '';

  return `[staging → ${shown}${more}] ${subject}`;
}
