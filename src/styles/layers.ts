/*
 * The layer order, as data.
 *
 * Declared in exactly one place so global.css, base.astro's inline statement and `webm doctor`
 * cannot drift apart. In generation 2 the two lists were kept in step by a comment saying they
 * must be - which is a convention, not a mechanism, and the failure is invisible: a mismatched
 * order produces no error, just a cascade that inverts on some pages and not others.
 */
export const LAYERS = [
  'webm.reset',
  'webm.tokens',
  'webm.base',
  'webm.layout',
  'webm.components.core',
  'webm.components.custom',
  'webm.utilities',
  'webm.overrides',
] as const;

/** The `@layer a, b, c;` statement. base.astro emits this inline, ahead of every stylesheet. */
export const LAYER_STATEMENT = `@layer ${LAYERS.join(', ')};`;
