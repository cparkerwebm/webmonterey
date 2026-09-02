/*
 * The rebuild comparison. Each layer exists because the one before it missed something real.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { visibleText, headTags, jsonLd, cssDeclarations, compare } from './compare.ts';

test('visible text ignores scripts, styles and comments', () => {
  const html = `<html><head><style>.a{color:red}</style></head>
    <body><!-- hidden --><script>var x=1</script><p>Hello there</p></body></html>`;
  assert.equal(visibleText(html), 'Hello there');
});

test('text alone would have passed a rebuild that lost its typeface', () => {
  /*
   * THIS IS WHY THERE ARE FOUR LAYERS. On the webmonterey.com rebuild, comparing text reported
   * "identical on every page" while the site had silently stopped loading its self-hosted font -
   * every word present, in the wrong face. The words are the same here too.
   */
  const before = `<html><head><link rel="stylesheet" href="/a.css"></head><body><p>Same words</p></body></html>`;
  const after = `<html><head></head><body><p>Same words</p></body></html>`;
  assert.equal(visibleText(before), visibleText(after), 'text cannot see it');
  assert.notDeepEqual(headTags(before), headTags(after), 'the head layer can');
});

test('head tags are order-independent, because head order is not meaningful', () => {
  const a = `<head><meta name="a" content="1"><link rel="canonical" href="/x"></head>`;
  const b = `<head><link rel="canonical" href="/x"><meta name="a" content="1"></head>`;
  assert.deepEqual(headTags(a), headTags(b));
});

test('a changed canonical is caught', () => {
  const a = `<head><link rel="canonical" href="/x"></head>`;
  const b = `<head><link rel="canonical" href="/y"></head>`;
  assert.notDeepEqual(headTags(a), headTags(b));
});

test('JSON-LD is compared as parsed data, not as text', () => {
  // Key order and whitespace change between builds and mean nothing.
  const a = `<script type="application/ld+json">{"a":1,"b":2}</script>`;
  const b = `<script type="application/ld+json">{"a":1,"b":2}</script>`;
  assert.equal(jsonLd(a), jsonLd(b));
  const c = `<script type="application/ld+json">{"a":1}</script>`;
  assert.notEqual(jsonLd(a), jsonLd(c));
});

test('malformed JSON-LD does not throw, it falls back to raw text', () => {
  const bad = `<script type="application/ld+json">{not json</script>`;
  assert.match(jsonLd(bad), /not json/);
});

test('bundler hashes in asset URLs are not a difference', () => {
  /*
   * The hash is content-derived and changes every build. Without stripping it, every stylesheet
   * and script tag reads as both missing and added on a rebuild that changed nothing - and a
   * comparison tool that cries wolf on every run is one nobody reads.
   */
  const a = `<head><link rel="stylesheet" href="/_astro/base.D8TeHbgD.css"></head>`;
  const b = `<head><link rel="stylesheet" href="/_astro/base.B7aTneAO.css"></head>`;
  assert.deepEqual(headTags(a), headTags(b));
});

test('a genuinely different stylesheet is still caught', () => {
  const a = `<head><link rel="stylesheet" href="/_astro/base.AAAAAAAA.css"></head>`;
  const b = `<head><link rel="stylesheet" href="/_astro/other.BBBBBBBB.css"></head>`;
  assert.notDeepEqual(headTags(a), headTags(b), 'the NAME differs, not just the hash');
});

test('CSS is gathered from inline <style> as well as from files', () => {
  /*
   * Astro inlines a small stylesheet into the HTML instead of emitting a file, and which way it
   * goes depends on size - so the same rule sits in _astro/*.css on one build and inside <style>
   * on the next. Reading only the files reported a whole component stylesheet as missing when it
   * had simply moved, on a rebuild that was correct.
   */
  const dir = mkdtempSync(join(tmpdir(), 'webm-cmp-'));
  mkdirSync(join(dir, '_astro'), { recursive: true });
  writeFileSync(join(dir, '_astro', 'a.css'), '.from-file{color:red}');
  writeFileSync(
    join(dir, 'index.html'),
    '<html><head><style>.inlined{padding:1rem}</style></head></html>',
  );

  const decls = cssDeclarations(dir);
  assert.ok(
    [...decls].some((d) => d.includes('color:red')),
    'the file',
  );
  assert.ok(
    [...decls].some((d) => d.includes('padding:1rem')),
    'and the inline block',
  );
});

test('a build that only GAINS css declarations is not a regression', () => {
  /*
   * The case that nearly cost the tool its credibility. A package upgrade adds declarations and
   * removes none, and the old summary line said "no differences in ... CSS" - which is false, and
   * false in the direction that makes you doubt a working tool. Worse, it hides the evidence that
   * an upgrade landed at all.
   */
  const dir = mkdtempSync(join(tmpdir(), 'cmp-'));
  const oldDist = join(dir, 'old');
  const newDist = join(dir, 'new');
  for (const d of [oldDist, newDist]) mkdirSync(join(d, '_astro'), { recursive: true });

  writeFileSync(join(oldDist, 'index.html'), '<html><body><p>Same words</p></body></html>');
  writeFileSync(join(newDist, 'index.html'), '<html><body><p>Same words</p></body></html>');
  writeFileSync(join(oldDist, '_astro', 'a.css'), 'a{color:red}');
  writeFileSync(join(newDist, '_astro', 'a.css'), 'a{color:red}b{outline:1px solid blue}');

  const diffs = compare(oldDist, newDist);
  assert.equal(diffs.length, 1, 'the gain is reported');
  assert.equal(diffs[0]!.info, true, 'but it is not a regression');
  assert.deepEqual(diffs[0]!.missing, [], 'nothing was lost');
  assert.ok(
    diffs[0]!.added.some((d) => d.includes('outline:1px solid blue')),
    'and the new declaration is named, so you can see the upgrade landed',
  );

  rmSync(dir, { recursive: true, force: true });
});

test('a lost declaration is still a regression even when others are gained', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cmp-'));
  const oldDist = join(dir, 'old');
  const newDist = join(dir, 'new');
  for (const d of [oldDist, newDist]) mkdirSync(join(d, '_astro'), { recursive: true });

  writeFileSync(join(oldDist, 'index.html'), '<html><body><p>Same words</p></body></html>');
  writeFileSync(join(newDist, 'index.html'), '<html><body><p>Same words</p></body></html>');
  writeFileSync(join(oldDist, '_astro', 'a.css'), '@font-face{src:url(x.woff2)}');
  writeFileSync(join(newDist, '_astro', 'a.css'), 'b{outline:1px solid blue}');

  const diffs = compare(oldDist, newDist);
  const css = diffs.find((d) => d.layer === 'css')!;
  assert.notEqual(css.info, true, 'a loss is never downgraded to information');
  assert.ok(css.missing.some((d) => d.includes('url(x.woff2)')));

  rmSync(dir, { recursive: true, force: true });
});
