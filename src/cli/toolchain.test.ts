/*
 * The toolchain step against fixture sites, with npm faked: the argv it must run, the argv it
 * must not, that nothing but wrangler and the plugin is touched, and that "at the floor" is said
 * only when every copy in the tree is there.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  installedWrangler,
  PLUGIN,
  raiseToolchain,
  rangeMinimum,
  staleCopies,
  summary,
  targetWrangler,
  WRANGLER_FLOOR,
  wranglerCopies,
  wranglerRange,
  type NpmRunner,
} from './toolchain.ts';

interface Fixture {
  range?: string | null;
  installed?: string | null;
  /** The plugin in the site's tree, and the exact wrangler it pins. */
  plugin?: { version: string; pins: string };
  /** A second wrangler nested under the plugin, as npm leaves it when the pins differ. */
  nested?: string;
  field?: 'devDependencies' | 'dependencies';
}

const PLUGIN_DIR = `node_modules/${PLUGIN}`;
const NESTED = `${PLUGIN_DIR}/node_modules/wrangler`;

function writeWrangler(root: string, rel: string, version: string) {
  mkdirSync(join(root, rel), { recursive: true });
  writeFileSync(join(root, rel, 'package.json'), JSON.stringify({ name: 'wrangler', version }));
}

function writePlugin(root: string, version: string, pins: string) {
  mkdirSync(join(root, PLUGIN_DIR), { recursive: true });
  writeFileSync(
    join(root, PLUGIN_DIR, 'package.json'),
    JSON.stringify({ name: PLUGIN, version, dependencies: { wrangler: pins } }),
  );
}

