/*
 * Astro Actions — typed server handlers callable from a form or from client JS.
 *
 * `src/actions/index.ts` is a FIXED path. Astro will not find actions anywhere else.
 *
 * The submit flow, in order, and the order matters:
 *
 *   1. Validate the fields          — cheapest, and rejects most malformed input
 *   2. Verify Turnstile             — before anything is stored or sent
 *   3. Write to D1                  — the enquiry is now safe even if email fails
 *   4. Deliver the mail             — through the site's queue when it has one, else inline
 *
 * Storing before sending is deliberate. Mailgun is the flakiest step, and a client would
 * rather have an enquiry in the database with a failed notification than a lost one. The queue
 * is the same reasoning one step further: the visitor needs none of the mail to continue, so
 * with a queue the response goes out before Mailgun is called, and a failed notification is
 * retried rather than logged. The mail steps themselves are in forms/deliver.ts, shared with
 * the consumer, so the inline path stays the tested fallback.
 */
import { defineAction, ActionError } from 'astro:actions';
import { z } from 'astro/zod';
import { copy, fill } from '../includes/webmonterey/copy.ts';
import { run } from '../includes/cloudflare/d1/client.ts';
import { getBinding, getSecret, hasBinding } from '../includes/cloudflare/workers/env.ts';
import { TURNSTILE_FIELD, verifyTurnstile } from '../includes/cloudflare/turnstile/verify.ts';
import { HONEYPOT_FIELD, isHoneypotFilled } from '../includes/webmonterey/forms/honeypot.ts';
import { autorespond, notify } from '../includes/webmonterey/forms/deliver.ts';
import { subscribe } from '../includes/webmonterey/marketing/index.ts';
import {
  fitsQueue,
  QUEUE_BINDING,
  type AutoresponseMessage,
  type FormMessage,
  type NotifyMessage,
  type SubscribeMessage,
} from '../includes/cloudflare/queues/message.ts';
import { renderSubject } from '../emails/subject.ts';
import { track } from '../includes/cloudflare/analytics/track.ts';
import { client, features, hasClient } from '../includes/webmonterey/site.ts';

/*
 * Form definitions live in the CLIENT repo, at src/forms/*.json - the filename is the form id.
 * The integration collects them into this module, the same way it does the block registry,
 * because a package cannot import a file from the site it is installed into.
 */
import { FORMS } from 'virtual:webm/forms';

type FormId = keyof typeof FORMS;

/**
 * Hand the messages to the site's queue. False - never a throw - when that cannot happen, so the
 * caller sends inline: a site must deliver mail with the queue down.
 */
async function enqueue(messages: FormMessage[]): Promise<boolean> {
  if (!features?.queue || !hasBinding(QUEUE_BINDING)) return false;
  if (!messages.every(fitsQueue)) return false;
  try {
    const queue = getBinding<Queue<FormMessage>>(QUEUE_BINDING);
    await queue.sendBatch(messages.map((body) => ({ body })));
    return true;
  } catch (error) {
    console.error('[webm] The queue refused the form messages; sending inline instead:', error);
    return false;
  }
}

