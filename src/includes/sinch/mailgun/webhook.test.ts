import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { classifyEvent, verifyWebhookSignature } from './webhook.ts';

const KEY = 'key-webhook-signing';
const sign = (timestamp: string, token: string) =>
  createHmac('sha256', KEY)
    .update(timestamp + token)
    .digest('hex');

test('a genuine signature verifies; a wrong key, a tampered field, or a missing part does not', async () => {
  const sig = { timestamp: '1700000000', token: 'abc123', signature: sign('1700000000', 'abc123') };
  assert.equal(await verifyWebhookSignature(sig, KEY), true);
  assert.equal(await verifyWebhookSignature(sig, 'another-key'), false);
  assert.equal(await verifyWebhookSignature({ ...sig, token: 'abc124' }, KEY), false);
  assert.equal(await verifyWebhookSignature({ ...sig, signature: undefined }, KEY), false);
  assert.equal(await verifyWebhookSignature(undefined, KEY), false);
  assert.equal(await verifyWebhookSignature({ ...sig, signature: 'zz' }, KEY), false);
  assert.equal(
    await verifyWebhookSignature({ ...sig, signature: sig.signature.toUpperCase() }, KEY),
    true,
  );
});

test('only unsubscribed, complained and a PERMANENT failure change a subscriber', () => {
  assert.deepEqual(classifyEvent({ event: 'unsubscribed', recipient: 'A@X.com' }), {
    recipient: 'a@x.com',
    reason: 'provider',
  });
  assert.deepEqual(classifyEvent({ event: 'complained', recipient: 'a@x.com' }), {
    recipient: 'a@x.com',
    reason: 'complaint',
  });
  assert.deepEqual(
    classifyEvent({ event: 'failed', severity: 'permanent', recipient: 'a@x.com' }),
    {
      recipient: 'a@x.com',
      reason: 'bounce',
    },
  );
  assert.equal(
    classifyEvent({ event: 'failed', severity: 'temporary', recipient: 'a@x.com' }),
    null,
  );
  assert.equal(classifyEvent({ event: 'delivered', recipient: 'a@x.com' }), null);
  assert.equal(classifyEvent({ event: 'unsubscribed' }), null);
  assert.equal(classifyEvent(null), null);
});
