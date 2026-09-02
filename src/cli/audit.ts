/*
 * `webm audit [dist/client]` - the pre-launch checks that only a BUILD can answer.
 *
 * `webm doctor` reads source. Some things are only visible in the output: whether every image
 * that reached the page has alt text, whether every internal link lands on a file the build
 * produced (or a route the Worker serves), whether the sitemap the build wrote is complete and
 * advertised. Each is the kind of thing a launch checklist says to "check" and nobody does
 * exhaustively by hand on a forty-page site.
 *
 * Pure where it can be: `audit()` takes the built files and returns findings, so the rules are
 * tested with literal HTML. `run()` reads dist/ and, unless told not to, makes one request per
 * unique external link - the one part that needs a network.
 *
 * WHAT IT DOES NOT DO: write alt text. It lists the images that have none; the launch skill is
 * what looks at each one and writes the words. An empty `alt=""` is a valid declaration that an
 * image is decorative and is not reported - only a MISSING attribute is.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export interface AuditInput {
  /** Relative html path -> contents, for every page in the build. */
  pages: Map<string, string>;
  /** Whether a relative path exists in the build output. */
  exists: (rel: string) => boolean;
  /** Read a relative non-html file from the build, or null. */
  read: (rel: string) => string | null;
  /** wrangler.jsonc's run_worker_first, so an on-demand route is not reported as broken. */
  workerFirst: string[];
  /** The production origin, for sitemap and external-link decisions. Undefined while unset. */
  origin?: string;
}

export interface AuditReport {
  missingAlt: { page: string; src: string }[];
  brokenInternal: { page: string; href: string }[];
  /** Unique external URLs, for the caller to probe. */
  external: string[];
  sitemap: { problems: string[]; urls: number };
}

/** The value of one attribute on a tag, or null when absent. Quoted or bare. */
export function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? '';
}

/** Whether an attribute is present at all, with or without a value. */
export function hasAttr(tag: string, name: string): boolean {
  return new RegExp(`\\s${name}(?=[\\s=>/])`, 'i').test(tag);
}

/** Every `<img>` on a page that declares no alt attribute at all. */
export function imagesWithoutAlt(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    if (hasAttr(tag, 'alt')) continue;
    out.push(attr(tag, 'src') ?? '(no src)');
  }
  return out;
}

const SKIP_SCHEMES = /^(mailto:|tel:|sms:|javascript:|data:|#)/i;

/** The hrefs on a page, split into internal paths and external URLs. */
export function links(html: string, origin?: string): { internal: string[]; external: string[] } {
  const internal = new Set<string>();
  const external = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = attr(m[0], 'href');
    if (!href || SKIP_SCHEMES.test(href)) continue;
    if (/^https?:\/\//i.test(href)) {
      /* A link to the site's own origin is internal - check it as a path. */
      if (origin && href.startsWith(origin)) internal.add(href.slice(origin.length) || '/');
      else external.add(href);
      continue;
    }
    if (href.startsWith('//')) {
      external.add(`https:${href}`);
      continue;
    }
    internal.add(href);
  }
  return { internal: [...internal], external: [...external] };
}

/**
 * Does an internal href land somewhere? A file the build wrote, in any of the forms the asset
 * router would serve it under, or a route the Worker answers.
 */
export function resolves(href: string, input: Pick<AuditInput, 'exists' | 'workerFirst'>): boolean {
  let path = href.split('#')[0]!.split('?')[0]!;
  try {
    path = decodeURIComponent(path);
  } catch {
    /* leave it */
  }
  if (!path.startsWith('/')) return true; /* relative to the page; not worth a false positive */
  if (path === '/') return input.exists('index.html');

  const bare = path.replace(/\/$/, '');
  const rel = bare.slice(1);
  if (input.exists(rel) || input.exists(`${rel}.html`) || input.exists(`${rel}/index.html`)) {
    return true;
  }
  return input.workerFirst.some((entry) =>
    entry.endsWith('/*')
      ? bare === entry.slice(0, -2) || bare.startsWith(entry.slice(0, -1))
      : entry === bare || entry === `${bare}/`,
  );
}

/** `<loc>` values out of a sitemap document. */
export function locs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => m[1]!);
}

/**
 * The sitemap the build wrote: present, advertised in robots.txt, every child present, every URL
 * on the production origin and landing on a page.
 */
export function auditSitemap(input: AuditInput): AuditReport['sitemap'] {
  const problems: string[] = [];
  const index = input.read('sitemap-index.xml');
  if (!index) {
    return {
      problems: [
        input.origin
          ? 'sitemap-index.xml was not built'
          : 'no sitemap - `domain` in webmonterey.json is unset, so nothing has an absolute URL',
      ],
      urls: 0,
    };
  }

  const robots = input.read('robots.txt') ?? '';
  if (!/^Sitemap:\s*\S+/m.test(robots)) problems.push('robots.txt has no Sitemap: line');

  let urls = 0;
  for (const childUrl of locs(index)) {
    const childRel = childUrl.replace(/^https?:\/\/[^/]+\//, '');
    const child = input.read(childRel);
    if (!child) {
      problems.push(`${childRel} is listed in the index and was not built`);
      continue;
    }
    for (const url of locs(child)) {
      urls++;
      if (input.origin && !url.startsWith(input.origin)) {
        problems.push(`${url} is not on ${input.origin}`);
        continue;
      }
      const path = url.replace(/^https?:\/\/[^/]+/, '') || '/';
      if (!resolves(path, input)) problems.push(`${url} is in the sitemap and has no page`);
    }
  }
  if (urls === 0) problems.push('the sitemap lists no URLs');
  return { problems, urls };
}

export function audit(input: AuditInput): AuditReport {
  const missingAlt: AuditReport['missingAlt'] = [];
  const brokenInternal: AuditReport['brokenInternal'] = [];
  const external = new Set<string>();

  for (const [page, html] of input.pages) {
    for (const src of imagesWithoutAlt(html)) missingAlt.push({ page, src });
    const found = links(html, input.origin);
    for (const href of found.internal) {
      if (!resolves(href, input)) brokenInternal.push({ page, href });
    }
    for (const url of found.external) external.add(url);
  }

  return {
    missingAlt,
    brokenInternal,
    external: [...external].sort(),
    sitemap: auditSitemap(input),
  };
}

/* ── the command ─────────────────────────────────────────────────────────────────────────── */

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    return e.isDirectory() ? walk(full) : [full];
  });
}

