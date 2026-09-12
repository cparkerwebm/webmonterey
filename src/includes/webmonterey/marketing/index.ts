/*
 * Marketing mail: the site's own list in its second D1 database, Mailgun only to send.
 *
 * WHY THE LIST IS HERE AND NOT AT MAILGUN. The client owns their subscribers the way they own
 * their submissions - in their repo's database, readable by their portal, kept if they leave.
 * A segment is a WHERE clause over columns the site chose. And the site then needs nothing from
 * Mailgun but sending, so the marketing key can be a domain sending key that can do nothing
 * else. What the site takes on in exchange is here: the confirmation, the two link pages, and
 * the webhook that keeps the list in step with what Mailgun learns.
 *
 * TWO DOMAINS. The confirmation goes from the transactional domain, webm.<domain>, through the
 * transactional key - it is the one message a person must get, and a new marketing domain has
 * no reputation to carry it. Campaigns go from mktg.<domain> through MAILGUN_MKTG_API_KEY and
 * MAILGUN_MKTG_DOMAIN, read through the mode helpers so a staging deployment uses the _TEST
 * pair (a Mailgun sandbox). A complaint on marketing then never touches the contact form.
 *
 * Runs in the Worker: everything here reads bindings and the site's config.
 */
import { getBinding, getBindingForMode } from '../../cloudflare/workers/env.ts';
import { sendEmail } from '../../sinch/mailgun/send.ts';
import { track } from '../../cloudflare/analytics/track.ts';
import { renderHtml, renderText } from '../../../emails/subscription-confirm.ts';
import { escapeHtml } from '../../../emails/footer.ts';
import { copy } from '../copy.ts';
import { fill } from '../copy-defaults.ts';
import { personalize } from '../webmaster/webmaster.ts';
import { client, displayName, domain, features } from '../site.ts';
import { fitsQueue, QUEUE_BINDING } from '../../cloudflare/queues/message.ts';
import type { CampaignBatchMessage, SubscribeMessage } from '../../cloudflare/queues/message.ts';
import {
  audiencePage,
  batchSent,
  campaignById,
  completeCampaign,
  confirmByToken,
  recordBatch,
  recordCampaign,
  signUp,
  suppress,
  unsubscribeByToken,
  type LinkOutcome,
} from './subscribers.ts';
import { confirmUrl, UNSUBSCRIBE_VARIABLE, unsubscribeUrl } from './links.ts';
import type { ListEvent } from '../../sinch/mailgun/webhook.ts';

export { isToken } from './tokens.ts';
export { CONFIRM_PATH, MARKETING_WORKER_FIRST, UNSUBSCRIBE_PATH, WEBHOOK_PATH } from './links.ts';
export type { LinkOutcome } from './subscribers.ts';

/** The second database. `DB` is submissions; this is the list. */
export const MKTG_BINDING = 'DB_MKTG';

const db = () => getBinding<D1Database>(MKTG_BINDING);
const origin = () => `https://${domain}/`;

/** The form hand-off: a pending row, and the confirmation mail when the row is new or renewed. */
export async function subscribe(message: SubscribeMessage): Promise<void> {
  const result = await signUp(db(), {
    email: message.email,
    name: message.name,
    source: message.source,
    purposes: message.purposes,
    policyVersion: message.policyVersion,
    ip: message.ip,
    vars: message.vars,
  });
  track({
    event: 'marketing.signup',
    host: message.hostname ?? '',
    form: message.formId,
    detail: result.status,
  });
  if (result.status !== 'pending') return;

  const mailgunDomain = getBinding<string>('MAILGUN_DOMAIN');
  const input = {
    body: personalize(copy.marketing.confirmBody, client),
    button: copy.marketing.confirmButton,
    confirmUrl: confirmUrl(origin(), result.token),
    client: displayName(),
    domain,
  };
  await sendEmail({
    apiKey: getBinding<string>('MAILGUN_API_KEY'),
    hostname: message.hostname,
    domain: mailgunDomain,
    from: `${displayName()} <website@${mailgunDomain}>`,
    to: [result.email],
    subject: personalize(copy.marketing.confirmSubject, client),
    text: renderText(input),
    html: renderHtml(input),
    tags: ['subscription-confirm'],
  });
}

