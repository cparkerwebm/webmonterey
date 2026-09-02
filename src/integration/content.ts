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
 */
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/*
 * The option type for a discriminated union.
 *
 * DERIVED FROM THE FUNCTION, not imported. astro/zod is zod 4, where the option constraint is
 * `core.$ZodTypeDiscriminable` - an internal export that is not re-exported and would break on a
 * patch release. Zod 3's `ZodDiscriminatedUnionOption` no longer exists, so any snippet using it
 * is pre-v4 and wrong.
 */
type BlockSchema = Parameters<typeof z.discriminatedUnion>[1][number];

/**
 * @param blockSchemas Every component's schema. Each must be an object schema with a literal
 *   `type` matching its folder ID. Zod needs at least one member for a discriminated union.
 */
export function webmontereyCollections(blockSchemas: readonly [BlockSchema, ...BlockSchema[]]) {
  const blockSchema = z.discriminatedUnion('type', [...blockSchemas]);

  const pages = defineCollection({
    /*
     * One JSON file per page; the filename is the route.
     *   src/content/pages/home.json         ->  /
     *   src/content/pages/about.json        ->  /about
     *   src/content/pages/services/seo.json ->  /services/seo
     * `home` is the only special case - see the router.
     */
    loader: glob({ base: './src/content/pages', pattern: '**/*.json' }),
    schema: z.object({
      /** Used for <title>, and rendered as the page's h1 unless `showTitle` is false. */
      title: z.string(),
      /*
       * Defaults TRUE so a page is structurally complete by default: a page whose only headings
       * are the h2s of its prose blocks has no h1 at all, which is a document-outline bug rather
       * than a style preference. Set false on a page whose first block renders its own h1.
       */
      showTitle: z.boolean().default(true),
      /** Meta description. Optional, but set it on any page that matters for search. */
      description: z.string().optional(),
      /** Ordered list of blocks. Each `type` must exist in the component registry. */
      blocks: z.array(blockSchema).default([]),
    }),
  });

  return { pages };
}
