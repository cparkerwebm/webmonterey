/*
 * The footer every transactional email ends with. Three lines, below the white card:
 *
 *   (c) 2026 Client Name
 *   This is an automated notification for your account at the example.com website.
 *   Powered by WebMonterey
 *
 * A separate module because submission-notification.ts is the FIRST template, not the only
 * one — an autoresponder or a receipt would otherwise copy this block, and the copies drift.
 * Same reasoning the Mailgun sender already carries.
 *
 * The year is computed HERE rather than passed in. These only ever render on
 * `prerender = false` routes, so `new Date()` is real request time, not a frozen build
 * constant — and a caller that has to remember to pass the year eventually forgets, which
 * shows up as a stale copyright the following January.
 */
import { CREDIT_TEXT, creditUrl } from '../includes/webmonterey/credits/credit.ts';
import { DEFAULT_COPY, fill } from '../includes/webmonterey/copy-defaults.ts';

export interface EmailFooterInput {
  /** The client's display name, for the copyright line. */
  client: string;
  /** The site's production domain, named in the disclaimer and used for attribution. */
  domain: string;
}

/** Minimal HTML escape. Shared with the templates; every interpolated value is untrusted. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function disclaimer(domain: string): string {
  return `${fill(DEFAULT_COPY.email.footerNotice, { domain })}`;
}

/**
 * The plain-text footer.
 *
 * DELIBERATELY CARRIES NO LINK. The credit appears as words only, so this surface contributes no
 * attribution and `utm_medium=email` only ever fires from the HTML version. That is accepted: a
 * UTM-laden URL on its own line is ugly in plain text, and it is the one place a mail client
 * genuinely would linkify and truncate it.
 *
 * Do not "fix" this by adding the URL.
 */
export function renderFooterText(input: EmailFooterInput): string {
  return [
    '',
    `© ${new Date().getFullYear()} ${input.client}`,
    disclaimer(input.domain),
    CREDIT_TEXT,
  ].join('\n');
}

export function renderFooterHtml(input: EmailFooterInput): string {
  const year = new Date().getFullYear();
  const href = creditUrl(input.domain, 'email');

  /*
   * Inline styles and explicit colors: email clients strip <style> blocks entirely, so the
   * site's design tokens cannot reach here. Deliberately NOT a table — this is three
   * centred lines and every client renders that consistently.
   *
   * BOTH LINKS OPEN IN A NEW TAB AND NEITHER ANNOUNCES IT, unlike the site footer, which
   * appends a visually-hidden "(opens in a new tab)". That asymmetry is deliberate, and the
   * reason is the same one that forced inline styles: the hiding technique cannot come with
   * it. `.webm-visually-hidden` is a stylesheet rule, and clients strip <style>; the inline
   * equivalent leans on `clip-path`, which Outlook and several webmail clients do not honour,
   * so the note would land as literal visible text in the footer of every notification.
   * Announcing it in words is the alternative and it is worse: a mail client opening a link
   * in a browser is the expected behavior, so the warning would be noise about something no
   * reader was surprised by. Nothing is lost that email a11y actually asks for.
   *
   * `title` is absent from both links ON PURPOSE, here and in Credit.astro. It is not reliably
   * announced by screen readers, is unreachable by keyboard and touch entirely, and either
   * duplicates the link text or competes with it for the accessible name. The link text is the
   * accessible name; that is the mechanism that works.
   *
   * `rel="noopener"` without `noreferrer`, also on purpose: the referrer IS the attribution.
   * Stripping it would leave only utm_content. See credit.ts.
   */
  return `    <div style="max-width:640px;margin:0 auto;padding:24px 32px 8px;text-align:center;font-size:13px;line-height:1.6;color:#3f3f3f;">
      <p style="margin:0;">&copy; ${year} ${escapeHtml(input.client)}</p>
      <p style="margin:0;">This is an automated notification for your account at the <a href="https://${escapeHtml(input.domain)}" target="_blank" rel="noopener" style="color:#3f3f3f;">${escapeHtml(input.domain)}</a> website.</p>
      <p style="margin:8px 0 0;"><a href="${href}" target="_blank" rel="noopener" style="color:#222;font-weight:700;text-decoration:none;">${CREDIT_TEXT}</a></p>
    </div>`;
}
