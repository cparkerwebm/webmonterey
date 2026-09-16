/*
 * Codemods, keyed by the version that introduces the break.
 *
 * A MAJOR WITHOUT A CODEMOD IS A MAJOR THAT WILL NOT GET ADOPTED. Generation 1 is the evidence:
 * it shipped a framework that six sites could have used and one did, because moving forward meant
 * hand-editing every consumer.
 *
 * Each entry runs against a site root and reports what it changed. They must be IDEMPOTENT - a
 * half-finished upgrade gets re-run, and a codemod that doubles an import on the second pass is
 * worse than no codemod.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { slugFor } from './slug.ts';
export interface Codemod {
  /** The version whose changes this handles, e.g. '2.0.0'. */
  version: string;
  title: string;
  /** Returns a description of every change made. Empty means nothing needed doing. */
  run(siteRoot: string): string[];
}

/*
 * EMPTY IS THE NORMAL STATE - it was, from 1.0.0 to 1.5.0. A codemod is added in the same change
 * as the break it repairs, and a test asserts the list is exactly what the release claims - so
 * adding one is a deliberate act somebody reviews rather than a surprise.
 *
 * The shape to copy when the first one arrives: read the site's file, MERGE the change in
 * (never replace a file the site may have added to), and return [] when there is nothing left to
 * do, so a second run is a no-op.
 */
/*
 * 1.6.0: the /webmaster button carries AGENCY_CTA_ATTRS, not AGENCY_LINK_ATTRS.
 *
 * The CTA constant is the link constant plus a `data-webm-cta` marker, and the marker is what the
 * page's global rule keys its 25px floor on - so a site that laid the page out itself before
 * 1.6.0 spreads the old constant and gets no floor. This rewrites that one spread, on the anchor
 * whose href is `cta.href`, and fixes the import to match. The intro link is untouched: it is
 * built by introHtml from the package, not by the site.
 *
 * MERGES, NEVER REPLACES. The layout is the site's file; only the spread and the import line
 * change. A second run finds no old spread and returns [].
 */
function webmasterPagePath(registry: string): string | null {
  const direct = registry.match(
    /export\s*\{\s*default\s+as\s+webmasterPage\s*\}\s*from\s*['"]([^'"]+)['"]/,
  );
  if (direct) return direct[1]!;

  const named = registry.match(/export\s+const\s+webmasterPage\s*=\s*([A-Za-z_$][\w$]*)/);
  if (!named) return null;
  const imported = registry.match(new RegExp(`import\\s+${named[1]}\\s+from\\s*['"]([^'"]+)['"]`));
  return imported ? imported[1]! : null;
}

/*
 * 1.6.0, second step: analytics on every site.
 *
 * THE ONE THING 1.6.0 SWITCHES ON FOR AN EXISTING SITE, and the reason it may: the Analytics
 * Engine dataset creates itself on first write, so the binding cannot fail a deploy; the
 * run_worker_first entry is a route the package injects; and the flag reads both. None of the
 * three has a resource behind it, unlike the queue and the marketing database, which stay a
 * person's decision. Every client should have the numbers, so every client gets them on upgrade.
 *
 * wrangler.jsonc is JSONC with comments, so it is edited as TEXT, never parsed and re-serialised:
 * a site's comments are the site's. The binding goes in above "observability" when that line
 * exists, else before the closing brace; the route is appended inside the run_worker_first
 * array. webmonterey.json is plain JSON and round-trips through JSON.parse with its key order.
 */
function enableAnalytics(siteRoot: string): string[] {
  const changes: string[] = [];
  const sitePath = join(siteRoot, 'webmonterey.json');
  if (!existsSync(sitePath)) return changes;
  const site = JSON.parse(readFileSync(sitePath, 'utf8')) as {
    domain?: string;
    slug?: string;
    features?: Record<string, unknown>;
  };
  const slug = site.slug ?? (site.domain ? safeSlug(site.domain) : null);

  const wranglerPath = ['wrangler.jsonc', 'wrangler.json']
    .map((f) => join(siteRoot, f))
    .find(existsSync);
  if (wranglerPath && slug) {
    let text = readFileSync(wranglerPath, 'utf8');
    const before = text;

    if (!/"analytics_engine_datasets"/.test(text)) {
      const block =
        `  // ANALYTICS. Form events and a cookieless page-view count, written to a Workers Analytics\n` +
        `  // Engine dataset named for the site. Nothing to create: the dataset appears on first write.\n` +
        `  "analytics_engine_datasets": [{ "binding": "ANALYTICS", "dataset": "${slug}" }],\n\n`;
      const at = text.search(/^[ \t]*"observability"/m);
      if (at !== -1) {
        text = text.slice(0, at) + block + text.slice(at);
      } else {
        const close = text.lastIndexOf('}');
        text =
          text.slice(0, close).replace(/,?\s*$/, ',\n\n') +
          block.replace(/,\n\n$/, '\n') +
          text.slice(close);
      }
      changes.push(`wrangler.jsonc: the ANALYTICS binding, dataset "${slug}"`);
    }

    if (!/"\/_webm\/\*"/.test(text)) {
      const list = text.match(/("run_worker_first"\s*:\s*\[)([^\]]*)(\])/);
      if (list) {
        const items = list[2]!;
        const trimmed = items.replace(/[\s,]*$/, '');
        const trail = items.slice(trimmed.length);
        const sep = trimmed.trim() ? ', ' : '';
        text = text.replace(list[0], `${list[1]}${trimmed}${sep}"/_webm/*"${trail}${list[3]}`);
        changes.push('wrangler.jsonc: "/_webm/*" in run_worker_first, for the page-view beacon');
      } else {
        changes.push(
          'wrangler.jsonc: no run_worker_first array found - add "/_webm/*" to it by hand, or ' +
            'the beacon 404s in a browser',
        );
      }
    }

    if (text !== before) writeFileSync(wranglerPath, text);
  }

  if (site.features?.analytics !== true) {
    site.features = { ...(site.features ?? {}), analytics: true };
    writeFileSync(sitePath, JSON.stringify(site, null, 2) + '\n');
    changes.push('webmonterey.json: features.analytics on');
  }
  return changes;
}

