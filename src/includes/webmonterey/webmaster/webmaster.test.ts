import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { AGENCY, contentTag, CREDIT_TEXT, creditUrl, WEBMASTER_PATH } from './webmaster.ts';

/*
 * Webmaster.astro read as SOURCE, because it cannot be imported here: an .astro file only
 * resolves inside an Astro build. A source assertion is the weaker tool and it is the one
 * available.
 */
const componentSource = readFileSync(new URL('./Webmaster.astro', import.meta.url), 'utf8');
const template = componentSource.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');
const anchors: string[] = template.match(/<a\s[^>]*>/g) ?? [];
const anchor = (): string => anchors[0] ?? '';

test('creditUrl points at the agency home page, not a /credits page', () => {
  const url = new URL(creditUrl('example.com'));
  assert.equal(url.origin, 'https://webmonterey.com');
  assert.equal(url.pathname, '/');
});

test('creditUrl carries all four UTM parameters', () => {
  const { searchParams } = new URL(creditUrl('example.com'));
  assert.equal(searchParams.get('utm_source'), 'client');
  assert.equal(searchParams.get('utm_campaign'), 'webmaster');
  assert.equal(searchParams.get('utm_content'), 'example_com');
});

test('utm_medium separates the two surfaces, and defaults to website', () => {
  assert.equal(
    new URL(creditUrl('example.com', 'website')).searchParams.get('utm_medium'),
    'website',
  );
  assert.equal(new URL(creditUrl('example.com', 'email')).searchParams.get('utm_medium'), 'email');
  assert.equal(new URL(creditUrl('example.com')).searchParams.get('utm_medium'), 'website');
});

test('utm_content is the production domain, with every dot as an underscore', () => {
  const url = new URL(creditUrl('sub.example.co.uk', 'email'));
  assert.equal(url.searchParams.get('utm_content'), 'sub_example_co_uk');
  /* Scoped to the query: the destination host is allowed to look like a host. */
  assert.equal(url.search.includes('.'), false);
});

test('contentTag changes nothing but the dots', () => {
  assert.equal(contentTag('localhost'), 'localhost');
  assert.equal(contentTag('steven-glaze.com'), 'steven-glaze_com');
});

test('CREDIT_TEXT is the shared wording', () => {
  assert.equal(CREDIT_TEXT, 'Powered by WebMonterey');
});

test('the agency identity is internally consistent', () => {
  assert.ok(AGENCY.id.startsWith(AGENCY.url), 'the @id lives on the agency origin');
  assert.ok(AGENCY.sameAs.every((u) => u.startsWith('https://')));
  assert.equal(new Set(AGENCY.sameAs).size, AGENCY.sameAs.length, 'no duplicate profile');
});

/* ── the footer credit: an INTERNAL link now ──────────────────────────────────────────────── */

test("the site credit renders exactly one link, to the site's own webmaster page", () => {
  assert.equal(anchors.length, 1, `expected one anchor, found ${anchors.length}`);
  assert.match(anchor(), new RegExp(`href=\\{WEBMASTER_PATH\\}`));
  assert.equal(WEBMASTER_PATH, '/webmaster');
});

test('an internal link does not open a new tab and carries no rel', () => {
  // The old outbound credit opened a new tab; an internal link that did would be a bug.
  assert.doesNotMatch(anchor(), /target=/);
  assert.doesNotMatch(anchor(), /rel=/);
  assert.doesNotMatch(template, /opens in a new tab/);
});
