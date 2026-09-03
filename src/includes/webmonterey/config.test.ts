import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_DIR,
  isConfigured,
  isPreviewBuild,
  isStagingDeployment,
  isValidTimeZone,
  PLACEHOLDER,
  previewReason,
  resolveAppPath,
  resolveDisplayName,
  workerFirstPaths,
} from './config.ts';

test('the app path defaults to the folder, so the common case needs no rewrite', () => {
  assert.equal(resolveAppPath({}), APP_DIR);
  assert.equal(resolveAppPath({ app: { path: 'portal' } }), 'portal');
  assert.equal(resolveAppPath({ app: { path: '/portal/' } }), 'portal', 'slashes are stripped');
  assert.equal(resolveAppPath({ app: { path: '/' } }), APP_DIR, 'and cannot become the root');
});

test('run_worker_first carries the PUBLIC app path in every form, only when enabled', () => {
  assert.deepEqual(workerFirstPaths({}), ['/_actions/*']);
  assert.deepEqual(workerFirstPaths({ app: { enabled: false, path: 'portal' } }), ['/_actions/*']);
  assert.deepEqual(workerFirstPaths({ app: { enabled: true, path: 'portal' } }), [
    '/_actions/*',
    '/portal/*',
    '/portal',
    '/portal/',
  ]);
});

test('isConfigured rejects the placeholder, empty and absent', () => {
  assert.equal(isConfigured(PLACEHOLDER), false);
  assert.equal(isConfigured('CHANGEME'), false);
  assert.equal(isConfigured(''), false);
  assert.equal(isConfigured(null), false);
  assert.equal(isConfigured(undefined), false);
  assert.equal(isConfigured('Acme Co'), true);
});

test('displayName prefers client, then domain, then a generic label', () => {
  assert.equal(resolveDisplayName('Acme Co', 'acme.com'), 'Acme Co');
  assert.equal(resolveDisplayName('CHANGEME', 'acme.com'), 'acme.com');
  assert.equal(resolveDisplayName('CHANGEME', 'CHANGEME'), 'This website');
  assert.equal(resolveDisplayName(undefined, undefined), 'This website');
});

test('displayName never leaks the placeholder to a visitor or an inbox', () => {
  for (const args of [
    ['CHANGEME', 'CHANGEME'],
    ['', ''],
    [undefined, undefined],
  ] as const) {
    const name = resolveDisplayName(args[0], args[1]);
    assert.ok(name.length > 0);
    assert.ok(!name.includes(PLACEHOLDER));
  }
});

test('Pacific/LA is rejected - it does not exist', () => {
  assert.equal(isValidTimeZone('Pacific/LA'), false);
  assert.equal(isValidTimeZone('America/Los_Angeles'), true);
  assert.equal(isValidTimeZone('Pacific/Honolulu'), true);
  assert.equal(isValidTimeZone('Nowhere/Nothing'), false);
});

test('staging is decided by config OR by a workers.dev hostname, each covering the other', () => {
  // A cron has no hostname, so config is the only signal it can read; a branch preview of a
  // launched site inherits `production` from main, so the hostname is the only signal there.
  assert.equal(isStagingDeployment('staging', null), true);
  assert.equal(isStagingDeployment('production', 'x-acme.acct.workers.dev'), true);
  assert.equal(isStagingDeployment('production', 'acme.com'), false);
  assert.equal(isStagingDeployment(undefined, 'www.acme.com'), false, 'a www variant still sends');
  assert.equal(isStagingDeployment('production', 'notworkers.dev'), false, 'label, not substring');
});

test('a telephone is only "configured" when it is actually set', () => {
  // Same placeholder discipline as client and domain: an unset number must not reach a tel:
  // href, where it renders as a call link that dials nothing.
  assert.equal(isConfigured(''), false);
  assert.equal(isConfigured('CHANGEME'), false);
  assert.equal(isConfigured('+18312220028'), true);
});

test('shortName falls back to the display name when unset', () => {
  /*
   * "About | Friends of the Marina Library" is 44 characters before the page name and Google
   * truncates around 60, so the suffix eats the title it is meant to caption. A client whose
   * name is already short sets nothing and nothing changes for them.
   */
  assert.equal(isConfigured(undefined), false, 'unset falls through to displayName');
  assert.equal(isConfigured('FoML'), true);
  assert.equal(isConfigured(''), false);
});

/* --- preview builds ------------------------------------------------------ */

test('a staging site is a preview with no branch at all - the laptop build', () => {
  assert.equal(isPreviewBuild({ environment: 'staging', branch: null }), true);
  assert.equal(previewReason({ environment: 'staging', branch: null }), 'staging');
});

test('a staging site is a preview on main - the case that was crawlable', () => {
  /* autire.webmonterey.workers.dev: main on Workers Builds, environment staging, and indexable
   * because only a non-production BRANCH used to be a preview. */
  assert.equal(isPreviewBuild({ environment: 'staging', branch: 'main' }), true);
  assert.equal(previewReason({ environment: 'staging', branch: 'main' }), 'staging');
});

test('a production site with no branch is production output', () => {
  assert.equal(isPreviewBuild({ environment: 'production', branch: null }), false);
  assert.equal(previewReason({ environment: 'production', branch: null }), null);
});

test('a production site on main is production output', () => {
  assert.equal(isPreviewBuild({ environment: 'production', branch: 'main' }), false);
});

test('a feature branch of a production site is still a preview', () => {
  /* webmonterey.json is committed, so the branch inherits production from main. The branch rule
   * is what keeps a launched site's review links out of the index. */
  assert.equal(isPreviewBuild({ environment: 'production', branch: 'feature/x' }), true);
  assert.equal(previewReason({ environment: 'production', branch: 'feature/x' }), 'branch');
});

test('productionBranch renames which branch is production', () => {
  const on = { environment: 'production', productionBranch: 'release' } as const;
  assert.equal(isPreviewBuild({ ...on, branch: 'release' }), false);
  assert.equal(isPreviewBuild({ ...on, branch: 'main' }), true);
});

test('staging wins over the production branch, whatever it is called', () => {
  assert.equal(
    previewReason({ environment: 'staging', branch: 'release', productionBranch: 'release' }),
    'staging',
  );
});

test('an unset environment is production, so a site predating the field builds as before', () => {
  assert.equal(isPreviewBuild({ environment: undefined, branch: null }), false);
  assert.equal(isPreviewBuild({ environment: undefined, branch: 'main' }), false);
  assert.equal(isPreviewBuild({ environment: undefined, branch: 'feature/x' }), true);
});
