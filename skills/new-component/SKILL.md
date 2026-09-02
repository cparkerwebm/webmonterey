---
name: new-component
description: Add a new page block to a WebMonterey site - the folder, the schema, the registry entry and the content union. Use for "build a hero", "add a testimonial section", "we need a pricing table", "make a new block type".
---

# New component

**The package ships zero visible components.** Every block a visitor sees is built here, in this
repo, for this client. That is deliberate: generation 1 shipped framework chrome and every site
overrode it.

## Component IDs

A folder named `{singular-type}-{6 digits}`, containing an `.astro` file of the same name plus
its `schema.ts`:

```
src/components/content/content-000004/
  content-000004.astro
  schema.ts
```

IDs are allocated sequentially **per type** and never reused. Check what exists before picking one.

| Folder        | Holds                                                   | Prefix       |
| ------------- | ------------------------------------------------------- | ------------ |
| `asides/`     | supporting content beside the main flow                 | `aside-`     |
| `content/`    | the main page content blocks                            | `content-`   |
| `general/`    | shared primitives — the fallback when nothing else fits | `general-`   |
| `interfaces/` | interactive UI                                          | `interface-` |
| `regions/`    | page chrome — header, footer, nav                       | `region-`    |

## Three places, and missing either of the last two fails differently

**1. The folder.** Schema first, then markup.

```ts
// schema.ts
import { z } from 'astro/zod';

export const schema = z.object({
  type: z.literal('content-000004'),
  heading: z.string(),
  body: z.array(z.string()).default([]),
});
```

**2. `src/components/registry.ts`** — two lines, an import and a map entry. The key **must** equal
the folder ID and the `type` in page JSON.

> **Forgetting this is the most common bug in the content model.** Nothing errors. `astro check`
> passes, the build succeeds, and the block renders as nothing. The router logs a warning at build
> time — read the build output.

**3. `src/content.config.ts`** — add the schema to the union passed to `webmontereyCollections`.

Miss the registry and the block validates but renders as nothing. Miss the union and valid JSON
fails to build.

## Styling

**Tokens only. No literal values.** Every color, space, size, radius, shadow, z-index, duration
and easing is a `--webm-*` custom property. `webm doctor` warns on literal colors in component CSS.

To retheme, change the **token** in `design.json` — one declaration cascades everywhere.

**A class used by more than one page belongs in a shared stylesheet.** Astro scopes a component's
`<style>` to that component's markup, so a class defined in one page's `<style>` and used in
another renders completely unstyled — no error, no warning, a bare element. This bit one client
build five separate times.

## Build it in isolation

`/webm` is a scratch route for exactly this — noindex, excluded from the sitemap. Compose the
block there, get it right, then wire it into a page. **Leave it empty when done.**

## Verify

```sh
npm run check
npm run preview   # NOT dev - preview is a real build on real workerd
```

`dev` cannot detect CSS bundling, cascade order, or the asset router. Every trap worth catching is
invisible in `dev` and visible in `preview`. See `/webm:traps`.
