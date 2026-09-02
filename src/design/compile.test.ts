/*
 * The load-bearing test is the first one: an empty design.json must reproduce webm-astro
 * v1.4.1's tokens.css exactly, value for value.
 *
 * It reads the real file, checked in as a fixture, rather than a copy of defaults.ts - which
 * would make it tautological. Edit defaults.ts and this fails until the fixture is updated
 * deliberately, which is the point. The fixture is frozen history, not a live file.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile, toCss, compileToCss, DesignError } from './compile.ts';

const FIXTURE = new URL('./__fixtures__/tokens-v1.4.1.css', import.meta.url);

/** Pull `--webm-x: value;` pairs out of a stylesheet, ignoring comments. */
function parseTokens(css: string): Map<string, string> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = new Map<string, string>();
  for (const m of withoutComments.matchAll(/(--webm-[\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(m[1]!, m[2]!.trim());
  }
  return out;
}

const flat = (design = {}) => {
  const out = new Map<string, string>();
  for (const g of compile(design)) for (const t of g.tokens) out.set(t.name, t.value);
  return out;
};

test('an empty design.json reproduces tokens.css v1.4.1 exactly', () => {
  const expected = parseTokens(readFileSync(FIXTURE, 'utf8'));
  const actual = flat();

  assert.equal(actual.size, expected.size, 'token count differs from v1.4.1');
  for (const [name, value] of expected) {
    assert.equal(actual.get(name), value, `${name} differs from v1.4.1`);
  }
});

test('the compiled stylesheet round-trips through the same parser', () => {
  const expected = parseTokens(readFileSync(FIXTURE, 'utf8'));
  const actual = parseTokens(compileToCss());
  assert.deepEqual([...actual.entries()].sort(), [...expected.entries()].sort());
});

test('a structured field replaces its token in place', () => {
  const tokens = flat({ color: { action: { base: '#bfb23b' } } });
  assert.equal(tokens.get('--webm-action'), '#bfb23b');
  // Siblings are untouched.
  assert.equal(tokens.get('--webm-action-dark'), '#003e80');
});

test('overrides win over a structured field naming the same token', () => {
  const tokens = flat({
    color: { action: { base: '#111111' } },
    overrides: { '--webm-action': '#222222' },
  });
  assert.equal(tokens.get('--webm-action'), '#222222');
});

test('an override outside the --webm- prefix is a build error', () => {
  assert.throws(
    () => compile({ overrides: { '--brand-color': 'red' } }),
    (e: unknown) =>
      e instanceof DesignError && /must start with --webm-/.test((e as Error).message),
  );
});

test('an override naming an unknown token is kept, in its own group', () => {
  const groups = compile({ overrides: { '--webm-hero-height': '80vh' } });
  const extra = groups.at(-1)!;
  assert.equal(extra.title, 'site tokens');
  assert.deepEqual(extra.tokens, [{ name: '--webm-hero-height', value: '80vh' }]);
});

test('a non-string value is a build error rather than a silent cast', () => {
  assert.throws(
    () => compile({ color: { action: { base: 0x006abe as unknown as string } } }),
    DesignError,
  );
});

test('the layer wrapper is emitted, because membership is what keeps tokens below components', () => {
  const css = compileToCss();
  assert.match(css, /^@layer webm\.tokens \{/);
  assert.match(css, /\n {2}:root \{/);
  assert.ok(css.trimEnd().endsWith('}'));
});

test('group order is preserved on emit', () => {
  const css = toCss(compile());
  const order = [...css.matchAll(/--- ([a-z0-9, -]+?) -+ \*\//g)].map((m) => m[1]);
  assert.equal(order[0], 'base palette');
  assert.equal(order[1], 'action');
  assert.equal(order.at(-1), 'composites');
});
