/*
 * The toolchain step against fixture sites, with npm faked: the argv it must run, the argv it
 * must not, and that nothing but wrangler is touched.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  installedWrangler,
  raiseToolchain,
  rangeMinimum,
  targetWrangler,
  WRANGLER_FLOOR,
  wranglerRange,
  type NpmRunner,
} from './toolchain.ts';

interface Fixture {
  range?: string | null;
  installed?: string | null;
  /** The wrangler the site's @cloudflare/vite-plugin pins, when one is installed. */
  pluginPins?: string;
  field?: 'devDependencies' | 'dependencies';
}

function site({
  range = '^4.118.0',
  installed = '4.129.0',
  pluginPins,
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
  if (installed) {
    mkdirSync(join(root, 'node_modules/wrangler'), { recursive: true });
    writeFileSync(
      join(root, 'node_modules/wrangler/package.json'),
      JSON.stringify({ name: 'wrangler', version: installed }),
    );
  }
  if (pluginPins) {
    mkdirSync(join(root, 'node_modules/@cloudflare/vite-plugin'), { recursive: true });
    writeFileSync(
      join(root, 'node_modules/@cloudflare/vite-plugin/package.json'),
      JSON.stringify({
        name: '@cloudflare/vite-plugin',
        version: '1.54.10',
        dependencies: { wrangler: pluginPins },
      }),
    );
  }
  return root;
}

/** An npm that installs what it is told, writes the range the way npm does, and lists one copy. */
function fakeNpm(root: string, opts: { copies?: number; fail?: boolean } = {}) {
  const calls: string[][] = [];
  let listed = opts.copies ?? 1;
  const runner: NpmRunner = (args) => {
    calls.push(args);
    if (args[0] === 'install') {
      if (opts.fail) return { ok: false, output: 'npm ERR! code E404\nnpm ERR! 404 Not Found' };
      const version = args[1]!.split('@')[1]!;
      mkdirSync(join(root, 'node_modules/wrangler'), { recursive: true });
      writeFileSync(
        join(root, 'node_modules/wrangler/package.json'),
        JSON.stringify({ name: 'wrangler', version }),
      );
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
      const field = args[2] === '--save-dev' ? 'devDependencies' : 'dependencies';
      pkg[field].wrangler = `^${version}`;
      writeFileSync(join(root, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
      return { ok: true, output: 'added 1 package' };
    }
    if (args[0] === 'ls') {
      return {
        ok: true,
        output: Array.from({ length: listed }, (_, i) =>
          i === 0
            ? `${root}/node_modules/wrangler`
            : `${root}/node_modules/@cloudflare/vite-plugin/node_modules/wrangler`,
        ).join('\n'),
      };
    }
    if (args[0] === 'dedupe') {
      listed = 1;
      return { ok: true, output: 'removed 1 package' };
    }
    throw new Error(`unexpected npm ${args.join(' ')}`);
  };
  return { runner, calls };
}

const pkgOf = (root: string) => JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

test('a site at ^4.118.0 with 4.129.0 installed is raised to the floor, with exactly one install', () => {
  const root = site();
  const { runner, calls } = fakeNpm(root);
  const result = raiseToolchain(root, runner);
  assert.equal(result.skipped, null);
  assert.deepEqual(calls, [
    ['install', `wrangler@${WRANGLER_FLOOR}`, '--save-dev'],
    ['ls', 'wrangler', '--parseable', '--all'],
  ]);
  assert.equal(pkgOf(root).devDependencies.wrangler, wranglerRange());
  assert.equal(result.installed, WRANGLER_FLOOR);
  assert.deepEqual(result.changes, [
    `npm install wrangler@${WRANGLER_FLOOR} (the floor): 4.129.0 -> ${WRANGLER_FLOOR}`,
    `package.json: wrangler ^4.118.0 -> ${wranglerRange()}`,
  ]);

  /* Nothing else in package.json moved. */
  const pkg = pkgOf(root);
  assert.deepEqual(pkg.dependencies, { astro: '^7.1.6' });
  assert.equal(pkg.devDependencies.typescript, '^6.0.3');

  /* Idempotent: the second run makes no npm call and reports nothing to change. */
  const again = fakeNpm(root);
  assert.deepEqual(raiseToolchain(root, again.runner), {
    changes: [],
    skipped: null,
    installed: WRANGLER_FLOOR,
  });
  assert.deepEqual(again.calls, []);
});

test('a site at the floor is untouched', () => {
  const root = site({ range: wranglerRange(), installed: WRANGLER_FLOOR });
  const before = readFileSync(join(root, 'package.json'), 'utf8');
  const { runner, calls } = fakeNpm(root);
  assert.deepEqual(raiseToolchain(root, runner), {
    changes: [],
    skipped: null,
    installed: WRANGLER_FLOOR,
  });
  assert.deepEqual(calls, []);
  assert.equal(readFileSync(join(root, 'package.json'), 'utf8'), before);
});

test('a site above the floor is never brought down', () => {
  const root = site({ range: '^4.140.0', installed: '4.140.2' });
  const { runner, calls } = fakeNpm(root);
  const result = raiseToolchain(root, runner);
  assert.deepEqual(result, { changes: [], skipped: null, installed: '4.140.2' });
  assert.deepEqual(calls, []);
  assert.equal(pkgOf(root).devDependencies.wrangler, '^4.140.0');
});

test('an old range with a new lockfile moves the range only - no install', () => {
  const root = site({ range: '^4.118.0', installed: '4.132.0' });
  const { runner, calls } = fakeNpm(root);
  const result = raiseToolchain(root, runner);
  assert.deepEqual(calls, []);
  assert.equal(pkgOf(root).devDependencies.wrangler, wranglerRange());
  assert.match(result.changes[0]!, /4\.132\.0 is installed, already above the floor/);
  assert.equal(result.installed, '4.132.0');
});

test("the install is the plugin's exact pin when that is above the floor, else the floor", () => {
  const above = site({ pluginPins: '4.132.0' });
  assert.deepEqual(targetWrangler(above), {
    version: '4.132.0',
    reason: 'what @cloudflare/vite-plugin 1.54.10 pins',
  });
  const { runner, calls } = fakeNpm(above);
  raiseToolchain(above, runner);
  assert.deepEqual(calls[0], ['install', 'wrangler@4.132.0', '--save-dev']);
  assert.equal(pkgOf(above).devDependencies.wrangler, '^4.132.0');

  const below = site({ pluginPins: '4.130.0' });
  assert.deepEqual(targetWrangler(below), { version: WRANGLER_FLOOR, reason: 'the floor' });
  const b = fakeNpm(below);
  raiseToolchain(below, b.runner);
  assert.deepEqual(b.calls[0], ['install', `wrangler@${WRANGLER_FLOOR}`, '--save-dev']);
});

test('two copies after the install are deduped, and the count is reported', () => {
  const root = site();
  const { runner, calls } = fakeNpm(root, { copies: 2 });
  const result = raiseToolchain(root, runner);
  assert.deepEqual(
    calls.map((c) => c[0]),
    ['install', 'ls', 'dedupe', 'ls'],
  );
  assert.ok(result.changes.some((c) => c === 'npm dedupe: 2 copies of wrangler -> 1'));
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

test('the installed version is read from the manifest, not the range', () => {
  assert.equal(installedWrangler(site({ range: '^4.118.0', installed: '4.129.0' })), '4.129.0');
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
