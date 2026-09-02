import { test } from 'node:test';
import assert from 'node:assert/strict';

import { redirectRecipients, redirectedSubject } from './redirect.ts';
import { isStagingDeployment } from '../../webmonterey/config.ts';

const DEV = 'dev@webmonterey.com';

test('every recipient becomes the dev address', () => {
  const out = redirectRecipients({ to: 'client@example.com' }, DEV);
  assert.deepEqual(out.to, [DEV]);
  assert.equal(out.replyTo, DEV);
});

test('cc and bcc are dropped, not redirected', () => {
  const out = redirectRecipients(
    { to: 'a@example.com', cc: 'b@example.com', bcc: 'c@example.com' },
    DEV,
  );

  /* A surviving bcc would be a real person receiving a test, invisibly. */
  assert.equal(out.cc, undefined);
  assert.equal(out.bcc, undefined);
  assert.deepEqual(out.to, [DEV]);
});

test('the real recipients survive in headers', () => {
  const out = redirectRecipients(
    { to: ['a@example.com', 'b@example.com'], bcc: 'c@example.com', replyTo: 'r@example.com' },
    DEV,
  );

  assert.equal(out.headers['X-Webm-Original-To'], 'a@example.com, b@example.com');
  assert.equal(out.headers['X-Webm-Original-Bcc'], 'c@example.com');
  assert.equal(out.headers['X-Webm-Original-Reply-To'], 'r@example.com');
  assert.equal(out.headers['X-Webm-Environment'], 'staging');
});

test('reply-to is rewritten, because this fleet inverts it on registration mail', () => {
  const out = redirectRecipients({ to: 'a@example.com', replyTo: 'organizer@example.com' }, DEV);
  assert.equal(out.replyTo, DEV);
});

test('the subject names who it was really for', () => {
  const out = redirectRecipients({ to: 'client@example.com' }, DEV);
  assert.equal(
    redirectedSubject('New enquiry', out.original),
    '[staging → client@example.com] New enquiry',
  );
});

test('a long recipient list is capped so the real subject stays visible', () => {
  const many = ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com', 'e@x.com'];
  assert.equal(redirectedSubject('Hello', many), '[staging → a@x.com, b@x.com, c@x.com +2] Hello');
});

test('an empty recipient list still marks the subject', () => {
  assert.equal(redirectedSubject('Hello', []), '[staging] Hello');
});

/* --- the decision itself ------------------------------------------------ */

test('staging config redirects, with or without a hostname', () => {
  assert.equal(isStagingDeployment('staging'), true);
  assert.equal(isStagingDeployment('staging', 'example.com'), true);
});

test('a cron on a staging site is covered, having no hostname at all', () => {
  /* The case a request-based check cannot see: scheduled() has no Request. */
  assert.equal(isStagingDeployment('staging', undefined), true);
});

test('workers.dev redirects even when the config says production', () => {
  assert.equal(isStagingDeployment('production', 'webm-example.webmonterey.workers.dev'), true);
  assert.equal(isStagingDeployment('production', 'workers.dev'), true);
});

test('a production site on its own domain sends for real', () => {
  assert.equal(isStagingDeployment('production', 'example.com'), false);
  assert.equal(isStagingDeployment(undefined, 'example.com'), false);
});

test('a www variant still sends for real', () => {
  /* The reason this tests workers.dev rather than "not the canonical domain": a bare `domain`
   * plus a www hostname would otherwise silently redirect a live site's mail away. */
  assert.equal(isStagingDeployment('production', 'www.example.com'), false);
});

test('a domain merely ending in workers.dev is not a preview', () => {
  assert.equal(isStagingDeployment('production', 'notworkers.dev'), false);
});

test('an unset environment and no hostname sends for real', () => {
  /* Every site predating this field. Any other answer breaks their email on npm update. */
  assert.equal(isStagingDeployment(undefined, undefined), false);
});
