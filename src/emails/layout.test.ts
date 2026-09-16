import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PAGE_BACKGROUND, renderPageHtml } from './layout.ts';

const input = { client: 'Acme Co', domain: 'example.com', card: '<p>hello</p>' };

test('the background rides on a presentation table, because Gmail drops the body element', () => {
  const html = renderPageHtml(input);
  assert.match(html, /<table role="presentation"[^>]*bgcolor="#f0eeed"/);
  assert.match(html, /<table role="presentation"[^>]*style="[^"]*background-color:#f0eeed/);
  assert.equal(PAGE_BACKGROUND, '#f0eeed');
});

test('the client name is centred above the card', () => {
  const html = renderPageHtml(input);
  const name = html.indexOf('Acme Co');
  const card = html.indexOf('background-color:#ffffff');
  assert.ok(name !== -1 && card !== -1 && name < card);
  assert.match(html.slice(0, card), /<h1[^>]*text-align:center;[^>]*>Acme Co<\/h1>/);
});

test('the client name is escaped', () => {
  const html = renderPageHtml({ ...input, client: '<script>alert(1)</script>' });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('the card content and the footer are inside the page', () => {
  const html = renderPageHtml(input);
  assert.ok(html.includes('<p>hello</p>'));
  assert.ok(html.includes('Powered by WebMonterey'));
});

test('the card is a full-width table inside a max-width div, for Apple Mail and Outlook both', () => {
  const html = renderPageHtml(input);
  const div = html.indexOf('<div style="max-width:640px;margin:0 auto;">');
  const mso = html.indexOf('<!--[if mso]><table role="presentation" width="640"');
  const card = html.indexOf('bgcolor="#ffffff"');
  assert.ok(div !== -1 && mso !== -1 && card !== -1);
  assert.ok(div < mso && mso < card);
  assert.doesNotMatch(
    html,
    /<table[^>]*max-width/,
    'max-width on a table is ignored by Apple Mail',
  );
});

test('no background shorthand and no three-digit hex reach the page', () => {
  const html = renderPageHtml(input);
  assert.doesNotMatch(html, /[^-]background:/);
  assert.doesNotMatch(html, /#[0-9a-fA-F]{3}(?![0-9a-fA-F])/);
});

test('the document has a language, a title and a charset', () => {
  const html = renderPageHtml(input);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<title>Acme Co<\/title>/);
  assert.match(html, /<meta charset="utf-8">/);
});
