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
 * THE BUTTON IS A TABLE CELL THAT CARRIES THE COLOUR AND THE PADDING, with the link inside it -
 * the "bulletproof button". A styled <a> alone arrived in Gmail as white text on white, because
 * Gmail dropped its background; and Outlook for Windows ignores padding on an inline element,
 * so the cell does both jobs. See layout.ts for the same rules on the page and the card.
 *
 * Copy comes from \`copy.marketing\`, so a client's own words reach it; the footer is the shared
 * one every transactional message ends with.
 */
import { escapeHtml, renderFooterText } from './footer.ts';
import { renderPageHtml } from './layout.ts';

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
  return renderPageHtml({
    client: input.client,
    domain: input.domain,
    card: `      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#222222;">${escapeHtml(input.body)}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;border-collapse:separate;">
        <tr>
          <td bgcolor="#222222" style="padding:12px 20px;background-color:#222222;border-radius:6px;">
            <a href="${url}" style="display:inline-block;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;">${escapeHtml(input.button)}</a>
          </td>
        </tr>
      </table>
      <p style="margin:0;font-size:13px;line-height:1.6;color:#3f3f3f;word-break:break-all;">
        <a href="${url}" style="color:#3f3f3f;">${url}</a>
      </p>`,
  });
}
