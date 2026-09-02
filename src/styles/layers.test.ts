import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LAYERS, LAYER_STATEMENT } from './layers.ts';

/** The @layer statement in global.css, normalized to a single line. */
function statementFrom(path: string): string {
  const css = readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const m = css.match(/@layer\s+([^;]+);/);
  assert.ok(m, `no @layer statement found in ${path}`);
  return m[1]!
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ');
}

test('global.css declares exactly the layers in layers.ts, in order', () => {
  assert.equal(statementFrom('./global.css'), LAYERS.join(', '));
});

test('the statement puts tokens above reset and below components', () => {
  const i = (n: string) => LAYERS.indexOf(n as (typeof LAYERS)[number]);
  assert.ok(i('webm.reset') < i('webm.tokens'), 'reset must not beat tokens');
  assert.ok(i('webm.tokens') < i('webm.components.core'), 'tokens must lose to components');
  assert.ok(i('webm.components.core') < i('webm.components.custom'), 'the client seam must win');
  assert.ok(i('webm.overrides') === LAYERS.length - 1, 'overrides is the last word');
});

test('LAYER_STATEMENT is a single valid statement', () => {
  assert.match(LAYER_STATEMENT, /^@layer [\w., ]+;$/);
});
