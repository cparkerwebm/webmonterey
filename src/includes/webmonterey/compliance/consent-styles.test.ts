/*
 * The consent dialog's layout contract, asserted against the component source.
 *
 * These are not style preferences. A consent dialog where "Reject all" sits below the fold is the
 * shape regulators treat as a dark pattern, and it happened here by accident: `overflow-y: auto`
 * was on the form, which contains the buttons as well as the category list, so on a laptop with
 * four categories the decline and save buttons scrolled out of view.
 *
 * It is asserted on the SOURCE rather than on rendered output because there is no headless
 * browser in this toolchain - so this catches the rule being removed or moved, not a visual
 * regression from some other direction. That limit is worth stating rather than pretending.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE = readFileSync(
  fileURLToPath(new URL('./CookieConsent.astro', import.meta.url)),
  'utf8',
);

/** The declarations of one rule, by selector, with comments stripped. */
function rule(selector: string): string {
  const css = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '');
  const at = css.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `no rule for ${selector}`);
  return css.slice(at, css.indexOf('}', at));
}

test('the action buttons are not inside the scrolling region', () => {
  /*
   * The bug. If the form scrolls, the buttons scroll with it, and a visitor has to scroll a
   * consent dialog to find the way to decline.
   */
  assert.doesNotMatch(
    rule('.webm-consent-dialog__form'),
    /overflow-y:\s*auto/,
    'the form must not be the scroller - the category list is',
  );
  assert.match(rule('.webm-consent-list'), /overflow-y:\s*auto/, 'the list scrolls instead');
});

test('the scroll container can actually shrink', () => {
  /*
   * min-block-size: 0 is load-bearing and looks like noise. A flex item defaults to a minimum of
   * its content size, so without it the list never gets a bounded height, the overflow moves back
   * out to the dialog, and the buttons scroll away again - with the overflow rule still sitting
   * there looking correct.
   */
  assert.match(rule('.webm-consent-list'), /min-block-size:\s*0/);
  assert.match(rule('.webm-consent-dialog__form'), /min-block-size:\s*0/);
});

test('the actions are never compressed instead of the list', () => {
  assert.match(rule('.webm-consent-dialog__actions'), /flex-shrink:\s*0/);
});

test('the dialog is only made a flex container when it is open', () => {
  /*
   * A closed <dialog> is display:none. `display: flex` on the bare element would override that
   * and leave the consent dialog on the page permanently, for every visitor.
   */
  assert.match(rule('.webm-consent-dialog[open]'), /display:\s*flex/);
  assert.doesNotMatch(rule('.webm-consent-dialog'), /display:\s*flex/);
});

test('buttons sit in a row by default, and stack only on a narrow viewport', () => {
  // Three stacked buttons on a desktop banner is what a flattened media query produces.
  assert.match(rule('.webm-consent-banner__actions'), /flex-wrap:\s*wrap/);
  assert.doesNotMatch(rule('.webm-consent-banner__actions'), /flex-direction:\s*column/);
  assert.doesNotMatch(rule('.webm-consent-dialog__actions'), /flex-direction:\s*column/);
});

test('the primary button sets its background and its text color together', () => {
  /*
   * They must live in the same rule. Split across two, an override of one leaves the other -
   * which is exactly how "Accept all" shipped as pale text on a pale background.
   */
  const primary = rule('.webm-consent-btn--primary');
  assert.match(primary, /background-color:\s*var\(--webm-action\)/);
  assert.match(primary, /color:\s*var\(--webm-text-on-action\)/);
});
