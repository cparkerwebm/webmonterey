import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataPoint, parseBeacon, pathOnly, referrerHost } from './datapoint.ts';

test('the column contract: index and blob1 are the event, host, path, form, detail, duration', () => {
  const point = dataPoint({
    event: 'form.notify_sent',
    host: 'example.com',
    path: '/contact?utm=x#top',
    form: 'contact',
    detail: 'queued',
    duration: 123.4,
  });
  assert.deepEqual(point, {
    indexes: ['form.notify_sent'],
    blobs: ['form.notify_sent', 'example.com', '/contact', 'contact', 'queued'],
    doubles: [123.4],
  });
});

test('absent fields are empty strings and zero, never undefined - the columns are positional', () => {
  const point = dataPoint({ event: 'page.view', host: 'a.com' });
  assert.deepEqual(point.blobs, ['page.view', 'a.com', '', '', '']);
  assert.deepEqual(point.doubles, [0]);
  assert.deepEqual(dataPoint({ event: 'x', host: 'a', duration: -5 }).doubles, [0]);
  assert.deepEqual(dataPoint({ event: 'x', host: 'a', duration: NaN }).doubles, [0]);
});

test('nothing a visitor typed survives past a path: query strings and fragments are cut', () => {
  assert.equal(pathOnly('/thanks?token=abc'), '/thanks');
  assert.equal(pathOnly('about#team'), '/about');
  assert.equal(pathOnly(undefined), '');
  assert.equal(referrerHost('https://news.example.org/story?id=1'), 'news.example.org');
  assert.equal(referrerHost('not a url'), '');
});

test('the beacon accepts a path and a referrer, and nothing else', () => {
  const ok = parseBeacon(
    JSON.stringify({ p: '/pricing?x=1', r: 'https://google.com/search?q=' }),
    'example.com',
  );
  assert.deepEqual(ok, {
    event: 'page.view',
    host: 'example.com',
    path: '/pricing',
    detail: 'google.com',
  });

  const internal = parseBeacon(
    JSON.stringify({ p: '/b', r: 'https://example.com/a' }),
    'example.com',
  );
  assert.equal(internal!.detail, '', 'a same-site referrer is navigation, not a source');

  assert.equal(parseBeacon('not json', 'example.com'), null);
  assert.equal(parseBeacon(JSON.stringify({ r: 'x' }), 'example.com'), null, 'a path is required');
  assert.equal(parseBeacon(JSON.stringify({ p: 'a'.repeat(600) }), 'example.com'), null);
  assert.equal(parseBeacon(JSON.stringify({ p: 42 }), 'example.com'), null);
});
