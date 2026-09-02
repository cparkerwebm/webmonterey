/*
 * Cookie consent — the API every other feature uses.
 *
 * Client-side only. Import this from a component's <script> block; never from frontmatter.
 *
 * THE STATE LIVES ON <html data-webm-consent="...">, a comma-separated list of granted
 * categories, written by an inline script in <head> before any third party loads. Reading an
 * attribute means a feature can check consent synchronously, with no race against the banner
 * and no import order to get right.
 *
 * WHEN COMPLIANCE IS DISABLED for a site (features.compliance = false in webmonterey.json),
 * the attribute is absent and EVERY function here reports granted. Gated features simply run.
 * That is deliberate: a feature written against this API works unchanged on sites that use
 * consent and sites that do not.
 */

declare global {
  interface Window {
    /** Defined by ConsentInit.astro, and by Google Tag Manager once it loads. */
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}

export const CONSENT_CATEGORIES = ['essential', 'functional', 'analytics', 'marketing'] as const;

export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];

export type ConsentState = Record<ConsentCategory, boolean>;

/** Fired on <document> whenever the visitor changes their choices. */
export const CONSENT_EVENT = 'webm:consent-change';

/** Cookie name. Also referenced by the inline script in CookieConsent.astro. */
export const CONSENT_COOKIE = 'webm_consent';

/** One year — matches the wording shown to the visitor in the preferences dialog. */
export const CONSENT_MAX_AGE = 60 * 60 * 24 * 365;

const ALL_GRANTED: ConsentState = {
  essential: true,
  functional: true,
  analytics: true,
  marketing: true,
};

/**
 * Is the consent system running on this site at all?
 *
 * False when the client has compliance switched off. Useful for hiding a "Cookie
 * preferences" footer link that would otherwise open nothing.
 */
export function isComplianceActive(): boolean {
  return document.documentElement.dataset.webmConsent !== undefined;
}

/** The visitor's current choices. Reports everything granted when compliance is disabled. */
export function getConsent(): ConsentState {
  const raw = document.documentElement.dataset.webmConsent;

  if (raw === undefined) return { ...ALL_GRANTED };

  const granted = new Set(raw.split(',').filter(Boolean));

  return {
    // Essential is never optional — it is what makes the site work, including storing this
    // very choice. It is listed in the dialog as always-on for transparency, not as a toggle.
    essential: true,
    functional: granted.has('functional'),
    analytics: granted.has('analytics'),
    marketing: granted.has('marketing'),
  };
}

/** Has the visitor allowed this category? */
export function hasConsent(category: ConsentCategory): boolean {
  return getConsent()[category];
}

/**
 * Run `fn` as soon as `category` is allowed, and again if it is re-granted later.
 *
 * This is the function most features want. It fires immediately when consent already exists,
 * so there is no "did I miss the event?" problem, and it keeps working if the visitor opens
 * preferences later and turns the category on.
 *
 *     import { whenConsented } from '../webmonterey/compliance/consent.ts';
 *
 *     whenConsented('analytics', () => {
 *       const s = document.createElement('script');
 *       s.src = 'https://example.com/analytics.js';
 *       document.head.appendChild(s);
 *     });
 *
 * `fn` runs AT MOST ONCE. Returns an unsubscribe function.
 */
export function whenConsented(category: ConsentCategory, fn: () => void): () => void {
  let done = false;

  const run = () => {
    if (done || !hasConsent(category)) return;
    done = true;
    document.removeEventListener(CONSENT_EVENT, run);
    fn();
  };

  document.addEventListener(CONSENT_EVENT, run);
  run();

  return () => document.removeEventListener(CONSENT_EVENT, run);
}

/**
 * Subscribe to every change. Unlike `whenConsented` this fires on withdrawal too, so use it
 * when something must be torn down as well as set up.
 */
export function onConsentChange(handler: (state: ConsentState) => void): () => void {
  const listener = () => handler(getConsent());
  document.addEventListener(CONSENT_EVENT, listener);
  return () => document.removeEventListener(CONSENT_EVENT, listener);
}

/**
 * Open the preferences dialog.
 *
 * Wire this to a "Cookie preferences" link in the footer — US state privacy law expects an
 * ongoing way to change the choice, not just a one-time banner. No-ops when compliance is
 * disabled.
 */
export function openPreferences(): void {
  document.dispatchEvent(new CustomEvent('webm:consent-open'));
}

/**
 * Was the visitor's browser sending a Global Privacy Control signal?
 *
 * When true, analytics and marketing were switched off automatically and the banner was not
 * shown — the signal IS the choice, and asking again would undermine it.
 */
export function isGpcHonored(): boolean {
  return document.documentElement.dataset.webmConsentGpc === '1';
}
