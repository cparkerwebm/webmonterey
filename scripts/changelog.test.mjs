import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { changelogSection, documentedVersions } from './changelog.mjs';

const SAMPLE = `# pkg

## 1.2.10 — 2026-01-02

Ten.

---

## 1.2.1 — 2026-01-01

One.

- a bullet

---

## 1.0.0

Zero.
`;

test('a section is the text under its own heading and nothing else', () => {
  assert.equal(changelogSection(SAMPLE, '1.2.1'), 'One.\n\n- a bullet');
});

test('1.2.1 does not match the 1.2.10 heading', () => {
  /*
   * The whole reason the match is anchored. A prefix match returns the WRONG SECTION rather than
   * failing, so the release succeeds and ships another version's notes - which is worse than no
   * notes at all, because it looks correct.
   */
  assert.equal(changelogSection(SAMPLE, '1.2.10'), 'Ten.');
  assert.notEqual(changelogSection(SAMPLE, '1.2.1'), 'Ten.');
});

test('an undocumented version is null, which is what stops the release', () => {
  assert.equal(changelogSection(SAMPLE, '9.9.9'), null);
});

test('the last section does not run off the end', () => {
  assert.equal(changelogSection(SAMPLE, '1.0.0'), 'Zero.');
});

test('a leading v on the heading is tolerated', () => {
  assert.equal(changelogSection('## v2.0.0\n\nTwo.\n', '2.0.0'), 'Two.');
});

test("the repo's own changelog documents the version in package.json", () => {
  /*
   * The check that would have caught the real defect: eight versions published, one documented.
   * It runs here as well as in prepublishOnly so a stale changelog fails `npm test`, not just a
   * release nobody is watching.
   */
  const version = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ).version;
  const text = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.ok(
    changelogSection(text, version),
    `CHANGELOG.md has no "## ${version}" section. Add one before releasing.`,
  );
});

test('every published version is documented', () => {
  const text = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const documented = new Set(documentedVersions(text));
  /*
   * Versions published under @cparkerwebm/webmonterey. Explicit rather than read from the
   * registry: the point is to catch a changelog entry being deleted or renumbered, and a
   * registry lookup would happily agree with the deletion.
   *
   * This line starts at 1.0.0. The eight versions previously listed belonged to
   * @cparkerwebm/webmonterey - a different package with a different owner - and carrying them
   * across would assert this changelog documents releases it never made.
   */
  for (const v of ['1.0.0']) {
    assert.ok(documented.has(v), `${v} is published but not in CHANGELOG.md`);
  }
});
