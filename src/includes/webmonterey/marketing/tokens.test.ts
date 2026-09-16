import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isToken, newToken, TOKEN_PATTERN } from './tokens.ts';
import { confirmUrl, mailOrigin, normalizeEmail, unsubscribeUrl } from './links.ts';

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

test('the mail origin is the domain in production and the preview host on a staging deployment', () => {
  /* Production, on its own domain: the domain. */
  assert.equal(mailOrigin('example.com', 'production', 'example.com'), 'https://example.com/');
  /* A workers.dev preview of a launched site: the host the signup came from, not the live site. */
  assert.equal(
    mailOrigin('example.com', 'production', 'example-abc.workers.dev'),
    'https://example-abc.workers.dev/',
  );
  /* A staging site, wherever it answers: the host it answered on. */
  assert.equal(
    mailOrigin('example.com', 'staging', 'example.example.workers.dev'),
    'https://example.example.workers.dev/',
  );
  /* A cron has no hostname and falls back to the domain, in either mode. */
  assert.equal(mailOrigin('example.com', 'production', null), 'https://example.com/');
  assert.equal(mailOrigin('example.com', 'staging', null), 'https://example.com/');
  assert.equal(mailOrigin('example.com', 'staging', undefined), 'https://example.com/');
  /* And a link built on it is on that origin. */
  assert.equal(
    confirmUrl(mailOrigin('example.com', 'production', 'example-abc.workers.dev'), 'abc'),
    'https://example-abc.workers.dev/subscribe/confirm?t=abc',
  );
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
