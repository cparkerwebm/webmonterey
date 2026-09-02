/*
 * Subject lines for transactional email.
 *
 * FORMAT:  [Client Name] Topic
 *
 * The bracketed prefix is applied HERE rather than written into each form's `notify.subject`,
 * so a form definition only ever states its topic. Putting it in the JSON would make it a
 * thing to remember for every new form and every new client site, and the first one forgotten
 * is invisible until a client's inbox rules quietly stop matching.
 *
 * The prefix is the CLIENT NAME, not the domain — it is read by a person triaging their inbox,
 * and "[Steven Glaze]" sorts and scans better than "[stevenglaze.com]".
 */

/**
 * Force a subject fragment to single-line ASCII.
 *
 * TWO reasons, and the second one matters more than it looks:
 *
 * 1. A non-ASCII subject has to be MIME encoded-word encoded, and anything that fails to
 *    decode it shows the recipient a raw `=?UTF-8?Q?...?=`. Visitor input reaches this
 *    string through `{{name}}`-style placeholders, so a smart quote pasted out of Word is
 *    enough to trigger it.
 *
 * 2. A subject is a mail HEADER. A CR or LF inside one is the classic header-injection
 *    vector — it ends the Subject: header early and lets whatever follows be read as a new
 *    header (Bcc:, say). Mailgun's form-encoded API makes that unlikely to reach the wire,
 *    but the correct place to be sure is where untrusted text enters a header, not one layer
 *    down in someone else's parser.
 *
 * Accents are transliterated rather than dropped, so "José" reads as "Jose" and not "Jos".
 */
export function toAsciiSubject(value: string): string {
  return (
    value
      // Decompose accented characters into base letter + combining mark, then drop the marks.
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      // Punctuation NFKD leaves alone but that is still not ASCII.
      .replace(/[‘’‚‛]/g, "'")
      .replace(/[“”„‟]/g, '"')
      .replace(/[–—―]/g, '-')
      .replace(/…/g, '...')
      .replace(/[   ]/g, ' ')
      // Anything left outside printable ASCII, including CR/LF and other control characters.
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Replace `{{field}}` placeholders in a topic template.
 * An unmatched placeholder becomes an empty string rather than being left visible.
 */
export function renderTopic(
  template: string,
  fields: Array<{ name: string; value: string }>,
): string {
  return template.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_match, key: string) => {
    return fields.find((f) => f.name === key)?.value ?? '';
  });
}

/**
 * Build the full subject line: `[Client Name] Topic`.
 *
 * The prefix is omitted entirely rather than rendered as `[CHANGEME]` on an unconfigured
 * starter — see the callers' handling in src/actions/index.ts.
 */
export function renderSubject(
  client: string | null,
  topicTemplate: string,
  fields: Array<{ name: string; value: string }>,
): string {
  const topic = toAsciiSubject(renderTopic(topicTemplate, fields));
  const prefix = client ? toAsciiSubject(client) : '';

  return prefix ? `[${prefix}] ${topic}`.trim() : topic;
}
