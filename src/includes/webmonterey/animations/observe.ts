/*
 * Scroll reveal — the JavaScript half of `.webm-reveal`.
 *
 * WHY THIS EXISTS RATHER THAN `animation-timeline: view()`. The CSS-only version of this
 * feature is Chromium-only: Firefox keeps scroll-driven animations behind a flag and the
 * `animation-trigger` syntax that would actually fit a reveal-on-enter API is Chromium-only
 * too. In every other browser the `@supports` guard made the whole feature a silent no-op.
 * IntersectionObserver is the mechanism, not a fallback for one.
 *
 * The split of duties is deliberate and worth keeping: this file ONLY toggles the
 * `data-reveal-visible` attribute and copies two numbers into custom properties. Every
 * distance, duration, easing and reduced-motion rule lives in animations.css, so a client can
 * retheme the motion without reading a line of TypeScript.
 *
 * The one-shot `.webm-animate` system is untouched by any of this — it is pure CSS, plays on
 * render rather than on scroll, and needs no JavaScript at all.
 *
 * Imported once from base.astro. Astro dedupes bundled <script> across component instances,
 * so importing it elsewhere is harmless but pointless.
 */

const SELECTOR = '.webm-reveal';
const STAGGER_SELECTOR = '[data-reveal-stagger]';

/** Elements already wired, so re-running init never double-observes. */
const registered = new WeakSet<Element>();

let observer: IntersectionObserver | null = null;

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function reveal(element: Element): void {
  element.setAttribute('data-reveal-visible', '');
}

/**
 * Reveal on a LATER frame, not this one.
 *
 * A transition only starts if the browser has already rendered the property's "before" value.
 * A bundled module script runs before first paint, so revealing an element synchronously here
 * means its `opacity: 0` is never painted — the element goes straight to its final state and
 * nothing animates. The result is indistinguishable from an ordinary page load, which is
 * exactly what an above-the-fold hero looked like before this existed.
 *
 * TWO frames, not one. A single requestAnimationFrame callback can still be folded into the
 * same style recalculation, which reintroduces the bug intermittently — the kind that looks
 * fixed on the machine you tested it on. The second frame guarantees a paint in between.
 *
 * Only the already-in-view path needs this. Anything revealed from the observer callback is
 * long past first paint by definition.
 */
function revealAfterPaint(element: Element): void {
  requestAnimationFrame(() => requestAnimationFrame(() => reveal(element)));
}

/**
 * Copy `data-reveal-delay` / `-duration` onto the element as custom properties.
 *
 * Custom properties rather than an inline `transition` string: the CSS keeps ownership of
 * easing and, more importantly, of the reduced-motion and print overrides. An inline
 * shorthand would out-specify both.
 */
function applyTiming(element: HTMLElement): void {
  const delay = element.dataset.revealDelay;
  if (delay) element.style.setProperty('--webm-reveal-delay', `${parseInt(delay, 10) || 0}ms`);

  const duration = element.dataset.revealDuration;
  if (duration) {
    element.style.setProperty('--webm-reveal-duration', `${parseInt(duration, 10) || 0}ms`);
  }
}

/**
 * The reveals a stagger container OWNS, in document order.
 *
 * Generic and taking its own lookup so it is a pure function of its arguments: the ownership
 * rule is the whole logic here, and it is the part that can be reasoned about and tested
 * without a DOM. `applyStagger` supplies the real elements.
 *
 * OWNERSHIP, NOT DESCENT. Every `.webm-reveal` below a container is a candidate; it belongs to
 * the NEAREST stagger container above it. That is what lets a staggered grid sit inside a
 * staggered section without the grid's cards being numbered twice — the section owns the grid,
 * the grid owns its cards, and each numbering starts at zero.
 */
export function ownedReveals<T>(
  container: T,
  candidates: readonly T[],
  ownerOf: (element: T) => T | null,
): T[] {
  return candidates.filter((element) => ownerOf(element) === container);
}

