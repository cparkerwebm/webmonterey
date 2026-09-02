/*
 * `webm sync` - materialize the fleet skills into .claude/skills/webm/.
 *
 * CLAUDE CODE DOES NOT READ SKILLS OUT OF node_modules. Discovery is directory-based - personal,
 * project, nested, plugin - and an npm package is none of those. A skills/ folder inside the
 * installed package is inert: Claude never looks, the skill never appears, and nothing errors.
 *
 * The destination is a SKILLS-DIRECTORY PLUGIN. Any folder under .claude/skills/ containing
 * .claude-plugin/plugin.json loads as `<folder>@skills-dir` on the next session, with no
 * marketplace and no install step, discovered in place rather than copied to a cache. Naming the
 * folder `webm` is what makes these `/webm:launch` - namespaced, so they can never collide with
 * a client's own skills, which sit BESIDE this directory at .claude/skills/<name>/. The same
 * folder carries the package's agents/ and hooks/ when it ships any; a client's own agents go in
 * .claude/agents/, untouched by this.
 *
 * FULL REPLACE, NEVER A MERGE. A skill deleted in a later version has to disappear here too,
 * which is why this directory is gitignored and exclusively package-owned. A client skill placed
 * inside it would be destroyed on the next install.
 *
 * THREE KINDS OF PACKAGE-OWNED FILE ON DISK, and the difference matters:
 *
 *   REPLACE   skills/, agents/, hooks/, scripts/, the CI workflow
 *                                  Regenerated every install. Pure infrastructure that a client
 *                                  never edits, so overwriting is free and a fix propagates.
 *   ADD-ONLY  migrations/          Copied only when absent. A migration that has been applied to
 *                                  a real D1 database must NEVER change - SQLite has already run
 *                                  it and wrangler tracks it by name. Later versions add 0002,
 *                                  they do not rewrite 0001.
 *   SEED      public/, content     Written once by `webm new` and then the client's outright.
 *                                  Not handled here at all - see cli/scaffold.ts.
 *
 * Anything that is a starting point a client will edit belongs in SEED. Putting it in REPLACE
 * throws their work away on the next `npm update`, silently.
 *
 * Wired from the CLIENT's package.json, so it is visible in the repo rather than a dependency
 * writing outside its own tree behind your back:
 *
 *     "scripts": { "postinstall": "webm sync" }
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  readdirSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { PACKAGE_ROOT, packageVersion } from './package-root.ts';

/**
 * The namespace. Rule 5's prefix: the CLI is `webm`, the tokens are --webm-*, the classes are
 * .webm-*, the Workers are webm-<slug>. `/webm:launch` rather than `/webmonterey:launch`.
 */
const NAMESPACE = 'webm';

interface SyncResult {
  added: string[];
  removed: string[];
  unchanged: string[];
  version: string;
  /** Agent definitions and hook files copied into the plugin, when the package ships any. */
  agents: string[];
  hooks: string[];
  /** Files refreshed under REPLACE, relative to the site root. */
  scripts: string[];
  workflows: string[];
  /** Migrations copied because the site did not have them. Never includes an existing file. */
  migrations: string[];
}

/**
 * REPLACE. Overwrite unconditionally from the package.
 *
 * `scripts/` holds two files that cannot live in node_modules:
 *
 *   check-node.mjs   runs as `preinstall`, which is BEFORE node_modules exists. A bin from an
 *                    uninstalled package is not on PATH yet, so this one has to be on disk.
 *   test-hooks.mjs   loaded with `node --import`, which resolves against the site, and is the
 *                    thing that lets a client's own component tests import `./thing` without an
 *                    extension the way the rest of the toolchain does.
 *
 * Both are dependency-free and neither has a client-specific line in it, so a full replace is
 * the whole propagation story: fix a bug here and every site gets it on `npm update`.
 */
function syncDir(source: string, target: string): string[] {
  if (!existsSync(source)) return [];
  mkdirSync(target, { recursive: true });
  const written: string[] = [];
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (!entry.isFile()) continue;
    cpSync(join(source, entry.name), join(target, entry.name));
    written.push(entry.name);
  }
  return written.sort();
}

/**
 * ADD-ONLY. Copy what is missing and never touch what is there.
 *
 * A D1 migration is applied once and recorded by filename in the database's own
 * d1_migrations table. Rewriting an applied file does not re-run it - the change simply never
 * reaches production, and local and remote drift apart with nothing to show for it. So a later
 * package version ships 0002 alongside, and this leaves 0001 exactly as the client has it.
 */
function addMissing(source: string, target: string): string[] {
  if (!existsSync(source)) return [];
  mkdirSync(target, { recursive: true });
  const added: string[] = [];
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || !entry.isFile()) continue;
    const dest = join(target, entry.name);
    if (existsSync(dest)) continue;
    cpSync(join(source, entry.name), dest);
    added.push(entry.name);
  }
  return added.sort();
}

function listSkills(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, 'SKILL.md')))
    .map((e) => e.name)
    .sort();
}

