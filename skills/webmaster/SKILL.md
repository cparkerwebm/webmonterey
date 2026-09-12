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
  cta: { label: string; href: string }; // the outbound button: text, and the attributed URL
}
```

`intro` and `body` are already HTML: the agency link with its UTM parameters, and the copy's own
inline formatting (`**bold**`, `_italic_`, `[text](/url)`) rendered and escaped. Render them with
`set:html`. `title` and `description` are text. The client's name is already filled in wherever
the copy says `{client}`.

`cta` is the "Visit WebMonterey" button. Render it as a link in the site's outline button style,
with `AGENCY_CTA_ATTRS` (from the same import) spread on. It carries the `target` and `rel` the
intro link has, plus a `data-webm-cta` marker the package styles: a 25px floor above the button,
so it never sits on the paragraph whatever the site's own paragraph spacing is. **A layout
written before 1.6.0 spreads `AGENCY_LINK_ATTRS` on the button; `webm upgrade` rewrites that, or
swap the name by hand.**

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
import {
  AGENCY_CTA_ATTRS,
  type WebmasterPageProps,
} from '@cparkerwebm/webmonterey/webmonterey/webmaster';

type Props = WebmasterPageProps;

const { title, intro, body, cta } = Astro.props;
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
        <p>
          <a class="button button--outline" href={cta.href} {...AGENCY_CTA_ATTRS}>{cta.label}</a>
        </p>
      </div>
    </article>
  </div>
</section>
```

`button button--outline` stands for whatever this site's outline button class is - the one its
own blocks use.

If the document block is itself a component that takes `title` and a slot or `html` prop, render
it directly rather than copying its markup:

```astro
---
import { AGENCY_CTA_ATTRS } from '@cparkerwebm/webmonterey/webmonterey/webmaster';
import Doc from '../content/content-000001/content-000001.astro';
const { title, intro, body, cta } = Astro.props;
---

<Doc title={title}>
  <p set:html={intro} />
  {body.map((paragraph) => <p set:html={paragraph} />)}
  <p><a class="button button--outline" href={cta.href} {...AGENCY_CTA_ATTRS}>{cta.label}</a></p>
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
- the first paragraph names this client and has one
  `<a href="https://webmonterey.com/?utm_source=client…" target="_blank" rel="noopener">`; the
  "Visit WebMonterey" button is the only other off-site link, to the same URL with the same
  attributes plus `data-webm-cta`
- `<title>`, `meta name="description"`, `og:image` (`/webmaster/og.png`) and the
  `application/ld+json` block are present and unchanged from before the export

Then push and compare `/webmaster` against `/privacy` on the preview URL: same heading style,
same panel, the package's words.
