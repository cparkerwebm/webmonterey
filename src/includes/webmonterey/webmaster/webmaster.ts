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

import { escapeHtml, renderInline } from '../prose/inline.ts';
import { fill } from '../copy-defaults.ts';

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
    'A webmaster service in Monterey, California: design, build, hosting, security and ongoing care for small-business websites.',
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

/**
 * What the site's `webmasterPage` component receives, when a site exports one from its
 * registry: the merged copy, already resolved. The component lays it out and carries no copy of
 * its own - the words are the package's on every site, the shape of the page is the client's.
 *
 * `intro` and `body` are HTML, rendered with `set:html`. They are the output of `renderInline`,
 * so a paragraph in `copy.webmaster` may carry the same inline subset page prose does -
 * `**bold**`, `_italic_`, `[text](/url)` - and everything else is escaped.
 */
export interface WebmasterPageProps {
  /** `copy.webmaster.title`, also the document title. Text. */
  title: string;
  /** `copy.webmaster.description`, also the meta description. Text. */
  description: string;
  /** The first paragraph's inner HTML, with the agency link already resolved. */
  intro: string;
  /** The remaining paragraphs' inner HTML, one entry per `<p>`. */
  body: string[];
  /**
   * The outbound button: `copy.webmaster.cta` as text, and the same attributed agency URL the
   * intro links to. Render it as a link with `AGENCY_CTA_ATTRS` spread on - it leaves the site, and
   * the marker in that constant is what spaces it from the paragraph above.
   */
  cta: { label: string; href: string };
}

/**
 * The attributes every link to the agency carries: a new tab because it leaves the site,
 * `noopener` without `noreferrer` because the referrer IS the attribution. One constant, spread
 * by the built-in page and by introHtml, so the intro link and the button cannot disagree.
 */
export const AGENCY_LINK_ATTRS = { target: '_blank', rel: 'noopener' } as const;

/**
 * The attributes the BUTTON carries: the link attributes above, plus a marker the page styles.
 *
 * WHY A MARKER RATHER THAN A CLASS. A site that lays the page out itself puts its own button
 * class on the anchor, and the package cannot know what that class spaces itself with. On one
 * site the button sat almost touching the paragraph above it. The marker travels with the button
 * whatever class it wears, and the page gives it a floor of 25px above - see webmaster.astro. The
 * intro link keeps the plain constant, so the two stay distinguishable.
 */
export const AGENCY_CTA_ATTRS = { ...AGENCY_LINK_ATTRS, 'data-webm-cta': '' } as const;

/**
 * `{client}` in a copy string becomes the client's name; everything else is left alone.
 *
 * WHY THE PAGE NAMES THE CLIENT. The same paragraph on every site the agency builds is duplicate
 * content across the fleet. A paragraph that says whose website this is is not, and it reads as
 * written for the client rather than pasted. `client` is '' on a site that has not set one yet
 * - the CHANGEME placeholder never reaches a page - and then the placeholder simply drops out
 * and the doubled space with it: "This custom website" rather than "This  custom website".
 *
 * Runs BEFORE the inline renderer, so a name with an ampersand is escaped like any other text.
 */
export function personalize(text: string, client: string): string {
  return fill(text, { client }).replace(/ {2,}/g, ' ').trim();
}

/**
 * The intro paragraph's inner HTML: `before` <a>WebMonterey</a> `after`.
 *
 * ONE STRING, because it is the only part of the copy that is not plain text. A site taking
 * over the page layout still gets the agency link exactly as the built-in page renders it - a
 * followed link, opening in a new tab, `noopener` without `noreferrer` because the referrer is
 * the attribution - rather than reassembling three fragments and forgetting one of the
 * attributes. The built-in page renders this same string, so the two cannot drift. The space
 * between `before` and the link is deliberate: Astro drops the whitespace between an expression
 * and an element on separate lines, and "managed byWebMonterey" shipped.
 */
export function introHtml(intro: { before: string; after: string }, href: string): string {
  const attrs = Object.entries(AGENCY_LINK_ATTRS)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');
  const link = `<a href="${escapeHtml(href)}" ${attrs}>${escapeHtml(AGENCY.name)}</a>`;
  return `${renderInline(intro.before)} ${link}${renderInline(intro.after)}`;
}

/**
 * The whole prop set, from the merged copy, the attributed agency link and the client's name.
 * `client` is '' when the site has not set one - see personalize.
 */
export function webmasterPageProps(
  text: {
    title: string;
    description: string;
    intro: { before: string; after: string };
    body: string[];
    cta: string;
  },
  href: string,
  client = '',
): WebmasterPageProps {
  const p = (s: string) => personalize(s, client);
  return {
    title: p(text.title),
    description: p(text.description),
    intro: introHtml({ before: p(text.intro.before), after: p(text.intro.after) }, href),
    body: text.body.map((paragraph) => renderInline(p(paragraph))),
    cta: { label: p(text.cta), href },
  };
}
