import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLEAN_TARGETS, clean, cleanTargets } from './clean.ts';

const site = (dirs: string[]) => {
  const root = mkdtempSync(join(tmpdir(), 'webm-clean-'));
  for (const d of dirs) {
    mkdirSync(join(root, d), { recursive: true });
    writeFileSync(join(root, d, 'x'), '');
  }
  return root;
};

test('clean removes only the generated directories and reports them in order', () => {
  const root = site(['dist', '.astro', 'node_modules/.vite', 'node_modules/astro', 'src/pages']);
  try {
    assert.deepEqual(clean(root), [...CLEAN_TARGETS]);
    for (const t of CLEAN_TARGETS) assert.equal(existsSync(join(root, t)), false, t);
    assert.equal(existsSync(join(root, 'node_modules/astro/x')), true, 'installed packages stay');
    assert.equal(existsSync(join(root, 'src/pages/x')), true, 'source stays');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('clean is idempotent: the second run finds nothing', () => {
  const root = site(['dist', '.astro']);
  try {
    assert.deepEqual(clean(root), ['.astro', 'dist']);
    assert.deepEqual(clean(root), []);
    assert.deepEqual(cleanTargets(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cleanTargets reports without removing', () => {
  const root = site(['dist']);
  try {
    assert.deepEqual(cleanTargets(root), ['dist']);
    assert.equal(existsSync(join(root, 'dist/x')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
