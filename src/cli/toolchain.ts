/*
 * The toolchain floor: the minimum wrangler a release was tested with, and the upgrade step that
 * raises a site to it.
 *
 * WHY THE PACKAGE OWNS THIS. The scaffold used to write a wrangler range into a new site's
 * devDependencies, and that was the last time the package had a say: `webm upgrade` moved the
 * package and nothing else, so every site kept the wrangler its lockfile had the day it was
 * scaffolded, and a dependency advisory had to be fixed one repo at a time. The concrete case,
 * 2026-09-12: a site upgraded 1.5.0 -> 1.6.2 still ran wrangler 4.129.0, whose miniflare bundles
 * sharp 0.35.2 and its libheif heap overflow (GHSA-rgj7-g3m4-5g8c, high). The fix is sharp
 * 0.35.4, which arrives with wrangler 4.131.1; every range in the chain already accepted it, and
 * nothing but the lockfile held the site back.
 *
 * ONE CONSTANT IS THE FLOOR. The scaffold writes it into a new site and the upgrade raises an old
 * site to it, so a release's floor reaches the whole fleet as sites upgrade. Astro stays a peer
 * of the site as it is; this is the Cloudflare toolchain the package's adapter drags in.
 *
 * THE PLUGIN MOVES FIRST, WHEN ITS PIN IS BELOW THE FLOOR. @cloudflare/vite-plugin depends on an
 * EXACT wrangler and miniflare, and @astrojs/cloudflare takes whichever plugin the lockfile
 * resolved - so a site's tree can hold the plugin's wrangler beside the site's own, and two exact
 * versions never dedupe. 1.8.0 installed the floor at the top and left the plugin's 4.129.0
 * nested under it, then read the top copy and said "at the floor" while `npm audit` still named
 * sharp. So: if the installed plugin pins a wrangler below the floor, `npm update
 * @cloudflare/vite-plugin` first - within whatever range @astrojs/cloudflare allows - and THEN
 * install the wrangler the plugin now pins, so the two resolve to one copy. Every copy in the
 * tree is read afterwards, and a copy below the floor is reported by its path, never papered
 * over by the top one.
 *
 * NOT `npm audit fix`. That bumps whatever npm decides that day, differs from site to site, and
 * is not something a release can test. The floor is deterministic and tested once per release.
 *
 * COMPATIBILITY DATE, in this direction, is safe. A newer wrangler bundles a newer workerd, and
 * the trap is a compatibility_date NEWER than the bundled runtime - miniflare refuses it with
 * ERR_FUTURE_COMPATIBILITY_DATE - never one older. Raising wrangler can only widen the dates the
 * runtime accepts; the doctor's stale-date check covers the other side.
 *
 * IDEMPOTENT, and it touches nothing but wrangler and, when its pin is below the floor, the
 * plugin: the range in package.json, and the lockfile through `npm install wrangler@<version>`
 * and `npm update @cloudflare/vite-plugin`. A site already at the floor with one copy is left
 * exactly as it is, and the top copy is never brought down.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { compareVersions } from './codemods.ts';
import { errorLine } from './queue.ts';

/** The minimum wrangler this release was tested with. Raised in the release that needs it. */
export const WRANGLER_FLOOR = '4.131.1';

/** The range the scaffold writes: the floor with a caret, so a site can move within the major. */
export const wranglerRange = (): string => `^${WRANGLER_FLOOR}`;

/** The adapter's plugin, which pins an exact wrangler. */
export const PLUGIN = '@cloudflare/vite-plugin';

export interface NpmResult {
  ok: boolean;
  /** stdout and stderr together. */
  output: string;
}

export type NpmRunner = (args: string[]) => NpmResult;

export interface WranglerCopy {
  /** Relative to the site root, e.g. node_modules/@cloudflare/vite-plugin/node_modules/wrangler. */
  path: string;
  version: string;
}

export interface ToolchainResult {
  /** What was done, in order. Empty with `skipped` null means the site was already there. */
  changes: string[];
  /** Why nothing was raised, when nothing was: what a person does next. */
  skipped: string | null;
  /** The wrangler at the top of the site's tree after the step, or null when none is. */
  installed: string | null;
  /** Every wrangler in the tree after the step, the top one first. */
  copies: WranglerCopy[];
}

type Manifest = { version: string; dependencies?: Record<string, string> };

/**
 * The manifest of a package installed in the site, resolved from the site upward the way `npx`
 * would find it, with a look under the two packages that can carry their own copy when the
 * resolver refuses a manifest the package does not export.
 */
function installedManifest(siteRoot: string, name: string): Manifest | null {
  const root = resolve(siteRoot);
  const candidates: string[] = [];
  try {
    candidates.push(createRequire(join(root, 'package.json')).resolve(`${name}/package.json`));
  } catch {
    /* not exported, or not installed - the paths below decide */
  }
  candidates.push(
    join(root, 'node_modules', name, 'package.json'),
    join(root, 'node_modules/@astrojs/cloudflare/node_modules', name, 'package.json'),
  );
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as Manifest;
    } catch {
      return null;
    }
  }
  return null;
}

