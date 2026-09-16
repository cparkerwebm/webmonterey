/*
 * The page every transactional email is laid out on: the tinted background, the client's name,
 * the white card, the shared footer. A template supplies the card's content and nothing else.
 *
 * WHAT IS PROVEN AND WHAT IS NOT. Every construct here was chosen against Can I Email's client
 * data and then checked by a real send, because the first version of these templates - a
 * background on <body>, a white <div> card, a styled <a> button - rendered in Apple Mail and
 * arrived in Gmail as black text on white with no tint, no card and an invisible button. Gmail
 * discards the body element, and it dropped the `background` colour on the div and on the link
 * both times it was tried. What it did paint, every time, is a table cell with `bgcolor` and
 * `background-color` together. So:
 *
 *   - COLOUR RIDES ON TABLE CELLS, as `bgcolor` plus `background-color`, six-digit hex, never the
 *     `background` shorthand. The page, the card and the button all do it this way.
 *   - THE CARD IS A 100%-WIDE TABLE INSIDE A MAX-WIDTH DIV, not a table with a max-width of its
 *     own: Apple Mail and iOS Mail ignore `max-width` on a table, per CSS 2.1, and a div is what
 *     constrains them. Outlook for Windows ignores `max-width` on a div, so a conditional-comment
 *     table of a fixed 640 does the same job there and is invisible to every other client.
 *   - THE BUTTON'S PADDING IS ON THE CELL, not the link. Outlook for Windows ignores padding on
 *     an inline element, and a link with no padding on a dark cell is a sliver. The link keeps
 *     `display:inline-block` so it is the whole cell's height where that is honoured.
 *   - `role="presentation"` ON EVERY LAYOUT TABLE, so a screen reader does not announce four
 *     one-cell tables. The data table of submitted fields is a real table and keeps its semantics.
 *
 * THE CLIENT'S NAME IS THE MESSAGE'S ONE HEADING. A visitor's inbox shows the sender as an
 * address on webm.<domain>, and the card opens straight into copy - so, before this line existed,
 * the first thing that said WHO the message was from was the copyright in the footer. It is an
 * <h1> because a message should have one and this is the only line that describes the whole
 * thing; it is set small because the subject line already did the shouting. Text only: the
 * package ships no visible components, and a logo is a per-site asset that would have to be
 * hosted and fetched on every open. HTML only: the plain-text part opens with the copy and its
 * footer already names the client.
 *
 * One module for the same reason footer.ts is one: three templates share this, and copies
 * drift.
 */
import { escapeHtml, renderFooterHtml } from './footer.ts';

export interface EmailPageInput {
  /** The client's display name, from `webmonterey.json`. */
  client: string;
  /** The site's production domain, for the footer. */
  domain: string;
  /** The card's inner HTML, already escaped by the template. */
  card: string;
}

/** The page tint. `--webm-base-300` is the site-side neighbour; there is no var() in a mail client. */
export const PAGE_BACKGROUND = '#f0eeed';

/** The card's width, and the width Outlook for Windows is told in its conditional table. */
const CARD_WIDTH = 640;

const FONT = "system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function renderPageHtml(input: EmailPageInput): string {
  const client = escapeHtml(input.client);
  /*
   * Inline styles throughout: mail clients strip <style>. `lang` on <html> and a <title> are
   * what a screen reader reads first; the charset meta is belt and braces over the MIME header,
   * for a client that saves the part to disk.
   */
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${client}</title>
  </head>
  <body style="margin:0;padding:0;background-color:${PAGE_BACKGROUND};font-family:${FONT};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAGE_BACKGROUND}" style="width:100%;border-collapse:collapse;background-color:${PAGE_BACKGROUND};">
      <tr>
        <td style="padding:24px;">
          <div style="max-width:${CARD_WIDTH}px;margin:0 auto;">
            <!--[if mso]><table role="presentation" width="${CARD_WIDTH}" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
            <h1 style="margin:0;padding:0 32px 12px;text-align:center;font-size:15px;font-weight:600;line-height:1.6;color:#222222;font-family:${FONT};">${client}</h1>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;border-collapse:separate;background-color:#ffffff;border-radius:8px;">
              <tr>
                <td style="padding:32px;font-family:${FONT};">
${input.card}
                </td>
              </tr>
            </table>
${renderFooterHtml({ client: input.client, domain: input.domain })}
            <!--[if mso]></td></tr></table><![endif]-->
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
