/*
 * R2 media, served from `media.<client-domain>`.
 *
 * WHAT BELONGS HERE, and what does not:
 *
 *   src/assets/    images the DESIGN uses — imported, hashed, optimised at build by sharp.
 *                  A logo, an icon, a hero shot. These belong in the repo.
 *   public/        small fixed files that need a stable URL (favicons, open-graph.png).
 *   R2 (here)      everything too large or too numerous to sit in git: video, audio, PDFs,
 *                  photo galleries, downloads, anything migrated wholesale off a WordPress
 *                  uploads folder.
 *
 * The deciding question is not file size, it is "should `git clone` carry this?" A 40MB
 * showreel makes every clone slower forever and can never be optimised by the build.
 *
 * NAMING:
 *   bucket    <slug>                  e.g. example - one name for every resource, see cli/slug.ts
 *   hostname  media.<client-domain>   e.g. media.example.com
 *
 * WHY A CUSTOM DOMAIN AND NOT r2.dev: Cloudflare's r2.dev subdomain is rate-limited and
 * documented as unsuitable for production. It is also a hostname the client does not own,
 * which puts their media on someone else's brand. A custom domain is also the only way the
 * objects get Cache-Reserve and normal zone caching.
 *
 * THE ZONE MUST BE ON THE SAME CLOUDFLARE ACCOUNT AS THE BUCKET. This is the same constraint
 * that makes `preview.<client-domain>` unusable before launch (see CLAUDE.md Traps) — but
 * unlike previews it is not a blocker here, because `go-live` moves the zone onto the account
 * anyway. Set up media AFTER the zone move, not before.
 */
import { domain, hasDomain } from '../../webmonterey/site.ts';
import { buildMediaUrl, mediaHostFor } from './url.ts';

export { buildMediaUrl, mediaHostFor };

/** The media hostname for this site, or null while `domain` is still CHANGEME. */
export const mediaHost = mediaHostFor(domain, hasDomain);

/** Absolute URL for an object in this site's media bucket. See buildMediaUrl. */
export function mediaUrl(key: string): string {
  return buildMediaUrl(mediaHost, key);
}
