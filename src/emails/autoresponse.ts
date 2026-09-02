/*
 * The confirmation email sent to the VISITOR after they submit a form.
 *
 * The second template, and the reason footer.ts and subject.ts are shared modules rather than
 * code inside submission-notification.ts. Nothing about the footer or the subject format is
 * re-implemented here.
 *
 * IT IS NOT THE NOTIFICATION WITH THE RECIPIENTS SWAPPED. Three things invert:
 *
 *   - `to` is the visitor, so this is the one message on the site that reaches an address the
 *     site does not control. It must never carry the D1 reference, internal notes, or any
 *     field the visitor did not themselves type.
 *   - Reply-To is the CLIENT's address, so a visitor replying reaches a human. The
 *     notification does the opposite and points at the enquirer.
 *   - It leads with copy, because the recipient did not ask for a data dump — they want
 *     confirmation that the thing they just did worked.
 *
 * The echo of their own submission is deliberate: it is the only record they have, since the
 * form cleared when it submitted.
 */
import { escapeHtml, renderFooterHtml, renderFooterText } from './footer.ts';
import { DEFAULT_COPY } from '../includes/webmonterey/copy-defaults.ts';

export interface AutoresponseEmailInput {
  /** Client-authored copy from the form definition's `autoresponse.body`. */
  body: string;
  /** The submitted fields, echoed back in display order. */
  fields: Array<{ label: string; name: string; value: string }>;
  /** The client's display name, for the footer's copyright line. */
  client: string;
  /** The site's production domain, named in the footer. */
  domain: string;
}

/** The heading above the echoed fields, in both parts. */
const ECHO_HEADING = '${DEFAULT_COPY.email.autoresponseHeading}';

export function renderText(input: AutoresponseEmailInput): string {
  const lines = [
    input.body,
    '',
    ECHO_HEADING,
    '',
    ...input.fields.map((f) => `${f.label}:\n${f.value || '-'}\n`),
  ];

  lines.push(renderFooterText({ client: input.client, domain: input.domain }));

  return lines.join('\n');
}

export function renderHtml(input: AutoresponseEmailInput): string {
  const rows = input.fields
    .map(
      (f) => `      <tr>
        <th align="left" style="padding:8px 16px 8px 0;vertical-align:top;color:#3f3f3f;font-weight:600;white-space:nowrap;">${escapeHtml(f.label)}</th>
        <td style="padding:8px 0;vertical-align:top;color:#222;">${escapeHtml(f.value) || '&mdash;'}</td>
      </tr>`,
    )
    .join('\n');

  /*
   * Inline styles and a table layout, for the same reason as the notification: email clients
   * strip <style> blocks, so the site's design tokens cannot reach here.
   *
   * The body copy is escaped like everything else. It comes from the form definition rather
   * than from a visitor, but it is still authored text arriving through JSON, and there is no
   * case where raw HTML in it would be intended.
   */
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f1eae8;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:640px;margin:0 auto;padding:32px;background:#fff;border-radius:8px;">
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#222;">${escapeHtml(input.body)}</p>
      <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#3f3f3f;">${ECHO_HEADING}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
${rows}
      </table>
    </div>
${renderFooterHtml({ client: input.client, domain: input.domain })}
  </body>
</html>`;
}
