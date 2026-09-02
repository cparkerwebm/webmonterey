import { test } from 'node:test';
import assert from 'node:assert/strict';

import { escapeHtml, renderFooterHtml, renderFooterText } from './footer.ts';

const input = { client: 'Acme Co', domain: 'example.com' };

test('escapeHtml neutralises the four dangerous characters', () => {
  assert.equal(escapeHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
});

test('escapeHtml escapes the ampersand first', () => {
  // Escaping & last would double-escape the entities the other replacements just produced.
  assert.equal(escapeHtml('&lt;'), '&amp;lt;');
});

test('the text footer is three lines below a leading blank', () => {
  const lines = renderFooterText(input).split('\n');
  assert.equal(lines[0], '');
  assert.equal(lines.length, 4);
  assert.match(lines[1], /^© \d{4} Acme Co$/);
  assert.equal(
    lines[2],
    'This is an automated notification for your account at the example.com website.',
  );
  assert.equal(lines[3], 'Powered by WebMonterey');
});

test('the year is the render year, not a build constant', () => {
  assert.ok(renderFooterText(input).includes(String(new Date().getFullYear())));
});

test('the HTML footer escapes an interpolated client name', () => {
  const html = renderFooterHtml({ client: '<script>alert(1)</script>', domain: 'example.com' });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('the HTML footer escapes an interpolated domain', () => {
  const html = renderFooterHtml({ client: 'Acme', domain: '"onmouseover="x' });
  assert.ok(!html.includes('"onmouseover="x</a>'));
  assert.ok(html.includes('&quot;'));
});

/** The credit link out of the rendered footer, told apart from the client's own site link. */
function creditHref(html: string): string {
  const href = html.match(/href="(https:\/\/webmonterey\.com[^"]*)"/)?.[1];
  assert.ok(href, 'the credit link should be present');
  return href;
}

test('the credit link is tagged as coming from email', () => {
  const href = creditHref(renderFooterHtml(input));
  // The HTML is escaped, so read the params back out of the escaped form.
  assert.match(href, /utm_medium=email/);
  /* Underscored, not dotted: a mail client linkifies a domain inside a query string. */
  assert.match(href, /utm_content=example_com/);
  assert.ok(!href.includes('/credits'), 'the credit link must not reintroduce a /credits path');
});

test("the client's TLD appears nowhere in the email credit URL", () => {
  /*
   * THE assertion that catches the bug this guards. A dotted utm_content is a domain sitting
   * in a query string; a mail client linkifies it and truncates the href there, so the credit
   * link arrives broken. Checked against the query rather than the whole URL because the
   * destination host is webmonterey.com and is allowed to look like a host.
   */
  const { search } = new URL(
    creditHref(renderFooterHtml({ ...input, domain: 'sub.example.co.uk' })),
  );
  assert.equal(search.includes('.uk'), false);
  assert.equal(search.includes('.'), false, 'no dot may reach the query string at all');
  assert.match(search, /utm_content=sub_example_co_uk/);
});

test('both surfaces use the same wording', () => {
  assert.ok(renderFooterText(input).includes('Powered by WebMonterey'));
  assert.ok(renderFooterHtml(input).includes('Powered by WebMonterey'));
});

/*
 * Both footer links open in a new tab.
 *
 * The web component carried `rel="noopener"` and no `target`, which does nothing - noopener only
 * means anything alongside a target - so the credit navigated away from the client's site in the
 * same tab. It was found broken on live sites. These assert the email side cannot regress the
 * same way; the Astro component is covered by a build-output check in examples/minimal.
 */
test('every link in the HTML footer opens in a new tab', () => {
  const html = renderFooterHtml({ client: 'Acme Co', domain: 'acme.com' });
  const anchors = [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(anchors.length >= 2, 'expected the site link and the credit link');
  for (const a of anchors) {
    assert.match(a, /target="_blank"/, `missing target: ${a}`);
    assert.match(a, /rel="[^"]*noopener/, `target without noopener: ${a}`);
  }
});

test('the credit link keeps its referrer - that is the attribution', () => {
  const html = renderFooterHtml({ client: 'Acme Co', domain: 'acme.com' });
  assert.ok(!html.includes('noreferrer'), 'noreferrer would strip the attribution signal');
});
