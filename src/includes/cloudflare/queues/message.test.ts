import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitsQueue, MAX_MESSAGE_BYTES, queueNames } from './message.ts';

test('a form submission fits; something absurd does not', () => {
  assert.equal(
    fitsQueue({ kind: 'form.notify', fields: [{ name: 'message', value: 'hi' }] }),
    true,
  );
  assert.equal(fitsQueue({ kind: 'x', blob: 'a'.repeat(MAX_MESSAGE_BYTES) }), false);
});

test('the queue and its dead-letter queue are the slug and the slug with a purpose suffix', () => {
  assert.deepEqual(queueNames('example'), { queue: 'example', deadLetter: 'example-dlq' });
});
