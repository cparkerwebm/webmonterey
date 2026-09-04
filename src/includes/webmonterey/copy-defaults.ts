/*
 * EVERY WORD THIS PACKAGE PUTS IN FRONT OF A VISITOR, IN ONE PLACE, OVERRIDABLE.
 *
 * THE DEFAULTS AND THE MERGE, WITH NO IMPORTS. Kept free of `virtual:webm/site` because the email
 * templates are unit-tested with plain `node --test`, outside Vite, where a virtual module cannot
 * resolve - wiring them to the resolved copy directly broke both suites at once. The resolved
 * value lives next door in ./copy.ts, which every component and action uses; anything that must
 * stay importable outside a build takes its strings as input and falls back to these.
 *
 * WHY. An audit of the fleet found the package writing visitor-facing copy for six clients with
 * no way to change any of it: a cookie banner with four category descriptions, a 404 page, six
 * form error messages, an email footer, a "Back to top" label. All in English, all in one voice,
 * all decided here.
 *
 * That is the same mistake as the structured-data component, which built nineteen node types of
 * opinion about what a business is and could only be replaced wholesale. The lesson from it: the
 * package owns the MECHANISM - consent state, validation order, sending mail - and the client
 * owns what is SAID. A recording studio, a mayoral campaign and a library charity do not share a
 * voice, and none of them necessarily works in English.
 *
 * ONE SEAM, NOT A PROP PER STRING. Threading `title` and `body` into the consent banner was the
 * shape of the old fix, and the banner shows why it fails: two of its dozen strings got props,
 * the rest did not, and Base passes neither - so even the two were unreachable. A single
 * override merged over these defaults costs the package nothing per string added.
 *
 * A site overrides only what it wants, in webmonterey.json:
 *
 *     "copy": {
 *       "consent": { "title": "Cookies on this site" },
 *       "notFound": { "body": "We could not find that page." }
 *     }
 */

export interface Copy {
  consent: {
    title: string;
    body: string;
    privacyLink: string;
    manage: string;
    rejectAll: string;
    acceptAll: string;
    save: string;
    prefsTitle: string;
    notice: string;
    categories: Record<
      'essential' | 'functional' | 'analytics' | 'marketing',
      {
        name: string;
        description: string;
      }
    >;
  };
  notFound: { title: string; body: string };
  scrollTop: { label: string };
  form: {
    unknownForm: string;
    /** `{fields}` is replaced with the comma-separated labels still missing. */
    missing: string;
    verifyUnavailable: string;
    verifyFailed: string;
    noDelivery: string;
  };
  email: {
    autoresponseHeading: string;
    /** `{id}` is replaced with the submission id. */
    reference: string;
    /** `{domain}` is replaced with the site's domain. */
    footerNotice: string;
  };
  /**
   * The /webmaster page. `intro` wraps the agency link: `before` <a>WebMonterey</a> `after`.
   * `intro` and `body` take the inline prose subset - `**bold**`, `_italic_`, `[text](/url)`.
   */
  webmaster: {
    title: string;
    description: string;
    intro: { before: string; after: string };
    body: string[];
  };
}

/*
 * The defaults are the copy the fleet shipped with, unchanged, so adopting this changes nothing
 * for a site that overrides nothing. They are DEFAULTS, not a house style: a client is entitled
 * to disagree with every one.
 */
export const DEFAULT_COPY: Copy = {
  consent: {
    title: 'We Value Your Privacy',
    body: 'We use cookies for essential functions and to understand how this site is used, so we can keep making it better.',
    privacyLink: 'Privacy policy',
    manage: 'Manage preferences',
    rejectAll: 'Reject all',
    acceptAll: 'Accept all',
    save: 'Save preferences',
    prefsTitle: 'Privacy Preferences',
    notice: 'Cookie notice',
    categories: {
      essential: {
        name: 'Essential',
        description:
          'Required for the site to function — security, navigation, and your privacy choices. Always on.',
      },
      functional: {
        name: 'Functional',
        description:
          'Remembers preferences such as language or region to personalize your experience.',
      },
      analytics: {
        name: 'Analytics',
        description:
          'Helps us understand how visitors use the site so we can improve it. Aggregated and anonymous.',
      },
      marketing: {
        name: 'Marketing',
        description:
          'Used to measure campaigns and show you more relevant advertising across the web.',
      },
    },
  },
  notFound: {
    title: 'Page not found',
    body: 'That page is not here. Try the navigation above, or get in touch.',
  },
  scrollTop: { label: 'Back to top' },
  form: {
    unknownForm: 'Unknown form.',
    missing: 'Please complete: {fields}.',
    verifyUnavailable: 'We could not verify your submission. Please try again shortly.',
    verifyFailed: 'Verification failed. Please reload the page and try again.',
    noDelivery: 'This form is not accepting messages right now. Please get in touch directly.',
  },
  email: {
    autoresponseHeading: 'What you sent us',
    reference: 'Reference: #{id}',
    footerNotice: 'This is an automated notification for your account at the {domain} website.',
  },
  webmaster: {
    title: 'Our Webmaster',
    description:
      'This custom website was designed, built and managed by WebMonterey, a webmaster service in Monterey, California.',
    intro: {
      before: 'This custom website was designed, built and managed by',
      after:
        ', a webmaster service in Monterey, California. WebMonterey handles the hosting, security, strategy and ongoing care of the site so that we can focus on what we do.',
    },
    /* Bold on purpose: the contact instruction is the paragraph a visitor with a problem needs. */
    body: [
      "**If you have a question about this website, notice something that isn't working, or have trouble using a page, please let WebMonterey know and they will take care of it.**",
    ],
  },
};

/** Merge the site's overrides over the defaults, key by key, at any depth. */
export function merge<T>(base: T, over: unknown): T {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return base;
  const out = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    if (v === undefined || v === null) continue;
    const current = out[k];
    out[k] =
      current && typeof current === 'object' && !Array.isArray(current) ? merge(current, v) : v;
  }
  return out as T;
}

/** Substitute `{name}` placeholders. Missing keys are left as written rather than blanked. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key) =>
    key in values ? String(values[key]) : whole,
  );
}