export const server = {
  submitForm: defineAction({
    accept: 'form',
    input: z.object({
      form: z.string(),
      [TURNSTILE_FIELD]: z.string().optional(),
      // Field values are validated below against the form's own definition, because the
      // shape differs per form and per site.
      data: z.record(z.string(), z.string()).optional(),
    }),

    handler: async (input, context) => {
      const formId = input.form as FormId;
      const definition = FORMS[formId];

      if (!definition) {
        throw new ActionError({ code: 'BAD_REQUEST', message: copy.form.unknownForm });
      }

      /*
       * Astro gives us the parsed input, but per-form fields are dynamic, so read them
       * straight off the raw FormData.
       */
      const formData = await context.request.clone().formData();
      /*
       * getAll, NOT get. A checkbox GROUP posts one entry per ticked box, and `get` returns only
       * the first - so a visitor selecting "Recording, Mixing, Mastering" had "Recording" stored
       * in D1 and "Recording" emailed to the client. No error, no warning: the enquiry arrives
       * looking complete and is quietly wrong. Found on two client sites independently.
       *
       * ONE READER FOR BOTH the field list and the required check. They used to be the same
       * function and must stay so: read the value one way for display and another for validation
       * and a required checkbox group starts rejecting valid submissions.
       *
       * Joined with ", " because the value is stored as one string per field and read by a human
       * in an email. A caller wanting the parts back can split on it.
       */
      const value = (name: string) =>
        formData
          .getAll(name)
          .map((entry) => String(entry).trim())
          .filter(Boolean)
          .join(', ');

      // --- 1. validate -----------------------------------------------------
      const fields = definition.fields.map((f) => ({
        name: f.name,
        label: f.label,
        value: value(f.name),
      }));

      const missing = definition.fields
        .filter((f) => f.required && !value(f.name))
        .map((f) => f.label);

      if (missing.length) {
        throw new ActionError({
          code: 'BAD_REQUEST',
          message: fill(copy.form.missing, { fields: missing.join(', ') }),
        });
      }

      /*
       * --- 1b. honeypot ----------------------------------------------------
       *
       * Before Turnstile, because it costs nothing: no network call, no third party. A form
       * opts out with `"honeypot": false`, or renames the trap with a string, for the client
       * whose form genuinely asks for a website.
       *
       * ANSWERS AS THOUGH IT SUCCEEDED. Telling a bot which check it failed is how the next
       * attempt gets past it - and the visitor never sees this either way, so a false positive
       * is silent. That is why the rendering contract in honeypot.ts is strict.
       */
      const honeypot =
        'honeypot' in definition
          ? (definition as { honeypot?: string | false }).honeypot
          : HONEYPOT_FIELD;

      if (honeypot !== false && isHoneypotFilled(formData, honeypot || HONEYPOT_FIELD)) {
        console.warn(`[webm] Honeypot caught a submission to "${formId}". Discarded.`);
        track({ event: 'form.honeypot', host: context.url.hostname, form: formId });
        return { ok: true, submissionId: undefined, formId };
      }

      /*
       * --- 2. Turnstile ----------------------------------------------------
       *
       * PER FORM, not site-wide. `features.turnstile` switches the capability on; a form opts
       * OUT with `"turnstile": false` in its definition.
       *
       * THAT DISTINCTION IS LOAD-BEARING, and it was learned the hard way. The widget is
       * rendered by the form COMPONENT, and a site does not necessarily render one on every
       * form - a newsletter box is a single inline field with no room for a challenge.
       * Verifying every form the moment the flag went on meant those boxes submitted no token,
       * failed verification, and rejected EVERY subscriber, while the form itself looked
       * completely normal. It cannot be reproduced with the flag off.
       *
       * Generation 2 carried this opt-out and the package lost it in the extraction. Restored
       * after mikeformarina.com's rebuild surfaced the same failure a second time.
       *
       * Default is ON: a new form is protected unless someone deliberately says otherwise.
       */
      const optsOutOfTurnstile = (definition as { turnstile?: boolean }).turnstile === false;

      if (features?.turnstile && !optsOutOfTurnstile) {
        let result;
        try {
          result = await verifyTurnstile({
            secretKey: await getSecret('TURNSTILE_SECRET_KEY'),
            token: value(TURNSTILE_FIELD),
            expectedHostname: context.url.hostname,
            expectedAction: formId,
            remoteIp: context.request.headers.get('CF-Connecting-IP'),
          });
        } catch (error) {
          /*
           * LOG IT. Without this line "we are turning away bots" and "the secret key is wrong,
           * so we are turning away every human" are the same silent 403. Observability is
           * already on; this costs nothing and is the difference between a five-minute
           * diagnosis and a fortnight of lost enquiries.
           */
          console.error(`[webm] Turnstile verification failed for "${formId}":`, error);
          track({
            event: 'form.turnstile_failed',
            host: context.url.hostname,
            form: formId,
            detail: 'error',
          });
          // Verification is unavailable. REJECT — never admit on error, or an attacker
          // simply breaks the siteverify call to bypass the check entirely.
          throw new ActionError({
            code: 'INTERNAL_SERVER_ERROR',
            message: copy.form.verifyUnavailable,
          });
        }

        if (!result.success) {
          console.warn(
            `[webm] Turnstile rejected a submission to "${formId}":`,
            (result as { 'error-codes'?: string[] })['error-codes'] ?? '(no codes)',
          );
          throw new ActionError({
            code: 'FORBIDDEN',
            message: copy.form.verifyFailed,
          });
        }
      }

      // --- 3. store --------------------------------------------------------
      let submissionId: number | undefined;

      if (features?.d1) {
        const cf = context.request.cf as { country?: string } | undefined;

        const stored = await run(
          getBinding<D1Database>('DB'),
          `INSERT INTO submissions (form, data, ip, user_agent, country)
           VALUES (?, ?, ?, ?, ?)`,
          formId,
          JSON.stringify(Object.fromEntries(fields.map((f) => [f.name, f.value]))),
          context.request.headers.get('CF-Connecting-IP'),
          context.request.headers.get('user-agent'),
          cf?.country ?? null,
        );

        submissionId = stored.meta.last_row_id;
        track({ event: 'form.stored', host: context.url.hostname, form: formId });
      }

      // --- 4. notify -------------------------------------------------------
      const recipients = definition.notify.to;

      /*
       * A FORM WITH NOWHERE TO SEND MUST NOT SAY THANK YOU.
       *
       * With D1 off, no recipient configured and no Mailgun key, this handler validated the
       * input, returned success, showed the cheerful confirmation page and dropped the enquiry
       * on the floor. Nobody finds out until a customer asks why they were never called back.
       *
       * Checked AFTER validation and Turnstile so a misconfigured form still rejects rubbish,
       * and gated on EXACTLY the conditions the store and send paths use below - a guard that
       * disagrees with them turns a working form into an error page, which is a worse bug than
       * the one it is preventing.
       */
      const willStore = Boolean(features?.d1);
      const willNotify = recipients.length > 0 && hasBinding('MAILGUN_API_KEY');

      if (!willStore && !willNotify) {
        console.error(
          `[webm] Form "${formId}" has nowhere to deliver: features.d1 is off, and ` +
            `${recipients.length ? 'MAILGUN_API_KEY is not set' : 'notify.to is empty'}. ` +
            `The submission was NOT saved. Set one of them.`,
        );
        throw new ActionError({
          code: 'INTERNAL_SERVER_ERROR',
          message: copy.form.noDelivery,
        });
      }

      if (recipients.length && hasBinding('MAILGUN_API_KEY')) {
        const replyTo = fields.find((f) => f.name === 'email')?.value;
        const hostname = context.url.hostname;

        const messages: FormMessage[] = [
          {
            kind: 'form.notify',
            formId,
            formName: definition.name,
            fields,
            submissionId,
            hostname,
            to: recipients,
            /*
             * `[Client Name] Topic`. The prefix is dropped rather than sent as `[CHANGEME]`
             * if webmonterey.json was never filled in — `go-live` checks for that, and
             * failing a live enquiry over a cosmetic prefix would trade a real loss for a
             * trivial one.
             */
            subject: renderSubject(hasClient ? client : null, definition.notify.subject, fields),
            ...(replyTo ? { replyTo } : {}),
          },
        ];

        /*
         * AUTORESPONSE — the visitor's confirmation. Its own message, on purpose: the client's
         * notification is the one that must not be lost, and a bounce from a visitor's mistyped
         * address must not take it down with it. It is never retried, by either path - a "we got
         * your message" hours later is worse than never sending it.
         *
         * Skipped entirely unless the form opts in, the visitor gave an address, and there is
         * a client recipient to point Reply-To at. See the `//autoresponse` note in the form
         * definition for why the default is off.
         */
        const autoresponse = 'autoresponse' in definition ? definition.autoresponse : undefined;
        if (autoresponse && replyTo && recipients[0]) {
          messages.push({
            kind: 'form.autoresponse',
            formId,
            formName: definition.name,
            fields,
            submissionId,
            hostname,
            to: replyTo,
            subject: renderSubject(hasClient ? client : null, autoresponse.subject, fields),
            body: autoresponse.body,
            replyTo: recipients[0],
          });
        }

        /*
         * --- 4. deliver: the queue when the site has one, inline when it has not ----------
         *
         * The visitor does not need either email to continue, so with `features.queue` on and
         * the QUEUE binding present the two messages are handed to the queue and the response
         * goes out now. The consumer (queues/consumer.ts) retries the notification and never the
         * autoresponse. Anything that stops the hand-off - the flag off, the binding missing, a
         * message over the size limit, send() throwing - falls to the inline path below, which is
         * what every site ran before 1.6.0 and what a site must still do with the queue down.
         */
        const queued = await enqueue(messages);
        track({
          event: queued ? 'form.queued' : 'form.submitted',
          host: hostname,
          form: formId,
          detail: queued ? 'queued' : 'inline',
        });
        if (!queued) {
          const [notification, confirmation] = messages as [NotifyMessage, AutoresponseMessage?];
          try {
            await notify(notification);
          } catch (error) {
            /*
             * The enquiry is already stored, so this is recoverable — do NOT fail the request
             * and tell the visitor to resubmit. `notified_at` stays NULL, which is the query
             * that finds anything needing a resend.
             */
            console.error('[webm] Notification email failed for submission', submissionId, error);
          }
          if (confirmation) {
            try {
              await autorespond(confirmation);
            } catch (error) {
              console.error('[webm] Autoresponse failed for submission', submissionId, error);
            }
          }
        }
      }

      /*
       * --- 5. the list, if this form feeds one ------------------------------------------
       *
       * Independent of the notification: a newsletter box has no recipient to notify and still
       * signs people up. Off the request like the mail - through the queue when there is one -
       * because it sends the confirmation email. A failure here is logged, never shown: the
       * visitor's enquiry, if the form was also one, is already safe.
       */
      const signup = 'subscribe' in definition ? definition.subscribe : undefined;
      const address = fields.find((f) => f.name === 'email')?.value;
      if (features?.marketing && signup && address) {
        const message: SubscribeMessage = {
          kind: 'form.subscribe',
          formId,
          email: address,
          name: fields.find((f) => f.name === 'name')?.value || undefined,
          source: `${formId}@${context.url.pathname}`,
          purposes: signup.purposes,
          policyVersion: signup.policyVersion,
          ip: context.request.headers.get('CF-Connecting-IP'),
          vars: Object.fromEntries(
            (signup.vars ?? []).map((name) => [
              name,
              fields.find((f) => f.name === name)?.value ?? '',
            ]),
          ),
          hostname: context.url.hostname,
        };
        if (!(await enqueue([message]))) {
          try {
            await subscribe(message);
          } catch (error) {
            console.error('[webm] Newsletter signup failed for', formId, error);
          }
        }
      }

      /*
       * `formId` TRAVELS WITH THE RESULT so a page hosting two forms can tell whose it is.
       * Every form on a page posts to this one action, and a server-rendered form reads the
       * outcome back through Astro.getActionResult - which answers "did submitForm run", not
       * "did MY form run". Without this the second form on a page congratulates the visitor
       * for a submission it never made.
       */
      return { ok: true, submissionId, formId };
    },
  }),
};
