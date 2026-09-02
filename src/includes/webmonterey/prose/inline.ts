/*
 * INLINE TEXT FORMATTING for prose blocks.
 *
 * Page JSON is plain strings, but real copy needs bold lead-ins and links — a privacy policy
 * is almost entirely "**Something.** explanation, see [the policy](/privacy)". Supporting that
 * without shipping a markdown parser is the whole job of this module.
 *
 * The supported subset is deliberately tiny and will not grow without a reason:
 *
 *   **bold**              ->  <strong>bold</strong>
 *   _italic_              ->  <em>italic</em>
 *   [text](/url)          ->  <a href="/url">text</a>
 *
 * ORDER IS LOAD-BEARING. Everything is HTML-escaped FIRST, then the three patterns are
 * applied to the escaped string. Do not reverse this to "parse then escape": the markers are
 * all ASCII punctuation that survives escaping intact, so escaping first costs nothing and
 * means a `<script>` in page JSON is inert no matter what. Page JSON is trusted content —
 * it arrives through a reviewed commit, not a form — but a content model that is safe only
 * while everyone remembers to be careful is not safe.
 *
 * The output is passed to `set:html`, which does NOT sanitise. This module is the sanitiser.
 */

/** Escape the five characters that can break out of text or an attribute value. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/*
 * Schemes allowed in a link. `javascript:` and `data:` are the two that turn a link into
 * script execution, so this is an allowlist rather than a blocklist — a blocklist misses
 * `vbscript:`, control characters inside the scheme, and whatever comes next.
 *
 * A relative URL (`/privacy`, `#section`, `contact`) has no scheme and is always allowed.
 */
const SAFE_SCHEME = /^(https?:|mailto:|tel:)/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed) return null;
  if (!HAS_SCHEME.test(trimmed)) return trimmed; // relative
  return SAFE_SCHEME.test(trimmed) ? trimmed : null;
}

/**
 * Render one string of prose to HTML. Escapes everything, then applies the subset above.
 *
 * A link with an unsafe scheme degrades to its own text — the words survive, the link does
 * not. Silently dropping the whole phrase would lose content the author wrote.
 */
export function renderInline(text: string): string {
  return (
    escapeHtml(text)
      // Links first: their label may itself contain bold, and the URL must not be scanned
      // for emphasis markers (an underscore in a query string is not italic).
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, href: string) => {
        const safe = safeHref(href);
        return safe === null ? label : `<a href="${safe}">${label}</a>`;
      })
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      // Underscores only count as emphasis at a word boundary, so snake_case_identifiers and
      // the underscores inside a URL that already became an href are left alone.
      .replace(/(^|\s)_([^_]+)_(?=$|[\s.,;:!?)])/g, '$1<em>$2</em>')
  );
}
