/*
 * The page schema, and the block union it is built on - the PURE half of content.ts.
 *
 * content.ts imports `astro:content`, which only resolves inside an Astro build, so nothing in
 * it can be unit tested. Everything with a type worth proving lives here instead: the union that
 * keeps each member's fields, the empty case a fresh scaffold starts in, and the page fields the
 * router reads. r2/url.ts and r2/media.ts are the same split.
 */
import { z } from 'astro/zod';

/*
 * The option type for a discriminated union.
 *
 * DERIVED FROM THE FUNCTION, not imported. astro/zod is zod 4, where the option constraint is
 * `core.$ZodTypeDiscriminable` - an internal export that is not re-exported and would break on a
 * patch release. Zod 3's `ZodDiscriminatedUnionOption` no longer exists, so any snippet using it
 * is pre-v4 and wrong.
 */
export type BlockSchema = Parameters<typeof z.discriminatedUnion>[1][number];

/**
 * The schema for one block, from every component's schema.
 *
 * GENERIC OVER THE TUPLE, so the union keeps each member's fields. Typed as a plain array of
 * options it inferred every block as `unknown`, and a site component reading a block off the
 * collection - structured data pulling FAQ items out of a page - failed `astro check` with
 * "'block' is of type 'unknown'". One site re-parsed every block through its own schema to get
 * round it; another forked the page schema rather than use the helper at all.
 *
 * EMPTY IS ALLOWED, and is `z.never()`: a fresh scaffold has no component yet, and `astro check`
 * - which Workers Builds runs - failed every first push over a one-member minimum the runtime
 * never had. With never, any block in page JSON fails validation with a clear message, which is
 * the right answer on a site with nothing to render it.
 */
export function blockUnion<const T extends readonly BlockSchema[]>(schemas: T): BlockUnion<T> {
  if (schemas.length === 0) return z.never() as BlockUnion<T>;
  return z.discriminatedUnion('type', [...schemas] as unknown as NonEmpty<T>) as BlockUnion<T>;
}

type NonEmpty<T extends readonly BlockSchema[]> = readonly [BlockSchema, ...BlockSchema[]] & T;

export type BlockUnion<T extends readonly BlockSchema[]> = T extends readonly []
  ? z.ZodNever
  : T extends readonly [BlockSchema, ...BlockSchema[]]
    ? z.ZodDiscriminatedUnion<[...T], 'type'>
    : z.ZodDiscriminatedUnion<[...T], 'type'> | z.ZodNever;

/**
 * The page schema every site's collection uses.
 *
 * `noindex`, `shareImage` and the two dimensions are HERE, not only read defensively by the
 * router: a site setting them in page JSON had them stripped by zod, because the schema did not
 * declare them, and one site forked the whole schema for exactly that. Declared, the router
 * forwards them plainly and the fork can go.
 */
export function pageSchema<T extends readonly BlockSchema[]>(blocks: T) {
  return z.object({
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
    /** Keep this page out of search: no index, no canonical, no sitemap entry. */
    noindex: z.boolean().default(false),
    /** The social card, as a public/ path. Omit for the site's default card. */
    shareImage: z.string().optional(),
    /**
     * Its size, when known. Only the default card is measured at build time; another image
     * declares its size here or ships no size tags, which the scrapers fill in themselves.
     */
    shareImageWidth: z.number().int().positive().optional(),
    shareImageHeight: z.number().int().positive().optional(),
    /** Ordered list of blocks. Each `type` must exist in the component registry. */
    blocks: z.array(blockUnion(blocks)).default([]),
  });
}
