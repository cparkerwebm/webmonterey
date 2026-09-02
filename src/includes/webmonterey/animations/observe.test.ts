import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownedReveals } from './observe.ts';

/*
 * A tree of plain objects standing in for elements, and a lookup that models what the real code
 * does: `element.parentElement?.closest('[data-reveal-stagger]')` — walk up from the PARENT and
 * take the first stagger container found.
 *
 * These test the ownership rule, which is the logic that was wrong. They do not exercise
 * querySelectorAll or closest themselves; those are the browser's, and there is no DOM here.
 */
interface Node {
  id: string;
  parent?: Node;
  stagger?: true;
}

const ownerOf = (element: Node): Node | null => {
  for (let p = element.parent; p; p = p.parent) if (p.stagger) return p;
  return null;
};

/** Everything below `root`, in document order, as querySelectorAll would return it. */
const descendants = (root: Node, all: Node[]): Node[] =>
  all.filter((n) => {
    for (let p = n.parent; p; p = p.parent) if (p === root) return true;
    return false;
  });

const owned = (container: Node, all: Node[]) =>
  ownedReveals(container, descendants(container, all), ownerOf).map((n) => n.id);

test('direct children are numbered in order - the case that already worked', () => {
  const ul: Node = { id: 'ul', stagger: true };
  const all = [ul, { id: 'a', parent: ul }, { id: 'b', parent: ul }, { id: 'c', parent: ul }];
  assert.deepEqual(owned(ul, all), ['a', 'b', 'c']);
});

/*
 * THE REGRESSION. <ul> -> <li> -> <button class="webm-reveal">: the reveal is a grandchild, the
 * old `container.children` walk found nothing, every item took a delay of zero, and the group
 * arrived at once looking exactly like a stagger nobody applied. Hit on three client sites.
 */
test('a reveal nested a level deeper is owned, not skipped', () => {
  const ul: Node = { id: 'ul', stagger: true };
  const li1: Node = { id: 'li1', parent: ul };
  const li2: Node = { id: 'li2', parent: ul };
  const all = [ul, li1, li2, { id: 'btn1', parent: li1 }, { id: 'btn2', parent: li2 }];
  assert.deepEqual(
    owned(ul, all),
    ['li1', 'li2', 'btn1', 'btn2'].filter((id) => id.length > 0),
  );
});

test('an element belongs to its NEAREST container, so a nested grid is not numbered twice', () => {
  const section: Node = { id: 'section', stagger: true };
  const grid: Node = { id: 'grid', parent: section, stagger: true };
  const all = [
    section,
    grid,
    { id: 'intro', parent: section },
    { id: 'card1', parent: grid },
    { id: 'card2', parent: grid },
  ];
  // The outer owns the intro and the grid itself - not the grid's cards.
  assert.deepEqual(owned(section, all), ['grid', 'intro']);
  // And the inner numbers its own from zero.
  assert.deepEqual(owned(grid, all), ['card1', 'card2']);
});

/*
 * Why the lookup starts at the PARENT rather than the element. With `closest()` from the element,
 * a node that is both a reveal and a nested container resolves to ITSELF, matches no outer
 * container, and is numbered by nothing at all.
 */
test('a container that is also a reveal is owned by the container above it', () => {
  const section: Node = { id: 'section', stagger: true };
  const grid: Node = { id: 'grid', parent: section, stagger: true };
  const all = [section, grid, { id: 'card', parent: grid }];
  assert.deepEqual(owned(section, all), ['grid']);
  assert.deepEqual(owned(grid, all), ['card']);
});

test('a container that owns nothing yields nothing rather than throwing', () => {
  const empty: Node = { id: 'empty', stagger: true };
  assert.deepEqual(owned(empty, [empty]), []);
});
