import { z } from 'zod'

/**
 * The theme-options model (#1076).
 *
 * This lived in `@setu/theme-default/options` and the admin imported it FROM THAT THEME BY NAME,
 * resolved when the admin bundle was built — so the Customizer could only ever show one theme's
 * options, whichever theme was installed. Themes are installable (#342), so the model belongs
 * here and the declaration becomes data a theme ships.
 *
 * Nothing about the logic was ever theme-specific: it only reads the declaration. The change is
 * that the declaration is now an argument rather than a module-level array.
 *
 * A declaration arrives from an INSTALLED PACKAGE and its values are emitted into a
 * `:root:root { … }` block and into inline preview styles, so `parseThemeOptions` validates it as
 * untrusted input. Enforced by packages/core/test/theme/options.test.ts, which drives hostile
 * declarations through it.
 */

/** A CSS custom property name and nothing else — `--x`, never `--x: red; } evil {`. */
const TOKEN_RE = /^--[A-Za-z0-9_-]+$/
/** Hex only (#rgb/#rgba/#rrggbb/#rrggbbaa). Anything else is invalid. */
const COLOR_RE = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
/** A declaration VALUE is interpolated into a CSS declaration, so it may not contain any
 *  character that could end it or open a new rule. Font stacks (quotes, commas, spaces) stay
 *  legal; `;`, `{`, `}`, and a comment opener do not. */
const SAFE_VALUE_RE = /^[^;{}<>\\]*$/

const tokenSchema = z
  .string()
  .regex(TOKEN_RE, 'token must be a CSS custom property name like "--accent"')

const choiceSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
  /** What the driven token(s) become when this choice is selected. */
  tokenValue: z
    .string()
    .regex(SAFE_VALUE_RE, 'choice tokenValue may not contain ; { } < > or \\')
})

const optionSchema = z
  .object({
    key: z.string().min(1),
    label: z.string().min(1),
    type: z.enum(['color', 'select']),
    token: z.union([tokenSchema, z.array(tokenSchema).min(1)]),
    default: z.string().min(1),
    choices: z.array(choiceSchema).optional()
  })
  .superRefine((opt, ctx) => {
    if (opt.type === 'color' && !COLOR_RE.test(opt.default))
      ctx.addIssue({
        code: 'custom',
        message: `option "${opt.key}": default must be a hex colour`
      })
    if (opt.type === 'select') {
      if (!opt.choices?.length)
        ctx.addIssue({
          code: 'custom',
          message: `option "${opt.key}": a select needs choices`
        })
      else if (!opt.choices.some((c) => c.value === opt.default))
        ctx.addIssue({
          code: 'custom',
          message: `option "${opt.key}": default must be one of its choice values`
        })
    }
  })

export type ThemeOptionType = 'color' | 'select'
export type ThemeOptionChoice = z.infer<typeof choiceSchema>
export type ThemeOption = z.infer<typeof optionSchema>

/** Validate a theme's declaration. Throws with a readable message — the caller reports it, and
 *  must never silently degrade to "this theme has no options" (that is indistinguishable from a
 *  theme that genuinely declares none). */
export function parseThemeOptions(raw: unknown): ThemeOption[] {
  const parsed = z.array(optionSchema).safeParse(raw)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new Error(
      `invalid theme options declaration: ${first?.message ?? 'unrecognised shape'}` +
        (first?.path?.length ? ` (at ${first.path.join('.')})` : '')
    )
  }
  return parsed.data
}

const tokensOf = (opt: ThemeOption): string[] =>
  Array.isArray(opt.token) ? opt.token : [opt.token]

/**
 * Pure: resolve chosen option values to the CSS custom properties they drive.
 *
 * Missing or invalid values fall back to the option's default, so a malformed stored value can
 * never emit garbage — which is also the second line of defence behind `parseThemeOptions`.
 * Shared by `optionsToCss` (the published override) and the Customizer's live preview, so the
 * two can never disagree.
 */
export function resolveThemeTokens(
  options: ThemeOption[],
  values: Record<string, string>
): Record<string, string> {
  const tokens: Record<string, string> = {}
  for (const opt of options) {
    const raw = values[opt.key]
    if (opt.type === 'color') {
      const value = COLOR_RE.test(raw ?? '') ? (raw as string) : opt.default
      for (const token of tokensOf(opt)) tokens[token] = value
    } else {
      const choices = opt.choices ?? []
      const choice =
        choices.find((c) => c.value === raw) ??
        choices.find((c) => c.value === opt.default)
      if (!choice) continue
      for (const token of tokensOf(opt)) tokens[token] = choice.tokenValue
    }
  }
  return tokens
}

/**
 * Pure: map chosen option values to a `:root:root { … }` override string.
 *
 * The selector is intentionally doubled (`:root:root`, specificity 0,0,2,0) so this override
 * beats the theme's plain `:root` defaults (0,0,1,0) no matter where Astro places the bundled
 * theme CSS in the document — source order alone is not enough. Not a typo.
 */
export function optionsToCss(
  options: ThemeOption[],
  values: Record<string, string>
): string {
  const decls = Object.entries(resolveThemeTokens(options, values)).map(
    ([token, value]) => `${token}: ${value};`
  )
  return `:root:root { ${decls.join(' ')} }`
}
