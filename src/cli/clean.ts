/*
 * `webm clean` - throw away everything a build or a dev server can regenerate.
 *
 * WHY A COMMAND. A dev session that has gone stale - Vite serving a pre-bundle whose hash no
 * longer matches, a content-layer cache that predates a schema edit, a dist/ from a branch that
 * is no longer checked out - is fixed by deleting three directories, and knowing which three is
 * the whole trick. Written down in a skill it is prose; here it is one word, and a session in a
 * client repo can run it without knowing what Vite is.
 *
 * Nothing here is the site's. Every path is generated, gitignored, and rebuilt by the next
 * `astro dev` or `astro build`. The three are:
 *
 *   node_modules/.vite   Vite's dependency pre-bundle. Astro dev reads it on every request and
 *                        500s on all of them once it is stale - see optimizeDeps in the
 *                        integration for the mechanism.
 *   .astro               Astro's own cache: content-layer data, generated types, the dev server's
 *                        lock and state files. `astro dev --force` clears part of this; removing
 *                        the directory clears all of it.
 *   dist                 The last build. Kept out of the way so `webm compare` and `astro
 *                        preview` cannot answer from an older branch's output.
 *
 * `--dry-run` lists what would go and touches nothing.
 */
import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** What a clean removes, relative to the site root. Order is the order they are reported. */
export const CLEAN_TARGETS = ['node_modules/.vite', '.astro', 'dist'] as const;

/** The targets that exist under `root` right now, as relative paths. */
export function cleanTargets(root: string): string[] {
  return CLEAN_TARGETS.filter((t) => existsSync(join(root, t)));
}

/**
 * Remove every target that exists and return what was removed. Idempotent: a second run finds
 * nothing and removes nothing, which is what a repeatable reset should do.
 */
export function clean(root: string): string[] {
  const present = cleanTargets(root);
  for (const t of present) rmSync(join(root, t), { recursive: true, force: true });
  return present;
}

export async function run(argv: string[]): Promise<number> {
  const dryRun = argv.includes('--dry-run');
  const root = resolve(process.cwd());

  if (!existsSync(join(root, 'astro.config.mjs'))) {
    console.error('webm clean: no astro.config.mjs here - run it from the site root.');
    return 1;
  }

  const targets = dryRun ? cleanTargets(root) : clean(root);
  if (targets.length === 0) {
    console.log('Nothing to clean.');
    return 0;
  }
  for (const t of targets) console.log(`${dryRun ? 'would remove' : 'removed'}  ${t}/`);
  if (!dryRun) console.log('\nNext `npm run dev` or `npm run build` regenerates all of it.');
  return 0;
}