function site({
  range = '^4.118.0',
  installed = '4.129.0',
  plugin,
  nested,
  field = 'devDependencies',
}: Fixture = {}) {
  const root = mkdtempSync(join(tmpdir(), 'webm-toolchain-'));
  const pkg: Record<string, unknown> = {
    name: 'acme',
    scripts: { build: 'astro build' },
    dependencies: { astro: '^7.1.6' },
    devDependencies: { typescript: '^6.0.3' },
  };
  if (range) (pkg[field] as Record<string, string>).wrangler = range;
  writeFileSync(join(root, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  if (installed) writeWrangler(root, 'node_modules/wrangler', installed);
  if (plugin) writePlugin(root, plugin.version, plugin.pins);
  if (nested) writeWrangler(root, NESTED, nested);
  return root;
}

/**
 * An npm that behaves the way the real one does on these trees: `install wrangler@V` puts V at
 * the top, writes ^V into the field asked for, and nests the plugin's pin beside it when the two
 * differ - or removes the nested copy when V now satisfies it;
 * `update <plugin>` moves the plugin to `newest` and nests the wrangler it pins when that differs
 * from the top.
 */
function fakeNpm(
  root: string,
  opts: { fail?: boolean; newest?: { version: string; pins: string } } = {},
) {
  const calls: string[][] = [];
  const runner: NpmRunner = (args) => {
    calls.push(args);
    if (args[0] === 'install') {
      if (opts.fail) return { ok: false, output: 'npm ERR! code E404\nnpm ERR! 404 Not Found' };
      const version = args[1]!.split('@')[1]!;
      writeWrangler(root, 'node_modules/wrangler', version);
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
      const field = args[2] === '--save-dev' ? 'devDependencies' : 'dependencies';
      pkg[field].wrangler = `^${version}`;
      writeFileSync(join(root, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
      /* The plugin's exact pin nests beside a top copy it no longer matches, and dedupes when it does. */
      const pluginManifest = join(root, PLUGIN_DIR, 'package.json');
      if (existsSync(pluginManifest)) {
        const pins = JSON.parse(readFileSync(pluginManifest, 'utf8')).dependencies?.wrangler;
        if (pins && pins !== version) writeWrangler(root, NESTED, pins);
        else if (existsSync(join(root, NESTED))) rmSync(join(root, NESTED), { recursive: true });
      }
      return { ok: true, output: 'added 1 package' };
    }
    if (args[0] === 'update' && args[1] === PLUGIN) {
      const newest = opts.newest ?? { version: '1.54.10', pins: '4.132.0' };
      writePlugin(root, newest.version, newest.pins);
      if (installedWrangler(root) !== newest.pins) writeWrangler(root, NESTED, newest.pins);
      else if (existsSync(join(root, NESTED))) rmSync(join(root, NESTED), { recursive: true });
      return { ok: true, output: 'changed 1 package' };
    }
    throw new Error(`unexpected npm ${args.join(' ')}`);
  };
  return { runner, calls };
}

const pkgOf = (root: string) => JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

test('a site at ^4.118.0 with 4.129.0 installed and no plugin is raised to the floor, with exactly one install', () => {
  const root = site();
  const { runner, calls } = fakeNpm(root);
  const result = raiseToolchain(root, runner);
  assert.equal(result.skipped, null);
  assert.deepEqual(calls, [['install', `wrangler@${WRANGLER_FLOOR}`, '--save-dev']]);
  assert.equal(pkgOf(root).devDependencies.wrangler, wranglerRange());
  assert.equal(result.installed, WRANGLER_FLOOR);
  assert.deepEqual(result.copies, [{ path: 'node_modules/wrangler', version: WRANGLER_FLOOR }]);
  assert.deepEqual(result.changes, [
    `npm install wrangler@${WRANGLER_FLOOR} (the floor): 4.129.0 -> ${WRANGLER_FLOOR}`,
    `package.json: wrangler ^4.118.0 -> ${wranglerRange()}`,
  ]);
  assert.equal(summary(result), `toolchain: wrangler ${WRANGLER_FLOOR}, at the floor.`);

  /* Nothing else in package.json moved. */
  const pkg = pkgOf(root);
  assert.deepEqual(pkg.dependencies, { astro: '^7.1.6' });
  assert.equal(pkg.devDependencies.typescript, '^6.0.3');

  /* Idempotent: the second run makes no npm call and reports nothing to change. */
  const again = fakeNpm(root);
  const second = raiseToolchain(root, again.runner);
  assert.deepEqual(again.calls, []);
  assert.deepEqual(second.changes, []);
  assert.equal(second.skipped, null);
});

test("the site the step was written for: the plugin pins below the floor, so it moves FIRST and the site's wrangler follows its new pin - one copy", () => {
  /* scrapbooku, 2026-09-16: plugin 1.54.4 pins 4.129.0; the site's own is 4.129.0, deduped with it. */
  const root = site({ plugin: { version: '1.54.4', pins: '4.129.0' } });
  const { runner, calls } = fakeNpm(root);
  const result = raiseToolchain(root, runner);
  assert.deepEqual(calls, [
    ['update', PLUGIN],
    ['install', 'wrangler@4.132.0', '--save-dev'],
  ]);
  assert.deepEqual(result.changes, [
    `npm update ${PLUGIN}: 1.54.4 -> 1.54.10 (pins wrangler 4.132.0)`,
    `npm install wrangler@4.132.0 (what ${PLUGIN} 1.54.10 pins): 4.129.0 -> 4.132.0`,
    'package.json: wrangler ^4.118.0 -> ^4.132.0',
  ]);
  assert.deepEqual(result.copies, [{ path: 'node_modules/wrangler', version: '4.132.0' }]);
  assert.equal(
    summary(result),
    `toolchain: wrangler 4.132.0, above the floor (${WRANGLER_FLOOR}).`,
  );
});

test("the site 1.8.0 left behind: the floor at the top and the plugin's 4.129.0 nested - repaired to one copy on the next run", () => {
  const root = site({
    range: wranglerRange(),
    installed: WRANGLER_FLOOR,
    plugin: { version: '1.54.4', pins: '4.129.0' },
    nested: '4.129.0',
  });
  assert.deepEqual(wranglerCopies(root), [
    { path: 'node_modules/wrangler', version: WRANGLER_FLOOR },
    { path: NESTED, version: '4.129.0' },
  ]);
  const { runner, calls } = fakeNpm(root);
  const result = raiseToolchain(root, runner);
  assert.deepEqual(calls, [
    ['update', PLUGIN],
    ['install', 'wrangler@4.132.0', '--save-dev'],
  ]);
  assert.deepEqual(result.copies, [{ path: 'node_modules/wrangler', version: '4.132.0' }]);
  assert.equal(staleCopies(result.copies).length, 0);
});

test('when the plugin cannot move past its pin, the copy below the floor is NAMED, not called "at the floor"', () => {
  const root = site({ plugin: { version: '1.54.4', pins: '4.129.0' } });
  /* @astrojs/cloudflare's range tops out at a plugin that still pins 4.129.0. */
  const { runner, calls } = fakeNpm(root, { newest: { version: '1.54.4', pins: '4.129.0' } });
  const result = raiseToolchain(root, runner);
  assert.deepEqual(calls, [
    ['update', PLUGIN],
    ['install', `wrangler@${WRANGLER_FLOOR}`, '--save-dev'],
  ]);
  assert.match(
    result.changes[0]!,
    /1\.54\.4 is the newest .* allows, and it pins wrangler 4\.129\.0/,
  );
  assert.deepEqual(result.copies, [
    { path: 'node_modules/wrangler', version: WRANGLER_FLOOR },
    { path: NESTED, version: '4.129.0' },
  ]);
  const line = summary(result);
  assert.doesNotMatch(line, /, at the floor\./);
  assert.match(
    line,
    new RegExp(
      `wrangler ${WRANGLER_FLOOR} at the top, but 4\\.129\\.0 at ${NESTED.replace(/[/@.]/g, '\\$&')} - below the floor`,
    ),
  );
  assert.match(line, /npm update @cloudflare\/vite-plugin/);
});

test('a site at the floor with one copy is untouched', () => {
  const root = site({
    range: wranglerRange(),
    installed: WRANGLER_FLOOR,
    plugin: { version: '1.54.8', pins: WRANGLER_FLOOR },
  });
  const before = readFileSync(join(root, 'package.json'), 'utf8');
  const { runner, calls } = fakeNpm(root);
  const result = raiseToolchain(root, runner);
  assert.deepEqual(calls, []);
  assert.deepEqual(result.changes, []);
  assert.equal(result.skipped, null);
  assert.equal(readFileSync(join(root, 'package.json'), 'utf8'), before);
  assert.equal(summary(result), `toolchain: wrangler ${WRANGLER_FLOOR}, at the floor.`);
});

test('a site above the floor is never brought down, even to match a plugin pinning lower', () => {
  const root = site({
    range: '^4.140.0',
    installed: '4.140.2',
    plugin: { version: '1.54.10', pins: '4.132.0' },
    nested: '4.132.0',
  });
  const { runner, calls } = fakeNpm(root);
  const result = raiseToolchain(root, runner);
  assert.deepEqual(calls, [], 'both copies are above the floor, so nothing is installed');
  assert.equal(pkgOf(root).devDependencies.wrangler, '^4.140.0');
  assert.equal(result.installed, '4.140.2');
  assert.match(
    summary(result),
    /wrangler 4\.140\.2, above the floor .*; also 4\.132\.0 at .*, at or above it\./,
  );
});

test('an old range with a new lockfile moves the range only - no install', () => {
  const root = site({ range: '^4.118.0', installed: '4.132.0' });
  const { runner, calls } = fakeNpm(root);
  const result = raiseToolchain(root, runner);
  assert.deepEqual(calls, []);
  assert.equal(pkgOf(root).devDependencies.wrangler, wranglerRange());
  assert.match(result.changes[0]!, /4\.132\.0 is installed, already above the floor/);
});

test("the install is the plugin's exact pin when that is above the floor, else the floor, and a pin above it needs no update", () => {
  const above = site({ plugin: { version: '1.54.10', pins: '4.132.0' }, nested: '4.132.0' });
  assert.deepEqual(targetWrangler(above), {
    version: '4.132.0',
    reason: `what ${PLUGIN} 1.54.10 pins`,
  });
  const { runner, calls } = fakeNpm(above);
  raiseToolchain(above, runner);
  assert.deepEqual(calls, [['install', 'wrangler@4.132.0', '--save-dev']]);
  assert.equal(pkgOf(above).devDependencies.wrangler, '^4.132.0');
  assert.deepEqual(wranglerCopies(above), [{ path: 'node_modules/wrangler', version: '4.132.0' }]);
});

test('wrangler in dependencies rather than devDependencies is saved back to the same field', () => {
  const root = site({ field: 'dependencies' });
  const { runner, calls } = fakeNpm(root);
  raiseToolchain(root, runner);
  assert.deepEqual(calls[0], ['install', `wrangler@${WRANGLER_FLOOR}`, '--save']);
  assert.equal(pkgOf(root).dependencies.wrangler, wranglerRange());
  assert.equal(pkgOf(root).devDependencies.wrangler, undefined);
});

test('a failed install is reported with its error line, and package.json is untouched', () => {
  const root = site();
  const before = readFileSync(join(root, 'package.json'), 'utf8');
  const { runner } = fakeNpm(root, { fail: true });
  const result = raiseToolchain(root, runner);
  assert.match(result.skipped!, /npm install wrangler@4\.131\.1 failed: .*404/);
  assert.match(result.skipped!, /Run it by hand/);
  assert.equal(result.installed, '4.129.0');
  assert.equal(readFileSync(join(root, 'package.json'), 'utf8'), before);
  assert.match(summary(result), /^toolchain: npm install wrangler@4\.131\.1 failed/);
});

test('a site that does not list wrangler, or lists it without a version, is left alone and told why', () => {
  const none = site({ range: null });
  const n = fakeNpm(none);
  assert.match(raiseToolchain(none, n.runner).skipped!, /does not list wrangler/);
  assert.deepEqual(n.calls, []);

  const tag = site({ range: 'latest' });
  const t = fakeNpm(tag);
  assert.match(raiseToolchain(tag, t.runner).skipped!, /"latest".*names no version/);
  assert.deepEqual(t.calls, []);
});

test('nothing installed under a range above the floor is a skip, not a downgrade', () => {
  const root = site({ range: '^4.140.0', installed: null });
  const { runner, calls } = fakeNpm(root);
  const result = raiseToolchain(root, runner);
  assert.match(result.skipped!, /not installed.*npm install gets it/);
  assert.deepEqual(calls, []);
  assert.equal(pkgOf(root).devDependencies.wrangler, '^4.140.0');
});

test('wranglerCopies finds a copy three levels down and under a scope, and the top one first', () => {
  const root = site({ installed: '4.132.0' });
  writeWrangler(
    root,
    'node_modules/@astrojs/cloudflare/node_modules/@cloudflare/vite-plugin/node_modules/wrangler',
    '4.129.0',
  );
  writeWrangler(root, 'node_modules/miniflare/node_modules/wrangler', '4.130.0');
  assert.deepEqual(wranglerCopies(root), [
    { path: 'node_modules/wrangler', version: '4.132.0' },
    { path: 'node_modules/miniflare/node_modules/wrangler', version: '4.130.0' },
    {
      path: 'node_modules/@astrojs/cloudflare/node_modules/@cloudflare/vite-plugin/node_modules/wrangler',
      version: '4.129.0',
    },
  ]);
  assert.deepEqual(
    staleCopies(wranglerCopies(root)).map((c) => c.version),
    ['4.130.0', '4.129.0'],
  );
  assert.equal(installedWrangler(site({ installed: null })), null);
});

test('rangeMinimum reads the version out of the range forms npm writes', () => {
  assert.equal(rangeMinimum('^4.118.0'), '4.118.0');
  assert.equal(rangeMinimum('~4.118.0'), '4.118.0');
  assert.equal(rangeMinimum('4.118.0'), '4.118.0');
  assert.equal(rangeMinimum('>=4.118.0 <5'), '4.118.0');
  assert.equal(rangeMinimum('latest'), null);
  assert.equal(rangeMinimum('*'), null);
});

test('the floor is a bare version and the scaffold range is it with a caret', () => {
  assert.match(WRANGLER_FLOOR, /^\d+\.\d+\.\d+$/);
  assert.equal(wranglerRange(), `^${WRANGLER_FLOOR}`);
});
