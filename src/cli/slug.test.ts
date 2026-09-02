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

test('the slug drops the TLD - this is what stops Chrome flagging preview links', () => {
  // A Worker named example-com puts example-com into every preview hostname, which Chrome reads
  // as a registrable domain. `example` embeds nothing.
  assert.equal(slugFor('example.com'), 'example');
  assert.equal(slugFor('acme-widgets.org'), 'acme-widgets');
});

test('a two-part public suffix drops both labels', () => {
  assert.equal(slugFor('example.co.uk'), 'example');
  assert.equal(slugFor('example.com.au'), 'example');
});

test('a subdomain is kept - an indexable subdomain is its own site', () => {
  assert.equal(slugFor('shop.example.com'), 'shop-example');
});

test('a single-label result never comes back empty', () => {
  assert.ok(slugFor('a.com').length > 0);
});

test('one name, everywhere: repo, Worker, D1, R2 and KV are all the slug', () => {
  assert.equal(repoName('example.com'), 'example');
  assert.deepEqual(resourceNames('example.com'), {
    slug: 'example',
    repo: 'example',
    worker: 'example',
    d1: 'example',
    r2: 'example',
    kv: 'example',
  });
});

test('every name is valid for the strictest resource - lowercase, digits and dashes only', () => {
  // R2 and Workers accept nothing else, and R2 also refuses a leading or trailing dash.
  for (const domain of ['example.com', 'shop.example.com', 'acme-widgets.co.uk', 'a1.io']) {
    for (const name of Object.values(resourceNames(domain))) {
      assert.match(name, /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/, `${domain} -> ${name}`);
    }
  }
});

test('two clients on the same name under different TLDs collide, which the caller must handle', () => {
  // `webm new` says so; the second one gets a name chosen by a person.
  assert.equal(slugFor('example.com'), slugFor('example.org'));
});
