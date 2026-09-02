import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { imageSize } from './image-size.ts';

const dir = mkdtempSync(join(tmpdir(), 'webm-img-'));

function write(name: string, bytes: number[]): string {
  const path = join(dir, name);
  writeFileSync(path, new Uint8Array(bytes));
  return path;
}

/** A PNG signature plus an IHDR chunk declaring the given size. Nothing else is read. */
function png(width: number, height: number): number[] {
  const size = (n: number) => [(n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  return [
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    0,
    0,
    0,
    13,
    0x49,
    0x48,
    0x44,
    0x52,
    ...size(width),
    ...size(height),
    8,
    6,
    0,
    0,
    0,
  ];
}

test('a PNG reports its real dimensions', () => {
  // 1280x672 is the case that motivated this: webmonterey.com shipped exactly that while
  // declaring 1200x630 in its og:image tags, for its whole life.
  assert.deepEqual(imageSize(write('a.png', png(1280, 672))), { width: 1280, height: 672 });
  assert.deepEqual(imageSize(write('b.png', png(1200, 630))), { width: 1200, height: 630 });
});

test('a GIF reports its dimensions, little-endian', () => {
  const gif = [
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x04, 0xb0, 0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0,
  ];
  assert.deepEqual(imageSize(write('c.gif', gif)), { width: 1024, height: 688 });
});

test('a JPEG is walked to its frame header, skipping segments that are not one', () => {
  const jpeg = [
    0xff, 0xd8,
    /* APP0, 16 bytes long, carrying no dimensions - it must be skipped by its length. */
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
    /* SOF0: length, precision, then height and width. */
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0xa0, 0x05, 0x00, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
  ];
  assert.deepEqual(imageSize(write('d.jpg', jpeg)), { width: 1280, height: 672 });
});

test('a file that is not an image, or is missing, returns null rather than a guess', () => {
  assert.equal(
    imageSize(
      write(
        'e.txt',
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24],
      ),
    ),
    null,
  );
  assert.equal(imageSize(join(dir, 'nope.png')), null);
});
