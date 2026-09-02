/*
 * The only test that installs the package the way a client does.
 *
 * WHY IT HAS TO EXIST. examples/minimal depends on "file:../.." which npm resolves to a SYMLINK
 * into this checkout. That hides an entire class of bug, and it hid three real ones:
 *
 *   - the CLI could not run, because Node refuses to type-strip under node_modules and a
 *     symlink escapes node_modules
 *   - template/ was missing from package.json files[], so it existed in every test and would
 *     have been absent from the tarball
 *   - the scaffold's own wrangler.jsonc rendered every page as "[object Object]"
 *
 * Each of those was invisible to 160-odd unit tests and to a green example build. So this packs
 * a real tarball, scaffolds a real site with the real CLI, installs, builds, and looks at the
 * HTML. Slow - about a minute - and it is the one that would have caught all three.
 *
 * >> AND IT STILL HAS A BLIND SPOT, WHICH SHIPPED A BROKEN 1.0.0. <<
 *
 * Installing from a packed tarball by path is not the same as installing from the registry.
 * package.json listed the package as a dependency of ITSELF at an absolute local path; npm
 * resolves that fine when the file is sitting there, so this test passed, and every install of
 * the published package failed with ENOENT.
 *
 * `node scripts/e2e.mjs --registry` installs the PUBLISHED package instead of a local pack. It
 * tests what a client actually gets, so it is the one to run after a publish rather than before.
 * The default path stays local because it must work before there is anything published to test
 * against.
 *
 *   node scripts/e2e.mjs              against a freshly packed tarball
 *   node scripts/e2e.mjs --registry   against whatever is published right now
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DOMAIN = 'e2e.example';
const REPO = 'e2e'; /* the slug: one name everywhere */

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : `\n         ${detail}`}`);
  if (!ok) failures.push(name);
};
const run = (cmd, args, cwd, quiet = true) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: quiet ? 'pipe' : 'inherit' });

const work = mkdtempSync(join(tmpdir(), 'webm-e2e-'));
console.log(`e2e in ${work}\n`);

try {
  console.log('packing…');
  execFileSync('node', ['scripts/build-cli.mjs'], { cwd: ROOT, stdio: 'pipe' });
  /*
   * LAST line, not the whole output: `npm pack` runs the prepack script first, so esbuild's
   * "dist/webm.mjs 64.1kb" is sitting on stdout above the filename.
   */
  const packed = run('npm', ['pack', '--silent', `--pack-destination=${work}`], ROOT)
    .trim()
    .split('\n')
    .at(-1)
    .trim();
  const tgz = join(work, packed);

  const useRegistry = process.argv.includes('--registry');
  console.log(useRegistry ? 'installing the PUBLISHED package…' : 'installing the packed tarball…');
  const host = join(work, 'host');
  execFileSync('mkdir', ['-p', host]);
  writeFileSync(join(host, 'package.json'), JSON.stringify({ name: 'host', private: true }) + '\n');
  if (useRegistry) {
    /*
     * A THROWAWAY HOME, so no user-level cache or config can serve a stale copy. Diagnosing an
     * earlier broken release took four rounds precisely because a local cache kept answering
     * instead of the registry.
     */
    const cleanHome = join(work, 'home');
    execFileSync('mkdir', ['-p', cleanHome]);
    execFileSync('npm', ['install', '@cparkerwebm/webmonterey', '--silent', '--ignore-scripts'], {
      cwd: host,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, HOME: cleanHome },
    });
  } else {
    run('npm', ['install', tgz, '--silent', '--ignore-scripts'], host);
  }

  console.log('webm new…');
  run(
    'node',
    [
      join(host, 'node_modules/@cparkerwebm/webmonterey/dist/webm.mjs'),
      'new',
      DOMAIN,
      '--client=E2E Example',
      '--org=example',
      '--no-install',
    ],
    host,
  );
  const site = join(host, REPO);
  check('webm new produced a site', existsSync(join(site, 'astro.config.mjs')));

  /*
   * Point at the tarball - everything else is untouched. In --registry mode the scaffolded
   * ^version is left alone: resolving it from npmjs IS the test.
   */
  if (!useRegistry) {
    const pkg = JSON.parse(readFileSync(join(site, 'package.json'), 'utf8'));
    pkg.dependencies['@cparkerwebm/webmonterey'] = `file:${tgz}`;
    writeFileSync(join(site, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  }

  console.log('npm install (runs preinstall + postinstall)…');
  run('npm', ['install', '--silent'], site);
  check(
    'postinstall materialized the skills',
    existsSync(join(site, '.claude/skills/webm/skills/traps/SKILL.md')),
  );
  check('sync restored scripts/', existsSync(join(site, 'scripts/check-node.mjs')));
  check(
    'sync seeded the D1 migration',
    existsSync(join(site, 'migrations/0001_create_submissions.sql')),
  );
  check(
    'seed wrote the favicons',
    readdirSync(join(site, 'public')).filter((f) => f.includes('favicon')).length >= 3,
  );
  check('seed wrote _headers', existsSync(join(site, 'public/_headers')));
  check('seed wrote CLAUDE.md', existsSync(join(site, 'CLAUDE.md')));

  console.log('astro build…');
  run('npx', ['astro', 'build'], site);

  const dist = join(site, 'dist/client');
  const read = (f) => (existsSync(join(dist, f)) ? readFileSync(join(dist, f), 'utf8') : '');

  /*
   * The assertion that matters most. A page that renders "[object Object]" is 15 bytes and the
   * build says "Complete!", so only looking at the bytes catches it.
   */
  for (const page of ['index.html', '404.html']) {
    const html = read(page);
    check(
      `${page} is real HTML`,
      html.length > 1000 && html.includes('<!DOCTYPE html>'),
      html.trim() === '[object Object]'
        ? 'rendered "[object Object]" - compatibility_date is stale in wrangler.jsonc'
        : `${html.length} bytes`,
    );
  }

  check(
    'the cascade layer statement is present',
    read('index.html').includes('@layer webm.reset,'),
  );
  check(
    'robots.txt names the sitemap',
    read('robots.txt').includes(`https://${DOMAIN}/sitemap-index.xml`),
  );
  check(
    '_headers kept the report-only CSP',
    read('_headers').includes('Content-Security-Policy-Report-Only'),
  );
  check('the adapter merged its cache rule', read('_headers').includes('immutable'));
  check('the manifest carries the client name', read('site.webmanifest').includes('E2E Example'));
  check(
    'the scratch page is NOT in a production build',
    !existsSync(join(dist, 'webm/index.html')),
    'a dev workbench shipped to the client domain',
  );

  /*
   * THE CHILD-THEME SEAMS. The package is a WordPress parent theme and this repo is the child,
   * which is only true if an override actually wins. Each of these is a seam somebody will
   * reach for, and a seam that silently loses is worse than no seam - the override sits in the
   * repo looking correct while the parent's version ships.
   */
  console.log('overrides…');

  writeFileSync(
    join(site, 'src/pages/404.astro'),
    `<html><body><h1>CHILD_404_WINS</h1></body></html>\n`,
  );

  writeFileSync(
    join(site, 'src/styles/custom/_index.css'),
    `@layer webm.components.custom {\n  .webm-container { outline: 7px dotted rgb(1 2 3); }\n}\n`,
  );

  const design = JSON.parse(readFileSync(join(site, 'design.json'), 'utf8'));
  /* #123456: six distinct hex digits, so the minifier cannot shorten it to three. */
  design.color = { ...(design.color ?? {}), action: { base: '#123456' } };
  writeFileSync(join(site, 'design.json'), JSON.stringify(design, null, 2) + '\n');

  run('npx', ['astro', 'build'], site);

  check(
    "the site's own 404.astro beats the injected one",
    read('404.html').includes('CHILD_404_WINS'),
    'the package route won, so a client cannot replace the 404',
  );

  const css = readdirSync(join(dist, '_astro'))
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(join(dist, '_astro', f), 'utf8'))
    .join('\n');
  check(
    'src/styles/custom/ reaches the bundle',
    /7px dotted/.test(css),
    'the client override seam is not in the module graph - a rule there never ships',
  );
  check(
    'design.json retints the action token',
    /--webm-action:\s*#123456/.test(css),
    'the palette override never compiled into the token layer',
  );

  console.log('webm doctor…');
  const doctor = run('npx', ['webm', 'doctor'], site);
  check(
    'doctor reports no failures',
    /0 failed/.test(doctor),
    doctor.split('\n').slice(-3).join('\n'),
  );
} catch (error) {
  failures.push('threw');
  console.error(`\n${error.stdout ?? ''}${error.stderr ?? ''}${error.message ?? error}`);
} finally {
  if (!process.env.KEEP) rmSync(work, { recursive: true, force: true });
  else console.log(`\nkept: ${work}`);
}

console.log(
  failures.length ? `\n${failures.length} FAILED: ${failures.join(', ')}` : '\nall passed',
);
process.exit(failures.length ? 1 : 0);
