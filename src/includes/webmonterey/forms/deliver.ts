/*
 * The two mail steps of the form pipeline, as functions of a plain message.
 *
 * ONE IMPLEMENTATION, TWO CALLERS. The queue consumer runs these when the site has a queue; the
 * action runs them inline when it has none, or when the queue refused the message - so the
 * inline path is the fallback and stays exercised, and a site must deliver mail with the queue
 * down. Both callers hand in the same message shape (queues/message.ts), which is why every
 * input is a plain value: nothing here reads a request.
 *
 * The staging redirect is inside sendEmail, keyed off `hostname` - captured by the producer,
 * since a consumer has no request to read it from.
 */
import { run } from '../../cloudflare/d1/client.ts';
import { getBinding, getSecret } from '../../cloudflare/workers/env.ts';
import { sendEmail } from '../../sinch/mailgun/send.ts';
import { renderHtml, renderText } from '../../../emails/submission-notification.ts';
import {
  renderHtml as renderAutoresponseHtml,
  renderText as renderAutoresponseText,
} from '../../../emails/autoresponse.ts';
import { track } from '../../cloudflare/analytics/track.ts';
import { displayName, domain, features } from '../site.ts';
import type { AutoresponseMessage, NotifyMessage } from '../../cloudflare/queues/message.ts';

/**
 * The client's notification. Throws on failure so the caller can retry it: the enquiry is the
 * message that must not be lost. On success stamps `notified_at` on the D1 row, which is what
 * the query for "anything needing a resend" reads.
 */
export async function notify(message: NotifyMessage): Promise<void> {
  const mailgunDomain = await getSecret('MAILGUN_DOMAIN');
  const started = Date.now();
  try {
    await send();
  } catch (error) {
    track({ event: 'form.notify_failed', host: message.hostname ?? '', form: message.formId });
    throw error;
  }
  track({
    event: 'form.notify_sent',
    host: message.hostname ?? '',
    form: message.formId,
    duration: Date.now() - started,
  });

  async function send() {
    await sendEmail({
      apiKey: await getSecret('MAILGUN_API_KEY'),
      hostname: message.hostname,
      domain: mailgunDomain,
      /*
       * The sending domain is `webm.<client-domain>`, so `website@` lands as
       * website@webm.example.com. Deliberately the same mailbox for every template - it is the
       * address a client sees in their inbox and adds to their safe-senders list.
       */
      from: `${displayName()} Website <website@${mailgunDomain}>`,
      to: message.to,
      subject: message.subject,
      text: renderText(emailInput(message)),
      html: renderHtml(emailInput(message)),
      // So hitting reply reaches the enquirer, not the Worker.
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      tags: [`form:${message.formId}`],
    });

    if (message.submissionId !== undefined && features?.d1) {
      await run(
        getBinding<D1Database>('DB'),
        `UPDATE submissions SET notified_at = datetime('now') WHERE id = ?`,
        message.submissionId,
      );
    }
  }
}

/**
 * The visitor's confirmation. Never retried by either caller: a bounce from a mistyped address
 * must not take the notification down with it, and a "we got your message" hours later is worse
 * than none. Throws so the caller can log it; the caller then drops it.
 */
export async function autorespond(message: AutoresponseMessage): Promise<void> {
  try {
    await sendAutoresponse(message);
  } catch (error) {
    track({
      event: 'form.autoresponse_failed',
      host: message.hostname ?? '',
      form: message.formId,
    });
    throw error;
  }
}

async function sendAutoresponse(message: AutoresponseMessage): Promise<void> {
  const mailgunDomain = await getSecret('MAILGUN_DOMAIN');
  const input = {
    body: message.body,
    fields: message.fields,
    client: displayName(),
    domain,
  };
  await sendEmail({
    apiKey: await getSecret('MAILGUN_API_KEY'),
    hostname: message.hostname,
    domain: mailgunDomain,
    from: `${displayName()} <website@${mailgunDomain}>`,
    to: [message.to],
    subject: message.subject,
    text: renderAutoresponseText(input),
    html: renderAutoresponseHtml(input),
    /* INVERTED relative to the notification: a visitor hitting reply must reach the client. */
    replyTo: message.replyTo,
    tags: [`form:${message.formId}`, 'autoresponse'],
  });
}

function emailInput(message: NotifyMessage) {
  return {
    form: message.formId,
    formName: message.formName,
    fields: message.fields,
    client: displayName(),
    domain,
    submissionId: message.submissionId,
  };
}
