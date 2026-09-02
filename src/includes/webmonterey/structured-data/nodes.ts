/*
 * STRUCTURED DATA, AS PARTS RATHER THAN AS A VERDICT.
 *
 * WHY THIS FILE EXISTS. The package used to ship one component that built nineteen node types and
 * emitted them, and every site got an agency's idea of what a business is. It was absorbed whole
 * from webmonterey.com on the reasoning that one site's improvement should become every site's -
 * which is right about improvements and wrong about opinions. A candidate, a recording studio, a
 * library charity and a compliance platform are not variants of one shape. Chasing that, the
 * component gained `place`, `breadcrumbs`, a page `description`, then `description` and `image`
 * on the Person node - six additions in a day - and afterwards a candidate site still could not
 * say `affiliation` and was still replacing the whole thing.
 *
 * THE SPLIT. Serialising a graph is identical on every site: one `@graph` rather than loose
 * islands so nodes can reference each other by `@id`, `<` escaped so a value cannot close the
 * script tag, empty fields dropped, nothing emitted for a noindex page. That is thirty lines and
 * it belongs here. WHICH nodes, with WHICH fields, is what the site is claiming about itself, and
 * that belongs to the site.
 *
 * So this exports building blocks and a serializer, and the package emits NOTHING by default. A
 * site composes its graph in a component it exports as `structuredData` from its registry; the
 * layout renders that into <head> on every indexable route with { title, description, image }:
 *
 *     ---
 *     import { graphContext, renderJsonLd, organizationNode, websiteNode, webPageNode }
 *       from '@cparkerwebm/webmonterey/structured-data';
 *     const { title, description, image } = Astro.props;
 *     const ctx = graphContext(Astro.site!, Astro.url.pathname, { title, description });
 *     const jsonLd = renderJsonLd([
 *       organizationNode(ctx, image),
 *       websiteNode(ctx),
 *       webPageNode(ctx),
 *       breadcrumbNode(ctx),
 *     ]);
 *     ---
 *     {jsonLd && <script type="application/ld+json" set:html={jsonLd} />}
 *
 * The parts are here so sites do not each rewrite a PostalAddress. The composition is not, so
 * the package never again has to grow a field to describe somebody else's business.
 * /webm:launch is where a site's graph gets decided.
 */
import { client, domain, hasClient, organization as org } from '../site.ts';

/** Everything a node builder needs to make stable @id values and absolute URLs. */
export interface GraphContext {
  /** The site origin, from Astro.site. */
  site: URL;
  /** This page's canonical URL, normalised the same way the canonical tag builds it. */
  url: string;
  title?: string;
  description?: string;
  /** `@id` of the organization node, for anything that references it. */
  orgId: string;
  /** `@id` of the website node. */
  siteId: string;
}

export function graphContext(site: URL, pathname: string, extra: Partial<GraphContext> = {}) {
  return {
    site,
    url: new URL(pathname, site).href,
    orgId: new URL('#organization', site).href,
    siteId: new URL('#website', site).href,
    ...extra,
  } as GraphContext;
}

/** Drop empty strings, empty arrays, null and undefined — never emit a blank field. */
export function compact<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, v]) => {
      if (v === null || v === undefined) return false;
      if (typeof v === 'string') return v.trim() !== '';
      if (Array.isArray(v)) return v.length > 0;
      return true;
    }),
  ) as Partial<T>;
}

/**
 * The graph, as the string that goes inside one <script type="application/ld+json">.
 *
 * `<` is escaped to its \\u003c form. Inside a script element the HTML parser is still looking for
 * `</script>`, so any value containing that sequence would close the block early and spill the
 * rest into the document as markup. These values come from config rather than from visitors, but
 * the escape costs nothing and the failure mode is markup injection.
 *
 * Returns null for an empty graph, so a caller renders no script rather than an empty one.
 */
export function renderJsonLd(nodes: unknown[]): string | null {
  const graph = nodes.filter(Boolean);
  if (graph.length === 0) return null;
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(
    /</g,
    '\\u003c',
  );
}

/** The address, or null when the config carries none. Shared by the organization and any Place. */
export function addressNode() {
  const address = compact({
    '@type': 'PostalAddress',
    streetAddress: org.streetAddress,
    addressLocality: org.addressLocality,
    addressRegion: org.addressRegion,
    postalCode: org.postalCode,
    addressCountry: org.addressCountry,
  });
  /*
   * compact() leaves the discriminator behind, so a PostalAddress carrying only its own @type is
   * an empty node. The length check is what actually decides whether there is an address at all.
   */
  return Object.keys(address).length > 1 ? address : null;
}

/** The organization. Its @type comes from config — Organization, NGO, LocalBusiness, whatever fits. */
export function organizationNode(ctx: GraphContext, image?: string) {
  return compact({
    '@type': org.type || 'Organization',
    '@id': ctx.orgId,
    name: hasClient ? client : domain,
    legalName: org.legalName,
    description: org.description,
    url: ctx.site.href,
    image,
    /*
     * THE LOGO IS NOT THE SHARE IMAGE. Both were `image` once, which published a 1200x630 social
     * banner as the organisation's mark - the thing a knowledge panel draws. Omitted when unset
     * rather than falling back to the card: a wrong logo is worse than no logo, and Google wants
     * at least 112x112.
     */
    logo: org.logo ? new URL(org.logo, ctx.site).href : '',
    telephone: org.telephone,
    email: org.email,
    address: addressNode() ?? '',
    areaServed: org.areaServed,
    priceRange: org.priceRange,
    openingHoursSpecification: org.hours?.opens
      ? {
          '@type': 'OpeningHoursSpecification',
          dayOfWeek: org.hours.days,
          opens: org.hours.opens,
          closes: org.hours.closes,
        }
      : '',
    sameAs: org.sameAs,
    founder: org.founder?.name ? { '@id': new URL('#founder', ctx.site).href } : '',
    employee: org.founder?.name ? { '@id': new URL('#founder', ctx.site).href } : '',
    hasOfferCatalog: org.services?.length
      ? {
          '@type': 'OfferCatalog',
          name: 'Services',
          itemListElement: org.services.map((name) => ({
            '@type': 'Offer',
            itemOffered: { '@type': 'Service', name },
          })),
        }
      : '',
  });
}

