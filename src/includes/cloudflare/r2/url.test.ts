import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMediaUrl, mediaHostFor } from './url.ts';

/*
 * Tests the PURE builder, not the config-bound wrapper.
 *
 * In generation 2 this file imported the bound module and had to branch on whether the site it
 * happened to be running in was configured yet - so the assertions were about properties that
 * hold in every configuration rather than about behavior. Separating buildMediaUrl from
 * mediaUrl means the interesting case (an unconfigured domain) is testable directly, on any
 * machine, with no build.
 */

test('an absolute https URL is built from the host and key', () => {
  assert.equal(
    buildMediaUrl('media.example.com', 'video/reel.mp4'),
    'https://media.example.com/video/reel.mp4',
  );
});

test('a leading slash on the key does not produce a double slash', () => {
  assert.equal(
    buildMediaUrl('media.example.com', '/video/reel.mp4'),
    'https://media.example.com/video/reel.mp4',
  );
  assert.equal(buildMediaUrl('media.example.com', '///a.pdf'), 'https://media.example.com/a.pdf');
});

test('a null host throws rather than returning a URL pointing at CHANGEME', () => {
  // A dead image is only ever noticed by a visitor. Fail the build instead.
  assert.throws(() => buildMediaUrl(null, 'a.pdf'), /CHANGEME/);
});

test('the error names the file and the field, so the fix is obvious from the message', () => {
  assert.throws(() => buildMediaUrl(null, 'a.pdf'), /webmonterey\.json/);
  assert.throws(() => buildMediaUrl(null, 'a.pdf'), /domain/);
});

test('mediaHostFor is null until the domain is configured', () => {
  assert.equal(mediaHostFor('CHANGEME', false), null);
  assert.equal(mediaHostFor(null, false), null);
  assert.equal(mediaHostFor('example.com', true), 'media.example.com');
});