/** The wrangler at the top of the site's tree, or null when none is. From the manifest, not the range. */
export function installedWrangler(siteRoot: string): string | null {
  return installedManifest(siteRoot, 'wrangler')?.version ?? null;
}

/**
 * Every wrangler in the site's tree: the top one, and any nested under another package's own
 * node_modules, three levels down at most - the plugin's copy sits one level down, and the
 * plugin itself can sit under @astrojs/cloudflare. Read from the filesystem rather than
 * `npm ls`, so what it says is what is on disk and it costs nothing.
 */
export function wranglerCopies(siteRoot: string): WranglerCopy[] {
  const root = resolve(siteRoot);
  const out: WranglerCopy[] = [];
  const version = (dir: string): string | null => {
    try {
      return (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Manifest).version;
    } catch {
      return null;
    }
  };
  const walk = (nm: string, rel: string, depth: number) => {
    if (depth > 3 || !existsSync(nm)) return;
    let entries: string[];
    try {
      entries = readdirSync(nm).filter((e) => !e.startsWith('.'));
    } catch {
      return;
    }
    const packages = entries.flatMap((e) => {
      if (!e.startsWith('@')) return [e];
      try {
        return readdirSync(join(nm, e)).map((s) => `${e}/${s}`);
      } catch {
        return [];
      }
    });
    for (const name of packages) {
      const dir = join(nm, name);
      try {
        if (!statSync(dir).isDirectory()) continue;
      } catch {
        continue;
      }
      if (name === 'wrangler') {
        const v = version(dir);
        if (v) out.push({ path: `${rel}/wrangler`, version: v });
        continue;
      }
      walk(join(dir, 'node_modules'), `${rel}/${name}/node_modules`, depth + 1);
    }
  };
  walk(join(root, 'node_modules'), 'node_modules', 1);
  return out.sort((a, b) => a.path.length - b.path.length);
}

/** The lowest version a range names: `^4.118.0` -> 4.118.0. Null for a range with no number in it. */
export function rangeMinimum(range: string): string | null {
  return range.match(/\d+\.\d+\.\d+/)?.[0] ?? null;
}

/** The exact wrangler the installed plugin pins, or null when there is no plugin or no exact pin. */
export function pluginPin(siteRoot: string): { version: string; plugin: string } | null {
  const plugin = installedManifest(siteRoot, PLUGIN);
  const pinned = plugin?.dependencies?.wrangler;
  return pinned && /^\d+\.\d+\.\d+$/.test(pinned)
    ? { version: pinned, plugin: plugin!.version }
    : null;
}

/** What the step installs: the plugin's exact pin when that is above the floor, else the floor. */
export function targetWrangler(siteRoot: string): { version: string; reason: string } {
  const pin = pluginPin(siteRoot);
  if (pin && compareVersions(pin.version, WRANGLER_FLOOR) > 0) {
    return { version: pin.version, reason: `what ${PLUGIN} ${pin.plugin} pins` };
  }
  return { version: WRANGLER_FLOOR, reason: 'the floor' };
}

const belowFloor = (v: string) => compareVersions(v, WRANGLER_FLOOR) < 0;

