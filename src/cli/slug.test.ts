import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DomainError, normalizeDomain, repoName, resourceNames, slugFor } from './slug.ts';

test('a domain is normalized from whatever was pasted', () => {
  for (const input of [
    'example.com',
    'https://example.com',
    'www.example.com',
    'HTTPS://WWW.Example.com/about',
    'example.com.',
  ]) {
    assert.equal(normalizeDomain(input), 'example.com', input);
  }
});

test('something that is not a domain is refused, naming what was expected', () => {
  assert.throws(() => normalizeDomain('acme'), DomainError);
  assert.throws(() => normalizeDomain(''), DomainError);
  assert.throws(() => normalizeDomain('exa mple.com'), DomainError);
});

test('the repo keeps the full domain, dots to UNDERSCORES', () => {
  assert.equal(repoName('autire.com'), 'autire_com');
  assert.equal(repoName('friendsofthemarinalibrary.org'), 'friendsofthemarinalibrary_org');
});

test('the three names are all different, and each has a job', () => {
  // repo is unambiguous about the site; slug drops the TLD so Chrome does not flag preview
  // hostnames; worker is the slug prefixed.
  const n = resourceNames('autire.com');
  assert.equal(n.repo, 'autire_com');
  assert.equal(n.slug, 'autire');
  assert.equal(n.worker, 'webm-autire');
});

test('the slug drops the TLD - this is what stops Chrome flagging preview links', () => {
  // webm-autire-com contains autire-com, which reads as a domain. webm-autire does not.
  assert.equal(slugFor('autire.com'), 'autire');
  assert.equal(slugFor('stevenglaze.com'), 'stevenglaze');
});

test('a two-part public suffix drops both labels', () => {
  assert.equal(slugFor('example.co.uk'), 'example');
  assert.equal(slugFor('example.com.au'), 'example');
});

test('a subdomain is kept - two of ours could differ only by it', () => {
  assert.equal(slugFor('shop.example.com'), 'shop-example');
});

test('a single-label result never comes back empty', () => {
  assert.ok(slugFor('a.com').length > 0);
});

test('every Cloudflare name derives from one domain, and the repo differs on purpose', () => {
  assert.deepEqual(resourceNames('autire.com'), {
    slug: 'autire',
    repo: 'autire_com',
    worker: 'webm-autire',
    d1: 'webm-autire-db',
    r2Media: 'webm-autire-media',
    r2App: 'webm-autire-app',
  });
});

test('two clients on the same name under different TLDs collide, which the caller must handle', () => {
  // clients.slug carries a unique constraint; `webm new` picks the next free form and records it.
  assert.equal(slugFor('autire.com'), slugFor('autire.org'));
});
