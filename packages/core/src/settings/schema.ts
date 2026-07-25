import { z } from 'zod'
import { DEFAULT_SETTINGS } from './defaults'
import type { SiteSettings } from './types'
import { validatePermalinkPattern, SLUG_SEGMENT } from '../permalinks/pattern'
import {
  EMAIL_TEMPLATE_MAX_BODY,
  EMAIL_TEMPLATE_MAX_SUBJECT,
  type EmailTemplateOverrides
} from '../email/template-registry'

// Every group is `.partial().passthrough()`: partial so a half-written file merges over
// defaults, passthrough so an unknown future field inside a group survives an older admin
// round-tripping the file (the same forward-compat promise the top level makes).
const groupObject = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape).partial().passthrough()

const generalSchema = groupObject({
  title: z.string(),
  tagline: z.string(),
  description: z.string(),
  timezone: z.string(),
  dateFormat: z.string()
})

const readingSchema = groupObject({
  homepage: z.string(),
  searchEngineVisible: z.boolean(),
  listPageSize: z.number(),
  postsPerPage: z.number(),
  feed: groupObject({ enabled: z.boolean(), items: z.number() }),
  markdown: groupObject({
    mode: z.enum(['off', 'index', 'pages']),
    style: z.enum(['raw', 'rendered'])
  }),
  relatedPosts: groupObject({
    enabled: z.boolean(),
    heading: z.string(),
    count: z.number(),
    showImage: z.boolean()
  }),
  sitemap: groupObject({
    posts: z.boolean(),
    pages: z.boolean(),
    categories: z.boolean(),
    tags: z.boolean()
  })
})

const mediaSchema = groupObject({
  imageFormat: z.enum(['webp', 'avif', 'both']),
  imageLqip: z.boolean()
})

const identitySchema = groupObject({
  // entityType/socialProfiles stay `z.unknown()` here and are coerced field-level below:
  // the coercion salvages a partly-good value (e.g. an array with one non-string member)
  // rather than discarding the whole field, which a strict schema would do.
  entityType: z.unknown(),
  name: z.string(),
  url: z.string(),
  logo: z.string(),
  defaultImage: z.string(),
  socialProfiles: z.unknown(),
  twitterHandle: z.string(),
  titleTemplate: z.string(),
  titleSeparator: z.string()
})

// patterns/uncategorized are intentionally lenient (z.unknown/z.string) here — each pattern
// is validated individually below so one bad pattern drops only itself.
const permalinksSchema = groupObject({
  patterns: z.unknown(),
  uncategorized: z.string()
})

// #498/#890: for BOTH fields the empty string is a valid stored value meaning "not set here —
// fall back to the env var, resolved server-side" (SETU_FORMS_NOTIFY_FROM / SETU_EMAIL_ADAPTER);
// anything else must be a well-formed address / a known transport. Neither field is ever a
// credential — Resend and SMTP secrets stay env-only, because this file is Git-committed.
// Lenient-parse behavior (invalid value → warning + default, sibling fields and other groups
// untouched) is pinned by packages/core/src/settings/email-settings.test.ts.
//
// #499: `templates` stays `z.unknown()` here and is salvaged entry-by-entry below (the
// permalinks.patterns precedent) — one malformed template must never cost you the others, and
// certainly not the sibling from-address. Template TEXT is configuration, not a credential.
const emailSchema = groupObject({
  fromAddress: z.union([z.literal(''), z.string().email()]),
  provider: z.enum(['', 'console', 'resend', 'smtp']),
  templates: z.unknown()
})

/** One stored override. Size-capped at the boundary because settings.json is Git-canonical —
 *  a template can arrive by `git push` without ever passing the api's settings-write gate. The
 *  same caps are re-checked at render time (renderEmailTemplate), so neither layer is the only
 *  defence; both halves are pinned by email-settings.test.ts + test/email/email-registry.test.ts. */
const emailTemplateSchema = groupObject({
  subject: z.string().max(EMAIL_TEMPLATE_MAX_SUBJECT),
  html: z.string().max(EMAIL_TEMPLATE_MAX_BODY),
  text: z.string().max(EMAIL_TEMPLATE_MAX_BODY)
})

