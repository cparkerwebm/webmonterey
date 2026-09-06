import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sitePage } from './config.ts';

/*
 * WHY THIS EXISTS. The integration injects the package's /404 on every site, and Astro warns on
 * every build of a site that also has src/pages/404.astro: "A static route cannot be defined
 * more than once … will result in a hard error in following versions". The fix is to not inject
 * when the site has its own, and this is the file check that decides it.
 */

const withSrc = (files: string[], fn: (src: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), 'webm-cfg-'));
  try {
    mkdirSync(join(dir, 'pages'), { recursive: true });
    for (const f of files) writeFileSync(join(dir, 'pages', f), '');
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('sitePage is null when src/pages has no file for the route', () => {
  withSrc(['index.astro', 'contact.astro'], (src) => {
    assert.equal(sitePage(src, '404'), null);
  });
});

test('sitePage finds a 404 in every form Astro treats as a route', () => {
  for (const ext of ['astro', 'md', 'mdx', 'html', 'ts', 'js']) {
    withSrc([`404.${ext}`], (src) => {
      assert.equal(sitePage(src, '404'), join(src, 'pages', `404.${ext}`), ext);
    });
  }
});

test('sitePage ignores files that are not routes', () => {
  withSrc(['404.css', '404.json', '404.astro.bak'], (src) => {
    assert.equal(sitePage(src, '404'), null);
  });
});

test('sitePage is exact about the stem: 404-old is not 404', () => {
  withSrc(['404-old.astro', '4040.astro'], (src) => {
    assert.equal(sitePage(src, '404'), null);
  });
});
