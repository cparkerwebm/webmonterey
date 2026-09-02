import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codemodsBetween, CODEMODS, type Codemod } from './codemods.ts';

const stub = (version: string): Codemod => ({ version, title: version, run: () => [] });
const ALL = [stub('3.0.0'), stub('1.1.0'), stub('2.1.0'), stub('2.0.0')];
const versions = (from: string, to: string) => codemodsBetween(from, to, ALL).map((c) => c.version);

test('the shipped codemods are exactly the versions this release claims', () => {
  // A registry assertion rather than nothing: adding a codemod is a deliberate act somebody
  // reviews, and this line is where the review happens.
  assert.deepEqual(
    CODEMODS.map((c) => c.version),
    [],
  );
});

test('the range is exclusive at the bottom and inclusive at the top', () => {
  // 1.1.0's codemod already ran when the site landed on 1.1.0.
  assert.deepEqual(versions('1.1.0', '2.0.0'), ['2.0.0']);
  assert.deepEqual(versions('1.0.0', '2.0.0'), ['1.1.0', '2.0.0']);
});

test('results are ordered by version, whatever order they were registered in', () => {
  assert.deepEqual(versions('1.0.0', '3.0.0'), ['1.1.0', '2.0.0', '2.1.0', '3.0.0']);
});

test('an upgrade that skips majors runs every codemod in between', () => {
  assert.deepEqual(versions('1.0.0', '2.1.0'), ['1.1.0', '2.0.0', '2.1.0']);
});

test('no movement runs nothing', () => {
  assert.deepEqual(versions('2.0.0', '2.0.0'), []);
});

test('a fresh install runs everything up to the installed version', () => {
  assert.deepEqual(versions('0.0.0', '2.0.0'), ['1.1.0', '2.0.0']);
});

test('a two-part version is treated as x.y.0', () => {
  assert.deepEqual(versions('2.0', '2.1.0'), ['2.1.0']);
});