/** Email type ids are slugs — core's own (`password-reset`) and any a plugin registers. This
 *  bounds the KEY's shape and length only; it is not a size bound on the entry, because
 *  `groupObject` is `.partial().passthrough()` (the repo-wide forward-compat convention), so
 *  fields inside an override that this build doesn't know are passed through unmeasured. What
 *  the key check buys is that every stored id is a plausible type id rather than arbitrary
 *  free-form text — pinned by src/settings/email-settings.test.ts ("drops an entry whose id is
 *  not a slug"). */
const EMAIL_TYPE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/

type Rec = Record<string, unknown>

const isPlainObject = (v: unknown): v is Rec =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Peel ZodOptional/ZodNullable/ZodDefault wrappers off a field to reach its ZodObject,
 *  so a nested group (`reading.feed`) can be salvaged field-by-field like a top-level one. */
function innerObject(schema: z.ZodTypeAny): z.ZodObject<z.ZodRawShape> | null {
  let cur: z.ZodTypeAny = schema
  for (let i = 0; i < 5; i += 1) {
    if (cur instanceof z.ZodObject) return cur as z.ZodObject<z.ZodRawShape>
    if (
      cur instanceof z.ZodOptional ||
      cur instanceof z.ZodNullable ||
      cur instanceof z.ZodDefault
    ) {
      cur = (cur._def as { innerType: z.ZodTypeAny }).innerType
      continue
    }
    return null
  }
  return null
}

/**
 * Parse one settings group, falling back PER FIELD rather than globally (#656).
 *
 * The whole group is tried first (the fast, common path). If it fails, each key is parsed
 * against its own field schema and only the keys that fail are dropped — recursing into
 * nested groups so a bad `reading.feed.items` costs you `items`, not `feed`, and certainly
 * not `permalinks.patterns`. Keys the schema doesn't know are passed through untouched.
 */
function salvageGroup(
  schema: z.ZodObject<z.ZodRawShape>,
  raw: unknown,
  path: string,
  warnings: string[]
): Rec {
  if (raw === undefined) return {}
  if (!isPlainObject(raw)) {
    warnings.push(`${path}: expected an object — ignored, using defaults`)
    return {}
  }
  const whole = schema.safeParse(raw)
  if (whole.success) return whole.data

  const shape = schema.shape
  const out: Rec = {}
  for (const [key, value] of Object.entries(raw)) {
    const field = shape[key]
    if (field === undefined) {
      out[key] = value // unknown future key — passthrough
      continue
    }
    const nested = innerObject(field)
    if (nested !== null && isPlainObject(value)) {
      out[key] = salvageGroup(nested, value, `${path}.${key}`, warnings)
      continue
    }
    const one = field.safeParse(value)
    if (one.success) out[key] = one.data
    else
      warnings.push(
        `${path}.${key}: ${one.error.issues[0]?.message ?? 'invalid value'} — reset to default`
      )
  }
  return out
}

/** Validate `permalinks.patterns` entry-by-entry: a bad pattern drops only its own
 *  collection, never the whole map (a reverted map silently moves every published URL). */
function salvagePatterns(
  raw: unknown,
  warnings: string[]
): Record<string, string> {
  const patterns: Record<string, string> = {}
  if (raw === undefined) return patterns
  if (!isPlainObject(raw)) {
    warnings.push('permalinks.patterns: expected an object — ignored')
    return patterns
  }
  for (const [collection, value] of Object.entries(raw)) {
    if (typeof value !== 'string') {
      warnings.push(
        `permalinks.patterns.${collection}: expected a string — dropped`
      )
      continue
    }
    const issues = validatePermalinkPattern(value)
    if (issues.length > 0)
      warnings.push(
        `permalinks.patterns.${collection}: ${issues[0]} — dropped, falling back to the default pattern`
      )
    else patterns[collection] = value
  }
  return patterns
}

/** Validate `email.templates` entry-by-entry and field-by-field: a bad override drops only
 *  itself (or only its own bad field), leaving every other template — and the shipped default it
 *  falls back to — intact. Ids the running build doesn't know are KEPT: a plugin's type may not
 *  be loaded yet, and dropping its override would silently discard the admin's work. */
