/*
 * The shape of design.json.
 *
 * DELIBERATELY SMALL. tokens.css in generation 2 was ~150 custom properties, but only about
 * fifteen of them ever changed between clients: the neutral ramp, the action color, borders,
 * state colors and the two font stacks. Everything else - spacing, widths, z-index, durations,
 * easings, shadows - is the design SYSTEM, not the brand, and a client who edits them is
 * usually making a mistake.
 *
 * So design.json carries what varies and the compiler emits the rest from defaults. A client
 * file is ~30 lines rather than ~200, and the diff between two clients is legible.
 *
 * `overrides` is the escape hatch for the remainder: any --webm-* property, set raw. Reach for
 * it when the token system genuinely does not express what a client needs, not to avoid
 * learning where a value lives.
 */

/** A CSS color, in any notation CSS accepts. Not validated beyond being a string. */
export type Color = string;

export interface DesignSystem {
  /** Ignored by the compiler; present so editors can offer completion. */
  $schema?: string;

  /** Bumped only for a breaking change to this shape. */
  version?: 1;

  /**
   * The words half of the design system, and the half that travels furthest: site copy,
   * social posts, and anything written in the client's name.
   *
   * Not consumed by the CSS compiler. Served to the platform and to Cowork as brand context.
   */
  brand?: {
    /** Display name. Falls back to `client` in webmonterey.json. */
    name?: string;
    /** How this client writes. One or two sentences, concrete. */
    voice?: string;
    /**
     * Hard rules a writer or a generator must not break. Phrase each as an instruction.
     * e.g. "Gold is a fill only - never gold text or links on white."
     */
    rules?: string[];
    logo?: {
      /** Full lockup. Repo-relative or absolute. */
      primary?: string;
      /** Icon-only mark, for favicons and tight spaces. */
      mark?: string;
    };
  };

  color?: {
    /**
     * The neutral ramp. Everything semantic points at these, never the other way round.
     * 100 is lightest, 900 darkest - the direction does not invert for a dark design.
     */
    base?: Partial<Record<'100' | '300' | '500' | '700' | '900', Color>>;
    /** The brand color. Retheming a client usually starts and ends here. */
    action?: { base?: Color; dark?: Color; light?: Color };
    border?: { subtle?: Color };
    state?: Partial<Record<'success' | 'warning' | 'danger' | 'info', Color>>;
  };

  font?: {
    /**
     * Full CSS font stacks, not family names - the compiler does not append fallbacks.
     * A self-hosted face still needs its @font-face declared in src/styles/custom/.
     */
    sans?: string;
    mono?: string;
  };

  /** Partial: name only the steps that differ from the defaults. */
  radius?: Partial<Record<'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'pill' | 'circle', string>>;

  /**
   * Raw token overrides, applied last and unvalidated beyond the name prefix.
   * Keys must start with `--webm-`; anything else is a build error, because a typo here is
   * otherwise silent - the property is set, nothing reads it, and the page looks untouched.
   */
  overrides?: Record<string, string>;
}

/** One emitted custom property. */
export interface Token {
  name: string;
  value: string;
}

/** A titled run of tokens. Groups exist to keep compiled CSS readable, nothing more. */
export interface TokenGroup {
  title: string;
  /** Emitted as a comment above the group. Omit for self-evident groups. */
  note?: string;
  tokens: Token[];
}
