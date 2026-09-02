/*
 * /webmaster/og.png - the webmaster page's share image, served FROM THE PACKAGE.
 *
 * public/ is copied verbatim from the site root and the package cannot add to it; a file seeded
 * there is written once and never refreshed. This endpoint serves the image out of the package
 * instead, so it is same-origin on every site, needs nothing in the client's repo, and a
 * redesign reaches every site on `npm update`. Prerendered, so the deployed result is a plain
 * static file.
 *
 * The bytes arrive through a virtual module rather than a file read: the Cloudflare adapter
 * builds routes for the workerd target, where `import.meta.url` is not a file URL and a
 * relative `new URL()` throws at prerender. The integration reads the file in Node and inlines
 * it. See integration/index.ts.
 *
 * The page reads the image's measured size from the same module, so og:image:width and height
 * are always the file's own.
 */
import type { APIRoute } from 'astro';
import image from 'virtual:webm/webmaster-og';

export const prerender = true;

export const GET: APIRoute = () => {
  const bytes = Uint8Array.from(atob(image.base64), (c) => c.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400',
    },
  });
};
