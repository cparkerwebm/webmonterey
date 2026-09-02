import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract, parseTokens } from './design-extract.ts';
import { compileToCss } from '../design/compile.ts';

test('a stylesheet identical to the defaults extracts to an empty design', () => {
  const r = extract(compileToCss());
  assert.equal(r.mapped.length, 0);
  assert.equal(r.overridden.length, 0);
  assert.equal(r.added.length, 0);
  assert.deepEqual(r.design, { version: 1 });
});

test('a changed brand color maps to a structured field, not an override', () => {
  const r = extract(compileToCss({ color: { action: { base: '#bfb23b' } } }));
  assert.deepEqual(r.design.color?.action, { base: '#bfb23b' });
  assert.equal(r.design.overrides, undefined);
  assert.deepEqual(r.mapped, ['--webm-action']);
});

test('a changed token with no structured field falls back to overrides, and is reported', () => {
  const r = extract(compileToCss({ overrides: { '--webm-space-md': '2rem' } }));
  assert.deepEqual(r.design.overrides, { '--webm-space-md': '2rem' });
  assert.deepEqual(r.overridden, ['--webm-space-md']);
  assert.deepEqual(r.added, []);
});

test('a token the system does not define is reported separately as a site token', () => {
  const r = extract(':root { --webm-hero-height: 80vh; }');
  assert.deepEqual(r.added, ['--webm-hero-height']);
  assert.deepEqual(r.design.overrides, { '--webm-hero-height': '80vh' });
});

test('extraction round-trips: extract then compile reproduces the input', () => {
  const original = compileToCss({
    color: { action: { base: '#bfb23b' }, base: { '700': '#2f3030' } },
    font: { sans: '"DM Sans", system-ui, sans-serif' },
    overrides: { '--webm-space-md': '2rem', '--webm-hero-height': '80vh' },
  });
  const rebuilt = compileToCss(extract(original).design);
  assert.deepEqual(parseTokens(rebuilt), parseTokens(original));
});

test('comments are ignored, so a commented-out token is not extracted', () => {
  const r = extract(':root { /* --webm-action: #ff0000; */ --webm-action: #00ff00; }');
  assert.equal(r.design.color?.action?.base, '#00ff00');
});

test('a token overridden inside @media does not overwrite its base value', () => {
  /*
   * THE MIGRATION BUG. The old parser was a flat regex, last-write-wins, so the reduced-motion
   * override became the site's real value. Converting webmonterey.com that way wrote
   * --webm-duration-fast: 0ms as the base: every animation disabled for every visitor, from a
   * command that printed success.
   */
  const css = `
    @layer webm.tokens {
      :root {
        --webm-duration-fast: 140ms;
        --webm-chrome-inset: var(--webm-space-16);
      }
      @media (prefers-reduced-motion: reduce) {
        :root { --webm-duration-fast: 0ms; }
      }
      @media (width < 48rem) {
        :root { --webm-chrome-inset: var(--webm-space-sm); }
      }
    }
  `;
  const { base, conditional } = parseTokens(css);

  assert.equal(base.get('--webm-duration-fast'), '140ms', 'the REAL value, not the media override');
  assert.equal(base.get('--webm-chrome-inset'), 'var(--webm-space-16)');
  assert.ok(conditional.has('--webm-duration-fast'), 'the override is reported, not lost');
  assert.match(conditional.get('--webm-duration-fast')!.join(' '), /prefers-reduced-motion/);
  assert.match(conditional.get('--webm-chrome-inset')!.join(' '), /width < 48rem/);
});

test('a conditional-only token never becomes a base value', () => {
  const css = `
    :root { --webm-action: #006abe; }
    @media print { :root { --webm-action: #000000; } }
  `;
  const { base, conditional } = parseTokens(css);
  assert.equal(base.get('--webm-action'), '#006abe');
  assert.deepEqual(conditional.get('--webm-action'), ['@media print']);
});

test('extract reports the conditional tokens it could not carry across', () => {
  const result = extract(`
    :root { --webm-duration-fast: 140ms; }
    @media (prefers-reduced-motion: reduce) { :root { --webm-duration-fast: 0ms; } }
  `);
  assert.equal(result.design.overrides?.['--webm-duration-fast'], '140ms');
  assert.ok(result.conditional.has('--webm-duration-fast'));
});
