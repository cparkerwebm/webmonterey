/*
 * Reading CHANGELOG.md as data.
 *
 * The release refuses to run without an entry for the version being published, and the GitHub
 * release notes are that entry - so this file decides both. Kept pure and tested, because the
 * cost of it being wrong is a release that either cannot happen or ships with the wrong notes.
 */

/**
 * The body of the `## <version>` section, or null if the changelog does not document it.
 *
 * @param {string} text     the whole CHANGELOG.md
 * @param {string} version  an exact version, e.g. "1.2.1"
 * @returns {string | null}
 */
export function changelogSection(text, version) {
  const lines = text.split('\n');
  /*
   * ANCHORED, and the anchor is the point. A loose `startsWith('## ' + version)` matches
   * `## 1.2.10` when asked for `## 1.2.1`, so releasing 1.2.1 would silently ship 1.2.10's notes.
   * The character after the version must be one that cannot continue a version number.
   */
  const heading = new RegExp(`^##\\s+v?${version.replace(/\./g, '\\.')}(?![\\w.-])`);
  const start = lines.findIndex((l) => heading.test(l));
  if (start === -1) return null;

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  const body = (end === -1 ? rest : rest.slice(0, end)).join('\n');

  /* Trim the `---` rule that separates entries; it is layout, not content. */
  return body.replace(/\n+-{3,}\s*$/, '').trim();
}

/** Every version the changelog documents, in the order they appear. */
export function documentedVersions(text) {
  return [...text.matchAll(/^##\s+v?(\d+\.\d+\.\d+[^\s]*)/gm)].map((m) => m[1]);
}
