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

const WEBMASTER_CTA: Codemod = {
  version: '1.6.0',
  title: 'The /webmaster button spreads AGENCY_CTA_ATTRS',
  run(siteRoot) {
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
  },
};

export const CODEMODS: Codemod[] = [WEBMASTER_CTA];

/** Semver compare, on the three numeric parts only. Prerelease tags are not used here. */
function compareVersions(a: string, b: string): number {
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
