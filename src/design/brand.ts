/*
 * The brand-context output: what Claude reads when writing for a client.
 *
 * This is the thing that makes generated copy look like the client instead of like a chatbot,
 * and it is why `brand.voice` lives in design.json rather than in a prompt somewhere. A social
 * post, a report and the site itself all draw from one file.
 *
 * Consumed by the platform MCP server, so it must stay serialisable and free of anything that
 * only makes sense inside a build.
 */
import { resolve } from './resolve.ts';
import { compile } from './compile.ts';
import type { DesignSystem } from './types.ts';

export interface BrandContext {
  name?: string;
  voice?: string;
  rules: string[];
  logo?: { primary?: string; mark?: string };
  /** Resolved literals, keyed without the --webm- prefix. */
  palette: Record<string, string>;
  fonts: { sans: string; mono: string };
}

export function brandContext(design: DesignSystem = {}): BrandContext {
  const tokens = resolve(compile(design));
  const get = (n: string) => tokens.get(n) ?? '';

  return {
    name: design.brand?.name,
    voice: design.brand?.voice,
    rules: design.brand?.rules ?? [],
    logo: design.brand?.logo,
    palette: {
      action: get('--webm-action'),
      actionDark: get('--webm-action-dark'),
      actionLight: get('--webm-action-light'),
      surface: get('--webm-surface'),
      surfaceAlt: get('--webm-surface-alt'),
      surfaceInverse: get('--webm-surface-inverse'),
      text: get('--webm-text'),
      textMuted: get('--webm-text-muted'),
      textStrong: get('--webm-text-strong'),
      textInverse: get('--webm-text-inverse'),
      border: get('--webm-border-subtle'),
    },
    fonts: { sans: get('--webm-font-sans'), mono: get('--webm-font-mono') },
  };
}
