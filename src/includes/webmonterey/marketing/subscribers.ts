/*
 * The subscriber table, as functions of a D1 database - the marketing include's data half.
 *
 * EVERY STATE CHANGE IS A GUARDED UPDATE, so a link clicked twice, a webhook delivered twice or a
 * form posted twice does one thing once. A confirm only moves pending -> subscribed; an
 * unsubscribe only moves pending or subscribed -> unsubscribed; a suppression from the provider
 * wins over everything. The provenance columns are written at signup and never edited: what a
 * person was told, when, and from where, is a record, not a setting.
 *
 * FRESH CONSENT RESTORES; A COMPLAINT DOES NOT. Someone who unsubscribed may sign up again and
 * gets a new confirmation mail - that is a new decision. Someone Mailgun suppressed for a
 * complaint or a permanent bounce is not re-added by a form: the email spec's rule that a
 * withdrawn consent cannot be restored by a stale integration, applied to a keen visitor.
 *
 * Takes the database rather than reading the binding, so it is tested against a fake.
 */
import { all, first, run } from '../../cloudflare/d1/client.ts';
import { newToken } from './tokens.ts';
import { normalizeEmail } from './links.ts';

export type SubscriberStatus = 'pending' | 'subscribed' | 'unsubscribed' | 'suppressed';

export interface SignupInput {
  email: string;
  name?: string;
  /** The form id and page path, e.g. `newsletter@/` - how they subscribed. */
  source: string;
  /** What the form said the list sends - what they agreed to, verbatim at signup. */
  purposes: string;
  policyVersion?: string;
  ip?: string | null;
  vars?: Record<string, unknown>;
}

export interface SignupResult {
  /** `pending`: a confirmation should be sent, with this token. Anything else: send nothing. */
  status: SubscriberStatus;
  token: string;
  email: string;
}

