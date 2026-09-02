/*
 * Read an image's real dimensions from its header.
 *
 * WHY THIS EXISTS. og:image:width and og:image:height have to travel with the share image, and
 * nothing in the toolchain can check them: files in public/ are copied verbatim and never
 * processed, so a client dropping in a differently sized card publishes false dimensions and no
 * build, test or linter says a word.
 *
 * Generations 1 and 2 handled it with a comment telling the reader to keep the numbers in step.
 * They did not: webmonterey.com shipped a 1280x672 image declaring 1200x630 for its whole life,
 * and the comment warning about it was sitting in the same file. A crawler uses these to lay the
 * card out before it fetches the image, so wrong values are worse than none.
 *
 * Header parsing only - no dependency, and it reads a few dozen bytes rather than decoding.
 */
import { openSync, readSync, closeSync } from 'node:fs';

export interface ImageSize {
  width: number;
  height: number;
}

/*
 * Read the first `length` bytes, or fewer if the file is shorter.
 *
 * Uint8Array and DataView rather than Buffer's read helpers: the package builds under a tsconfig
 * that does not pull in Node's Buffer typings, and these are the platform primitives anyway.
 */
function head(path: string, length: number): Uint8Array | null {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const bytes = new Uint8Array(length);
    const read = readSync(fd, bytes, 0, length, 0);
    return bytes.subarray(0, read);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const startsWith = (bytes: Uint8Array, prefix: number[]): boolean =>
  prefix.every((byte, i) => bytes[i] === byte);

const ascii = (bytes: Uint8Array, start: number, end: number): string =>
  String.fromCharCode(...bytes.subarray(start, end));

/**
 * PNG, GIF and JPEG. WebP and AVIF are deliberately absent: neither is a safe share image
 * anyway - several crawlers still will not decode them - so a card should not be in one.
 */
export function imageSize(path: string): ImageSize | null {
  const bytes = head(path, 65_536);
  if (!bytes || bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  /* PNG: an 8-byte signature, then an IHDR chunk whose first two fields are the dimensions. */
  if (startsWith(bytes, PNG_MAGIC) && ascii(bytes, 12, 16) === 'IHDR') {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  /* GIF: 'GIF87a' or 'GIF89a', then width and height as little-endian 16-bit. */
  if (ascii(bytes, 0, 3) === 'GIF') {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }

  /*
   * JPEG: a chain of length-prefixed segments. Walk them to a Start Of Frame, which is where the
   * dimensions live. SOF0/1/2/3/5/6/7/9/10/11/13/14/15 all carry them; DHT (c4), DNL (c8) and
   * JPG (cc) share the range and do not, so they are skipped explicitly.
   */
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = bytes[offset + 1]!;
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
      }
      /* Not a frame header - skip this segment by its own declared length. */
      const length = view.getUint16(offset + 2);
      if (length < 2) return null;
      offset += 2 + length;
    }
  }

  return null;
}
