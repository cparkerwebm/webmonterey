/*
 * design.json -> CSS custom properties.
 *
 * Pure. No I/O, no Astro, no dependencies - which is why it lives behind the `./design` subpath
 * and can be tested with `node --test` alone. Rule 1 applies to the framework as much as to a
 * client site: there is no test framework here either.
 *
 * The contract that matters: compiling an EMPTY design.json must reproduce webm-astro v1.4.1's
 * tokens.css exactly. That equivalence is what makes this a refactor of where values live rather
 * than a redesign of the token system, and it is asserted in compile.test.ts.
 */
import { DEFAULTS, TOKEN_NAMES } from './defaults.ts';
import type { DesignSystem, TokenGroup } from './types.ts';

/**
 * Where each design.json field lands, as [path, token name] pairs.
 *
 * Declarative on purpose. Adding a field to design.json should be one line here plus one line
 * in types.ts, not a new branch in the merge.
 */
export const MAPPING: ReadonlyArray<readonly [path: readonly string[], token: string]> = [
  [['color', 'base', '100'], '--webm-base-100'],
  [['color', 'base', '300'], '--webm-base-300'],
  [['color', 'base', '500'], '--webm-base-500'],
  [['color', 'base', '700'], '--webm-base-700'],
  [['color', 'base', '900'], '--webm-base-900'],
  [['color', 'action', 'base'], '--webm-action'],
  [['color', 'action', 'dark'], '--webm-action-dark'],
  [['color', 'action', 'light'], '--webm-action-light'],
  [['color', 'border', 'subtle'], '--webm-border-subtle'],
  [['color', 'state', 'success'], '--webm-state-success'],
  [['color', 'state', 'warning'], '--webm-state-warning'],
  [['color', 'state', 'danger'], '--webm-state-danger'],
  [['color', 'state', 'info'], '--webm-state-info'],
  [['font', 'sans'], '--webm-font-sans'],
  [['font', 'mono'], '--webm-font-mono'],
  [['radius', 'none'], '--webm-radius-none'],
  [['radius', 'xs'], '--webm-radius-xs'],
  [['radius', 'sm'], '--webm-radius-sm'],
  [['radius', 'md'], '--webm-radius-md'],
  [['radius', 'lg'], '--webm-radius-lg'],
  [['radius', 'xl'], '--webm-radius-xl'],
  [['radius', 'pill'], '--webm-radius-pill'],
  [['radius', 'circle'], '--webm-radius-circle'],
];

function at(source: unknown, path: readonly string[]): unknown {
  let node: unknown = source;
  for (const key of path) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

export class DesignError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DesignError';
  }
}

/**
 * Merge a design.json over the defaults, returning the full grouped token set.
 *
 * Overrides that name a token already in a group REPLACE it in place, so the compiled file keeps
 * its grouping rather than growing an "overrides" tail that separates a value from its siblings.
 * An override naming a token that does not exist is appended to its own group - legitimate, since
 * a client may add a token their own components read.
 */
export function compile(design: DesignSystem = {}): TokenGroup[] {
  const patch = new Map<string, string>();

  for (const [path, token] of MAPPING) {
    const value = at(design, path);
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') {
      throw new DesignError(`design.json: ${path.join('.')} must be a string, got ${typeof value}`);
    }
    patch.set(token, value);
  }

  /*
   * Overrides are applied after the mapping, so `overrides` wins over a structured field naming
   * the same token. That ordering is deliberate: the escape hatch is the more specific statement.
   */
  const extra: string[] = [];
  for (const [name, value] of Object.entries(design.overrides ?? {})) {
    if (!name.startsWith('--webm-')) {
      throw new DesignError(
        `design.json: override "${name}" must start with --webm-. ` +
          `A property outside the prefix is set but never read, and the page looks untouched.`,
      );
    }
    if (typeof value !== 'string') {
      throw new DesignError(`design.json: override "${name}" must be a string`);
    }
    patch.set(name, value);
    if (!TOKEN_NAMES.has(name)) extra.push(name);
  }

  const groups: TokenGroup[] = DEFAULTS.map((group) => ({
    ...group,
    tokens: group.tokens.map((t) => (patch.has(t.name) ? { ...t, value: patch.get(t.name)! } : t)),
  }));

  if (extra.length) {
    groups.push({
      title: 'site tokens',
      note: 'Declared in design.json overrides and not part of the default set.',
      tokens: extra.map((name) => ({ name, value: patch.get(name)! })),
    });
  }

  return groups;
}

/** Wrap a note as a CSS comment, indented to sit inside :root. */
function comment(text: string, indent: string): string {
  const lines = text.split('\n');
  if (lines.length === 1) return `${indent}/* ${text} */`;
  return [
    `${indent}/*`,
    ...lines.map((l) => (l ? `${indent} * ${l}` : `${indent} *`)),
    `${indent} */`,
  ].join('\n');
}

/**
 * Emit the compiled token set as a stylesheet.
 *
 * The `@layer webm.tokens` wrapper is REQUIRED, not cosmetic. Layer membership is what keeps
 * these declarations below components in the cascade; a bare :root block would out-rank a
 * component rule at equal specificity. Layer ORDER is a separate problem and is held by the
 * inline statement in base.astro - see the layer-order trap.
 */
export function toCss(groups: TokenGroup[]): string {
  const out: string[] = ['@layer webm.tokens {', '  :root {'];

  groups.forEach((group, i) => {
    if (i > 0) out.push('');
    const rule = `/* --- ${group.title} ${'-'.repeat(Math.max(1, 68 - group.title.length))} */`;
    out.push(`    ${rule}`);
    if (group.note) out.push(comment(group.note, '    '));
    for (const t of group.tokens) out.push(`    ${t.name}: ${t.value};`);
  });

  out.push('  }', '}', '');
  return out.join('\n');
}

/** design.json in, stylesheet out. The whole compiler, for callers that want one call. */
export function compileToCss(design: DesignSystem = {}): string {
  return toCss(compile(design));
}
