/*
 * The Cloudflare adapter, pre-configured.
 *
 * WHY THIS IS A SEPARATE EXPORT AND NOT SET BY THE INTEGRATION.
 *
 * An adapter set through `updateConfig` from inside `astro:config:setup` does NOT get its own
 * integration hooks run. Astro accepts the config, the build starts, and then dies with:
 *
 *   [UNRESOLVED_ENTRY] Cannot resolve entry module virtual:astro:legacy-ssr-entry
 *
 * the moment any route is on-demand. A fully static site never notices, which is exactly how it
 * survived: examples/minimal had no `prerender = false` route and no form, so it built cleanly
 * while the form pipeline - the thing the package exists to provide - could not build at all.
 *
 * Reproduced against bare Astro: identical config, adapter in `defineConfig` builds, adapter via
 * `updateConfig` fails. Generation 1 already knew this and shipped `@cparkerwebm/webmonterey/adapter`
 * for the same reason.
 *
 * So the client's astro.config.mjs names the adapter itself:
 *
 *     import { defineConfig } from 'astro/config';
 *     import webmonterey, { adapter } from '@cparkerwebm/webmonterey';
 *
 *     export default defineConfig({
 *       adapter: adapter(),
 *       integrations: [webmonterey()],
 *     });
 *
 * Two lines rather than one, and the site does not take a direct dependency on
 * @astrojs/cloudflare - the package still owns which adapter and how it is configured.
 */
import cloudflare from '@astrojs/cloudflare';

export interface AdapterOptions {
  /**
   * Override only with a reason.
   *
   * 'compile' optimizes images at BUILD with sharp. The adapter's own default is
   * 'cloudflare-binding', which transforms at request time through Cloudflare Images - a separate,
   * paid product. For a static marketing site that is slower and an unnecessary dependency: every
   * image is known at build, so it should be resized once rather than per request.
   *
   * Switch only for genuine runtime transforms - user uploads, or remote images whose dimensions
   * are unknown until requested.
   */
  imageService?: 'compile' | 'cloudflare-binding' | 'passthrough';
}

export function adapter(options: AdapterOptions = {}) {
  return cloudflare({ imageService: options.imageService ?? 'compile' });
}

export default adapter;
