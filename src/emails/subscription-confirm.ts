/*
 * The confirmation email a visitor gets after signing up to a site's list.
 *
 * TRANSACTIONAL, NOT MARKETING. It goes from the site's transactional domain, webm.<domain>,
 * because it is the one message a person must receive to get any marketing at all - and a
 * marketing domain's reputation is exactly what a new list has none of. It carries no
 * unsubscribe link: there is nothing to unsubscribe from yet, and "ignore this and nothing more
 * is sent" is the truthful version.
 *
 * ONE CALL TO ACTION, the confirm link, shown twice: as a button, and as the URL in plain text
 * under it, because a button image that does not load or a client that strips styles still
 * leaves a link a person can use. The same URL is the whole plain-text part.
 *
 * Copy comes from \`copy.marketing\`, so a client's own words reach it; the footer is the shared
 * one every transactional message ends with.
 */
import { escapeHtml, renderFooterHtml, renderFooterText } from './footer.ts';

export interface SubscriptionConfirmInput {
  /** \`copy.marketing.confirmBody\`, \`{client}\` already filled. */
  body: string;
  /** \`copy.marketing.confirmButton\`. */
  button: string;
  /** The absolute confirm link. */
  confirmUrl: string;
  client: string;
  domain: string;
}

export function renderText(input: SubscriptionConfirmInput): string {
  return [
    input.body,
    '',
    `${input.button}:`,
    input.confirmUrl,
    renderFooterText({ client: input.client, domain: input.domain }),
  ].join('\n');
}

export function renderHtml(input: SubscriptionConfirmInput): string {
  const url = escapeHtml(input.confirmUrl);
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f1eae8;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:640px;margin:0 auto;padding:32px;background:#fff;border-radius:8px;">
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#222;">${escapeHtml(input.body)}</p>
      <p style="margin:0 0 24px;">
        <a href="${url}" style="display:inline-block;padding:12px 20px;background:#222;color:#fff;text-decoration:none;border-radius:6px;font-size:15px;font-weight:600;">${escapeHtml(input.button)}</a>
      </p>
      <p style="margin:0;font-size:13px;line-height:1.6;color:#3f3f3f;word-break:break-all;">
        <a href="${url}" style="color:#3f3f3f;">${url}</a>
      </p>
    </div>
${renderFooterHtml({ client: input.client, domain: input.domain })}
  </body>
</html>`;
}
