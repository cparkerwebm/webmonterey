/*
 * Files a site needs ON DISK that the package cannot supply from node_modules.
 *
 * These are the SEED tier - see the header of sync.ts for the other two. Written once by
 * `webm new`, then the client's outright. Nothing here is ever refreshed by an upgrade, because
 * every one of them is a starting point somebody is expected to edit:
 *
 *   public/_headers          the CSP grows a host for every third party this client adds
 *   public/favicon*, og      replaced with the client's marks at launch
 *   src/assets/images/       the placeholder logo, likewise
 *   src/forms/contact.json   recipients, fields and autoresponse copy are per-client
 *   CLAUDE.md, CONTENT.md    guidance a client repo may add to
 *   .editorconfig etc        editor and formatter settings
 *
 * WHY public/ CANNOT COME FROM THE PACKAGE. Astro copies public/ verbatim from the site root
 * into the build output. There is no hook that contributes to it and no way to point it at a
 * dependency, so a favicon that lives only in node_modules is a favicon that never ships.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

/** Where each part of `template/` lands in a site. */
const SEEDS: ReadonlyArray<{ from: string; to: string }> = [
  { from: 'site', to: '.' },
  { from: 'public', to: 'public' },
  { from: 'assets', to: 'src/assets/images' },
];

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (
      e.name.startsWith('.') &&
      e.name !== '.editorconfig' &&
      e.name !== '.prettierrc.json' &&
      e.name !== '.prettierignore'
    ) {
      return [];
    }
    const full = join(dir, e.name);
    return e.isDirectory() ? walk(full) : [full];
  });
}

/**
 * Copy the seed tree into a site.
 *
 * NEVER OVERWRITES. The scaffold runs first and its output wins: where both produce a file, the
 * scaffold's is the one with this client's domain substituted into it, and a blind copy here
 * would replace it with the generic template. Returns what it actually wrote.
 */
export function seed(packageRoot: string, siteRoot: string): string[] {
  const written: string[] = [];

  for (const { from, to } of SEEDS) {
    const source = join(packageRoot, 'template', from);
    for (const file of walk(source)) {
      const rel = relative(source, file);
      const dest = join(siteRoot, to === '.' ? rel : join(to, rel));
      if (existsSync(dest)) continue;
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(file, dest);
      written.push(relative(siteRoot, dest));
    }
  }

  return written.sort();
}

/**
 * Every directory the scaffold creates but leaves empty.
 *
 * Git does not track directories, so an empty one vanishes on the next clone and the structure
 * stops being self-describing - somebody adding their first form has to know that `src/forms/`
 * is where it goes rather than seeing the folder sitting there.
 *
 * Walked rather than listed, because a hardcoded list goes stale the moment the scaffold grows a
 * directory and nothing points that out.
 */
export function gitkeepEmptyDirs(siteRoot: string, dirs: readonly string[]): string[] {
  const kept: string[] = [];

  for (const dir of dirs) {
    const full = join(siteRoot, dir);
    mkdirSync(full, { recursive: true });
    if (readdirSync(full).length > 0) continue;
    writeFileSync(join(full, '.gitkeep'), '');
    kept.push(join(dir, '.gitkeep'));
  }

  /* Anything nested that came out empty too - src/components/* above all. */
  const walkDirs = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const full = join(d, e.name);
      if (readdirSync(full).length === 0) {
        writeFileSync(join(full, '.gitkeep'), '');
        kept.push(join(relative(siteRoot, full), '.gitkeep'));
      } else {
        walkDirs(full);
      }
    }
  };
  walkDirs(siteRoot);

  return [...new Set(kept)].sort();
}

/**
 * The directories a site has before anyone adds anything to them.
 *
 * `src/pages/` is here and matters most: the package injects `/[...slug]`, `/robots.txt`,
 * `/webm` and `/404`, so a site needs no page files at all - but Astro still expects the
 * directory, and a site author needs somewhere obvious to put a bespoke route.
 */
export const SCAFFOLD_DIRS: readonly string[] = [
  'migrations',
  'public',
  'src/assets/fonts',
  'src/assets/icons',
  'src/assets/images',
  'src/components/asides',
  'src/components/content',
  'src/components/general',
  'src/components/interfaces',
  'src/components/regions',
  'src/content/pages',
  'src/forms',
  'src/pages',
  'src/pages/webapp',
  'src/scripts',
  'src/styles/custom',
];
