/*
 * The notification email sent to the client when someone submits a form.
 *
 * Plain functions returning strings rather than a template engine — an email body is a
 * string, and adding a dependency to build one would break the vanilla rule for no gain.
 *
 * Both a text and an HTML part are produced. Sending both materially improves deliverability;
 * text-only mail is more likely to be filtered, and HTML-only is worse.
 *
 * NO HEADING IN THE BODY. The subject line already says what this is —
 * `[Client Name] New contact enquiry from Jane` — and repeating it as an <h1> directly under
 * it just pushes the actual fields further down the preview pane. Subject lines are built by
 * subject.ts; the shared three-line footer is footer.ts.
 */
import { escapeHtml, renderFooterHtml, renderFooterText } from './footer.ts';
import { DEFAULT_COPY, fill } from '../includes/webmonterey/copy-defaults.ts';

export interface SubmissionEmailInput {
  /** Form id, e.g. 'contact'. */
  form: string;
  /** Human name of the form, from its definition. */
  formName: string;
  /** The submitted fields, in display order. */
  fields: Array<{ label: string; name: string; value: string }>;
  /** The client's display name, for the footer's copyright line. */
  client: string;
  /** The site's production domain, named in the footer. */
  domain: string;
  /** D1 row id, so a specific enquiry can be found later. */
  submissionId?: number;
}

export function renderText(input: SubmissionEmailInput): string {
  const lines = [...input.fields.map((f) => `${f.label}:\n${f.value || '-'}\n`)];

  if (input.submissionId !== undefined) {
    lines.push(`${fill(DEFAULT_COPY.email.reference, { id: input.submissionId ?? '' })}`);
  }

  lines.push(renderFooterText({ client: input.client, domain: input.domain }));

  return lines.join('\n');
}

export function renderHtml(input: SubmissionEmailInput): string {
  const rows = input.fields
    .map(
      (f) => `      <tr>
        <th align="left" style="padding:8px 16px 8px 0;vertical-align:top;color:#3f3f3f;font-weight:600;white-space:nowrap;">${escapeHtml(f.label)}</th>
        <td style="padding:8px 0;vertical-align:top;color:#222;">${escapeHtml(f.value) || '&mdash;'}</td>
      </tr>`,
    )
    .join('\n');

  const reference =
    input.submissionId !== undefined
      ? `<p style="margin:24px 0 0;color:#3f3f3f;font-size:13px;">${fill(DEFAULT_COPY.email.reference, { id: input.submissionId ?? '' })}</p>`
      : '';

  /*
   * Inline styles and a table layout on purpose. Email clients strip <style> blocks and have
   * no meaningful CSS support — the site's design tokens cannot be used here.
   */
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f1eae8;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:640px;margin:0 auto;padding:32px;background:#fff;border-radius:8px;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
${rows}
      </table>
      ${reference}
    </div>
${renderFooterHtml({ client: input.client, domain: input.domain })}
  </body>
</html>`;
}
