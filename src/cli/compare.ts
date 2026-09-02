/*
 * `webm compare <old-dist> <new-dist>` - did the rebuild change anything a visitor can see?
 *
 * A rebuild moves every file in a site. The only honest way to know it is faithful is to build
 * the old one, build the new one, and diff the OUTPUT - the source is expected to differ
 * everywhere, so comparing source proves nothing.
 *
 * FOUR LAYERS, BECAUSE THE FIRST ONE ALONE LIES. Comparing rendered text on the webmonterey.com
 * rebuild reported "identical on every page" while the site had silently stopped loading its
 * self-hosted typeface: the words were all present, in the wrong font. Text, head, structured
 * data and CSS each catch a different class of regression and none subsumes another.
 *
 *   text    visible words, tags stripped        content loss, duplicated headings
 *   head    meta and link tags                  canonical, robots, Open Graph, favicons
 *   jsonld  the structured-data graph           the SEO surface, which no page shows
 *   css     every declaration in the bundle     fonts, tokens, whole stylesheets not imported
 *
 * Astro's per-build scope hashes are normalized away, or every component rule reads as changed.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface Diff {
  layer: 'text' | 'head' | 'jsonld' | 'css';
  /* Reported, but not a regression - it does not fail the run. Only CSS gains use this: a
   * declaration the new build serves and the old did not is the expected shape of a package
   * upgrade, and staying silent about it made the summary line claim there was no difference
   * at all. Seeing the gain is how you confirm a fix actually reached the bundle. */
  info?: boolean;
  page: string;
  missing: string[];
  added: string[];
}

function walk(dir: string, match: (f: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    return e.isDirectory() ? walk(full, match) : match(e.name) ? [full] : [];
  });
}

/** Visible words, with script, style and comments removed. */
export function visibleText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Every meta and link tag, normalized and sorted - order in <head> is not meaningful.
 *
 * BUNDLER HASHES ARE STRIPPED. `/_astro/base.D8TeHbgD.css` becomes `/_astro/base.css`: the hash
 * is content-derived and changes on every build, so without this every stylesheet and script tag
 * reads as both missing and added on a rebuild that changed nothing. That noise is what makes a
 * comparison tool get ignored.
 */
export function headTags(html: string): string[] {
  const head = html.slice(0, html.indexOf('</head>') + 1);
  return [...head.matchAll(/<(meta|link)\b[^>]*>/gi)]
    .map((m) =>
      m[0]
        .replace(/\s+/g, ' ')
        .replace(/\.[A-Za-z0-9_-]{8,}\.(css|js|woff2?|png|jpg|webp|svg)/g, '.$1')
        /*
         * Server-island preloads carry the island's ENCRYPTED PROPS in the query string, and
         * those are re-encrypted every build. Without this each one reads as both missing and
         * added, on every page that defers anything.
         */
        .replace(/(\/_server-islands\/[A-Za-z0-9_-]+)\?[^"']*/g, '$1'),
    )
    .sort();
}

export function jsonLd(html: string): string {
  const blocks = [
    ...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi),
  ];
  try {
    return JSON.stringify(
      blocks.map((b) => JSON.parse(b[1]!)),
      null,
      1,
    );
  } catch {
    return blocks.map((b) => b[1]).join('\n');
  }
}

/**
 * Every CSS declaration in the bundle, as a set.
 *
 * A set rather than a diff of files: the bundler splits and names files differently between
 * builds, so file-level comparison is noise. What matters is whether a declaration that used to
 * be served still is.
 */
export function cssDeclarations(dist: string): Set<string> {
  /*
   * BOTH SOURCES, and missing the second one makes this lie. Astro INLINES a small stylesheet
   * into the HTML rather than emitting a file, and which way it goes depends on size - so the
   * same rule can be in _astro/*.css on one build and inside <style> on the next. Reading only
   * the files reported a component's entire stylesheet as missing when it had simply moved.
   */
  const inline = walk(dist, (f) => f.endsWith('.html'))
    .flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)])
    .map((m) => m[1]!);

  const css = [
    ...walk(join(dist, '_astro'), (f) => f.endsWith('.css')).map((f) => readFileSync(f, 'utf8')),
    ...inline,
  ]
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    /* Astro's scope hash changes every build; without this every scoped rule reads as changed. */
    .replace(/\[data-astro-cid-[a-z0-9]+\]/gi, '');

  return new Set(
    css
      .split(/[{};]/)
      .map((d) => d.trim())
      .filter((d) => d.includes(':') && d.length < 300),
  );
}