function safeSlug(domain: string): string | null {
  try {
    return slugFor(domain);
  } catch {
    return null;
  }
}

const WEBMASTER_CTA: Codemod = {
  version: '1.6.0',
  title: 'The /webmaster button spreads AGENCY_CTA_ATTRS; analytics on',
  run(siteRoot) {
    return [...webmasterCta(siteRoot), ...enableAnalytics(siteRoot)];
  },
};

function webmasterCta(siteRoot: string): string[] {
  {
    const registryPath = join(siteRoot, 'src/components/registry.ts');
    if (!existsSync(registryPath)) return [];
    const relative = webmasterPagePath(readFileSync(registryPath, 'utf8'));
    if (!relative) return [];

    const layoutPath = join(siteRoot, 'src/components', relative);
    if (!existsSync(layoutPath)) return [];
    const before = readFileSync(layoutPath, 'utf8');

    /* The button: an anchor with cta.href on the same tag as the old spread. */
    const after = before.replace(
      /(<a\b[^>]*?\bhref=\{cta\.href\}[^>]*?)\{\.\.\.AGENCY_LINK_ATTRS\}/g,
      '$1{...AGENCY_CTA_ATTRS}',
    );
    if (after === before) return [];

    let fixed = after;
    const stillUsesLink = /\bAGENCY_LINK_ATTRS\b/.test(
      fixed.replace(/import\s*\{[^}]*\}\s*from\s*['"][^'"]+['"];?/g, ''),
    );
    fixed = fixed.replace(
      /import\s*\{([^}]*)\}\s*from\s*(['"]@cparkerwebm\/webmonterey\/webmonterey\/webmaster['"])/,
      (_m, names: string, source: string) => {
        const list = names
          .split(',')
          .map((n) => n.trim())
          .filter(Boolean)
          .filter((n) => stillUsesLink || n !== 'AGENCY_LINK_ATTRS');
        if (!list.includes('AGENCY_CTA_ATTRS')) list.push('AGENCY_CTA_ATTRS');
        return `import { ${list.join(', ')} } from ${source}`;
      },
    );

    writeFileSync(layoutPath, fixed);
    return [
      `src/components/${relative}: the button spreads AGENCY_CTA_ATTRS (the 25px floor above it)`,
    ];
  }
}

/*
 * 1.6.1: the dead-letter queue is `<slug>-fail`. One site upgraded on 1.6.0 in the minutes before
 * the rename and has a `-dlq` queue: this renames it in wrangler.jsonc, `webm queue` then creates
 * the `-fail` queue (it creates both names whether or not the block is wired, and an existing
 * queue is fine), and the old queue is left for a person to delete - the upgrade never deletes a
 * resource, and the message says which command does.
 */
const DEAD_LETTER_NAME: Codemod = {
  version: '1.6.1',
  title: 'The dead-letter queue is <slug>-fail',
  run(siteRoot) {
    const wranglerPath = ['wrangler.jsonc', 'wrangler.json']
      .map((f) => join(siteRoot, f))
      .find(existsSync);
    if (!wranglerPath) return [];
    const before = readFileSync(wranglerPath, 'utf8');
    const after = before.replace(/("dead_letter_queue"\s*:\s*")([^"]+)-dlq(")/g, '$1$2-fail$3');
    if (after === before) return [];
    writeFileSync(wranglerPath, after);
    const old = before.match(/"dead_letter_queue"\s*:\s*"([^"]+-dlq)"/)?.[1] ?? '<slug>-dlq';
    return [
      `wrangler.jsonc: dead_letter_queue renamed to ${old.replace(/-dlq$/, '-fail')}. The queue step ` +
        `creates it; delete the old one yourself once the next deploy is live: ` +
        `npx wrangler queues delete ${old}`,
    ];
  },
};

export const CODEMODS: Codemod[] = [WEBMASTER_CTA, DEAD_LETTER_NAME];

/** Semver compare, on the three numeric parts only. Prerelease tags are not used here. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/**
 * Codemods that apply when moving from `from` to `to`, in version order.
 *
 * Exclusive at the bottom, inclusive at the top: upgrading 1.1.0 -> 2.0.0 runs 2.0.0's codemod
 * and not 1.1.0's, which already ran when the site landed on 1.1.0.
 *
 * `list` is injectable so the range logic is testable without registering a real codemod.
 */
/**
 * Every codemod above `from`, whatever is installed. For `webm upgrade --codemods-from`: a
 * package ships no codemod newer than itself, so this is "everything since that version" - and
 * on a pre-release checkout, whose package.json still carries the old number, it is the only way
 * the new codemod runs at all.
 */
export function codemodsAfter(from: string, list: Codemod[] = CODEMODS): Codemod[] {
  return list
    .filter((c) => compareVersions(c.version, from) > 0)
    .sort((a, b) => compareVersions(a.version, b.version));
}

export function codemodsBetween(from: string, to: string, list: Codemod[] = CODEMODS): Codemod[] {
  return list
    .filter((c) => compareVersions(c.version, from) > 0 && compareVersions(c.version, to) <= 0)
    .sort((a, b) => compareVersions(a.version, b.version));
}
