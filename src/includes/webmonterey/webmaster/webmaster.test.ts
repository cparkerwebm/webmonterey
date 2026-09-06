import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  AGENCY,
  contentTag,
  CREDIT_TEXT,
  creditUrl,
  introHtml,
  webmasterPageProps,
  WEBMASTER_PATH,
  AGENCY_LINK_ATTRS,
  personalize,
} from './webmaster.ts';
import { DEFAULT_COPY } from '../copy-defaults.ts';

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

/* ── the intro paragraph, as one HTML string for a site that owns the layout ─────────────── */

test('introHtml is before, a space, the agency link, then after', () => {
  const html = introHtml({ before: 'Built by', after: ', a service.' }, 'https://x.test/?a=1&b=2');
  assert.equal(
    html,
    'Built by <a href="https://x.test/?a=1&amp;b=2" target="_blank" rel="noopener">WebMonterey</a>, a service.',
  );
});

test('introHtml escapes the copy and the href', () => {
  const html = introHtml({ before: '<b>a & b</b>', after: '"q"' }, 'https://x.test/?"');
  assert.ok(!html.includes('<b>'), 'copy markup must not pass through');
  assert.ok(html.includes('&lt;b&gt;a &amp; b&lt;/b&gt;'));
  assert.ok(html.includes('href="https://x.test/?&quot;"'));
  assert.ok(html.endsWith('&quot;q&quot;'));
});

const TEXT = {
  title: 'T',
  description: 'D',
  intro: { before: 'Built by', after: ', **really**.' },
  body: ["**If it isn't working, say so.**", 'See [the policy](/privacy).'],
  cta: 'Visit',
};

test('the copy carries the inline prose subset, in the intro and the body', () => {
  const props = webmasterPageProps(TEXT, 'https://x.test/');
  assert.equal(props.title, 'T');
  assert.equal(props.description, 'D');
  assert.ok(props.intro.endsWith('</a>, <strong>really</strong>.'));
  assert.deepEqual(props.body, [
    '<strong>If it isn&#39;t working, say so.</strong>',
    'See <a href="/privacy">the policy</a>.',
  ]);
});

test('the cta is the copy label and the same attributed href the intro links to', () => {
  const props = webmasterPageProps(TEXT, 'https://x.test/?utm_source=client');
  assert.deepEqual(props.cta, { label: 'Visit', href: 'https://x.test/?utm_source=client' });
  assert.match(props.intro, /href="https:\/\/x\.test\/\?utm_source=client"/);
});

/* ── the client's name, so no two sites carry the same paragraph ────────────────────────── */

test('personalize fills {client} and leaves other braces alone', () => {
  assert.equal(personalize('This {client} site, {other}.', 'Acme'), 'This Acme site, {other}.');
});

test('personalize drops the placeholder and its space on an unconfigured site', () => {
  assert.equal(personalize('This {client} custom website', ''), 'This custom website');
  assert.equal(personalize('about the {client} website', ''), 'about the website');
  assert.equal(personalize('{client} is here', ''), 'is here');
});

test('the client name reaches every prop, and is escaped like text', () => {
  const props = webmasterPageProps(
    {
      title: '{client} webmaster',
      description: 'About {client}',
      intro: { before: 'The {client} site, by', after: ', for {client}.' },
      body: ['Ask {client}.'],
      cta: 'Visit, {client}',
    },
    'https://x.test/',
    'Smith & Sons',
  );
  assert.equal(props.title, 'Smith & Sons webmaster');
  assert.equal(props.description, 'About Smith & Sons');
  assert.ok(props.intro.startsWith('The Smith &amp; Sons site, by <a '), props.intro);
  assert.ok(props.intro.endsWith('</a>, for Smith &amp; Sons.'), props.intro);
  assert.deepEqual(props.body, ['Ask Smith &amp; Sons.']);
  assert.equal(props.cta.label, 'Visit, Smith & Sons');
});

test('the default copy names the client in the description, the intro and the contact line', () => {
  const props = webmasterPageProps(DEFAULT_COPY.webmaster, 'https://x.test/', 'Acme Co');
  assert.match(props.description, /^This Acme Co custom website/);
  assert.match(props.intro, /^This Acme Co custom website was designed, built and managed by <a /);
  assert.match(props.body[0]!, /about the Acme Co website/);
  assert.equal(props.cta.label, 'Visit WebMonterey');
});

test('the built-in page renders the same intro string a site layout receives', () => {
  /*
   * One source for the agency link. The page used to build its own <a> in the template, which
   * is how a second copy of the attributes would drift; now both layouts render introHtml. The
   * one <a> the template does write is the button, and its attributes are the spread constant,
   * never typed out.
   */
  const page = readFileSync(new URL('../../../pages/webmaster.astro', import.meta.url), 'utf8');
  const template = page.slice(page.indexOf('---', 3));
  assert.match(template, /<p set:html=\{props\.intro\} \/>/);
  const anchors = template.match(/<a\s[^>]*>/g) ?? [];
  assert.equal(anchors.length, 1, 'the template writes exactly one link: the button');
  assert.match(anchors[0]!, /href=\{props\.cta\.href\}/);
  assert.match(anchors[0]!, /\{\.\.\.AGENCY_LINK_ATTRS\}/);
  assert.doesNotMatch(anchors[0]!, /target=|rel=/, 'attributes come from the constant only');
  assert.deepEqual(AGENCY_LINK_ATTRS, { target: '_blank', rel: 'noopener' });
  const html = introHtml({ before: '', after: '' }, 'https://x.test/');
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener"/);
  assert.doesNotMatch(html, /noreferrer/);
});
