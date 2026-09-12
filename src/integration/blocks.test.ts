/*
 * The union keeps each member's fields, and the empty case compiles.
 *
 * The type-level half is the point: these assignments are checked by `npm run check`, and the
 * runtime half proves the same shapes parse. No expectTypeOf, no dependency - a value typed
 * `string` that would be `unknown` is a compile error, which is all a type test needs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'astro/zod';
import { blockUnion, pageSchema } from './blocks.ts';

const hero = z.object({ type: z.literal('hero-000001'), heading: z.string() });
const faq = z.object({
  type: z.literal('content-000010'),
  items: z.array(z.object({ q: z.string(), a: z.string() })),
});

test('a union of two schemas narrows on `type` to that member', () => {
  const union = blockUnion([hero, faq]);
  type Block = z.infer<typeof union>;

  const describe = (block: Block): string => {
    if (block.type === 'content-000010') {
      const first: string = block.items[0]?.q ?? '';
      return first;
    }
    const heading: string = block.heading;
    return heading;
  };

  assert.equal(describe({ type: 'hero-000001', heading: 'Hi' }), 'Hi');
  assert.equal(describe({ type: 'content-000010', items: [{ q: 'Q', a: 'A' }] }), 'Q');
  assert.equal(union.safeParse({ type: 'nope' }).success, false, 'a typo is a validation error');
});

test('an empty tuple compiles and rejects every block', () => {
  const union = blockUnion([]);
  type Block = z.infer<typeof union>;
  const impossible: Block[] = [];
  assert.equal(impossible.length, 0);
  assert.equal(union.safeParse({ type: 'hero-000001' }).success, false);
});

test('the page schema keeps blocks typed through the collection entry', () => {
  const page = pageSchema([hero, faq]);
  const parsed = page.parse({
    title: 'Home',
    blocks: [{ type: 'content-000010', items: [{ q: 'Q', a: 'A' }] }],
  });
  const block = parsed.blocks[0]!;
  if (block.type === 'content-000010') {
    const answer: string = block.items[0]!.a;
    assert.equal(answer, 'A');
  } else {
    assert.fail('narrowed to the wrong member');
  }
  assert.equal(parsed.showTitle, true);
  assert.equal(parsed.noindex, false);
});

test('a page with no blocks parses against the empty union, and one block does not', () => {
  const page = pageSchema([]);
  assert.equal(page.parse({ title: 'Fresh' }).blocks.length, 0);
  assert.equal(page.safeParse({ title: 'Fresh', blocks: [{ type: 'x' }] }).success, false);
});

test('noindex, shareImage and its size are declared, so a site need not fork the schema', () => {
  const page = pageSchema([hero]);
  const parsed = page.parse({
    title: 'Thanks',
    noindex: true,
    shareImage: '/cards/thanks.png',
    shareImageWidth: 1280,
    shareImageHeight: 672,
  });
  assert.equal(parsed.noindex, true);
  assert.equal(parsed.shareImage, '/cards/thanks.png');
  assert.equal(parsed.shareImageWidth, 1280);
  assert.equal(parsed.shareImageHeight, 672);
  assert.equal(page.safeParse({ title: 'x', shareImageWidth: 0 }).success, false);
});
