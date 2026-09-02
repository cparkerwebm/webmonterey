import type { AstroComponentFactory } from 'astro/runtime/server/index.js';
import content000001 from './content/content-000001/content-000001.astro';
import region000001 from './regions/region-000001/region-000001.astro';

/*
 * THE BLOCK REGISTRY - client-owned, because every visible component is.
 *
 * Maps a block `type` in page JSON to the component that renders it. Forgetting an entry is the
 * most common bug in the content model: nothing errors, the build succeeds, and the block renders
 * as nothing.
 */
export const blocks: Record<string, AstroComponentFactory> = {
  'content-000001': content000001,
  'region-000001': region000001,
};

export const registeredTypes = (): string[] => Object.keys(blocks);
