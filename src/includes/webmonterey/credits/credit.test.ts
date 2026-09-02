import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { contentTag, CREDIT_TEXT, creditUrl } from './credit.ts';

/*
 * Credit.astro read as SOURCE, because it cannot be imported here: it pulls in ../site.ts, which
 * imports virtual:webm/site, which only resolves inside an Astro build. A source assertion is the
 * weaker tool and it is the one available - and the alternative in place until now was nothing.
 *
 * WHY IT NEEDS ONE AT ALL. This anchor once carried rel="noopener" and no target, which does
 * nothing whatsoever - noopener only means anything alongside a target - so the credit navigated
 * the visitor away from the client's site in the same tab. That shipped to live sites. The
 * regression test written afterwards guards the EMAIL footer, in emails/footer.test.ts; the
 * component where the bug actually happened had no test until this one.
 */
const componentSource = readFileSync(new URL('./Credit.astro', import.meta.url), 'utf8');
/** The template with its {/* *\/} comment blocks removed, so prose about the rule is not read as the rule. */
const template = componentSource.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');
const anchors: string[] = template.match(/<a\s[^>]*>/g) ?? [];
/** The single credit anchor. Asserted to be the only one below. */
const anchor = (): string => anchors[0] ?? '';

test('creditUrl points at the main site, not a /credits page', () => {
  const url = new URL(creditUrl('example.com'));
  assert.equal(url.origin, 'https://webmonterey.com');
  assert.equal(url.pathname, '/', 'the credit link must not reintroduce a /credits path');
});

test('creditUrl carries all four UTM parameters', () => {
  const { searchParams } = new URL(creditUrl('example.com'));
  assert.equal(searchParams.get('utm_source'), 'client');
  assert.equal(searchParams.get('utm_campaign'), 'credits');
  assert.equal(searchParams.get('utm_content'), 'example_com');
});

test('utm_medium separates the two surfaces', () => {
  const site = new URL(creditUrl('example.com', 'website'));
  const email = new URL(creditUrl('example.com', 'email'));
  assert.equal(site.searchParams.get('utm_medium'), 'website');
  assert.equal(email.searchParams.get('utm_medium'), 'email');
});

test('utm_medium defaults to website', () => {
  assert.equal(new URL(creditUrl('example.com')).searchParams.get('utm_medium'), 'website');
});

test('utm_content is the production domain, with every dot as an underscore', () => {
  // Not the host the page is served from — a preview build must not fragment attribution.
  const url = new URL(creditUrl('sub.example.co.uk', 'email'));
  assert.equal(url.searchParams.get('utm_content'), 'sub_example_co_uk');
});

test('both surfaces tag the same client the same way', () => {
  const site = new URL(creditUrl('example.com', 'website'));
  const email = new URL(creditUrl('example.com', 'email'));
  assert.equal(site.searchParams.get('utm_content'), email.searchParams.get('utm_content'));
});

test('no dot survives into the credit URL, so nothing can linkify it', () => {
  const url = new URL(creditUrl('example.com', 'email'));
  assert.equal(url.searchParams.get('utm_content'), 'example_com');
  /*
   * Scoped to the QUERY STRING, not the whole URL: the destination host is webmonterey.com
   * and is allowed to look like a host. It is the parameter value that must not.
   */
  assert.equal(url.search.includes('.'), false);
});

test('contentTag leaves a domain that has no dots alone', () => {
  assert.equal(contentTag('localhost'), 'localhost');
});

test('contentTag changes nothing but the dots', () => {
  // The value still has to be recognisably the site it came from in the report.
  assert.equal(contentTag('steven-glaze.com'), 'steven-glaze_com');
});

test('CREDIT_TEXT is the shared wording', () => {
  assert.equal(CREDIT_TEXT, 'Powered by WebMonterey');
});

/* ── the footer credit's link, mirroring emails/footer.test.ts ────────────────────────────── */

test('the site credit renders exactly one link', () => {
  assert.equal(anchors.length, 1, `expected one anchor, found ${anchors.length}`);
});

test('the site credit opens in a new tab', () => {
  // The half that was missing. Without it the visitor leaves the client's site to read ours.
  assert.match(anchor(), /target="_blank"/);
});

test('the new tab cannot reach back into the client page', () => {
  assert.match(anchor(), /rel="[^"]*noopener/);
});

/*
 * Locking a decision rather than an implementation detail: the referrer IS the attribution, so
 * stripping it would leave only utm_content. This is the kind of thing someone adds in good faith
 * while "hardening" a target=_blank link.
 */
test('the credit link deliberately does not send noreferrer', () => {
  assert.doesNotMatch(anchor(), /noreferrer/);
});

test('the new tab is announced, not just implemented', () => {
  // A link that moves the user to another tab without saying so is a semantics bug.
  assert.match(template, /webm-visually-hidden[^>]*>\s*\(opens in a new tab\)/);
});
