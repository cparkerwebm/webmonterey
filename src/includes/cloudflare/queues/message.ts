/*
 * What travels through the site's queue - the pure half. consumer.ts is the Worker half.
 *
 * WHY A QUEUE AT ALL. The test is whether the visitor needs the result right now. Validation,
 * the honeypot, Turnstile and the D1 write: yes - an error there is the visitor's to see, and
 * "thanks" must mean the enquiry is safe. The notification and the autoresponse: no - a slow
 * Mailgun call was the visitor's wait, and a failed one was a console line in logs that expire.
 * Behind a queue each is retried on its own, and the visitor already has their page.
 *
 * TWO MESSAGES PER SUBMISSION, not one. The notification retries until it lands or the queue
 * gives up, and then sits in the dead-letter queue where a person can see it. The autoresponse
 * NEVER retries: "we got your message" hours late is worse than none, which was already the rule
 * when both were sent inline. One message carrying both would retry the autoresponse every time
 * the notification failed.
 *
 * THE MESSAGE CARRIES THE FIELDS AND THE HOSTNAME. With D1 off the queue is the durable record,
 * so the whole submission has to be in it; and the staging redirect keys off the request
 * hostname, which a consumer has no request to read - so the producer captures it.
 *
 * A site adds its own kinds - a CRM add, a Slack post, a webhook - by handing formQueue a handler
 * per kind; see consumer.ts. Nothing service-specific ships here.
 */

/** One submitted field, as the email templates want it. */
export interface SubmittedField {
  name: string;
  label: string;
  value: string;
}

/** What both form messages share: enough to render and address the mail without D1. */
export interface FormMessageBase {
  formId: string;
  formName: string;
  fields: SubmittedField[];
  /** The D1 row, when the site stores submissions; the notify step stamps notified_at on it. */
  submissionId?: number;
  /** The request hostname, for the staging redirect. Null when there was no request. */
  hostname: string | null;
}

export interface NotifyMessage extends FormMessageBase {
  kind: 'form.notify';
  to: string[];
  subject: string;
  replyTo?: string;
}

export interface AutoresponseMessage extends FormMessageBase {
  kind: 'form.autoresponse';
  /** The visitor. The only address the site mails that it does not control. */
  to: string;
  subject: string;
  body: string;
  /** The client's first recipient, so a visitor hitting reply reaches a human. */
  replyTo: string;
}

/** The form's newsletter hand-off: a pending row and a confirmation mail, off the request. */
export interface SubscribeMessage {
  kind: 'form.subscribe';
  formId: string;
  email: string;
  name?: string;
  /** `<form id>@<page path>`, the provenance source. */
  source: string;
  purposes: string;
  policyVersion?: string;
  ip: string | null;
  vars: Record<string, unknown>;
  hostname: string | null;
}

/**
 * One batch of a campaign: the campaign and an id RANGE, not the recipients and not the body.
 * A thousand addresses alone is ~120 KB against the queue's 128 KB, and the HTML would have
 * pushed every real campaign past it - which the size check caught by sending inline, silently
 * losing the per-batch retry for exactly the sends that need it. The consumer reads the body and
 * the rows back from the campaign row; a few hundred bytes, retried alone, idempotent per batch.
 */
export interface CampaignBatchMessage {
  kind: 'campaign.batch';
  campaignId: number;
  batch: number;
  /** Subscriber ids after this one... */
  fromId: number;
  /** ...up to and including this one, re-read with the campaign's own audience query. */
  toId: number;
  hostname: string | null;
}

export type FormMessage = NotifyMessage | AutoresponseMessage | SubscribeMessage;
export type MarketingMessage = SubscribeMessage | CampaignBatchMessage;

/** Any message on the queue: the package's two, or a site's own kind. */
export type QueueMessage =
  FormMessage | MarketingMessage | { kind: string; [key: string]: unknown };

/** Cloudflare's ceiling per message. A form submission is a few KB; this guards the outlier. */
export const MAX_MESSAGE_BYTES = 128 * 1024;

/** Whether a message fits the queue. Over the limit it is sent inline instead. */
export function fitsQueue(message: unknown): boolean {
  return new TextEncoder().encode(JSON.stringify(message)).byteLength <= MAX_MESSAGE_BYTES;
}

/** The queue and dead-letter queue names for a site, from its slug: one name everywhere. */
export function queueNames(slug: string): { queue: string; deadLetter: string } {
  return { queue: slug, deadLetter: `${slug}-dlq` };
}

/** The binding every site's producer uses. */
export const QUEUE_BINDING = 'QUEUE';