export function raiseToolchain(siteRoot: string, npm: NpmRunner): ToolchainResult {
  const pkgPath = join(siteRoot, 'package.json');
  const done = (changes: string[], skipped: string | null): ToolchainResult => ({
    changes,
    skipped,
    installed: installedWrangler(siteRoot),
    copies: wranglerCopies(siteRoot),
  });
  if (!existsSync(pkgPath)) return done([], 'no package.json here');

  const readPkg = () =>
    JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
  const pkg = readPkg();
  const field = pkg.devDependencies?.wrangler
    ? 'devDependencies'
    : pkg.dependencies?.wrangler
      ? 'dependencies'
      : null;
  if (!field) return done([], 'package.json does not list wrangler, so nothing was raised');
  const range = pkg[field]!.wrangler!;
  const min = rangeMinimum(range);
  if (!min) {
    return done(
      [],
      `wrangler is "${range}" in package.json, which names no version, so it was left alone`,
    );
  }

  const changes: string[] = [];
  const before = installedWrangler(siteRoot);
  const rangeBelow = belowFloor(min);

  /* A range above the floor with nothing installed is a site that has not run npm install. */
  if (!before && !rangeBelow && compareVersions(min, WRANGLER_FLOOR) > 0) {
    return done(
      changes,
      `wrangler is not installed in this site, and ${range} is above the floor - npm install gets it`,
    );
  }

  /*
   * 1. THE PLUGIN FIRST. A plugin pinning a wrangler below the floor would keep that wrangler
   * nested beside whatever the site installs, and the advisory with it. Move it within the range
   * the adapter allows, so the pin the next step installs to is one the whole tree agrees on.
   */
  const pinBefore = pluginPin(siteRoot);
  if (pinBefore && belowFloor(pinBefore.version)) {
    const u = npm(['update', PLUGIN]);
    const pinAfter = pluginPin(siteRoot);
    if (!u.ok) {
      changes.push(`npm update ${PLUGIN} failed: ${errorLine(u.output)}`);
    } else if (pinAfter && pinAfter.plugin !== pinBefore.plugin) {
      changes.push(
        `npm update ${PLUGIN}: ${pinBefore.plugin} -> ${pinAfter.plugin} (pins wrangler ${pinAfter.version})`,
      );
    } else {
      changes.push(
        `npm update ${PLUGIN}: ${pinBefore.plugin} is the newest the site's @astrojs/cloudflare allows, and it pins wrangler ${pinBefore.version}`,
      );
    }
  }

  /*
   * 2. THE SITE'S OWN WRANGLER: one install of one spec when it is below the floor, or when a
   * second copy would remain because the plugin now pins something newer. Never lower than what
   * is at the top already. npm writes the range itself, as ^<version>, in the field the site used.
   */
  const target = targetWrangler(siteRoot);
  const duplicated = wranglerCopies(siteRoot).length > 1;
  const needsInstall =
    !before ||
    belowFloor(before) ||
    (duplicated && before !== target.version && compareVersions(target.version, before) > 0);
  if (needsInstall) {
    const spec = `wrangler@${target.version}`;
    const r = npm(['install', spec, field === 'devDependencies' ? '--save-dev' : '--save']);
    if (!r.ok) {
      return done(
        changes,
        `npm install ${spec} failed: ${errorLine(r.output)}. Run it by hand, then npx webm doctor.`,
      );
    }
    const after = installedWrangler(siteRoot);
    changes.push(
      `npm install ${spec} (${target.reason}): ${before ?? 'nothing'} -> ${after ?? 'nothing'}`,
    );
    const rangeAfter = readPkg()[field]?.wrangler;
    if (rangeAfter && rangeAfter !== range)
      changes.push(`package.json: wrangler ${range} -> ${rangeAfter}`);
  } else if (rangeBelow) {
    pkg[field]!.wrangler = wranglerRange();
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    changes.push(
      `package.json: wrangler ${range} -> ${wranglerRange()} (${before} is installed, already above the floor)`,
    );
  }

  return done(changes, null);
}

/** The site's npm, output captured so the step can say what moved rather than echo npm. */
export function npmRunner(siteRoot: string): NpmRunner {
  return (args) => {
    try {
      const output = execFileSync('npm', args, {
        cwd: siteRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NO_COLOR: '1' },
      });
      return { ok: true, output };
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string; message?: string };
      return { ok: false, output: `${e.stdout ?? ''}\n${e.stderr ?? ''}\n${e.message ?? ''}` };
    }
  };
}

/** The copies below the floor, wherever they sit. Empty is the only state that is "at the floor". */
export function staleCopies(copies: WranglerCopy[]): WranglerCopy[] {
  return copies.filter((c) => belowFloor(c.version));
}

/**
 * The one-line verdict, the last line `webm upgrade` prints for the step. "At the floor" is said
 * only when EVERY copy in the tree is at or above it; a copy below it is named by its path, so
 * the line a person reads is the line `npm audit` would agree with.
 */
export function summary(result: ToolchainResult): string {
  if (result.skipped) return `toolchain: ${result.skipped}`;
  const top = result.installed;
  if (!top) return 'toolchain: wrangler is not installed here.';
  const stale = staleCopies(result.copies).filter((c) => c.path !== 'node_modules/wrangler');
  if (stale.length) {
    const list = stale.map((c) => `${c.version} at ${c.path}`).join(', ');
    return (
      `toolchain: wrangler ${top} at the top, but ${list} - below the floor (${WRANGLER_FLOOR}). ` +
      `npm update ${PLUGIN}, then npx webm doctor.`
    );
  }
  const where =
    compareVersions(top, WRANGLER_FLOOR) === 0
      ? 'at the floor'
      : `above the floor (${WRANGLER_FLOOR})`;
  const others = result.copies.filter((c) => c.path !== 'node_modules/wrangler');
  const also = others.length
    ? `; also ${others.map((c) => `${c.version} at ${c.path}`).join(', ')}, at or above it`
    : '';
  return `toolchain: wrangler ${top}, ${where}${also}.`;
}

/** Printed by `webm upgrade`, in the queue step's style. */
export function report(result: ToolchainResult): void {
  for (const c of result.changes) console.log(`  ${c}`);
  console.log(`  ${summary(result)}`);
}
