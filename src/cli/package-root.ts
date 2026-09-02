/*
 * Finding the package's own root, from wherever this code ended up.
 *
 * THE PROBLEM BUNDLING CREATES: src/cli/*.ts resolve the root as `../../` from their own
 * location, and bin/webm.mjs as `../`. Bundle them all into dist/webm.mjs and every one of those
 * is now relative to dist/ - so `../../` overshoots the repo entirely and reads a package.json
 * belonging to whatever sits above it. That failed as `ENOENT: /Users/cparkerwebm/Workspace/
 * package.json`, which names a directory that has nothing to do with this package.
 *
 * Walking up until the manifest identifies itself works from source and from a bundle, and does
 * not care how deep either sits.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * The manifest identifies itself by its bin, not by a hardcoded name. The package has been
 * renamed once already; a name literal here is one more place a rename has to find.
 */
function isOurs(manifest: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { bin?: Record<string, string> };
    return typeof pkg.bin?.webm === 'string';
  } catch {
    return false; /* a malformed package.json above us is not ours; keep walking */
  }
}

function findRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest) && isOurs(manifest)) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error(
    `webm: cannot locate the package root from ${fileURLToPath(import.meta.url)}. ` +
      `This usually means the CLI was moved out of the installed package.`,
  );
}

export const PACKAGE_ROOT = findRoot();

function manifest(): { name: string; version: string } {
  return JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
}

export function packageVersion(): string {
  return manifest().version;
}

/** The published name, read from the manifest so a rename is one edit. */
export function packageName(): string {
  return manifest().name;
}
