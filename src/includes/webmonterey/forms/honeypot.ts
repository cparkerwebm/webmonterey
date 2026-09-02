/*
 * HONEYPOT - a field no human ever fills in.
 *
 * The cheapest bot filter there is: a real text input, rendered off-screen and out of the tab
 * order, that a person never sees and therefore never types into. Naive form spammers fill every
 * input they find, so a non-empty value here is a bot with near-certainty.
 *
 * WHY THIS RATHER THAN A CHALLENGE WIDGET, for a small form: no third-party script, so nothing to
 * consent-gate, no request to another origin, no cost, and nothing for a real visitor to solve.
 * It stops the crude majority and does NOT stop a targeted bot that reads the CSS - Turnstile is
 * the answer to that. The two compose and neither replaces the other, which matters most for a
 * form too small to justify a widget: a newsletter box that mints no Turnstile token has 100% of
 * its sign-ups rejected while looking completely normal.
 *
 * Built independently on two client sites before it was in the package, which is the argument for
 * it being here.
 *
 * EXPORTED FROM THE PACKAGE at `@cparkerwebm/webmonterey/webmonterey/forms`, because the trap is
 * rendered by the site's own form COMPONENT and checked by the package's handler - two halves
 * that must agree on one name. It was unexported until mikeformarina.com's rebuild could not
 * resolve it: without the export a site copies the constant, and the day the default changes the
 * component renders one name while the server checks another. A honeypot that catches nothing is
 * silent, and so is one that catches everyone.
 *
 * THE FIELD NAME IS CONFIGURABLE, and that is not decoration. Bots weight recognisable names, so
 * a URL-shaped one is caught most often - but reserving a single name across a whole fleet means
 * the first client whose form genuinely asks for a website silently has every submission treated
 * as spam. Per-form, defaulting to the name that works.
 */

/** The default. Bots fill a field called `website` reliably; no real form may then use that name. */
export const HONEYPOT_FIELD = 'website';

/**
 * The rendering contract, as a data attribute set. ALL FOUR PARTS MATTER:
 *
 *   the class      off-screen, NOT `display: none` - some bots skip undisplayed inputs
 *   aria-hidden    a screen reader must not announce it
 *   tabindex="-1"  a keyboard user must not land on it
 *   autocomplete   a browser must not helpfully fill it in for someone
 *
 * Get any one of them wrong and it starts catching real people, whose submission then vanishes
 * with a cheerful confirmation - the worst possible failure for a contact form.
 */
export const honeypotAttributes = (name: string = HONEYPOT_FIELD) =>
  ({
    type: 'text',
    name,
    class: 'webm-honeypot',
    'aria-hidden': 'true',
    tabindex: '-1',
    autocomplete: 'off',
    value: '',
  }) as const;

/**
 * True when the honeypot caught something.
 *
 * The caller should answer as though the submission SUCCEEDED rather than showing an error:
 * telling a bot which check it failed is how the next attempt gets past it. That also means a
 * false positive is invisible to the visitor, which is why the rendering contract above is
 * strict.
 */
export function isHoneypotFilled(formData: FormData, name: string = HONEYPOT_FIELD): boolean {
  return String(formData.get(name) ?? '').trim().length > 0;
}
