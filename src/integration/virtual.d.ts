/*
 * The virtual modules the integration provides.
 *
 * These do not exist on disk. Each resolves at build time to something in the CLIENT repo, which
 * a package cannot import relatively - see includes/webmonterey/config.ts.
 */
/**
 * What this build is FOR. `preview` is true on any Workers Builds branch other than the
 * production one - every page noindex, no sitemap, no analytics. A local build is not a preview.
 */
declare module 'virtual:webm/build' {
  const build: { preview: boolean; branch: string | null };
  export default build;
}

declare module 'virtual:webm/site' {
  import type { SiteConfig } from '../includes/webmonterey/config.ts';
  const config: SiteConfig;
  export default config;
}

declare module 'virtual:webm/design' {
  import type { DesignSystem } from '../design/types.ts';
  const design: DesignSystem;
  export default design;
}

/** The compiled token layer. Side-effect import only. */
declare module 'virtual:webm/tokens.css';

/** Which icon files exist in the site's public/. The layout links only what is really there. */
declare module 'virtual:webm/icons' {
  const icons: Record<string, boolean>;
  export default icons;
}

/** The client's own stylesheet - src/styles/custom/. Side-effect import only. */
declare module 'virtual:webm/custom';

/** The webmaster page's share image - bytes as base64 and its measured size - from the package. */
declare module 'virtual:webm/webmaster-og' {
  const image: { base64: string; width: number | null; height: number | null };
  export default image;
}

/**
 * The real pixel size of `public/opengraph.png`, measured at build time, or null when there is
 * no readable file there. Nothing else can check it: public/ is copied verbatim.
 */
declare module 'virtual:webm/share-image' {
  const size: { width: number; height: number } | null;
  export default size;
}

declare module 'virtual:webm/registry' {
  import type { AstroComponentFactory } from 'astro/runtime/server/index.js';
  /** Maps a block `type` in page JSON to the component that renders it. */
  export const blocks: Record<string, AstroComponentFactory>;
  /** Every registered block type, so the router can report an unknown one usefully. */
  export const registeredTypes: () => string[];
  /**
   * The site header, rendered once into the layout's `header` slot on every package route.
   *
   * NOT a member of `blocks`. A registered type is addressable from a page's JSON, and a page
   * listing its header as a block would stack a second one under the real one.
   */
  export const header: AstroComponentFactory | null;
  /** The site footer. Same contract as `header`. */
  export const footer: AstroComponentFactory | null;
  /**
   * Overlays rendered once at the end of `<body>` - a mobile menu panel, a CTA drawer.
   *
   * They have to sit outside `<main>` to be positioned above everything, so a site with either
   * has no way to render it through the block system.
   */
  export const panels: AstroComponentFactory[];
  /**
   * Rendered in place of the router's plain `<h1>` when a page has `showTitle`.
   *
   * Receives the page's whole frontmatter, so a site's header can use fields the package has
   * never heard of - a subtitle, header photos, a category. Without this seam a site that wants
   * anything more than an `<h1>` has to fork the router, and a forked router stops receiving
   * every later fix to block lookup, unknown-type reporting and FAQ extraction.
   */
  export const pageHeader: AstroComponentFactory | null;
  /**
   * The site's JSON-LD, rendered into <head> on every indexable route. The package emits none of
   * its own; this component composes a graph from the builders in
   * `@cparkerwebm/webmonterey/structured-data`, and receives `{ title, description, image }`
   * for the page being rendered. Null means no structured data on this site.
   */
  export const structuredData: AstroComponentFactory | null;
}

declare module 'virtual:webm/forms' {
  /** Every form definition in the client repo, keyed by id (the filename). */
  export const FORMS: Record<
    string,
    {
      name: string;
      fields: { name: string; label: string; required?: boolean }[];
      notify: { to: string[]; subject: string };
      autoresponse?: { subject: string; body: string };
      /**
       * Opt this ONE form out of Turnstile, even with `features.turnstile` on.
       *
       * For a form whose component renders no widget - a newsletter box with a single inline
       * field. Such a form mints no token, so verifying it rejects every real submission while
       * looking completely normal. Omit it and the form is verified, which is the safe default.
       */
      turnstile?: boolean;
      /** Rename the honeypot trap, or `false` to disable it. See includes/webmonterey/forms. */
      honeypot?: string | false;
    }
  >;
}