/** The confirm page's work. */
export async function confirmSubscription(token: string, ip?: string | null): Promise<LinkOutcome> {
  const outcome = await confirmByToken(db(), token, ip);
  if (outcome === 'done') track({ event: 'marketing.confirmed', host: domain });
  return outcome;
}

/** The unsubscribe page's work. */
export async function unsubscribe(token: string): Promise<LinkOutcome> {
  const outcome = await unsubscribeByToken(db(), token);
  if (outcome === 'done') track({ event: 'marketing.unsubscribed', host: domain, detail: 'site' });
  return outcome;
}

/** The webhook's work: what Mailgun learned, applied to the list. */
export async function applyListEvent(event: ListEvent): Promise<boolean> {
  const changed = await suppress(db(), event.recipient, event.reason);
  if (changed) track({ event: 'marketing.unsubscribed', host: domain, detail: event.reason });
  return changed;
}

export interface CampaignInput {
  /** The site's own key, e.g. `2026-10-newsletter`. Sending the same key again sends nothing twice. */
  key: string;
  subject: string;
  /** The body, without a footer: the package appends the subscribed-at line and the link. */
  text: string;
  html: string;
  /** A segment: a SQL fragment over the subscribers columns, ANDed with `status = 'subscribed'`. */
  where?: string;
  params?: unknown[];
  /** The request hostname, when there is one; a cron passes null. */
  hostname: string | null;
  /**
   * WARM-UP CONTROLS, for a new sending domain. Mailgun's own schedule starts a domain at 1,000
   * messages a day and no more than 100 an hour, and climbs a stage at a time - so a campaign
   * can be capped (`limit`: at most this many recipients, in id order, from where the audience
   * starts) and paced (`batchSize` recipients per batch, one batch every `batchEverySeconds`,
   * as the queue's own delay - so 100 an hour is `{ batchSize: 100, batchEverySeconds: 3600 }`).
   * Pacing needs the queue; inline sending ignores it and says so. Cloudflare caps a delay at 12
   * hours, so a single send paces at most that far ahead; the next day is a new key.
   */
  limit?: number;
  batchSize?: number;
  batchEverySeconds?: number;
}

export interface CampaignResult {
  campaignId: number;
  batches: number;
  recipients: number;
  /** True when the batches went to the queue; false when they were sent inline, here. */
  queued: boolean;
}

/** Mailgun's ceiling per call. */
export const BATCH_SIZE = 1000;

/** Cloudflare's ceiling on a queued message's delay: 12 hours. */
export const MAX_DELAY_SECONDS = 43200;

/**
 * Send a campaign to the audience, in batches of up to 1,000, each batch a queue message
 * retried alone - or sent inline, in order, when the site has no queue. The campaign row is
 * written first with the body and the audience query, so a batch message is only an id range
 * and a batch that runs twice sends once.
 */
export async function sendCampaign(input: CampaignInput): Promise<CampaignResult> {
  const database = db();
  const { text, html } = withFooter(input.text, input.html);
  const campaignId = await recordCampaign(database, {
    key: input.key,
    subject: input.subject,
    text,
    html,
    where: input.where,
    params: input.params,
  });

  const queue = features?.queue ? getQueue() : null;
  const batchSize = Math.min(Math.max(1, input.batchSize ?? BATCH_SIZE), BATCH_SIZE);
  const spacing = Math.max(0, input.batchEverySeconds ?? 0);
  if (spacing && !queue) {
    console.warn('[webm] sendCampaign: batchEverySeconds needs the queue; sending without pacing.');
  }
  let after = 0;
  let batch = 0;
  let recipients = 0;
  for (;;) {
    const remaining = input.limit === undefined ? batchSize : input.limit - recipients;
    if (remaining <= 0) break;
    const page = await audiencePage(database, {
      where: input.where,
      params: input.params,
      after,
      limit: Math.min(batchSize, remaining),
    });
    if (page.length === 0) break;
    const message: CampaignBatchMessage = {
      kind: 'campaign.batch',
      campaignId,
      batch: ++batch,
      fromId: after,
      toId: page[page.length - 1]!.id,
      hostname: input.hostname,
    };
    after = message.toId;
    recipients += page.length;

    if (queue && fitsQueue(message)) {
      const delaySeconds = Math.min(MAX_DELAY_SECONDS, spacing * (batch - 1));
      await queue.send(message, delaySeconds ? { delaySeconds } : undefined);
    } else {
      await sendCampaignBatch(message);
    }
  }
  await completeCampaign(database, campaignId, batch);
  return { campaignId, batches: batch, recipients, queued: Boolean(queue) };
}