function salvageEmailTemplates(
  raw: unknown,
  warnings: string[]
): EmailTemplateOverrides {
  const out: EmailTemplateOverrides = {}
  if (raw === undefined) return out
  if (!isPlainObject(raw)) {
    warnings.push('email.templates: expected an object — ignored')
    return out
  }
  for (const [id, value] of Object.entries(raw)) {
    if (!EMAIL_TYPE_ID.test(id)) {
      warnings.push(
        `email.templates.${id}: not a valid email type id — dropped, using the shipped default`
      )
      continue
    }
    if (!isPlainObject(value)) {
      warnings.push(
        `email.templates.${id}: expected an object — dropped, using the shipped default`
      )
      continue
    }
    out[id] = salvageGroup(
      emailTemplateSchema,
      value,
      `email.templates.${id}`,
      warnings
    )
  }
  return out
}

/** Parse a raw settings value and deep-merge over DEFAULT_SETTINGS, reporting every key
 *  that had to be reset. Malformed or missing input → defaults (never throws). Each group
 *  and each field falls back independently (#656), and unknown future groups/fields are
 *  preserved so an older admin won't clobber a newer file. */
export function parseSettingsWithWarnings(raw: unknown): {
  settings: SiteSettings
  warnings: string[]
} {
  const warnings: string[] = []
  if (raw !== undefined && !isPlainObject(raw))
    warnings.push('settings: expected an object — using defaults')
  const data: Rec = isPlainObject(raw) ? { ...raw } : {}

  const general = salvageGroup(generalSchema, data.general, 'general', warnings)
  const reading = salvageGroup(readingSchema, data.reading, 'reading', warnings)
  const media = salvageGroup(mediaSchema, data.media, 'media', warnings)
  const identity = salvageGroup(
    identitySchema,
    data.identity,
    'identity',
    warnings
  )
  const permalinks = salvageGroup(
    permalinksSchema,
    data.permalinks,
    'permalinks',
    warnings
  )
  const email = salvageGroup(emailSchema, data.email, 'email', warnings)

  const rd = DEFAULT_SETTINGS.reading
  const id = DEFAULT_SETTINGS.identity
  const nested = (key: keyof typeof rd): Rec =>
    isPlainObject(reading[key]) ? reading[key] : {}

  const validEntity = (['person', 'organization'] as const).includes(
    identity.entityType as SiteSettings['identity']['entityType']
  )
  if (identity.entityType !== undefined && !validEntity)
    warnings.push(
      'identity.entityType: expected "person" or "organization" — reset to default'
    )
  const rawProfiles = identity.socialProfiles
  if (rawProfiles !== undefined && !Array.isArray(rawProfiles))
    warnings.push(
      'identity.socialProfiles: expected an array of strings — reset to default'
    )

  const patterns = salvagePatterns(permalinks.patterns, warnings)
  const uncategorized = permalinks.uncategorized
  const validUncategorized =
    typeof uncategorized === 'string' && SLUG_SEGMENT.test(uncategorized)
  if (uncategorized !== undefined && !validUncategorized)
    warnings.push(
      'permalinks.uncategorized: must be lowercase letters, digits, or hyphens — reset to default'
    )

  const settings: SiteSettings = {
    ...data,
    general: { ...DEFAULT_SETTINGS.general, ...general },
    reading: {
      ...rd,
      ...reading,
      feed: { ...rd.feed, ...nested('feed') },
      markdown: { ...rd.markdown, ...nested('markdown') },
      relatedPosts: { ...rd.relatedPosts, ...nested('relatedPosts') },
      sitemap: { ...rd.sitemap, ...nested('sitemap') }
    },
    media: { ...DEFAULT_SETTINGS.media, ...media },
    identity: {
      ...id,
      ...identity,
      entityType: validEntity
        ? (identity.entityType as SiteSettings['identity']['entityType'])
        : id.entityType,
      socialProfiles: Array.isArray(rawProfiles)
        ? rawProfiles.filter((s): s is string => typeof s === 'string')
        : id.socialProfiles
    },
    permalinks: {
      ...permalinks,
      patterns,
      uncategorized: validUncategorized
        ? uncategorized
        : DEFAULT_SETTINGS.permalinks.uncategorized
    },
    email: {
      ...DEFAULT_SETTINGS.email,
      ...email,
      templates: salvageEmailTemplates(email.templates, warnings)
    }
  }

  return { settings, warnings }
}

/** Parse a raw settings value and deep-merge over DEFAULT_SETTINGS. Malformed or
 *  missing input → defaults (never throws). Warnings-free convenience wrapper over
 *  {@link parseSettingsWithWarnings}. */
export function parseSettings(raw: unknown): SiteSettings {
  return parseSettingsWithWarnings(raw).settings
}
