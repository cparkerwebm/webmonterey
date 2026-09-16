import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderHtml, renderText } from './submission-notification.ts';

const input = {
  form: 'contact',
  formName: 'Contact',
  fields: [{ label: 'Your name', name: 'name', value: 'Ada' }],
  client: 'Acme Co',
  domain: 'example.com',
  submissionId: 42,
};

test('the client is named above the card', () => {
  const html = renderHtml(input);
  const name = html.indexOf('Acme Co');
  const card = html.indexOf('background-color:#ffffff');
  assert.ok(name !== -1 && card !== -1 && name < card);
});

test('the text part is fields, reference, footer', () => {
  const text = renderText(input);
  assert.ok(text.startsWith('Your name:\nAda\n'));
  assert.ok(text.includes('42'));
  assert.ok(text.includes('Powered by WebMonterey'));
});
