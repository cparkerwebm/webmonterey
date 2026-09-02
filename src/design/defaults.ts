/*
 * THE DESIGN SYSTEM'S DEFAULT TOKEN SET.
 *
 * Ported verbatim from webm-astro v1.4.1 src/styles/tokens.css, which is the reference the
 * compiler is checked against: compiling an empty design.json must produce the same values that
 * file declared. That equivalence is what makes the move from a hand-edited stylesheet to
 * generated CSS a refactor rather than a redesign.
 *
 * Groups exist so compiled output stays readable. Order is preserved on emit.
 *
 * WHAT BELONGS HERE vs in design.json: anything a client would sensibly change is exposed in
 * design.json and merged over these. Everything else - spacing, widths, z-index, durations,
 * easings, shadows - is the system. A client wanting a different spacing scale is nearly always
 * a client who wants a different value in one component.
 */
import type { TokenGroup } from './types.ts';

export const DEFAULTS: TokenGroup[] = [
  {
    title: 'base palette',
    note: 'Raw neutrals. Everything semantic below points at these, not the other way round.',
    tokens: [
      { name: '--webm-base-100', value: '#ffffff' },
      { name: '--webm-base-300', value: '#f1eae8' },
      { name: '--webm-base-500', value: '#3f3f3f' },
      { name: '--webm-base-700', value: '#222222' },
      { name: '--webm-base-900', value: '#000000' },
    ],
  },
  {
    title: 'action',
    note: 'The brand color. Retheming a client usually starts and ends here.',
    tokens: [
      { name: '--webm-action', value: '#006abe' },
      { name: '--webm-action-dark', value: '#003e80' },
      { name: '--webm-action-light', value: '#6bc7ff' },
    ],
  },
  {
    title: 'surface',
    tokens: [
      { name: '--webm-surface', value: 'var(--webm-base-100)' },
      { name: '--webm-surface-alt', value: 'var(--webm-base-300)' },
      { name: '--webm-surface-accent', value: 'var(--webm-action-light)' },
      { name: '--webm-surface-inverse', value: 'var(--webm-base-900)' },
      { name: '--webm-surface-raised', value: 'var(--webm-base-100)' },
    ],
  },
  {
    title: 'text',
    tokens: [
      { name: '--webm-text', value: 'var(--webm-base-700)' },
      { name: '--webm-text-muted', value: 'var(--webm-base-500)' },
      { name: '--webm-text-strong', value: 'var(--webm-base-900)' },
      { name: '--webm-text-inverse', value: 'var(--webm-base-100)' },
      { name: '--webm-text-on-action', value: 'var(--webm-base-100)' },
    ],
  },
  {
    title: 'link',
    tokens: [
      { name: '--webm-link', value: 'var(--webm-action)' },
      { name: '--webm-link-hover', value: 'var(--webm-action-dark)' },
      { name: '--webm-link-visited', value: 'var(--webm-action-dark)' },
    ],
  },
  {
    title: 'border',
    tokens: [
      { name: '--webm-border-subtle', value: '#dcd3d0' },
      { name: '--webm-border-interactive', value: 'var(--webm-base-500)' },
      { name: '--webm-border-strong', value: 'var(--webm-base-700)' },
    ],
  },
  {
    title: 'state',
    tokens: [
      { name: '--webm-state-success', value: '#0f7b3f' },
      { name: '--webm-state-warning', value: '#9a6700' },
      { name: '--webm-state-danger', value: '#b3261e' },
      { name: '--webm-state-info', value: 'var(--webm-action)' },
    ],
  },
  {
    title: 'font',
    note: [
      'System stack by default - zero network cost, no layout shift, no dependency.',
      'To use a real typeface, put the woff2 in public/fonts/, declare @font-face in',
      'src/styles/custom/, and set font.sans in design.json.',
    ].join('\n'),
    tokens: [
      {
        name: '--webm-font-sans',
        value: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      },
      {
        name: '--webm-font-mono',
        value: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      },
    ],
  },
  {
    title: 'font-size',
    note: 'Fluid scale. Each step interpolates between a mobile and a desktop size.',
    tokens: [
      { name: '--webm-font-size-2xs', value: 'clamp(0.6944rem, 0.6859rem + 0.0426vw, 0.72rem)' },
      { name: '--webm-font-size-xs', value: 'clamp(0.8333rem, 0.8111rem + 0.1111vw, 0.9rem)' },
      { name: '--webm-font-size-sm', value: 'clamp(1rem, 0.9583rem + 0.2083vw, 1.125rem)' },
      { name: '--webm-font-size-md', value: 'clamp(1.2rem, 1.1312rem + 0.3438vw, 1.406rem)' },
      { name: '--webm-font-size-lg', value: 'clamp(1.44rem, 1.3341rem + 0.5297vw, 1.758rem)' },
      { name: '--webm-font-size-xl', value: 'clamp(1.728rem, 1.5716rem + 0.7821vw, 2.197rem)' },
      { name: '--webm-font-size-2xl', value: 'clamp(2.074rem, 1.8493rem + 1.1216vw, 2.747rem)' },
      { name: '--webm-font-size-3xl', value: 'clamp(2.488rem, 2.1734rem + 1.5748vw, 3.433rem)' },
      { name: '--webm-font-size-4xl', value: 'clamp(2.986rem, 2.5508rem + 2.1759vw, 4.292rem)' },
    ],
  },
  {
    title: 'leading',
    tokens: [
      { name: '--webm-leading-tight', value: '1.1' },
      { name: '--webm-leading-snug', value: '1.25' },
      { name: '--webm-leading-normal', value: '1.5' },
      { name: '--webm-leading-loose', value: '1.7' },
    ],
  },
  {
    title: 'tracking',
    tokens: [
      { name: '--webm-tracking-tight', value: '-0.02em' },
      { name: '--webm-tracking-normal', value: '0em' },
      { name: '--webm-tracking-wide', value: '0.06em' },
    ],
  },
  {
    title: 'weight',
    tokens: [
      { name: '--webm-weight-regular', value: '400' },
      { name: '--webm-weight-medium', value: '500' },
      { name: '--webm-weight-semibold', value: '600' },
      { name: '--webm-weight-bold', value: '700' },
    ],
  },
  {
    title: 'space',
    tokens: [
      { name: '--webm-space-3xs', value: '0.25rem' },
      { name: '--webm-space-2xs', value: '0.5rem' },
      { name: '--webm-space-xs', value: '0.75rem' },
      { name: '--webm-space-sm', value: '1rem' },
      { name: '--webm-space-md', value: '1.5rem' },
      { name: '--webm-space-lg', value: '2rem' },
      { name: '--webm-space-xl', value: '3rem' },
      { name: '--webm-space-2xl', value: '4rem' },
      { name: '--webm-space-3xl', value: '6rem' },
      { name: '--webm-space-4xl', value: '8rem' },
    ],
  },
  {
    title: 'space, fluid',
    tokens: [
      { name: '--webm-space-fluid-sm', value: 'clamp(1rem, 0.8333rem + 0.8333vw, 1.5rem)' },
      { name: '--webm-space-fluid-md', value: 'clamp(1.5rem, 1.25rem + 1.25vw, 2.25rem)' },
      { name: '--webm-space-fluid-lg', value: 'clamp(2rem, 1.6667rem + 1.6667vw, 3rem)' },
      { name: '--webm-space-fluid-xl', value: 'clamp(3rem, 2.5rem + 2.5vw, 4.5rem)' },
      { name: '--webm-space-fluid-2xl', value: 'clamp(4rem, 3.3333rem + 3.3333vw, 6rem)' },
      { name: '--webm-space-fluid-3xl', value: 'clamp(6rem, 5rem + 5vw, 9rem)' },
    ],
  },
  {
    title: 'section rhythm',
    tokens: [
      { name: '--webm-section-sm', value: 'clamp(2rem, 1.6667rem + 1.6667vw, 3rem)' },
      { name: '--webm-section-md', value: 'clamp(3rem, 2rem + 5vw, 6rem)' },
      { name: '--webm-section-lg', value: 'clamp(4rem, 2.6667rem + 6.6667vw, 8rem)' },
      { name: '--webm-section-xl', value: 'clamp(6rem, 4rem + 10vw, 12rem)' },
    ],
  },
  {
    title: 'gutter',
    tokens: [{ name: '--webm-gutter', value: 'clamp(1rem, 0.3333rem + 3.3333vw, 3rem)' }],
  },
  {
    title: 'width',
    tokens: [
      { name: '--webm-width-max', value: '1920px' },
      { name: '--webm-width-wide', value: '1600px' },
      { name: '--webm-width-content', value: '1280px' },
      { name: '--webm-width-narrow', value: '960px' },
      { name: '--webm-width-text', value: '68ch' },
    ],
  },
  {
    title: 'radius',
    tokens: [
      { name: '--webm-radius-none', value: '0' },
      { name: '--webm-radius-xs', value: '0.125rem' },
      { name: '--webm-radius-sm', value: '0.25rem' },
      { name: '--webm-radius-md', value: '0.5rem' },
      { name: '--webm-radius-lg', value: '1rem' },
      { name: '--webm-radius-xl', value: '1.5rem' },
      { name: '--webm-radius-pill', value: '62.4375rem' },
      { name: '--webm-radius-circle', value: '50%' },
    ],
  },
  {
    title: 'border-width',
    tokens: [
      { name: '--webm-border-width-0', value: '0' },
      { name: '--webm-border-width-1', value: '1px' },
      { name: '--webm-border-width-2', value: '2px' },
      { name: '--webm-border-width-4', value: '4px' },
    ],
  },
  {
    title: 'shadow',
    tokens: [
      { name: '--webm-shadow-xs', value: '0 1px 2px 0 rgb(34 34 34 / 0.06)' },
      {
        name: '--webm-shadow-sm',
        value: '0 1px 3px 0 rgb(34 34 34 / 0.1), 0 1px 2px -1px rgb(34 34 34 / 0.1)',
      },
      {
        name: '--webm-shadow-md',
        value: '0 4px 6px -1px rgb(34 34 34 / 0.1), 0 2px 4px -2px rgb(34 34 34 / 0.1)',
      },
      {
        name: '--webm-shadow-lg',
        value: '0 10px 15px -3px rgb(34 34 34 / 0.1), 0 4px 6px -4px rgb(34 34 34 / 0.1)',
      },
      {
        name: '--webm-shadow-xl',
        value: '0 20px 25px -5px rgb(34 34 34 / 0.12), 0 8px 10px -6px rgb(34 34 34 / 0.1)',
      },
    ],
  },
  {
    title: 'z-index',
    note: 'Named layers only. Never write a raw z-index in component CSS.',
    tokens: [
      { name: '--webm-z-below', value: '-1' },
      { name: '--webm-z-base', value: '0' },
      { name: '--webm-z-raised', value: '10' },
      { name: '--webm-z-sticky', value: '100' },
      { name: '--webm-z-header', value: '200' },
      { name: '--webm-z-drawer', value: '300' },
      { name: '--webm-z-overlay', value: '400' },
      { name: '--webm-z-modal', value: '500' },
      { name: '--webm-z-toast', value: '600' },
      { name: '--webm-z-tooltip', value: '700' },
      { name: '--webm-z-skiplink', value: '900' },
    ],
  },
  {
    title: 'duration',
    tokens: [
      { name: '--webm-duration-instant', value: '75ms' },
      { name: '--webm-duration-fast', value: '150ms' },
      { name: '--webm-duration-normal', value: '250ms' },
      { name: '--webm-duration-slow', value: '400ms' },
      { name: '--webm-duration-slower', value: '600ms' },
    ],
  },
  {
    title: 'easing',
    tokens: [
      { name: '--webm-ease-linear', value: 'linear' },
      { name: '--webm-ease-out', value: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      { name: '--webm-ease-in', value: 'cubic-bezier(0.7, 0, 0.84, 0)' },
      { name: '--webm-ease-in-out', value: 'cubic-bezier(0.65, 0, 0.35, 1)' },
      { name: '--webm-ease-spring', value: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
    ],
  },
  {
    title: 'scroll reveal',
    note: [
      'Defaults for .webm-reveal. Overridable per element with data-reveal-delay and',
      'data-reveal-duration, which observe.ts writes as inline properties.',
      '',
      'NOT var(--webm-duration-slow), and not a card-sized distance. The motion scale tops out',
      'at 400ms, tuned for a button or a dropdown - something small moving a short way. A reveal',
      'is a whole content group arriving, and at 400ms over 1.5rem it reads as a twitch.',
      '',
      '7.5rem over 1500ms was arrived at on a real client homepage, not picked. Raising duration',
      'alone did nothing: --webm-ease-out front-loads the curve, so extra time only stretches the',
      'settle. Raising distance alone lurched. Both had to grow together.',
    ].join('\n'),
    tokens: [
      { name: '--webm-reveal-duration', value: '1500ms' },
      { name: '--webm-reveal-delay', value: '0ms' },
      { name: '--webm-reveal-distance', value: '7.5rem' },
      { name: '--webm-reveal-ease', value: 'var(--webm-ease-out)' },
      { name: '--webm-reveal-blur', value: '8px' },
      { name: '--webm-reveal-stagger-step', value: '80ms' },
    ],
  },
  {
    title: 'focus',
    tokens: [
      { name: '--webm-focus-width', value: '3px' },
      { name: '--webm-focus-offset', value: '2px' },
      { name: '--webm-focus-color', value: 'var(--webm-action)' },
    ],
  },
  {
    title: 'composites',
    tokens: [
      { name: '--webm-focus-ring', value: 'var(--webm-focus-width) solid var(--webm-focus-color)' },
    ],
  },
];

/** Every default token name, for validation and for `webm doctor`. */
export const TOKEN_NAMES: ReadonlySet<string> = new Set(
  DEFAULTS.flatMap((g) => g.tokens.map((t) => t.name)),
);
