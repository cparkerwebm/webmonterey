/*
 * The webmaster credit, in ONE place.
 *
 * Two surfaces render it and they cannot share a component: the site footer is an .astro
 * component, and transactional email is a string with inline styles (email clients strip <style>
 * blocks). Without this module the wording exists twice, and the next time it changes one copy
 * gets missed.
 *
 * WHERE THE FOOTER LINK GOES CHANGED. It used to leave the client's site for webmonterey.com. Now
 * it goes to the site's OWN /webmaster page - indexable, in the sitemap, rendered with the site's
 * chrome - and THAT page carries the one outbound link. Three things that buys: the visitor stays
 * on the client's site; every client site has a page that says who to call when something is
 * wrong; and the outbound link sits on a real page with real copy, which is a backlink rather
 * than a footer credit. The email footer keeps the outbound link, because an email cannot
 * usefully point at a page on the site it is about.
 *
 * utm_content is ALWAYS the production domain from webmonterey.json, never the host the page is
 * served from - a preview build still reports the client's own domain, so staging traffic does
 * not fragment the attribution. It is written with underscores (`example_com`): a dot makes the
 * value look like a hostname, and analytics UIs read it as one rather than as the label it is.
 *
 * THE AGENCY'S IDENTITY IS HERE TOO, for the webmaster page's structured data. It is the one
 * place in the package that names the agency, deliberately: the credit is the package saying who
 * built the framework, which a public package is allowed to do, and keeping it in one module
 * means a change to the name, the address or a profile is one edit.
 */

/** The credit wording. Rendered verbatim on the site and in email. */
export const CREDIT_TEXT = 'Powered by WebMonterey';

/** The page every site has. Fixed - the footer, the sitemap and the doctor all rely on it. */
export const WEBMASTER_PATH = '/webmaster';

/** The share image the webmaster page carries, served from the package by the integration. */
export const WEBMASTER_OG_PATH = '/webmaster/og.png';

/**
 * The agency, as the webmaster page's structured data describes it. The `@id` is the same
 * entity webmonterey.com declares for itself, so every client page points at one organization
 * rather than a hundred copies of it.
 */
export const AGENCY = {
  id: 'https://webmonterey.com/#organization',
  name: 'WebMonterey',
  url: 'https://webmonterey.com/',
  description:
    'A webmaster maintenance service in Monterey, California: design, build, hosting, security and ongoing care for small-business websites.',
  address: { addressLocality: 'Monterey', addressRegion: 'CA', addressCountry: 'US' },
  sameAs: [
    /* The Google Business Profile, by its Knowledge Graph id - the stable form of the share link. */
    'https://www.google.com/search?kgmid=/g/11nvks0plt',
    'https://www.linkedin.com/company/webmonterey',
    'https://www.facebook.com/webmonterey',
    'https://www.youtube.com/@webmonterey',
    'https://www.pinterest.com/webmonterey',
    'https://github.com/webmonterey',
    'https://www.crunchbase.com/organization/webmonterey',
    'https://www.alignable.com/monterey-ca/webmonterey',
    'https://www.yelp.com/biz/webmonterey-monterey',
  ],
} as const;

/**
 * Which surface the click came from. Kept separate from utm_content so the report can tell a
 * page click from an email click without splitting it per client.
 */
export type CreditMedium = 'website' | 'email';

/**
 * The client's domain as a UTM label rather than as a domain. Dots only - the value is
 * otherwise left exactly as webmonterey.json wrote it, so what lands in the report is still
 * recognizably the site it came from.
 */
export function contentTag(domain: string): string {
  return domain.replace(/\./g, '_');
}

/** The attributed link to the agency for one client site. */
export function creditUrl(domain: string, medium: CreditMedium = 'website'): string {
  const params = new URLSearchParams({
    utm_source: 'client',
    utm_medium: medium,
    utm_campaign: 'webmaster',
    /* See the note above: a dot here is a link waiting to be made out of the query string. */
    utm_content: contentTag(domain),
  });

  return `${AGENCY.url}?${params}`;
}
