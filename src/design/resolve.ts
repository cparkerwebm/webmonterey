/*
 * Flatten var() chains to literal values.
 *
 * This is the email output. Email HTML has no cascade, no classes and no custom properties -
 * Outlook has enforced that for fifteen years - so every style must be inlined as a literal.
 * `--webm-link: var(--webm-action)` is useless in a mail client; `#006abe` is not.
 *
 * Also the "resolved palette" used for social graphics and reports, where a renderer wants a
 * color rather than a reference.
 */
import type { TokenGroup } from './types.ts';

export class ResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResolveError';
  }
}

/** Matches one var() call, capturing the name and an optional fallback. */
const VAR = /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/;

/**
 * Resolve every token to a literal, following var() references.
 *
 * A reference to an undefined token resolves to its fallback if one is written, and throws
 * otherwise - a silently-empty value in an email is worse than a failed build, because nobody
 * sees it until a client forwards the mail asking why it looks broken.
 */
export function resolve(groups: TokenGroup[]): Map<string, string> {
  const raw = new Map<string, string>();
  for (const g of groups) for (const t of g.tokens) raw.set(t.name, t.value);

  const done = new Map<string, string>();

  const expand = (name: string, seen: string[]): string => {
    const cached = done.get(name);
    if (cached !== undefined) return cached;

    if (seen.includes(name)) {
      throw new ResolveError(`Circular token reference: ${[...seen, name].join(' -> ')}`);
    }
    const value = raw.get(name);
    if (value === undefined) {
      throw new ResolveError(`Token ${name} is referenced but never defined`);
    }

    let out = value;
    for (let guard = 0; guard < 50; guard++) {
      const m = VAR.exec(out);
      if (!m) break;
      const [whole, ref, fallback] = m;
      let replacement: string;
      if (raw.has(ref!)) {
        replacement = expand(ref!, [...seen, name]);
      } else if (fallback !== undefined) {
        replacement = fallback.trim();
      } else {
        throw new ResolveError(
          `Token ${name} references ${ref}, which is not defined and has no fallback`,
        );
      }
      out = out.slice(0, m.index) + replacement + out.slice(m.index + whole!.length);
    }

    done.set(name, out);
    return out;
  };

  for (const name of raw.keys()) expand(name, []);
  return done;
}

/**
 * The subset an email template actually reaches for, resolved flat.
 *
 * Deliberately narrow. An email primitive needs colors, a font stack and a couple of sizes -
 * handing it 124 tokens invites someone to inline a fluid clamp() into a table cell, which no
 * mail client understands.
 */
export function emailPalette(groups: TokenGroup[]): Record<string, string> {
  const all = resolve(groups);
  const want = [
    '--webm-surface',
    '--webm-surface-alt',
    '--webm-surface-inverse',
    '--webm-text',
    '--webm-text-muted',
    '--webm-text-strong',
    '--webm-text-inverse',
    '--webm-text-on-action',
    '--webm-action',
    '--webm-action-dark',
    '--webm-link',
    '--webm-border-subtle',
    '--webm-font-sans',
    '--webm-radius-md',
    '--webm-space-sm',
    '--webm-space-md',
    '--webm-space-lg',
  ];
  const out: Record<string, string> = {};
  for (const name of want) {
    const value = all.get(name);
    if (value !== undefined) out[name.replace('--webm-', '')] = value;
  }
  return out;
}
