import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from './compile.ts';
import { resolve, emailPalette, ResolveError } from './resolve.ts';
import { brandContext } from './brand.ts';
import type { TokenGroup } from './types.ts';

const group = (tokens: Record<string, string>): TokenGroup[] => [
  { title: 'test', tokens: Object.entries(tokens).map(([name, value]) => ({ name, value })) },
];

test('a var() chain resolves to a literal', () => {
  const out = resolve(
    group({
      '--webm-a': '#123456',
      '--webm-b': 'var(--webm-a)',
      '--webm-c': 'var(--webm-b)',
    }),
  );
  assert.equal(out.get('--webm-c'), '#123456');
});

test('the default set resolves with no var() left anywhere', () => {
  for (const [name, value] of resolve(compile())) {
    assert.ok(!value.includes('var('), `${name} still contains var(): ${value}`);
  }
});

test('a composite with several references resolves all of them', () => {
  const out = resolve(compile());
  assert.equal(out.get('--webm-focus-ring'), '3px solid #006abe');
});

test('a circular reference throws rather than looping', () => {
  assert.throws(
    () => resolve(group({ '--webm-a': 'var(--webm-b)', '--webm-b': 'var(--webm-a)' })),
    (e: unknown) => e instanceof ResolveError && /Circular/.test((e as Error).message),
  );
});

test('an undefined reference with a fallback uses the fallback', () => {
  const out = resolve(group({ '--webm-a': 'var(--webm-missing, 1rem)' }));
  assert.equal(out.get('--webm-a'), '1rem');
});

test('an undefined reference without a fallback throws, rather than emitting empty', () => {
  assert.throws(() => resolve(group({ '--webm-a': 'var(--webm-missing)' })), ResolveError);
});

test('the email palette is literals only, keyed without the prefix', () => {
  const palette = emailPalette(compile({ color: { action: { base: '#bfb23b' } } }));
  assert.equal(palette.action, '#bfb23b');
  assert.equal(palette.link, '#bfb23b', 'link points at action and must arrive resolved');
  for (const [k, v] of Object.entries(palette)) {
    assert.ok(!k.startsWith('--'), `${k} kept its prefix`);
    assert.ok(!v.includes('var('), `${k} still contains var()`);
  }
});

test('the email palette omits fluid sizes no mail client understands', () => {
  for (const v of Object.values(emailPalette(compile()))) {
    assert.ok(!v.includes('clamp('), `a clamp() reached the email palette: ${v}`);
  }
});

test('brand context carries voice and rules alongside a resolved palette', () => {
  const ctx = brandContext({
    brand: { name: 'Autire', voice: 'Direct.', rules: ['Gold is a fill only.'] },
    color: { action: { base: '#bfb23b' } },
    overrides: { '--webm-text-on-action': 'var(--webm-base-700)' },
  });
  assert.equal(ctx.name, 'Autire');
  assert.deepEqual(ctx.rules, ['Gold is a fill only.']);
  assert.equal(ctx.palette.action, '#bfb23b');
  assert.ok(!JSON.stringify(ctx).includes('var('), 'brand context must be fully resolved');
});

test('brand context defaults rules to an empty array, never undefined', () => {
  assert.deepEqual(brandContext().rules, []);
});