const setDiff = (a: Set<string>, b: Set<string>) => [...a].filter((x) => !b.has(x));
const words = (s: string) => new Set(s.split(' ').filter(Boolean));

export function compare(oldDist: string, newDist: string): Diff[] {
  const diffs: Diff[] = [];
  const pages = walk(oldDist, (f) => f.endsWith('.html')).map((f) => relative(oldDist, f));

  for (const page of pages) {
    const a = readFileSync(join(oldDist, page), 'utf8');
    const bPath = join(newDist, page);
    if (!existsSync(bPath)) {
      diffs.push({ layer: 'text', page, missing: ['THE WHOLE PAGE'], added: [] });
      continue;
    }
    const b = readFileSync(bPath, 'utf8');

    const at = words(visibleText(a));
    const bt = words(visibleText(b));
    if (setDiff(at, bt).length || setDiff(bt, at).length) {
      diffs.push({ layer: 'text', page, missing: setDiff(at, bt), added: setDiff(bt, at) });
    }

    const ah = new Set(headTags(a));
    const bh = new Set(headTags(b));
    if (setDiff(ah, bh).length || setDiff(bh, ah).length) {
      diffs.push({ layer: 'head', page, missing: setDiff(ah, bh), added: setDiff(bh, ah) });
    }

    if (jsonLd(a) !== jsonLd(b)) {
      diffs.push({ layer: 'jsonld', page, missing: ['graph differs'], added: [] });
    }
  }

  const ac = cssDeclarations(oldDist);
  const bc = cssDeclarations(newDist);
  const lost = setDiff(ac, bc);
  const gained = setDiff(bc, ac);
  if (lost.length) {
    /*
     * Only LOST declarations fail. The new build legitimately gains rules - a package base rule
     * that the old site had edited in place now sits alongside the override that supersedes it.
     * A declaration that vanished is the regression.
     */
    diffs.push({ layer: 'css', page: '(bundle)', missing: lost, added: gained });
  } else if (gained.length) {
    diffs.push({ layer: 'css', page: '(bundle)', missing: [], added: gained, info: true });
  }

  return diffs;
}

export function run(argv: string[]): number {
  const [oldDist, newDist] = argv;
  if (!oldDist || !newDist) {
    console.error('webm compare <old-dist/client> <new-dist/client>');
    console.error('\n  Build both sites first. Compares text, head tags, JSON-LD and CSS.');
    return 1;
  }
  for (const d of [oldDist, newDist]) {
    if (!existsSync(d) || !statSync(d).isDirectory()) {
      console.error(`webm compare: no such directory: ${d}`);
      return 1;
    }
  }

  const diffs = compare(oldDist, newDist);
  const pages = walk(oldDist, (f) => f.endsWith('.html')).length;
  const regressions = diffs.filter((d) => !d.info);

  if (!diffs.length) {
    console.log(`webm compare: ${pages} pages, no differences in text, head, JSON-LD or CSS.`);
    return 0;
  }

  for (const d of diffs) {
    console.log(`\n${d.layer.toUpperCase()}${d.info ? ' (not a regression)' : ''}  ${d.page}`);
    for (const m of d.missing.slice(0, 25)) console.log(`  - ${m.slice(0, 160)}`);
    if (d.missing.length > 25) console.log(`  … ${d.missing.length - 25} more missing`);
    for (const a of d.added.slice(0, 10)) console.log(`  + ${a.slice(0, 160)}`);
    if (d.added.length > 10) console.log(`  … ${d.added.length - 10} more added`);
  }
  if (!regressions.length) {
    console.log(
      `\nwebm compare: ${pages} pages, no regressions in text, head, JSON-LD or CSS.` +
        ` The additions above are what the new build serves and the old did not.`,
    );
    return 0;
  }

  console.log(
    `\n${regressions.length} differences across ${pages} pages. A "-" line is something the old site served and the new one does not.`,
  );
  return 1;
}
