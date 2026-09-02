/*
 * The package manifest is a contract with every client site. A broken export path fails at
 * import time, in their build, not here - so it is worth a test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** package.json carries `//`-prefixed keys as inline documentation; JSON.parse handles them. */
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  name: string;
  optionalDependencies?: Record<string, string>;
  exports: Record<string, string>;
  bin: Record<string, string>;
  files: string[];
  peerDependencies: Record<string, string>;
  dependencies: Record<string, string>;
};

test('every export path exists on disk', () => {
  for (const [subpath, target] of Object.entries(pkg.exports)) {
    if (subpath.startsWith('//')) continue;
    assert.ok(existsSync(join(ROOT, target)), `${subpath} -> ${target} does not exist`);
  }
});

test('the bin exists and is the CLI', () => {
  for (const target of Object.values(pkg.bin)) {
    assert.ok(existsSync(join(ROOT, target)), `${target} does not exist`);
  }
});

test('every published directory exists', () => {
  for (const entry of pkg.files) {
    assert.ok(existsSync(join(ROOT, entry)), `files lists ${entry}, which does not exist`);
  }
});

test('astro is a peer, never a dependency', () => {
  // Two copies of Astro in one tree break the integration in ways that are hard to read.
  assert.ok(pkg.peerDependencies.astro, 'astro must be a peerDependency');
  assert.equal(pkg.dependencies.astro, undefined, 'astro must not be a plain dependency');
});

test('the design subpath imports nothing from Astro', () => {
  // This is what keeps it testable with node --test and usable from the platform without
  // pulling a framework in to read a color.
  for (const file of [
    'compile.ts',
    'defaults.ts',
    'resolve.ts',
    'brand.ts',
    'types.ts',
    'index.ts',
  ]) {
    const source = readFileSync(join(ROOT, 'src/design', file), 'utf8');
    assert.ok(!/from '(astro|astro:)/.test(source), `src/design/${file} imports from astro`);
  }
});

test('every directory the code reads out of the package is published', () => {
  /*
   * The inverse of "every published directory exists", and the one that actually bites: `files`
   * is an allowlist, so a new directory is absent from the tarball by default. It works in this
   * repo and in `npm link` - both of which read the working tree - and is missing the moment a
   * real install happens. `template/` shipped that way until this test was written.
   */
  const sources = readdirSync(join(ROOT, 'src', 'cli'))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => readFileSync(join(ROOT, 'src', 'cli', f), 'utf8'))
    .join('\n');

  const published = new Set(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).files);

  for (const match of sources.matchAll(/PACKAGE_ROOT,\s*'([a-z-]+)'/g)) {
    const dir = match[1]!;
    assert.ok(
      published.has(dir),
      `src/cli reads PACKAGE_ROOT/${dir}/ but "${dir}" is not in package.json files[] - ` +
        `it works from a checkout and is absent from the tarball`,
    );
  }
});

test('the webmaster share image is the size the page declares for it', async () => {
  /*
   * The page hardcodes 1200x630 in og:image:width/height because measuring inside a page's
   * frontmatter would need node:fs in an Astro module. A crawler lays the card out from those
   * numbers before it fetches the image, so they have to be true - this is where that is held.
   */
  const { imageSize } = await import('./integration/image-size.ts');
  assert.deepEqual(imageSize(join(ROOT, 'src/assets/webmaster-og.png')), {
    width: 1200,
    height: 630,
  });
});

test('the package does not depend on itself', () => {
  /*
   * IT DID, AND IT SHIPPED. package.json carried
   *   "@cparkerwebm/webmonterey": "file:/Users/cparkerwebm/Workspace/webmonterey/...tgz"
   * as a runtime dependency of itself, pointing at an absolute path on one laptop. Every install
   * of the published 1.0.0 failed with ENOENT on a path that exists on no other machine.
   *
   * It hid for two sessions because every install until the first real publish was either a
   * symlink or a file: reference, and in both of those the self-reference resolves to something
   * that happens to exist. Only a registry install can see it.
   */
  assert.ok(
    !(pkg.dependencies ?? {})[pkg.name],
    `${pkg.name} lists itself as a dependency - every install will try to install it into itself`,
  );
});

test('no dependency is a file: or link: path', () => {
  /*
   * A local path in a PUBLISHED package is always wrong: it resolves on the machine that
   * published and nowhere else. This is the general form of the self-dependency above, and it is
   * worth checking every field rather than just the one that bit.
   */
  const fields = [pkg.dependencies, pkg.peerDependencies, pkg.optionalDependencies];
  for (const field of fields) {
    for (const [name, spec] of Object.entries(field ?? {})) {
      assert.ok(
        !/^(file:|link:|\.{1,2}\/)/.test(spec),
        `${name} is "${spec}" - a local path cannot resolve for anyone installing this`,
      );
    }
  }
});
