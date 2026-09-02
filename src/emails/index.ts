/*
 * @cparkerwebm/webmonterey/emails
 *
 * Transactional templates - form notifications and autoresponses - as plain functions.
 *
 * PLAIN FUNCTIONS RETURNING STRINGS, not a component framework. Email HTML is tables and inline
 * styles - Outlook has enforced that for fifteen years - so a framework's main advantages do not
 * survive the constraint, and @react-email/render would mean React SSR inside a Worker on every
 * send. Zero dependencies, runs in a Worker, testable with `node --test`.
 *
 * Styling comes from `emailPalette()` in ./design, which resolves every var() chain to a literal.
 * A custom property in an email is inert; `--webm-link: var(--webm-action)` is useless in a mail
 * client and `#006abe` is not.
 */
export { renderFooterHtml, renderFooterText, escapeHtml } from './footer.ts';
export { renderSubject, renderTopic, toAsciiSubject } from './subject.ts';
export {
  renderHtml as renderNotificationHtml,
  renderText as renderNotificationText,
} from './submission-notification.ts';
export {
  renderHtml as renderAutoresponseHtml,
  renderText as renderAutoresponseText,
} from './autoresponse.ts';