/** The person behind the organization, from `organization.founder`. */
export function personNode(ctx: GraphContext) {
  if (!org.founder?.name) return null;
  return compact({
    '@type': 'Person',
    '@id': new URL('#founder', ctx.site).href,
    name: org.founder.name,
    jobTitle: org.founder.jobTitle,
    description: org.founder.description,
    image: org.founder.image ? new URL(org.founder.image, ctx.site).href : '',
    url: ctx.site.href,
    worksFor: { '@id': ctx.orgId },
    sameAs: org.founder.sameAs,
  });
}

export function websiteNode(ctx: GraphContext) {
  return compact({
    '@type': 'WebSite',
    '@id': ctx.siteId,
    url: ctx.site.href,
    name: hasClient ? client : domain,
    description: org.description,
    publisher: { '@id': ctx.orgId },
    inLanguage: 'en',
  });
}

export function webPageNode(ctx: GraphContext) {
  return compact({
    '@type': 'WebPage',
    '@id': `${ctx.url}#webpage`,
    url: ctx.url,
    name: ctx.title,
    description: ctx.description,
    isPartOf: { '@id': ctx.siteId },
    about: { '@id': ctx.orgId },
    inLanguage: 'en',
  });
}

/** A physical place — the ONE page that is the place, never site-wide. */
export interface PlaceInput {
  type: 'BookStore' | 'Store' | 'Place';
  name: string;
  streetAddress: string;
  addressLocality: string;
  addressRegion: string;
  postalCode: string;
  addressCountry: string;
  telephone?: string;
  openingHours: { days: string[]; opens: string; closes: string }[];
}

export function placeNode(ctx: GraphContext, place: PlaceInput, image?: string) {
  return compact({
    '@type': place.type,
    '@id': `${ctx.url}#place`,
    name: place.name,
    url: ctx.url,
    telephone: place.telephone,
    image,
    address: {
      '@type': 'PostalAddress',
      streetAddress: place.streetAddress,
      addressLocality: place.addressLocality,
      addressRegion: place.addressRegion,
      postalCode: place.postalCode,
      addressCountry: place.addressCountry,
    },
    openingHoursSpecification: place.openingHours.map((slot) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: slot.days,
      opens: slot.opens,
      closes: slot.closes,
    })),
    parentOrganization: { '@id': ctx.orgId },
  });
}

/**
 * A breadcrumb trail, root first, INCLUDING the current page as the last crumb.
 *
 * A single-item trail is omitted: "Home" on its own is not a trail and Google ignores it.
 * The caller supplies the names because only the route knows them - deriving from the URL gives
 * a slug where a name belongs, which is how /programs/chess-club/ published its middle step as
 * nothing at all.
 */
export function breadcrumbNode(ctx: GraphContext, trail?: { name: string; path: string }[]) {
  /*
   * NO TRAIL GIVEN? DERIVE A TWO-LEVEL ONE FROM THE PATH.
   *
   * This fallback is load-bearing and was nearly lost splitting this file out: dropping it took
   * the BreadcrumbList off thirty-two inner pages across two sites at once, silently, because
   * structured data has no visible surface to notice it on. Most pages pass nothing and rely on
   * exactly this.
   *
   * Two levels is all derivation can honestly give - the middle segment of /programs/chess-club/
   * is a slug here, not a name. A route that knows its own hierarchy passes the trail.
   */
  if (!trail) {
    const segments = new URL(ctx.url).pathname.split('/').filter(Boolean);
    if (segments.length === 0) return null;
    return {
      '@type': 'BreadcrumbList',
      '@id': `${ctx.url}#breadcrumb`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: ctx.site.href },
        {
          '@type': 'ListItem',
          position: 2,
          name: ctx.title ?? segments[segments.length - 1],
          /*
           * The last crumb carries its URL too. Google treats `item` as optional on the final
           * element, so omitting it is valid - but a breadcrumb whose last entry has no address is
           * less useful to anything reading the graph, and generation 2 emitted it.
           */
          item: ctx.url,
        },
      ],
    };
  }
  if (trail.length < 2) return null;
  return {
    '@type': 'BreadcrumbList',
    '@id': `${ctx.url}#breadcrumb`,
    itemListElement: trail.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: new URL(crumb.path, ctx.site).href,
    })),
  };
}

/**
 * FAQPage. Worth emitting for entity understanding and AI search, but NOT for Google rich
 * results: those were restricted to government and health sites in August 2023.
 *
 * ONLY EVER PASS QUESTIONS VISIBLE ON THE PAGE. Structured data describing content a visitor
 * cannot see is a manual-action risk, not a shortcut.
 */
export function faqNode(ctx: GraphContext, faq: Array<{ question: string; answer: string }>) {
  if (!faq?.length) return null;
  return {
    '@type': 'FAQPage',
    '@id': `${ctx.url}#faq`,
    isPartOf: { '@id': `${ctx.url}#webpage` },
    mainEntity: faq.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };
}
