/*
 * The appearance prop, asserted against the component source - there is no headless browser in
 * this toolchain, so this catches the attribute or the modifier being removed, not a rendering
 * regression. examples/minimal builds the widget both ways and checks the output HTML.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE = readFileSync(fileURLToPath(new URL('./Turnstile.astro', import.meta.url)), 'utf8');
const widget = SOURCE.slice(SOURCE.indexOf('<div'), SOURCE.indexOf('</div>'));

test('appearance is a prop with the three Turnstile values, defaulting to always', () => {
  assert.match(SOURCE, /appearance\?: 'always' \| 'execute' \| 'interaction-only';/);
  assert.match(SOURCE, /appearance = 'always',/);
});

test('the attribute is written for a non-default value and omitted for the default', () => {
  /*
   * `undefined` is how Astro omits an attribute. Writing data-appearance="always" would be
   * harmless, but the default markup staying byte-identical is what keeps this change safe on
   * every site that never passes the prop.
   */
  assert.match(widget, /data-appearance=\{appearance === 'always' \? undefined : appearance\}/);
});

test('interaction-only drops the reserved height through a modifier class', () => {
  assert.match(SOURCE, /const quiet = appearance === 'interaction-only';/);
  assert.match(widget, /'webm-turnstile--quiet': quiet/);
  const css = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.webm-turnstile--quiet \{\s*min-block-size: 0;/);
  assert.match(css, /\.webm-turnstile \{\s*min-block-size: 4\.0625rem;/, 'the default keeps it');
});
