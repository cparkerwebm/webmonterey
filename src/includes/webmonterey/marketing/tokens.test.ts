import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isToken, newToken, TOKEN_PATTERN } from './tokens.ts';
import { confirmUrl, normalizeEmail, unsubscribeUrl } from './links.ts';

test('a token is 32 random bytes as base64url, and only that shape is looked up', () => {
  const token = newToken();
  assert.match(token, TOKEN_PATTERN);
  assert.notEqual(newToken(), token);
  assert.equal(isToken(token), true);
  assert.equal(isToken(token + '='), false);
  assert.equal(isToken("' OR 1=1 --"), false);
  assert.equal(isToken(42), false);
});

test('the deterministic form, for a reader checking the encoding', () => {
  const zeros = newToken((b) => b.fill(0));
  assert.equal(zeros, 'A'.repeat(43));
  const highs = newToken((b) => b.fill(255));
  assert.equal(highs, '_'.repeat(42) + '8');
});

test('links are absolute, on the production origin, with the token in the query', () => {
  assert.equal(
    confirmUrl('https://example.com/', 'abc'),
    'https://example.com/subscribe/confirm?t=abc',
  );
  assert.equal(
    unsubscribeUrl('https://example.com', 'a+b'),
    'https://example.com/unsubscribe?t=a%2Bb',
  );
  assert.equal(normalizeEmail('  Alice@Example.COM '), 'alice@example.com');
});
