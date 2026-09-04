---
name: webmaster
description: Make the package's /webmaster page look like this site's other document pages by exporting a `webmasterPage` layout component from the registry. Use for "the webmaster page looks different", "style /webmaster like /privacy", "webmaster page layout", "webmasterPage".
---

# The `/webmaster` page

**The package owns the page; this site may own its shape.** `/webmaster` is injected on every
site: who built it, who to call. The route, the words, the document title, the meta description,
the share image and the agency JSON-LD are the package's, so the page says the same thing on
every site. Without help it renders as an `<h1>` (or this site's `pageHeader`) and a stack of
paragraphs - which looks like a different site the moment the site's own document pages have a
richer layout.

**Do not add `src/pages/webmaster.astro`.** It collides with the injected route, and the injected
route wins. The seam is a registry export.

## What the component receives

```ts
interface WebmasterPageProps {
  title: string; // text - also the document title
  description: string; // text - also the meta description
  intro: string; // HTML - the first paragraph, agency link already in it
  body: string[]; // HTML - one entry per remaining paragraph
}
```

`intro` and `body` are already HTML: the agency link with its UTM parameters, and the copy's own
inline formatting (`**bold**`, `_italic_`, `[text](/url)`) rendered and escaped. Render them with
`set:html`. `title` and `description` are text.

**The component carries no copy of its own.** Not a heading, not a caption, not a sentence. The
words are the same on every site; when a client wants them changed, that is `copy.webmaster` in
`webmonterey.json` (`title`, `description`, `intro.before`, `intro.after`, `body[]`), never the
component.

## 1. Find this site's document layout

Look at how the privacy or terms page is rendered - usually one long-form block under
`src/components/content/`. The webmaster page should reuse **that block's markup and classes**,
so a change to the document style reaches both.

## 2. Write the component

`src/components/general/webmaster-page.astro`. The reference below is complete and works on any
site; replace the element names and classes with the document block's own.

```astro
---
/*
 * The /webmaster page body. The package hands in the copy; this lays it out like the site's
 * other document pages. See /webm:webmaster.
 */
import type { WebmasterPageProps } from '@cparkerwebm/webmonterey/webmonterey/webmaster';

type Props = WebmasterPageProps;

const { title, intro, body } = Astro.props;
---

<section class="webm-section" data-space="lg">
  <div class="webm-container" data-width="text">
    <article class="doc">
      <header class="doc__head">
        <h1 class="doc__title">{title}</h1>
      </header>
      <div class="doc__panel">
        <p set:html={intro} />
        {body.map((paragraph) => <p set:html={paragraph} />)}
      </div>
    </article>
  </div>
</section>
```

If the document block is itself a component that takes `title` and a slot or `html` prop, render
it directly rather than copying its markup:

```astro
---
import Doc from '../content/content-000001/content-000001.astro';
const { title, intro, body } = Astro.props;
---

<Doc title={title}>
  <p set:html={intro} />
  {body.map((paragraph) => <p set:html={paragraph} />)}
</Doc>
```

## 3. Export it

```ts
// src/components/registry.ts
export { default as webmasterPage } from './general/webmaster-page.astro';
```

Not an entry in `blocks` - it is not addressable from page JSON. A named export beside
`pageHeader` and `structuredData`.

## 4. Verify

```sh
npm run build
```

Then read `dist/client/webmaster/index.html`:

- the body is the new markup, and there is no `webm-stack` div left from the built-in layout
- the `<h1>` is the package's title (`Our Webmaster` unless `copy.webmaster.title` is set)
- the first paragraph has one `<a href="https://webmonterey.com/?utm_source=client…"
target="_blank" rel="noopener">` and nothing else links off-site
- `<title>`, `meta name="description"`, `og:image` (`/webmaster/og.png`) and the
  `application/ld+json` block are present and unchanged from before the export

Then push and compare `/webmaster` against `/privacy` on the preview URL: same heading style,
same panel, the package's words.
