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
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WRANGLER_FLOOR } from '../src/cli/toolchain.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DOMAIN = 'e2e.example';
const REPO = 'e2e'; /* the slug: one name everywhere */

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : `\n         ${detail}`}`);
  if (!ok) failures.push(name);
};
const run = (cmd, args, cwd, quiet = true, env = {}) =>
  execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: quiet ? 'pipe' : 'inherit',
    env: { ...process.env, ...env },
  });

/*
 * THE SITE'S OWN `npm run build` - `wrangler types && astro check && astro build` - because that
 * is what Workers Builds runs. Plain `astro build` was used here through 1.5.0, and it does not
 * type-check, so a scaffold that failed `astro check` with zero components passed this test and
 * failed the first push of every fresh site.
 *
 * BOTH streams captured, because Astro's router warnings go to stderr and execFileSync only
 * returns stdout. The output is an assertion surface: a route collision is a warning today and a
 * hard error in a later Astro, so a build that succeeds while warning is a build that will fail
 * next year.
 */
const build = (cwd) => {
  const r = spawnSync('npm', ['run', 'build'], { cwd, encoding: 'utf8', env: process.env });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.status !== 0) throw new Error(`npm run build failed in ${cwd}\n${out}`);
  return out;
};
const COLLISION = /cannot be defined more than once/;
const atLeast = (version, floor) => {
  const [a, b] = [version, floor].map((v) => v.split('.').map(Number));
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
};

const work = mkdtempSync(join(tmpdir(), 'webm-e2e-'));

/*
 * NO LOGIN, for every step that could reach the Cloudflare account. An empty config home means
 * wrangler finds no OAuth session, and the empty token means it has nothing else; in a
 * non-interactive process it can only report "not logged in". A bogus token was tried first and
 * did not hold on the upgrade path - two runs created real queues on the account.
 */
const NO_LOGIN = {
  ...process.env,
  XDG_CONFIG_HOME: join(work, 'no-config'),
  CLOUDFLARE_API_TOKEN: '',
  CLOUDFLARE_ACCOUNT_ID: '',
  WRANGLER_SEND_METRICS: 'false',
};
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
   * The scaffold starts a site on environment "staging", and a staging site is a preview build
   * everywhere - noindex, no sitemap, Disallow: /. Everything below measures PRODUCTION output,
   * so this flips it the way /webm:launch does. The staging build itself is asserted at the end.
   */
  const siteJson = join(site, 'webmonterey.json');
  const scaffolded = JSON.parse(readFileSync(siteJson, 'utf8'));
  check('the scaffold starts a site on staging', scaffolded.environment === 'staging');
  /*
   * A 1.5-SHAPED SITE. The `app` key every pre-1.6 scaffold carried is left in place: it is no
   * longer read, and this is the proof that a site upgrading with it is untouched. The webmaster
   * layout written further down spreads the OLD button constant for the same reason - the
   * upgrade path is run over both before the final build.
   */
  writeFileSync(
    siteJson,
    JSON.stringify(
      {
        ...scaffolded,
        environment: 'production',
        app: { enabled: false, path: 'webapp', label: 'Portal' },
      },
      null,
      2,
    ) + '\n',
  );

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
  const firstBuild = build(site);

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
  check(
    "without a site 404 the package's ships, with no route collision",
    read('404.html').includes('Back to the home page') && !COLLISION.test(firstBuild),
    COLLISION.test(firstBuild)
      ? 'Astro warned that /404 is defined twice'
      : 'dist/client/404.html is not the package page',
  );
  check(
    'the webmaster page names the client, in the description and in the words',
    read('webmaster/index.html').includes(
      'This E2E Example custom website was built and managed by',
    ) &&
      /<meta name="description" content="This E2E Example custom website/.test(
        read('webmaster/index.html'),
      ) &&
      read('webmaster/index.html').includes('about the E2E Example website'),
    'the {client} placeholder was not filled from webmonterey.json',
  );
  check(
    'the webmaster page and its share image are built',
    read('webmaster/index.html').includes('application/ld+json') &&
      existsSync(join(dist, 'webmaster/og.png')),
    'the injected /webmaster route or its og.png endpoint did not build',
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

  /*
   * THE /webmaster BODY. The page before this build is the package's own layout; this hands the
   * body to a site component and keeps everything else. Both halves are asserted: the site's
   * markup is in, and the <head> the package owns - title, share image, agency graph - is the
   * same bytes it was without the export.
   */
  const webmasterBefore = read('webmaster/index.html');
  /*
   * The tags the package writes, not the whole <head>: this same build retints design.json and
   * adds custom CSS, so the stylesheet hash changes for reasons that are nothing to do with the
   * seam.
   */
  const owned = (html) =>
    (
      html
        .slice(0, html.indexOf('</head>'))
        .match(
          /<title>[^<]*<\/title>|<meta name="description"[^>]*>|<meta property="og:[^>]*>|<script type="application\/ld\+json">[\s\S]*?<\/script>/g,
        ) ?? []
    ).join('\n');
  execFileSync('mkdir', ['-p', join(site, 'src/components/general')]);
  const oldLayout =
    `---\nimport { AGENCY_LINK_ATTRS, type WebmasterPageProps } from '@cparkerwebm/webmonterey/webmonterey/webmaster';\n` +
    `type Props = WebmasterPageProps;\n` +
    `const { title, intro, body, cta } = Astro.props;\n---\n` +
    `<article class="doc" data-child="CHILD_WEBMASTER_WINS">\n` +
    `  <h1 class="doc__title">{title}</h1>\n` +
    `  <p set:html={intro} />\n` +
    `  {body.map((p) => <p set:html={p} />)}\n` +
    `  <p><a data-cta href={cta.href} {...AGENCY_LINK_ATTRS}>{cta.label}</a></p>\n` +
    `</article>\n`;
  writeFileSync(join(site, 'src/components/general/webmaster-page.astro'), oldLayout);
  writeFileSync(
    join(site, 'src/components/registry.ts'),
    readFileSync(join(site, 'src/components/registry.ts'), 'utf8') +
      `\nexport { default as webmasterPage } from './general/webmaster-page.astro';\n`,
  );

  const overrideBuild = build(site);

  const webmasterAfter = read('webmaster/index.html');
  check(
    "the site's webmasterPage renders the /webmaster body",
    webmasterAfter.includes('CHILD_WEBMASTER_WINS') &&
      webmasterAfter.includes('<h1 class="doc__title">Our Webmaster</h1>') &&
      /<p><strong>If you have a question/.test(webmasterAfter),
    'the registry export was ignored and the built-in layout shipped',
  );
  check(
    'the intro reaches the site component with the agency link resolved',
    /<p>[^<]* <a href="https:\/\/webmonterey\.com\/\?utm_source=client[^"]*" target="_blank" rel="noopener">WebMonterey<\/a>/.test(
      webmasterAfter,
    ),
    'the outbound link, its UTMs or its attributes did not survive the hand-off',
  );
  check(
    'the cta reaches the site component: label, attributed href, agency link attributes',
    /<a data-cta href="https:\/\/webmonterey\.com\/\?utm_source=client[^"]*" target="_blank" rel="noopener">Visit WebMonterey<\/a>/.test(
      webmasterAfter,
    ),
    'the button prop, its href or its attributes did not survive the hand-off',
  );
  check(
    'the built-in webmaster layout is gone when the site owns the body',
    !/<div class="webm-stack">/.test(webmasterAfter),
    'both layouts rendered',
  );

  /*
   * THE UPGRADE PATH, over the 1.5-shaped layout above: the codemods from 1.5.0 to the installed
   * version, then the sync. The one codemod rewrites the button's spread; nothing else in the
   * site changes. Then a rebuild, and the button carries the marker the page's floor rule keys on.
   */
  /* --no-queue: these two runs prove the codemods; the queue step is proved below, logged out. */
  console.log('webm upgrade --codemods-from 1.5.0 --no-queue…');
  const upgraded = run('npx', ['webm', 'upgrade', '--codemods-from', '1.5.0', '--no-queue'], site);
  check(
    'the 1.6.0 codemod ran and named the layout it changed',
    /1\.6\.0 .*AGENCY_CTA_ATTRS/.test(upgraded) && /webmaster-page\.astro/.test(upgraded),
    upgraded.split('\n').slice(0, 6).join('\n'),
  );
  const layoutAfter = readFileSync(
    join(site, 'src/components/general/webmaster-page.astro'),
    'utf8',
  );
  check(
    'the layout now spreads AGENCY_CTA_ATTRS and imports it',
    /\{\.\.\.AGENCY_CTA_ATTRS\}/.test(layoutAfter) && !/AGENCY_LINK_ATTRS/.test(layoutAfter),
  );
  check(
    'running the codemods again changes nothing',
    /nothing to change/.test(
      run('npx', ['webm', 'upgrade', '--codemods-from', '1.5.0', '--no-queue'], site),
    ),
  );
  /*
   * THE QUEUE STEP, with a deliberately invalid token: it must say so and write nothing - the
   * site builds and sends inline exactly as before. The first run of this scenario on a logged-in
   * laptop created two real queues on the account, which is why the token is forced here.
   */
  /*
   * A REAL CROSS-VERSION UPGRADE. The site is put back on 1.5.0 from the registry with the
   * 1.5-shaped layout, committed, and upgraded to THIS tarball by this repo's own built binary
   * standing in for "the old version's process" - the fix under test is that the second half
   * runs from the binary just installed, so the new codemods apply. Through 1.6.1 they did not.
   * npm reaches the registry for astro anyway, so 1.5.0 coming from it is no new dependency.
   */
  console.log('upgrade from 1.5.0 to the tarball…');
  writeFileSync(join(site, 'src/components/general/webmaster-page.astro'), oldLayout);
  /*
   * AND THE TOOLCHAIN SUCH A SITE HAS: wrangler 4.129.0 under a ^4.118.0 range, which is the site
   * the toolchain step was written for - its miniflare bundles a sharp with an open advisory.
   * The upgrade must raise it, leave one copy, and clear the advisory, without being asked.
   */
  run(
    'npm',
    [
      'install',
      '@cparkerwebm/webmonterey@1.5.0',
      'wrangler@4.129.0',
      '--silent',
      '--ignore-scripts',
    ],
    site,
  );
  /*
   * AND THE PLUGIN SUCH A LOCKFILE RESOLVED: @cloudflare/vite-plugin 1.54.4, which pins wrangler
   * 4.129.0 exactly. Held there by an override for one install and then released - a stale
   * lockfile looks exactly like that: the plugin satisfies its range, so npm leaves it. 1.8.0's
   * step installed the floor at the top and left this copy nested, then said "at the floor".
   */
  {
    const pkgPath = join(site, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    writeFileSync(
      pkgPath,
      JSON.stringify({ ...pkg, overrides: { '@cloudflare/vite-plugin': '1.54.4' } }, null, 2) +
        '\n',
    );
    run('npm', ['install', '--silent', '--ignore-scripts'], site);
    pkg.devDependencies.wrangler = '^4.118.0';
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    run('npm', ['install', '--silent', '--ignore-scripts'], site);
    /* The plugin sits at the top or under @astrojs/cloudflare, as npm decides. */
    const pluginNow = ['node_modules', 'node_modules/@astrojs/cloudflare/node_modules']
      .map((d) => join(site, d, '@cloudflare/vite-plugin/package.json'))
      .filter(existsSync)
      .map((f) => JSON.parse(readFileSync(f, 'utf8')))[0] ?? {
      version: 'absent',
      dependencies: {},
    };
    const wranglerNow = JSON.parse(
      readFileSync(join(site, 'node_modules/wrangler/package.json'), 'utf8'),
    ).version;
    check(
      'the 1.5-era site holds the plugin that pins wrangler 4.129.0, and that wrangler',
      pluginNow.version === '1.54.4' && wranglerNow === '4.129.0',
      `plugin ${pluginNow.version} pins ${pluginNow.dependencies?.wrangler}; wrangler ${wranglerNow}`,
    );
  }
  run('git', ['add', '-A'], site);
  run(
    'git',
    ['-c', 'user.email=e2e@example.com', '-c', 'user.name=e2e', 'commit', '-q', '-m', 'on 1.5.0'],
    site,
  );
  const crossOut = spawnSync(process.execPath, [join(ROOT, 'dist/webm.mjs'), 'upgrade', tgz], {
    cwd: site,
    encoding: 'utf8',
    env: NO_LOGIN,
  });
  const crossText = `${crossOut.stdout ?? ''}${crossOut.stderr ?? ''}`;
  check(
    'the upgrade installed the tarball and handed over to the new binary',
    crossOut.status === 0 && /Handing over to it/.test(crossText),
    crossText.split('\n').slice(-12).join('\n'),
  );
  check(
    "the NEW version's codemods ran from the new binary: the 1.5 layout was rewritten",
    /1\.6\.0 .*AGENCY_CTA_ATTRS/.test(crossText) &&
      /\{\.\.\.AGENCY_CTA_ATTRS\}/.test(
        readFileSync(join(site, 'src/components/general/webmaster-page.astro'), 'utf8'),
      ),
    'the codemod list came from the old process',
  );
  check(
    'the toolchain step moved the plugin first, because its pin was below the floor',
    /npm update @cloudflare\/vite-plugin: 1\.54\.4 -> 1\.54\.\d+ \(pins wrangler 4\.\d+\.\d+\)/.test(
      crossText,
    ),
    crossText
      .split('\n')
      .filter((l) => /vite-plugin/.test(l))
      .join('\n'),
  );
  check(
    'the toolchain step raised wrangler from the 1.5-era range, and said what moved',
    /npm install wrangler@4\.\d+\.\d+ \(.*\): 4\.129\.0 -> 4\.\d+\.\d+/.test(crossText) &&
      /package\.json: wrangler \^4\.118\.0 -> \^4\.\d+\.\d+/.test(crossText) &&
      /toolchain: wrangler 4\.\d+\.\d+, (at|above) the floor/.test(crossText),
    crossText
      .split('\n')
      .filter((l) => /toolchain|wrangler/i.test(l))
      .join('\n'),
  );
  {
    const ls = spawnSync('npm', ['ls', 'wrangler', '--parseable', '--all'], {
      cwd: site,
      encoding: 'utf8',
    });
    const copies = [...new Set((ls.stdout ?? '').split('\n').filter((l) => /wrangler$/.test(l)))];
    const version = JSON.parse(
      readFileSync(join(site, 'node_modules/wrangler/package.json'), 'utf8'),
    ).version;
    check(
      'one copy of wrangler, at or above the floor',
      copies.length === 1 && atLeast(version, WRANGLER_FLOOR),
      `${copies.length} copies; installed ${version}; floor ${WRANGLER_FLOOR}`,
    );
    const audit = spawnSync('npm', ['audit', '--json'], { cwd: site, encoding: 'utf8' });
    let vulnerabilities = null;
    try {
      vulnerabilities = JSON.parse(audit.stdout).vulnerabilities ?? {};
    } catch {
      /* no JSON: the registry was not reachable, and the check below says so */
    }
    check(
      'npm audit has no entry for sharp after the upgrade',
      vulnerabilities !== null && !('sharp' in vulnerabilities),
      vulnerabilities
        ? `advisories: ${Object.keys(vulnerabilities).join(', ') || 'none'}`
        : (audit.stdout ?? '').slice(0, 200),
    );
  }
  check(
    'and the queue step ran from it too, skipping cleanly without a login and creating nothing',
    /queue: wrangler (is not logged in|could not create)/.test(crossText) &&
      !/created queue/.test(crossText),
    crossText
      .split('\n')
      .filter((l) => /queue/i.test(l))
      .join('\n'),
  );

  console.log('webm queue (no login)…');
  const queueOut = spawnSync('npx', ['webm', 'queue'], {
    cwd: site,
    encoding: 'utf8',
    /* An invalid token forces token auth over any laptop login, so the account is never reached. */
    env: NO_LOGIN,
  });
  const queueText = `${queueOut.stdout ?? ''}${queueOut.stderr ?? ''}`;
  check(
    'without a wrangler login the queue step skips and names the fix',
    queueOut.status === 1 && /queue: wrangler (is not logged in|could not create)/.test(queueText),
    queueText.split('\n').slice(0, 4).join('\n'),
  );
  {
    const wranglerNow = readFileSync(join(site, 'wrangler.jsonc'), 'utf8');
    const siteNow = JSON.parse(readFileSync(siteJson, 'utf8'));
    check(
      'and it wrote nothing: the block stays a comment and the flag stays off',
      /\/\/ "queues": \{/.test(wranglerNow) && siteNow.features.queue === false,
      `features.queue=${siteNow.features.queue}; queues lines:\n${wranglerNow
        .split('\n')
        .filter((l) => /queues|main|QUEUE/.test(l))
        .join('\n')}`,
    );
  }

  build(site);
  check(
    'after the upgrade the site-owned button carries the 25px-floor marker',
    /<a data-cta href="https:\/\/webmonterey\.com\/\?utm_source=client[^"]*" target="_blank" rel="noopener" data-webm-cta>Visit WebMonterey<\/a>/.test(
      read('webmaster/index.html'),
    ),
    'the codemod did not reach the built page',
  );
  check(
    'the <head> the package owns is unchanged by the seam',
    owned(webmasterAfter) === owned(webmasterBefore) &&
      owned(webmasterAfter).includes('#organization') &&
      owned(webmasterAfter).includes('/webmaster/og.png'),
    'title, description, share image or JSON-LD changed when the site took the body',
  );

  check(
    "the site's own 404.astro is the 404, and the package's is not injected beside it",
    read('404.html').includes('CHILD_404_WINS') && !COLLISION.test(overrideBuild),
    COLLISION.test(overrideBuild)
      ? "Astro warned that /404 is defined twice: the package injected its 404 over the site's"
      : 'the package route won, so a client cannot replace the 404',
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

  /*
   * A BRANCH PREVIEW BUILD. Workers Builds injects WORKERS_CI_BRANCH; anything but the production
   * branch is a preview, and a preview must be impossible to index and invisible to analytics.
   * Built last, so nothing above was measured against it.
   */
  console.log('preview build (WORKERS_CI_BRANCH=feature/x)…');
  run('npx', ['astro', 'build'], site, true, { WORKERS_CI_BRANCH: 'feature/x' });
  const previewIndex = read('index.html');
  check('every page on a preview is noindex', /name="robots" content="noindex/.test(previewIndex));
  check('a preview page carries no page-view beacon', !/_webm\/beacon/.test(previewIndex));
  check('a preview page emits no canonical', !/rel="canonical"/.test(previewIndex));
  check('a preview has no sitemap', !existsSync(join(dist, 'sitemap-index.xml')));
  check('a preview robots.txt disallows everything', /Disallow: \/\s*$/m.test(read('robots.txt')));
  check(
    'the webmaster page on a preview carries no agency graph',
    !read('webmaster/index.html').includes('#organization'),
  );

  /*
   * A STAGING BUILD, with no branch at all - the laptop build of a site that has not launched.
   * This is the case that was indexable before 1.3.0: only a non-production branch used to be a
   * preview, so `main` and a laptop build of a staging site produced production output.
   */
  console.log('staging build (environment: "staging", no WORKERS_CI_BRANCH)…');
  writeFileSync(siteJson, JSON.stringify(scaffolded, null, 2) + '\n');
  run('npx', ['astro', 'build'], site);
  const stagingIndex = read('index.html');
  check(
    'every page of a staging site is noindex, with no branch at all',
    /name="robots" content="noindex/.test(stagingIndex),
  );
  check('a staging page emits no canonical', !/rel="canonical"/.test(stagingIndex));
  check('a staging site has no sitemap', !existsSync(join(dist, 'sitemap-index.xml')));
  check('a staging robots.txt disallows everything', /Disallow: \/\s*$/m.test(read('robots.txt')));

  console.log('webm doctor…');
  const doctor = run('npx', ['webm', 'doctor'], site);
  check(
    'doctor: wrangler is at or above the toolchain floor',
    /ok\s+wrangler is at or above the toolchain floor/.test(doctor),
    doctor
      .split('\n')
      .filter((l) => /toolchain/.test(l))
      .join('\n'),
  );
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