export async function signUp(db: D1Database, input: SignupInput): Promise<SignupResult> {
  const email = normalizeEmail(input.email);
  const existing = await first<{ status: SubscriberStatus; token: string }>(
    db,
    `SELECT status, token FROM subscribers WHERE email = ?`,
    email,
  );

  if (existing?.status === 'subscribed' || existing?.status === 'suppressed') {
    return { status: existing.status, token: existing.token, email };
  }

  const token = newToken();
  const vars = JSON.stringify(input.vars ?? {});
  if (existing) {
    await run(
      db,
      `UPDATE subscribers
          SET status = 'pending', token = ?, name = COALESCE(?, name), source = ?, purposes = ?,
              policy_version = ?, signup_ip = ?, signed_up_at = datetime('now'),
              confirmed_at = NULL, confirm_ip = NULL, unsubscribed_at = NULL,
              unsubscribe_reason = NULL, vars = ?, updated_at = datetime('now')
        WHERE email = ?`,
      token,
      input.name ?? null,
      input.source,
      input.purposes,
      input.policyVersion ?? null,
      input.ip ?? null,
      vars,
      email,
    );
  } else {
    await run(
      db,
      `INSERT INTO subscribers (email, name, status, token, source, purposes, policy_version, signup_ip, vars)
       VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
      email,
      input.name ?? null,
      token,
      input.source,
      input.purposes,
      input.policyVersion ?? null,
      input.ip ?? null,
      vars,
    );
  }
  return { status: 'pending', token, email };
}

export type LinkOutcome = 'done' | 'already' | 'invalid';

/** The confirm link. `done` the first time, `already` for a subscribed row, `invalid` otherwise. */
export async function confirmByToken(
  db: D1Database,
  token: string,
  ip?: string | null,
): Promise<LinkOutcome> {
  const changed = await run(
    db,
    `UPDATE subscribers
        SET status = 'subscribed', confirmed_at = datetime('now'), confirm_ip = ?, updated_at = datetime('now')
      WHERE token = ? AND status = 'pending'`,
    ip ?? null,
    token,
  );
  if (changed.meta.changes > 0) return 'done';
  const row = await first<{ status: SubscriberStatus }>(
    db,
    `SELECT status FROM subscribers WHERE token = ?`,
    token,
  );
  return row?.status === 'subscribed' ? 'already' : 'invalid';
}

/** The unsubscribe link on the site. Never fails a person who is already off the list. */
export async function unsubscribeByToken(db: D1Database, token: string): Promise<LinkOutcome> {
  const changed = await run(
    db,
    `UPDATE subscribers
        SET status = 'unsubscribed', unsubscribed_at = datetime('now'), unsubscribe_reason = 'site',
            updated_at = datetime('now')
      WHERE token = ? AND status IN ('pending', 'subscribed')`,
    token,
  );
  if (changed.meta.changes > 0) return 'done';
  const row = await first<{ status: SubscriberStatus }>(
    db,
    `SELECT status FROM subscribers WHERE token = ?`,
    token,
  );
  return row ? 'already' : 'invalid';
}

/**
 * What the mail provider told us: the header unsubscribe, a complaint, a permanent bounce.
 * `provider` is an unsubscribe the person chose; the other two are suppressions the site must
 * honour and a form cannot undo. Unknown addresses are ignored - the event may be about
 * transactional mail to someone who never subscribed.
 */
export async function suppress(
  db: D1Database,
  email: string,
  reason: 'provider' | 'complaint' | 'bounce',
): Promise<boolean> {
  const status = reason === 'provider' ? 'unsubscribed' : 'suppressed';
  const changed = await run(
    db,
    `UPDATE subscribers
        SET status = ?, unsubscribed_at = datetime('now'), unsubscribe_reason = ?, updated_at = datetime('now')
      WHERE email = ? AND status != 'suppressed'`,
    status,
    reason,
    normalizeEmail(email),
  );
  return changed.meta.changes > 0;
}

export interface Recipient {
  id: number;
  email: string;
  name: string | null;
  token: string;
  vars: string;
}

/**
 * One page of the audience: subscribed rows, in id order, after `after`, up to `limit` - or up
 * to and including `to`, for a batch re-reading its range. `where` is the site's own segment - a
 * SQL fragment over this table's columns, with its params - and is ANDed with the status; a
 * segment cannot widen the audience past subscribed. A row that unsubscribed between the
 * campaign starting and its batch sending is not in the range any more, which is the point of
 * re-reading rather than carrying addresses.
 */
export async function audiencePage(
  db: D1Database,
  options: { where?: string; params?: unknown[]; after?: number; to?: number; limit?: number } = {},
): Promise<Recipient[]> {
  const extra = options.where ? ` AND (${options.where})` : '';
  const upper = options.to === undefined ? '' : ' AND id <= ?';
  return all<Recipient>(
    db,
    `SELECT id, email, name, token, vars FROM subscribers
      WHERE status = 'subscribed' AND id > ?${upper}${extra}
      ORDER BY id LIMIT ?`,
    options.after ?? 0,
    ...(options.to === undefined ? [] : [options.to]),
    ...(options.params ?? []),
    options.limit ?? 1000,
  );
}

export interface CampaignRow {
  id: number;
  subject: string;
  text: string;
  html: string;
  audience_where: string | null;
  audience_params: string;
}

/**
 * A campaign row, created once per key with its body and audience; the id comes back on every
 * call. Sending the same key again sends nothing twice: the batches remember.
 */
export async function recordCampaign(
  db: D1Database,
  input: {
    key: string;
    subject: string;
    text: string;
    html: string;
    where?: string;
    params?: unknown[];
  },
): Promise<number> {
  await run(
    db,
    `INSERT OR IGNORE INTO campaigns (key, subject, text, html, audience_where, audience_params)
     VALUES (?, ?, ?, ?, ?, ?)`,
    input.key,
    input.subject,
    input.text,
    input.html,
    input.where ?? null,
    JSON.stringify(input.params ?? []),
  );
  const row = await first<{ id: number }>(db, `SELECT id FROM campaigns WHERE key = ?`, input.key);
  return row!.id;
}

/** The campaign a batch belongs to, or null when the id is not one - a message from a dropped row. */
export async function campaignById(db: D1Database, id: number): Promise<CampaignRow | null> {
  return first<CampaignRow>(
    db,
    `SELECT id, subject, text, html, audience_where, audience_params FROM campaigns WHERE id = ?`,
    id,
  );
}

/** Once every batch is out. */
export async function completeCampaign(db: D1Database, id: number, batches: number): Promise<void> {
  await run(
    db,
    `UPDATE campaigns SET batches = ?, completed_at = datetime('now') WHERE id = ?`,
    batches,
    id,
  );
}

/** Whether a batch of a campaign was already sent - the idempotency the queue's retries need. */
export async function batchSent(
  db: D1Database,
  campaignId: number,
  batch: number,
): Promise<boolean> {
  const row = await first<{ sent_at: string | null }>(
    db,
    `SELECT sent_at FROM campaign_batches WHERE campaign_id = ? AND batch = ?`,
    campaignId,
    batch,
  );
  return Boolean(row?.sent_at);
}

export async function recordBatch(
  db: D1Database,
  input: { campaignId: number; batch: number; recipients: number; messageId: string },
): Promise<void> {
  await run(
    db,
    `INSERT INTO campaign_batches (campaign_id, batch, recipients, sent_at, message_id)
     VALUES (?, ?, ?, datetime('now'), ?)
     ON CONFLICT (campaign_id, batch) DO UPDATE SET sent_at = excluded.sent_at, message_id = excluded.message_id`,
    input.campaignId,
    input.batch,
    input.recipients,
    input.messageId,
  );
  await run(
    db,
    `UPDATE campaigns SET recipients = recipients + ? WHERE id = ?`,
    input.recipients,
    input.campaignId,
  );
}
