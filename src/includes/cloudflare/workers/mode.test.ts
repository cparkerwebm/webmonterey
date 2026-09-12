import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindingMode, bindingName } from './mode.ts';

test('a staging environment reads the _TEST value, whatever the host', () => {
  assert.equal(bindingMode('staging', 'example.com'), 'test');
  assert.equal(bindingMode('staging', null), 'test');
});

test('a workers.dev host reads the _TEST value even in production', () => {
  assert.equal(bindingMode('production', 'example.webmonterey.workers.dev'), 'test');
});

test('a custom domain in production reads the live value', () => {
  assert.equal(bindingMode('production', 'example.com'), 'live');
  assert.equal(bindingMode('production', null), 'live', 'a cron has no hostname and is live');
});

test('a host that merely ends in "notworkers.dev" is live - the label rule, not a substring', () => {
  assert.equal(bindingMode('production', 'notworkers.dev'), 'live');
});

test('the name carries the suffix at the END, so the pair sorts together', () => {
  assert.equal(bindingName('STRIPE_SECRET_KEY', 'test'), 'STRIPE_SECRET_KEY_TEST');
  assert.equal(bindingName('STRIPE_SECRET_KEY', 'live'), 'STRIPE_SECRET_KEY');
});
