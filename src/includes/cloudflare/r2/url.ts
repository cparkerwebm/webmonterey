/*
 * Pure media-URL construction. No config, no virtual module, no imports.
 *
 * Separated from media.ts so it is testable with `node --test` and no build. media.ts binds
 * this to the site's own host; anything importing media.ts transitively pulls in
 * virtual:webm/site, which only exists inside an Astro build.
 *
 * THE PATTERN, applied throughout the package: pure logic lives in a file with no virtual-module
 * imports; the binding lives beside it. Generation 2 could not do this because everything shared
 * one repo, so its tests had to branch on whether the site they happened to run in was configured
 * yet - asserting properties that hold in every configuration rather than behavior.
 */

/**
 * Absolute URL for an object in the media bucket.
 *
 * Throws on a null host rather than returning a broken URL: a link silently pointing at
 * `https://media.CHANGEME/…` renders as a dead image or a dead download, and the failure would
 * only ever be noticed by a visitor.
 */
export function buildMediaUrl(host: string | null, key: string): string {
  if (!host) {
    throw new Error(
      '[webm] Cannot build a media URL: webmonterey.json "domain" is still CHANGEME. ' +
        'Set the production domain, or do not reference R2 media yet.',
    );
  }
  return `https://${host}/${key.replace(/^\/+/, '')}`;
}

/** The media hostname for a domain, or null while it is still the placeholder. */
export function mediaHostFor(domain: string | null, configured: boolean): string | null {
  return configured && domain ? `media.${domain}` : null;
}
