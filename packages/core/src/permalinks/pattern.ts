import { z } from 'zod'

/** Tokens a permalink pattern may use. Each must be a whole path segment. */
export const PERMALINK_TOKENS = [
  ':slug',
  ':collection',
  ':year',
  ':month',
  ':day',
  ':category'
] as const

/** Today's hardcoded scheme — the fallback when neither config nor settings set a pattern. */
export const DEFAULT_PERMALINK_PATTERN = ':collection/:slug'

/** THE URL-segment slug rule for permalinks — lowercase letters, digits, hyphens.
 *  Shared by pattern-literal validation here and by `resolvePermalink`'s
 *  `:category` guard, so a value the validator would reject in a pattern can
 *  never be interpolated into a URL either. */
export const SLUG_SEGMENT = /^[a-z0-9-]+$/

/** Validate a permalink pattern. Returns human-readable problems; empty array = valid.
 *  Security: rejects absolute paths, dot segments, empty segments, unknown tokens, and
 *  non-URL-safe literals, so a pattern can never traverse or escape the site root. */
export function validatePermalinkPattern(pattern: string): string[] {
  if (typeof pattern !== 'string' || pattern.trim() === '')
    return ['pattern must be a non-empty string']
  const issues: string[] = []
  if (pattern.startsWith('/'))
    issues.push('pattern must be relative — remove the leading "/"')
  if (pattern.endsWith('/')) issues.push('pattern must not end with "/"')
  if (pattern.includes('//'))
    issues.push('pattern must not contain empty segments ("//")')
  let hasSlug = false
  for (const seg of pattern.split('/')) {
    if (seg === '') continue // already reported via the checks above
    if (seg === '.' || seg === '..') {
      issues.push(`illegal segment "${seg}"`)
    } else if (seg.startsWith(':')) {
      if (!(PERMALINK_TOKENS as readonly string[]).includes(seg))
        issues.push(
          `unknown token "${seg}" — known tokens: ${PERMALINK_TOKENS.join(', ')}`
        )
      else if (seg === ':slug') hasSlug = true
    } else if (seg.includes(':')) {
      issues.push(
        `token must be a whole segment — "${seg}" mixes a token with other characters`
      )
    } else if (!SLUG_SEGMENT.test(seg)) {
      issues.push(
        `literal segment "${seg}" must be lowercase letters, digits, or hyphens`
      )
    }
  }
  if (!hasSlug) issues.push('pattern must contain ":slug"')
  return issues
}

/** Zod schema for a permalink pattern (setu.config validation — fails loud). */
export const permalinkPatternSchema = z.string().superRefine((value, ctx) => {
  for (const message of validatePermalinkPattern(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message })
  }
})
