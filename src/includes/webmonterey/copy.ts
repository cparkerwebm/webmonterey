/*
 * THE RESOLVED COPY: package defaults with the site's overrides merged over them.
 *
 * Split from ./copy-defaults.ts because this half imports `virtual:webm/site`, which only exists
 * inside a Vite build. Anything unit-tested outside one - the email templates - imports the
 * defaults and takes overrides as input instead.
 */
import site from 'virtual:webm/site';
import { DEFAULT_COPY, merge, type Copy } from './copy-defaults.ts';

export { DEFAULT_COPY, fill, type Copy } from './copy-defaults.ts';

export const copy: Copy = merge(DEFAULT_COPY, (site as { copy?: unknown }).copy);
