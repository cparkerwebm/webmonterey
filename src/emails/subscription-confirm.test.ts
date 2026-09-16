import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHtml, renderText } from './subscription-confirm.ts';

const input = {
  body: 'Confirm to hear from Acme & Co.',
  button: 'Confirm subscription',
  confirmUrl: 'https://acme.com/subscribe/confirm?t=a-b_c',
  client: 'Acme & Co',
  domain: 'acme.com',
};

test('the plain-text part is the copy, the label and the bare URL, then the footer', () => {
  const text = renderText(input);
  assert.match(
    text,
    /^Confirm to hear from Acme & Co\.\n\nConfirm subscription:\nhttps:\/\/acme\.com\/subscribe\/confirm\?t=a-b_c\n/,
  );
  assert.match(text, /© \d{4} Acme & Co/);
});

test('the HTML part links the URL twice - a button and the bare link - and escapes everything', () => {
  const html = renderHtml(input);
  const links = html.match(/href="https:\/\/acme\.com\/subscribe\/confirm\?t=a-b_c"/g) ?? [];
  assert.equal(links.length, 2);
  assert.match(html, /Acme &amp; Co\./);
  assert.doesNotMatch(html, /<script|<form/i);
  assert.doesNotMatch(html, /unsubscribe/i, 'nothing to unsubscribe from yet');
});

test('the client is named above the card', () => {
  const html = renderHtml(input);
  const name = html.indexOf('Acme &amp; Co');
  const card = html.indexOf('background-color:#ffffff');
  assert.ok(name !== -1 && card !== -1 && name < card);
});

test('the button is a coloured cell with the padding on the cell, not the link', () => {
  const html = renderHtml(input);
  assert.match(
    html,
    /<td bgcolor="#222222" style="padding:12px 20px;background-color:#222222;[^"]*">\s*<a href="https:\/\/acme\.com[^"]*" style="display:inline-block;color:#ffffff;/,
  );
});
