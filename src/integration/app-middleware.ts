/*
 * THE WEB APP'S PUBLIC PATH, when it differs from the folder.
 *
 * The app lives at src/pages/webapp/ on every site, and by default is served at /webapp/. A
 * client whose customers log in does not want the framework's folder name in their address bar,
 * so webmonterey.json's `app.path` lets them say `portal` - and this is the piece that makes
 * that true: `/portal/dashboard` is rewritten to render `/webapp/dashboard` while the browser
 * URL stays put.
 *
 * INJECTED BY THE INTEGRATION, not written by the site, and only when `app.enabled` is on AND
 * the path differs from the folder. With the default path there is nothing to rewrite and this
 * module is never loaded. A site's own src/middleware.ts, if it has one, runs after this.
 *
 * The folder name is also REDIRECTED to the public path, so one page cannot answer at two URLs
 * - a canonical problem search engines report, and a leak of the framework's naming into a
 * client's product.
 *
 * Everything under the folder must be `prerender = false`. A rewrite can only land on a route the
 * Worker renders; a prerendered page under src/pages/webapp/ is a static file the asset router
 * serves at its own path and this never sees. `webm doctor` checks.
 */
import { defineMiddleware } from 'astro:middleware';
import site from 'virtual:webm/site';
import { APP_DIR, appEnabled, resolveAppPath } from '../includes/webmonterey/config.ts';

const publicPath = resolveAppPath(site);
const active = appEnabled(site) && publicPath !== APP_DIR;

const under = (pathname: string, segment: string) =>
  pathname === `/${segment}` || pathname.startsWith(`/${segment}/`);

export const onRequest = defineMiddleware((context, next) => {
  if (!active) return next();
  const { pathname } = context.url;

  if (under(pathname, publicPath)) {
    return context.rewrite(`/${APP_DIR}${pathname.slice(publicPath.length + 1)}`);
  }
  if (under(pathname, APP_DIR)) {
    return context.redirect(`/${publicPath}${pathname.slice(APP_DIR.length + 1)}`, 301);
  }
  return next();
});
