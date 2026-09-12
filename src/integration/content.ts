/*
 * The content collection, for a client's src/content.config.ts.
 *
 * Astro requires that file at a FIXED path in the client repo, so the package cannot own it.
 * What the package can own is the page schema - everything except the block union, which is
 * necessarily site-local because every component is.
 *
 * A client's content.config.ts becomes:
 *
 *     import { webmontereyCollections } from '@cparkerwebm/webmonterey/content';
 *     import { schema as content000001 } from './components/content/content-000001/schema.ts';
 *     export const collections = webmontereyCollections([content000001]);
 *
 * WHY THE UNION MATTERS: it is what makes a typo in page JSON a BUILD ERROR rather than a blank
 * space on the page. Generation 2 used `z.looseObject({ type: z.string() })` until v1.3 purely
 * because there was no component to build a union from, and that version accepted any typo
 * silently - the block rendered as nothing, with only a console warning.
 *
 * The schema itself is in blocks.ts, which has no Astro import and is where it is tested.
 */
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { pageSchema, type BlockSchema } from './blocks.ts';

export type { BlockSchema } from './blocks.ts';

/**
 * @param blockSchemas Every component's schema. Each must be an object schema with a literal
 *   `type` matching its folder ID. Empty on a site with no component yet - see blockUnion.
 */
export function webmontereyCollections<const T extends readonly BlockSchema[]>(blockSchemas: T) {
  const pages = defineCollection({
    /*
     * One JSON file per page; the filename is the route.
     *   src/content/pages/home.json         ->  /
     *   src/content/pages/about.json        ->  /about
     *   src/content/pages/services/seo.json ->  /services/seo
     * `home` is the only special case - see the router.
     */
    loader: glob({ base: './src/content/pages', pattern: '**/*.json' }),
    schema: pageSchema(blockSchemas),
  });

  return { pages };
}