/**
 * One batch, to Mailgun, through the marketing domain and key. Reads the body and its rows back
 * from the campaign row - anyone who unsubscribed since the campaign started is simply not in
 * the range any more. Idempotent per batch.
 */
export async function sendCampaignBatch(message: CampaignBatchMessage): Promise<void> {
  const database = db();
  if (await batchSent(database, message.campaignId, message.batch)) return;
  const campaign = await campaignById(database, message.campaignId);
  if (!campaign) {
    console.error(`[webm] Campaign ${message.campaignId} is not in the database; batch dropped.`);
    return;
  }
  const recipients = await audiencePage(database, {
    where: campaign.audience_where ?? undefined,
    params: JSON.parse(campaign.audience_params) as unknown[],
    after: message.fromId,
    to: message.toId,
    limit: BATCH_SIZE,
  });
  if (recipients.length === 0) return;

  const mktgDomain = getBindingForMode<string>('MAILGUN_MKTG_DOMAIN', message.hostname);
  const site = origin();
  const started = Date.now();
  const result = await sendEmail({
    apiKey: getBindingForMode<string>('MAILGUN_MKTG_API_KEY', message.hostname),
    hostname: message.hostname,
    domain: mktgDomain,
    from: `${displayName()} <news@${mktgDomain}>`,
    to: recipients.map((r) => r.email),
    subject: campaign.subject,
    text: campaign.text,
    html: campaign.html,
    recipientVariables: Object.fromEntries(
      recipients.map((r) => [
        r.email,
        { name: r.name ?? '', unsubscribe: unsubscribeUrl(site, r.token) },
      ]),
    ),
    tags: ['campaign', `campaign:${message.campaignId}`],
  });
  await recordBatch(database, {
    campaignId: message.campaignId,
    batch: message.batch,
    recipients: recipients.length,
    messageId: result.id,
  });
  track({
    event: 'campaign.batch_sent',
    host: message.hostname ?? domain,
    detail: String(message.campaignId),
    duration: Date.now() - started,
  });
}

/**
 * The footer under every campaign: why they are getting it, and the per-recipient unsubscribe
 * link, as Mailgun's placeholder - substituted per recipient from recipient-variables. Exported
 * for its test.
 */
export function withFooter(text: string, html: string): { text: string; html: string } {
  const line = fill(copy.marketing.campaignFooter, { domain });
  const label = copy.marketing.campaignUnsubscribe;
  return {
    text: `${text.replace(/\s+$/, '')}\n\n${line}\n${label}: ${UNSUBSCRIBE_VARIABLE}\n`,
    html: html.includes('</body>')
      ? html.replace('</body>', `${footerHtml(line, label)}\n</body>`)
      : `${html}\n${footerHtml(line, label)}`,
  };
}

function footerHtml(line: string, label: string): string {
  return (
    `<p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#6b6b6b;text-align:center;">` +
    `${escapeHtml(line)} <a href="${UNSUBSCRIBE_VARIABLE}" style="color:#6b6b6b;">${escapeHtml(label)}</a></p>`
  );
}

function getQueue(): Queue<CampaignBatchMessage> | null {
  try {
    return getBinding<Queue<CampaignBatchMessage>>(QUEUE_BINDING);
  } catch {
    return null;
  }
}
