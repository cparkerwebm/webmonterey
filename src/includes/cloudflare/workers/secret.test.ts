import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBound, isSecretsStoreBinding, readSecret } from './secret.ts';

test('a Worker secret - a string on env - is returned as it is', async () => {
  assert.equal(await readSecret({ MAILGUN_API_KEY: 'key-123' }, 'MAILGUN_API_KEY'), 'key-123');
});

test('a Secrets Store binding - an object with get() - is read with get()', async () => {
  let calls = 0;
  const env = {
    MAILGUN_WEBHOOK_SIGNING_KEY: {
      get: async () => {
        calls += 1;
        return 'from-the-store';
      },
    },
  };
  assert.equal(await readSecret(env, 'MAILGUN_WEBHOOK_SIGNING_KEY'), 'from-the-store');
  assert.equal(calls, 1);
});

test('a missing binding throws, naming the secret and both ways to set it', async () => {
  await assert.rejects(readSecret({}, 'TURNSTILE_SECRET_KEY'), (error: Error) => {
    assert.match(error.message, /Missing Cloudflare binding or secret "TURNSTILE_SECRET_KEY"/);
    assert.match(error.message, /wrangler secret put TURNSTILE_SECRET_KEY/);
    assert.match(error.message, /secrets_store_secrets/);
    return true;
  });
  await assert.rejects(readSecret({ X: '' }, 'X'), /Missing Cloudflare binding or secret "X"/);
});

test('a Secrets Store binding with no secret behind it names the local create command', async () => {
  const env = {
    STRIPE_SECRET_KEY: {
      get: async () => {
        throw new Error('Secret "STRIPE_SECRET_KEY" not found');
      },
    },
  };
  await assert.rejects(readSecret(env, 'STRIPE_SECRET_KEY'), (error: Error) => {
    assert.match(error.message, /binding "STRIPE_SECRET_KEY" has no secret behind it/);
    assert.match(error.message, /Secret "STRIPE_SECRET_KEY" not found/);
    assert.match(error.message, /wrangler secrets-store secret create/);
    assert.match(error.message, /no --remote/);
    return true;
  });
});

test('a resource binding read as a secret is refused, not handed to a mail call', async () => {
  class D1Database {}
  await assert.rejects(
    readSecret({ DB: new D1Database() }, 'DB'),
    /bound as a D1Database, not a secret/,
  );
});

test('a Secrets Store binding counts as bound; empty, null and undefined do not', () => {
  assert.equal(isBound({ get: async () => 'x' }), true);
  assert.equal(isBound('x'), true);
  assert.equal(isBound(''), false);
  assert.equal(isBound(null), false);
  assert.equal(isBound(undefined), false);
});

test('only an object with a get function is a Secrets Store binding', () => {
  assert.equal(isSecretsStoreBinding({ get: async () => 'x' }), true);
  assert.equal(isSecretsStoreBinding('a string'), false);
  assert.equal(isSecretsStoreBinding({ get: 'not a function' }), false);
  assert.equal(isSecretsStoreBinding(null), false);
});
