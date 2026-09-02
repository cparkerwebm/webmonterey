// @ts-check
import { defineConfig } from 'astro/config';
import webmonterey, { adapter } from '@cparkerwebm/webmonterey';

/*
 * The adapter is named here, not set by the integration. An adapter registered through
 * updateConfig does not run its own hooks, and the build then fails on the first on-demand route.
 */
export default defineConfig({
  adapter: adapter(),
  integrations: [webmonterey()],
});
