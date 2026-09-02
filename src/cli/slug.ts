/*
 * Turning a domain into the names everything else uses.
 *
 * TWO NAMES, DELIBERATELY DIFFERENT.
 *
 *   GitHub repo        <domain_underscored>   webmonterey/autire_com
 *   Cloudflare stuff   webm-<slug>            webm-autire, webm-autire-db, webm-autire-media
 *
 * The repo keeps the full domain so it is unambiguous which site it serves. Cloudflare drops the
 * TLD token because `webm-autire-com` contains `autire-com`, which Chrome's lookalike check reads
 * as a registrable domain - and every preview link then warns the client the site looks fake.
 * `webm-autire` has nothing in it that looks like a domain. See ARCHITECTURE.md section 5.
 */

/** Public suffixes that take two labels, so `example.co.uk` slugs to `example`. */
const TWO_PART_SUFFIXES = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'me.uk',
  'net.uk',
  'sch.uk',
  'com.au',
  'net.au',
  'org.au',
  'edu.au',
  'gov.au',
  'co.nz',
  'net.nz',
  'org.nz',
  'com.br',
  'com.mx',
  'co.za',
  'co.jp',
  'co.in',
  'com.sg',
]);

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

/** Strip scheme, www, path and trailing dots. `https://www.Example.com/` -> `example.com` */
export function normalizeDomain(input: string): string {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '')
    .replace(/\.+$/, '');

  if (!cleaned || !cleaned.includes('.')) {
    throw new DomainError(`"${input}" is not a domain. Expected something like example.com.`);
  }
  if (!/^[a-z0-9.-]+$/.test(cleaned)) {
    throw new DomainError(`"${input}" contains characters a hostname cannot.`);
  }
  return cleaned;
}

/**
 * The GitHub repo name. Dots become UNDERSCORES: `autire.com` -> `autire_com`.
 *
 * Underscores, not dashes, and not the slug. Three names, three jobs:
 *
 *   repo       autire_com     the full domain, unambiguous about which site this is
 *   slug       autire         no TLD, because a Cloudflare Worker named webm-autire-com
 *                             embeds autire-com and Chrome reads that as a domain
 *   worker     webm-autire    the slug, prefixed
 *
 * A rebuild creates a NEW repo under the underscore name beside the old dashed one, which is what
 * lets the old site keep serving until the cutover.
 */
export function repoName(domain: string): string {
  return normalizeDomain(domain).replace(/\./g, '_');
}

/**
 * The client slug - the domain with its public suffix removed.
 *
 * `autire.com` -> `autire`, `example.co.uk` -> `example`. Subdomains are kept, because
 * `shop.example.com` and `example.com` are different clients if they are ever both ours.
 */
export function slugFor(domain: string): string {
  const clean = normalizeDomain(domain);
  const parts = clean.split('.');
  const lastTwo = parts.slice(-2).join('.');
  const drop = TWO_PART_SUFFIXES.has(lastTwo) ? 2 : 1;
  const kept = parts.slice(0, Math.max(1, parts.length - drop));
  return kept.join('-');
}

/** Every Cloudflare resource name for a site, from one domain. */
export function resourceNames(domain: string) {
  const slug = slugFor(domain);
  return {
    slug,
    repo: repoName(domain),
    worker: `webm-${slug}`,
    d1: `webm-${slug}-db`,
    r2Media: `webm-${slug}-media`,
    r2App: `webm-${slug}-app`,
  };
}