/**
 * Index every reveal a stagger container owns, so the CSS can compute each delay.
 *
 * This is what the old `data-delay="1".."4"` ladder could not do: the step is a real
 * millisecond value and the count is unbounded, so a grid of nine cards staggers as readily
 * as a row of three.
 *
 * DESCENDANTS, NOT `children`. This walked `container.children` and so numbered only DIRECT
 * children. Real markup nests the revealing element a level deeper more often than not — a
 * `<ul>` whose `<li>` wraps the button that actually moves, or a card wrapper holding a border
 * still while its inside animates. In those layouts the walk found nothing, set no index, and
 * every item took a delay of zero: the group arrived in one piece, looking precisely like a
 * stagger nobody had applied. Nothing threw, because nothing failed — there was simply nothing
 * to do. Three client sites hit it and each worked around it by hand-writing delays off a map
 * index. The CSS half of this had the same bug, as `> .webm-reveal`; changing either alone
 * fixes nothing, because an index nothing reads is as useless as a rule with no index.
 *
 * `parentElement?.closest(...)` rather than `closest(...)` STARTS THE SEARCH ABOVE the element.
 * An element that is both a reveal and a nested stagger container would otherwise resolve to
 * itself, and so be numbered by nothing — the outer container would skip it as belonging to
 * someone else. Starting a level up, it belongs to the outer container and still owns its own
 * subtree, which is the behavior the markup implies.
 */
function applyStagger(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>(STAGGER_SELECTOR).forEach((container) => {
    const step = container.dataset.revealStagger;
    if (step) {
      container.style.setProperty('--webm-reveal-stagger-step', `${parseInt(step, 10) || 0}ms`);
    }

    const candidates = Array.from(container.querySelectorAll<HTMLElement>(SELECTOR));
    ownedReveals(
      container,
      candidates,
      (element) => element.parentElement?.closest<HTMLElement>(STAGGER_SELECTOR) ?? null,
    ).forEach((element, index) => {
      element.style.setProperty('--webm-reveal-index', String(index));
    });
  });
}

function getObserver(): IntersectionObserver {
  if (observer) return observer;

  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;

        reveal(entry.target);

        // `data-reveal-once="false"` opts into re-animating on every entry.
        const once = (entry.target as HTMLElement).dataset.revealOnce !== 'false';
        if (once) observer?.unobserve(entry.target);
      }
    },
    {
      /*
       * Fire slightly before the element is fully on screen, and require only a sliver of it
       * to be visible — otherwise a section taller than the viewport waits for its bottom
       * edge, which never arrives.
       */
      rootMargin: '0px 0px -10% 0px',
      threshold: 0.05,
    },
  );

  return observer;
}

/**
 * Wire up every `.webm-reveal` in `root` that is not already wired.
 *
 * Safe to call repeatedly — on first load, after a view transition, and after injecting
 * markup dynamically.
 */
export function initAnimations(root: ParentNode = document): void {
  const elements = Array.from(root.querySelectorAll<HTMLElement>(SELECTOR));
  if (elements.length === 0) return;

  applyStagger(root);

  /*
   * Reduced motion: reveal everything at once and never observe. Neutralising the CSS is only
   * half the fix — without this, a motion-sensitive visitor would still depend on scroll
   * position for content to appear, because the CSS override only kills the movement.
   */
  if (prefersReducedMotion()) {
    elements.forEach(reveal);
    return;
  }

  const io = getObserver();

  for (const element of elements) {
    if (registered.has(element)) continue;
    registered.add(element);
    applyTiming(element);

    // Anything already on screen at load must not wait for a scroll that may never come.
    const rect = element.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      revealAfterPaint(element);
      continue;
    }

    io.observe(element);
  }
}

/** Tear down between view transitions so the observer never holds stale nodes. */
export function destroyAnimations(): void {
  observer?.disconnect();
  observer = null;
}