export function sync(siteRoot: string): SyncResult {
  const version = packageVersion();
  const source = join(PACKAGE_ROOT, 'skills');
  const target = join(siteRoot, '.claude', 'skills', NAMESPACE);

  const before = listSkills(join(target, 'skills'));
  const after = listSkills(source);

  rmSync(target, { recursive: true, force: true });
  mkdirSync(join(target, '.claude-plugin'), { recursive: true });

  /*
   * Filter dotfiles. On macOS `.DS_Store` is created in any directory Finder has opened, so
   * without this it copies into every client repo AND ships in the npm tarball. Gitignored and
   * harmless, but it is junk in someone else's repo with our name on it. The same filter is
   * what lets agents/ and hooks/ hold a .gitkeep in the package and arrive empty in a site.
   */
  const noDotfiles = (src: string) => !basename(src).startsWith('.');
  if (existsSync(source)) {
    cpSync(source, join(target, 'skills'), { recursive: true, filter: noDotfiles });
  }

  /*
   * THE PLUGIN'S OTHER COMPONENTS. A skills-directory plugin can carry agents/ (subagent
   * definitions, invoked as webm:<name>) and hooks/hooks.json (event handlers that make a trap
   * mechanical rather than advisory). Both ride along under the same REPLACE rule as skills/, and
   * both need /reload-plugins in a running session - SKILL.md edits are picked up live, these are
   * not. Empty in the package today; the mechanism is here so shipping one is a file, not a
   * release of the sync command.
   */
  const plugin = (dir: string): string[] => {
    const from = join(PACKAGE_ROOT, dir);
    if (!existsSync(from)) return [];
    const names = readdirSync(from).filter(noDotfiles).sort();
    if (names.length) cpSync(from, join(target, dir), { recursive: true, filter: noDotfiles });
    return names;
  };
  const agents = plugin('agents');
  const hooks = plugin('hooks');

  writeFileSync(
    join(target, '.claude-plugin', 'plugin.json'),
    JSON.stringify(
      {
        name: NAMESPACE,
        description: 'WebMonterey fleet skills. Materialized by `webm sync` - do not edit here.',
        version: version,
      },
      null,
      2,
    ) + '\n',
  );

  /*
   * A marker the doctor reads to tell whether the sync ran against the installed version.
   * `npm install --ignore-scripts` skips postinstall silently, and the failure mode is a session
   * with no fleet skills and no error to explain why.
   */
  writeFileSync(
    join(target, '.webm-sync.json'),
    JSON.stringify({ version: version, namespace: NAMESPACE, skills: after }, null, 2) + '\n',
  );

  const template = join(PACKAGE_ROOT, 'template');

  return {
    added: after.filter((s) => !before.includes(s)),
    removed: before.filter((s) => !after.includes(s)),
    unchanged: after.filter((s) => before.includes(s)),
    version: version,
    agents,
    hooks,
    scripts: syncDir(join(template, 'scripts'), join(siteRoot, 'scripts')),
    /*
     * CI, REPLACE-managed like scripts/. A site never edits its own workflow - if a leg is wrong
     * it is wrong on every site, and it gets fixed here. Five sites once had no CI whatsoever,
     * which is how code depending on an unpublished package reached main without a word.
     */
    workflows: syncDir(join(template, 'workflows'), join(siteRoot, '.github/workflows')),
    migrations: addMissing(join(template, 'migrations'), join(siteRoot, 'migrations')),
  };
}

/**
 * Make sure the materialized directory is ignored.
 *
 * It is regenerated on every install, so committing it guarantees a conflict on every upgrade
 * and a stale copy on every checkout.
 */
function ensureGitignored(siteRoot: string): boolean {
  const path = join(siteRoot, '.gitignore');
  const entry = `.claude/skills/${NAMESPACE}/`;
  const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
  if (current.includes(entry)) return false;
  const addition =
    `\n# Materialized by \`webm sync\` on every install. Package-owned; never commit.\n` +
    `# Client skills go BESIDE it, at .claude/skills/<name>/.\n${entry}\n`;
  writeFileSync(path, current.replace(/\n*$/, '\n') + addition);
  return true;
}

export function run(argv: string[]): number {
  const siteRoot = argv[0] ?? process.cwd();
  const result = sync(siteRoot);

  const total = result.added.length + result.unchanged.length;
  console.log(`webm sync: ${total} skills at .claude/skills/${NAMESPACE}/ (v${result.version})`);
  for (const s of result.added) console.log(`  + /${NAMESPACE}:${s}`);
  for (const s of result.removed) console.log(`  - /${NAMESPACE}:${s}`);

  if (result.agents.length) console.log(`  agents: ${result.agents.join(', ')}`);
  if (result.hooks.length) console.log(`  hooks: ${result.hooks.join(', ')}`);
  if (result.scripts.length) {
    console.log(`  scripts/ refreshed: ${result.scripts.join(', ')}`);
  }
  for (const m of result.migrations) {
    console.log(`  + migrations/${m}  (apply it: npx wrangler d1 migrations apply <DB> --remote)`);
  }

  if (ensureGitignored(siteRoot)) {
    console.log(`  gitignored .claude/skills/${NAMESPACE}/`);
  }

  /*
   * A new or removed SKILL.md is picked up live, within the session - Claude Code watches skill
   * directories. Only the plugin's other components (agents/, hooks/, .mcp.json) need a reload,
   * and the first-ever sync needs a restart because a watcher cannot watch a directory that did
   * not exist when the session started.
   */
  if (result.added.length || result.removed.length) {
    console.log(
      `\nSkill changes are picked up live. If this was the first sync in this repo, restart ` +
        `Claude Code so it can watch the new directory.`,
    );
  }
  return 0;
}