/** Strip // and /* comments so JSON.parse can read a .jsonc file. */
function parseJsonc<T>(source: string): T {
  const stripped = source
    .replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (m, comment) => (comment ? '' : m))
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(stripped) as T;
}

/**
 * One request per unique external URL. HEAD first; a 405 gets a GET, because plenty of servers
 * refuse HEAD and answer GET. Failures are reported as warnings, not failures: many sites block
 * anything that is not a browser, and a link that a bot cannot fetch is not necessarily broken.
 */
async function probe(urls: string[]): Promise<{ url: string; status: string }[]> {
  const bad: { url: string; status: string }[] = [];
  const queue = [...urls];
  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      try {
        let res = await fetch(url, {
          method: 'HEAD',
          redirect: 'follow',
          signal: AbortSignal.timeout(8000),
        });
        if (res.status === 405 || res.status === 403) {
          res = await fetch(url, {
            method: 'GET',
            redirect: 'follow',
            signal: AbortSignal.timeout(8000),
          });
        }
        if (res.status >= 400) bad.push({ url, status: String(res.status) });
      } catch (error) {
        bad.push({ url, status: error instanceof Error ? error.name : 'error' });
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return bad.sort((a, b) => a.url.localeCompare(b.url));
}

export async function run(argv: string[]): Promise<number> {
  const dist = resolve(argv.find((a) => !a.startsWith('-')) ?? 'dist/client');
  const noExternal = argv.includes('--no-external');

  if (!existsSync(join(dist, 'index.html'))) {
    console.error(`webm audit: no build at ${dist}. Run \`npm run build\` first.`);
    return 1;
  }

  const siteRoot = process.cwd();
  const files = walk(dist);
  const rels = new Set(files.map((f) => relative(dist, f)));
  const pages = new Map(
    files
      .filter((f) => f.endsWith('.html'))
      .map((f) => [relative(dist, f), readFileSync(f, 'utf8')]),
  );

  const wranglerPath = ['wrangler.jsonc', 'wrangler.json']
    .map((f) => join(siteRoot, f))
    .find(existsSync);
  const wrangler = wranglerPath
    ? parseJsonc<{ assets?: { run_worker_first?: string[] } }>(readFileSync(wranglerPath, 'utf8'))
    : null;

  const sitePath = join(siteRoot, 'webmonterey.json');
  const site = existsSync(sitePath)
    ? (JSON.parse(readFileSync(sitePath, 'utf8')) as { domain?: string })
    : {};
  const origin = site.domain && site.domain !== 'CHANGEME' ? `https://${site.domain}` : undefined;

  const report = audit({
    pages,
    exists: (rel) => rels.has(rel),
    read: (rel) =>
      rels.has(rel) && statSync(join(dist, rel)).isFile()
        ? readFileSync(join(dist, rel), 'utf8')
        : null,
    workerFirst: wrangler?.assets?.run_worker_first ?? [],
    origin,
  });

  let failed = 0;
  const section = (ok: boolean, title: string) => console.log(`${ok ? '  ok ' : 'FAIL '} ${title}`);

  section(report.missingAlt.length === 0, `Every image declares alt text (${pages.size} pages)`);
  for (const { page, src } of report.missingAlt)
    console.log(`       ${page}: <img src="${src}"> has no alt attribute`);
  if (report.missingAlt.length) {
    failed++;
    console.log(
      `       Write alt text for each - what the image shows, in context - or alt="" if it is decorative.`,
    );
  }

  section(
    report.brokenInternal.length === 0,
    'Every internal link lands on a page or a Worker route',
  );
  for (const { page, href } of report.brokenInternal) console.log(`       ${page}: ${href}`);
  if (report.brokenInternal.length) failed++;

  section(
    report.sitemap.problems.length === 0,
    `The sitemap is complete and advertised (${report.sitemap.urls} URLs)`,
  );
  for (const p of report.sitemap.problems) console.log(`       ${p}`);
  if (report.sitemap.problems.length) failed++;

  if (noExternal) {
    console.log(`  --  ${report.external.length} external links not probed (--no-external)`);
  } else if (report.external.length) {
    const bad = await probe(report.external);
    console.log(
      `${bad.length ? 'warn ' : '  ok '} ${report.external.length} external links respond (${bad.length} did not)`,
    );
    for (const { url, status } of bad) console.log(`       ${status.padEnd(12)} ${url}`);
    if (bad.length)
      console.log(
        `       Open each in a browser before deciding it is broken - many sites refuse bots.`,
      );
  } else {
    console.log('  ok  no external links');
  }

  console.log(`\n${failed === 0 ? 'audit clean' : `${failed} check(s) failed`}`);
  return failed ? 1 : 0;
}
