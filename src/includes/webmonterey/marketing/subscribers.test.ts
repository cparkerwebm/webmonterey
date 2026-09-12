/*
 * Against a fake D1: the SQL each transition issues, the guards, and what comes back. The real
 * schema is exercised by examples/minimal's local database; this proves the logic.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  audiencePage,
  confirmByToken,
  recordCampaign,
  signUp,
  suppress,
  unsubscribeByToken,
} from './subscribers.ts';

interface Call {
  sql: string;
  params: unknown[];
}

/** A D1Database whose answers are scripted per call, recording every statement. */
function fakeDb(answers: Array<{ first?: unknown; changes?: number; all?: unknown[] }>) {
  const calls: Call[] = [];
  let i = 0;
  const db = {
    prepare(sql: string) {
      const call: Call = { sql: sql.replace(/\s+/g, ' ').trim(), params: [] };
      calls.push(call);
      const answer = answers[i++] ?? {};
      const statement = {
        bind(...params: unknown[]) {
          call.params = params;
          return statement;
        },
        async first() {
          return answer.first ?? null;
        },
        async run() {
          return { meta: { changes: answer.changes ?? 0, last_row_id: 1 }, results: [] };
        },
        async all() {
          return { results: answer.all ?? [] };
        },
      };
      return statement;
    },
  };
  return { db: db as unknown as D1Database, calls };
}

const signup = { email: ' New@Example.com ', source: 'newsletter@/', purposes: 'Monthly news' };

test('a new address is inserted pending, with its provenance, and gets a token to confirm', async () => {
  const { db, calls } = fakeDb([{ first: null }, {}]);
  const result = await signUp(db, { ...signup, name: 'New', ip: '1.2.3.4', vars: { plan: 'pro' } });
  assert.equal(result.status, 'pending');
  assert.equal(result.email, 'new@example.com');
  assert.match(calls[1]!.sql, /^INSERT INTO subscribers/);
  assert.deepEqual(calls[1]!.params.slice(0, 2), ['new@example.com', 'New']);
  assert.equal(calls[1]!.params[2], result.token);
  assert.deepEqual(calls[1]!.params.slice(3, 7), ['newsletter@/', 'Monthly news', null, '1.2.3.4']);
  assert.equal(calls[1]!.params[7], '{"plan":"pro"}');
});

test('an unsubscribed address signing up again is fresh consent: pending, new token, new provenance', async () => {
  const { db, calls } = fakeDb([
    { first: { status: 'unsubscribed', token: 'old' } },
    { changes: 1 },
  ]);
  const result = await signUp(db, signup);
  assert.equal(result.status, 'pending');
  assert.notEqual(result.token, 'old');
  assert.match(calls[1]!.sql, /^UPDATE subscribers SET status = 'pending'/);
  assert.match(calls[1]!.sql, /unsubscribed_at = NULL/);
});

test('a subscribed address is left alone, and a suppressed one is never re-added by a form', async () => {
  const subscribed = fakeDb([{ first: { status: 'subscribed', token: 't1' } }]);
  assert.deepEqual(await signUp(subscribed.db, signup), {
    status: 'subscribed',
    token: 't1',
    email: 'new@example.com',
  });
  assert.equal(subscribed.calls.length, 1, 'no write');

  const suppressed = fakeDb([{ first: { status: 'suppressed', token: 't2' } }]);
  assert.equal((await signUp(suppressed.db, signup)).status, 'suppressed');
  assert.equal(suppressed.calls.length, 1, 'no write');
});

test('confirm moves only pending, and says already or invalid otherwise', async () => {
  const done = fakeDb([{ changes: 1 }]);
  assert.equal(await confirmByToken(done.db, 'tok', '9.9.9.9'), 'done');
  assert.match(done.calls[0]!.sql, /WHERE token = \? AND status = 'pending'/);
  assert.deepEqual(done.calls[0]!.params, ['9.9.9.9', 'tok']);

  const already = fakeDb([{ changes: 0 }, { first: { status: 'subscribed' } }]);
  assert.equal(await confirmByToken(already.db, 'tok'), 'already');
  const invalid = fakeDb([{ changes: 0 }, { first: null }]);
  assert.equal(await confirmByToken(invalid.db, 'nope'), 'invalid');
  const gone = fakeDb([{ changes: 0 }, { first: { status: 'unsubscribed' } }]);
  assert.equal(
    await confirmByToken(gone.db, 'tok'),
    'invalid',
    'an unsubscribed row does not confirm',
  );
});

test('unsubscribe on the site moves pending or subscribed, and is kind to a repeat click', async () => {
  const done = fakeDb([{ changes: 1 }]);
  assert.equal(await unsubscribeByToken(done.db, 'tok'), 'done');
  assert.match(done.calls[0]!.sql, /unsubscribe_reason = 'site'/);
  assert.match(done.calls[0]!.sql, /status IN \('pending', 'subscribed'\)/);
  const again = fakeDb([{ changes: 0 }, { first: { status: 'unsubscribed' } }]);
  assert.equal(await unsubscribeByToken(again.db, 'tok'), 'already');
  const invalid = fakeDb([{ changes: 0 }, { first: null }]);
  assert.equal(await unsubscribeByToken(invalid.db, 'tok'), 'invalid');
});

test('the provider header is an unsubscribe; a complaint or bounce is a suppression; suppressed stays', async () => {
  const header = fakeDb([{ changes: 1 }]);
  assert.equal(await suppress(header.db, 'A@X.com', 'provider'), true);
  assert.deepEqual(header.calls[0]!.params, ['unsubscribed', 'provider', 'a@x.com']);
  const complaint = fakeDb([{ changes: 1 }]);
  await suppress(complaint.db, 'a@x.com', 'complaint');
  assert.deepEqual(complaint.calls[0]!.params.slice(0, 2), ['suppressed', 'complaint']);
  assert.match(complaint.calls[0]!.sql, /status != 'suppressed'/);
  const unknown = fakeDb([{ changes: 0 }]);
  assert.equal(await suppress(unknown.db, 'nobody@x.com', 'bounce'), false);
});

test('the audience is subscribed rows only, paged by id, with the segment ANDed in', async () => {
  const rows = [{ id: 5, email: 'a@x.com', name: null, token: 't', vars: '{}' }];
  const { db, calls } = fakeDb([{ all: rows }]);
  const page = await audiencePage(db, {
    where: `vars ->> '$.plan' = ?`,
    params: ['pro'],
    after: 4,
    limit: 500,
  });
  assert.deepEqual(page, rows);
  assert.match(
    calls[0]!.sql,
    /WHERE status = 'subscribed' AND id > \? AND \(vars ->> '\$\.plan' = \?\) ORDER BY id LIMIT \?/,
  );
  assert.deepEqual(calls[0]!.params, [4, 'pro', 500]);
});

test('a campaign is recorded once per key and its id comes back every time', async () => {
  const { db, calls } = fakeDb([{}, { first: { id: 7 } }]);
  assert.equal(await recordCampaign(db, { key: '2026-10', subject: 'News' }), 7);
  assert.match(calls[0]!.sql, /INSERT OR IGNORE INTO campaigns/);
});
