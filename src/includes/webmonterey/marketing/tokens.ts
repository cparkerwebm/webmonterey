/*
 * The link token on every subscriber row - pure.
 *
 * RANDOM PER ROW, NOT SIGNED. A signed token needs a secret, which is one more thing to create,
 * record and rotate on every site; a random 256-bit value stored on the row needs nothing and is
 * exactly as unguessable. The confirm and unsubscribe links carry it, and the row is looked up by
 * it. Base64url, so it sits in a query string untouched.
 */
export const TOKEN_BYTES = 32;

export function newToken(random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array = fill): string {
  const bytes = random(new Uint8Array(TOKEN_BYTES));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fill(bytes: Uint8Array<ArrayBuffer>): Uint8Array {
  crypto.getRandomValues(bytes);
  return bytes;
}

/** The shape a token must have to be looked up at all; anything else is answered as invalid. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}
