/*
 * The agency credit's wording and link, in ONE place.
 *
 * Two surfaces render this credit and they cannot share a component: the site footer is an
 * .astro component with scoped CSS, and transactional email is a string with inline styles
 * (email clients strip <style> blocks). Without this module the wording exists twice, and the
 * next time it changes one copy gets missed — which is exactly how "a WebMonterey website"
 * would have survived in email after the footer moved to "Powered by WebMonterey".
 *
 * utm_content is ALWAYS the production domain from webmonterey.json, never the host the page
 * happens to be served from. A preview build at `feature-x-webm-example-com.workers.dev`
 * still reports the client's own domain, so staging traffic does not fragment the attribution.
 *
 * IT IS WRITTEN WITH UNDERSCORES — `example_com`, not `example.com`. A dot makes the value look
 * like a hostname, and analytics UIs read it as one rather than as the label it is. Underscores
 * keep it a label. Every dot goes, subdomains included: `sub.example.co.uk` is `sub_example_co_uk`.
 *
 * This comment used to also claim a mail client would linkify `example.com` inside the query
 * string and truncate the URL there. That does not apply: auto-linkification acts on plain text,
 * and here the URL only ever appears inside an href. Corrected rather than deleted, because a
 * justification that does not survive scrutiny invites someone to reverse the decision it
 * defends — and the analytics reason on its own is enough.
 *
 * The link points at the WebMonterey home page, not a /credits landing page. The UTM
 * parameters carry the whole story, so the destination stays the main site and there is no
 * separate page to keep alive. utm_medium is what separates the two surfaces: `website` from
 * the footer, `email` from a transactional template.
 */

/** The credit wording. Rendered verbatim on the site and in email. */
export const CREDIT_TEXT = 'Powered by WebMonterey';

/**
 * Which surface the click came from. Kept separate from utm_content so the report can tell
 * a footer click from an email click without splitting it per client.
 */
export type CreditMedium = 'website' | 'email';

/**
 * The client's domain as a UTM label rather than as a domain. Dots only — the value is
 * otherwise left exactly as webmonterey.json wrote it, so what lands in the report is still
 * recognisably the site it came from.
 */
export function contentTag(domain: string): string {
  return domain.replace(/\./g, '_');
}

/** The attributed credit link for one client site. */
export function creditUrl(domain: string, medium: CreditMedium = 'website'): string {
  const params = new URLSearchParams({
    utm_source: 'client',
    utm_medium: medium,
    utm_campaign: 'credits',
    /* See the note above: a dot here is a link waiting to be made out of the query string. */
    utm_content: contentTag(domain),
  });

  return `https://webmonterey.com/?${params}`;
}
