/*
 * Reading the client's config files.
 *
 * Kept separate from the integration so it is testable without Astro, and so `webm doctor` and
 * `webm sync` read the config exactly the way the build does rather than reimplementing it.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { SiteConfig } from '../includes/webmonterey/config.ts';
import type { DesignSystem } from '../design/types.ts';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function readJson<T>(path: string, what: string, required: boolean): T | null {
  if (!existsSync(path)) {
    if (required) {
      throw new ConfigError(`${what} not found at ${path}. Every site needs one.`);
    }
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (error) {
    /*
     * Name the file. A JSON syntax error surfaces from deep inside the build otherwise, and the
     * message alone ("Unexpected token }") does not say which of the two config files it came
     * from.
     */
    throw new ConfigError(
      `${what} at ${path} is not valid JSON: ${error instanceof Error ? error.message : error}`,
    );
  }
}

export interface SiteFiles {
  site: SiteConfig;
  design: DesignSystem;
  /** Absolute paths, for addWatchFile - editing either must trigger a rebuild. */
  paths: { site: string; design: string | null };
}

/**
 * Load webmonterey.json and design.json from a site root.
 *
 * design.json is OPTIONAL. A site with no design file compiles the default token set, which is
 * exactly what a freshly minted site should look like before anyone has chosen a palette.
 * webmonterey.json is required, because `domain` alone switches on canonical tags, Open Graph
 * URLs, the sitemap and the credit's attribution.
 */
export function loadSiteFiles(root: string): SiteFiles {
  const sitePath = join(root, 'webmonterey.json');
  const designPath = join(root, 'design.json');

  const site = readJson<SiteConfig>(sitePath, 'webmonterey.json', true)!;
  const design = readJson<DesignSystem>(designPath, 'design.json', false);

  return {
    site,
    design: design ?? {},
    paths: { site: sitePath, design: design ? designPath : null },
  };
}

/**
 * The production origin, or undefined while `domain` is still the placeholder.
 *
 * Deliberately undefined rather than a localhost guess. With `site` unset Astro suppresses
 * canonical tags and the sitemap integration is not added - both better than a canonical tag
 * pointing at localhost, or a sitemap that cannot be built because it has no absolute URL.
 */
export function resolveSiteUrl(config: SiteConfig): string | undefined {
  const domain = config.domain;
  return domain && domain !== 'CHANGEME' ? `https://${domain}` : undefined;
}

/**
 * Every form definition in a site, keyed by id.
 *
 * The id is the FILENAME, which is what page JSON and the action's `form` field reference. There
 * is no registry to keep in step - adding src/forms/quote.json is the whole job.
 */
export function loadForms(root: string): Record<string, unknown> {
  const dir = join(root, 'src/forms');
  if (!existsSync(dir)) return {};
  const out: Record<string, unknown> = {};
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    out[file.replace(/\.json$/, '')] = readJson(join(dir, file), `src/forms/${file}`, true);
  }
  return out;
}
