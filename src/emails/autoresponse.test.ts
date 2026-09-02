import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderHtml, renderText } from './autoresponse.ts';
import { renderHtml as renderNotificationHtml } from './submission-notification.ts';

const input = {
  body: 'Thanks for getting in touch.',
  fields: [
    { label: 'Your name', name: 'name', value: 'Ada' },
    { label: 'Email address', name: 'email', value: 'ada@example.com' },
  ],
  client: 'Acme Co',
  domain: 'example.com',
};

test('the visitor sees the client-authored copy first', () => {
  assert.ok(renderText(input).startsWith('Thanks for getting in touch.'));
  assert.ok(renderHtml(input).includes('Thanks for getting in touch.'));
});

test('their own submission is echoed back', () => {
  const text = renderText(input);
  assert.ok(text.includes('Your name'));
  assert.ok(text.includes('Ada'));
});

test('it never carries the D1 reference', () => {
  /*
   * The notification includes "Reference: #id" so an enquiry can be found later. This message
   * goes to an address the site does not control, so an internal row id must not ride along.
   * The input type has no submissionId at all — this guards against one being added.
   */
  assert.ok(!renderText(input).includes('Reference'));
  assert.ok(!renderHtml(input).includes('Reference'));

  const notification = renderNotificationHtml({
    form: 'contact',
    formName: 'Contact',
    fields: input.fields,
    client: input.client,
    domain: input.domain,
    submissionId: 42,
  });
  assert.ok(notification.includes('Reference'), 'the notification still carries it');
});

test('the body copy is escaped', () => {
  const html = renderHtml({ ...input, body: '<script>alert(1)</script>' });
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('field values are escaped', () => {
  const html = renderHtml({
    ...input,
    fields: [{ label: 'Name', name: 'name', value: '<img src=x onerror=alert(1)>' }],
  });
  assert.ok(!html.includes('<img src=x'));
});

test('an empty value renders a dash rather than a blank cell', () => {
  const html = renderHtml({
    ...input,
    fields: [{ label: 'Phone', name: 'phone', value: '' }],
  });
  assert.ok(html.includes('&mdash;'));
  assert.ok(
    renderText({ ...input, fields: [{ label: 'Phone', name: 'phone', value: '' }] }).includes('-'),
  );
});

test('it reuses the shared footer', () => {
  assert.ok(renderText(input).includes('Powered by WebMonterey'));
  assert.ok(renderHtml(input).includes('Powered by WebMonterey'));
  assert.ok(renderText(input).includes('Acme Co'));
});

test('both parts are produced for deliverability', () => {
  assert.ok(renderText(input).length > 0);
  assert.ok(renderHtml(input).startsWith('<!doctype html>'));
});
