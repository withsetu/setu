import { z } from 'zod'
import { DEFAULT_SETTINGS } from './defaults'
import type { SiteSettings } from './types'
import { validatePermalinkPattern, SLUG_SEGMENT } from '../permalinks/pattern'

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
  if (whole.success) return whole.data as Rec

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

  const rd = DEFAULT_SETTINGS.reading
  const id = DEFAULT_SETTINGS.identity
  const nested = (key: keyof typeof rd): Rec =>
    isPlainObject(reading[key]) ? (reading[key] as Rec) : {}

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

  const settings = {
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
    }
  } as unknown as SiteSettings

  return { settings, warnings }
}

/** Parse a raw settings value and deep-merge over DEFAULT_SETTINGS. Malformed or
 *  missing input → defaults (never throws). Warnings-free convenience wrapper over
 *  {@link parseSettingsWithWarnings}. */
export function parseSettings(raw: unknown): SiteSettings {
  return parseSettingsWithWarnings(raw).settings
}
