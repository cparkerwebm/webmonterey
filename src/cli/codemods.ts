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
export interface Codemod {
  /** The version whose changes this handles, e.g. '2.0.0'. */
  version: string;
  title: string;
  /** Returns a description of every change made. Empty means nothing needed doing. */
  run(siteRoot: string): string[];
}

/*
 * EMPTY AT 1.0.0, and that is the registry's normal state. A codemod is added in the same change
 * as the break it repairs, and a test asserts the list is exactly what the release claims - so
 * adding one is a deliberate act somebody reviews rather than a surprise.
 *
 * The shape to copy when the first one arrives: read the site's file, MERGE the change in
 * (never replace a file the site may have added to), and return [] when there is nothing left to
 * do, so a second run is a no-op.
 */
export const CODEMODS: Codemod[] = [];

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
export function codemodsBetween(from: string, to: string, list: Codemod[] = CODEMODS): Codemod[] {
  return list
    .filter((c) => compareVersions(c.version, from) > 0 && compareVersions(c.version, to) <= 0)
    .sort((a, b) => compareVersions(a.version, b.version));
}
