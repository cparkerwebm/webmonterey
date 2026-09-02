import { test } from 'node:test';
import assert from 'node:assert/strict';

import { escapeHtml, renderInline } from './inline.ts';

/*
 * This module is the sanitiser for everything passed to `set:html` in a prose block, so the
 * escaping tests below are the load-bearing ones. Page JSON is trusted content, but "trusted"
 * is a property of today's workflow, not of the code.
 */

test('escapeHtml covers the five characters that break out', () => {
  assert.equal(escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});

test('markup in page JSON is rendered inert', () => {
  assert.equal(renderInline('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('an img onerror payload cannot escape', () => {
  const out = renderInline('<img src=x onerror=alert(1)>');
  assert.ok(!out.includes('<img'));
  assert.ok(out.startsWith('&lt;img'));
});

test('bold becomes strong', () => {
  assert.equal(renderInline('**Essential** — always on'), '<strong>Essential</strong> — always on');
});

test('italic becomes em', () => {
  assert.equal(renderInline('it is _essential_ here'), 'it is <em>essential</em> here');
});

test('underscores inside a word are left alone', () => {
  assert.equal(renderInline('snake_case_name stays'), 'snake_case_name stays');
});

test('a relative link is kept', () => {
  assert.equal(renderInline('[policy](/privacy)'), '<a href="/privacy">policy</a>');
});

test('an anchor and a mailto are kept', () => {
  assert.equal(renderInline('[top](#top)'), '<a href="#top">top</a>');
  assert.equal(renderInline('[mail](mailto:a@b.com)'), '<a href="mailto:a@b.com">mail</a>');
});

test('an https link is kept', () => {
  assert.equal(
    renderInline('[cf](https://cloudflare.com)'),
    '<a href="https://cloudflare.com">cf</a>',
  );
});

test('a javascript: link degrades to its own text', () => {
  // The words the author wrote survive; the link does not.
  const out = renderInline('[click](javascript:alert%281%29)');
  assert.ok(!out.includes('<a '));
  assert.ok(!out.includes('javascript:'));
  assert.ok(out.includes('click'));
});

test('a data: link degrades to its own text', () => {
  const out = renderInline('[x](data:text/html;base64,PHNjcmlwdD4=)');
  assert.ok(!out.includes('<a '));
  assert.ok(!out.includes('data:'));
});

test('an unknown scheme is refused — allowlist, not blocklist', () => {
  assert.ok(!renderInline('[x](vbscript:msgbox)').includes('<a '));
});

test('a quote in a URL cannot break out of the href attribute', () => {
  const out = renderInline('[x](/a"onmouseover="alert(1))');
  assert.ok(!out.includes('onmouseover="alert'));
  assert.ok(out.includes('&quot;'));
});

test('underscores in a URL are not treated as emphasis', () => {
  assert.equal(
    renderInline('[link](https://x.com/a_b_c)'),
    '<a href="https://x.com/a_b_c">link</a>',
  );
});

test('bold and a link compose in one string', () => {
  assert.equal(
    renderInline('**Cloudflare** — see [docs](https://cf.com).'),
    '<strong>Cloudflare</strong> — see <a href="https://cf.com">docs</a>.',
  );
});

test('plain text passes through unchanged', () => {
  assert.equal(renderInline('Just a sentence.'), 'Just a sentence.');
});
