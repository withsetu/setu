import { z } from 'zod'
import { DEFAULT_SETTINGS } from './defaults'
import type { SiteSettings } from './types'
import { validatePermalinkPattern } from '../permalinks/pattern'

const generalSchema = z
  .object({
    title: z.string(),
    tagline: z.string(),
    description: z.string(),
    timezone: z.string(),
    dateFormat: z.string()
  })
  .partial()

const readingSchema = z
  .object({
    homepage: z.string(),
    searchEngineVisible: z.boolean(),
    listPageSize: z.number(),
    postsPerPage: z.number(),
    feed: z.object({ enabled: z.boolean(), items: z.number() }).partial(),
    markdown: z
      .object({
        mode: z.enum(['off', 'index', 'pages']),
        style: z.enum(['raw', 'rendered'])
      })
      .partial(),
    relatedPosts: z
      .object({
        enabled: z.boolean(),
        heading: z.string(),
        count: z.number(),
        showImage: z.boolean()
      })
      .partial()
  })
  .partial()

const mediaSchema = z
  .object({
    imageFormat: z.enum(['webp', 'avif', 'both']),
    imageLqip: z.boolean()
  })
  .partial()

const identitySchema = z
  .object({
    // entityType/socialProfiles are intentionally lenient here so a hand-edited bad value
    // resets only itself (coerced in the merge below) rather than failing the whole parse
    // and wiping every other group back to defaults.
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
  .partial()

// patterns/uncategorized are intentionally lenient (z.unknown/z.string) here — a bad
// pattern or slug is dropped field-level in the merge below rather than failing the
// whole parse and wiping every other group back to defaults.
const permalinksSchema = z
  .object({ patterns: z.unknown(), uncategorized: z.string() })
  .partial()

// passthrough keeps unknown future top-level groups (forward-compat on read/save).
const settingsSchema = z
  .object({
    general: generalSchema.optional(),
    reading: readingSchema.optional(),
    media: mediaSchema.optional(),
    identity: identitySchema.optional(),
    permalinks: permalinksSchema.optional()
  })
  .passthrough()

/** Parse a raw settings value and deep-merge over DEFAULT_SETTINGS. Malformed or
 *  missing input → defaults (never throws). Unknown future top-level groups are
 *  preserved on the returned object so an older admin won't clobber a newer file. */
export function parseSettings(raw: unknown): SiteSettings {
  const parsed = settingsSchema.safeParse(raw)
  const data: Record<string, unknown> = parsed.success ? parsed.data : {}
  const general = (data.general ?? {}) as Partial<SiteSettings['general']>
  const reading = (data.reading ?? {}) as Partial<SiteSettings['reading']>
  const media = (data.media ?? {}) as Partial<SiteSettings['media']>
  const identity = (data.identity ?? {}) as Partial<SiteSettings['identity']>
  const permalinks = (data.permalinks ?? {}) as Partial<SiteSettings['permalinks']>
  const rd = DEFAULT_SETTINGS.reading
  const id = DEFAULT_SETTINGS.identity
  const validFormat = (['webp', 'avif', 'both'] as const).includes(
    media.imageFormat as SiteSettings['media']['imageFormat']
  )
  const validEntity = (['person', 'organization'] as const).includes(
    identity.entityType as SiteSettings['identity']['entityType']
  )
  const validSlug = /^[a-z0-9-]+$/
  const patterns: Record<string, string> = {}
  if (
    permalinks.patterns &&
    typeof permalinks.patterns === 'object' &&
    !Array.isArray(permalinks.patterns)
  ) {
    for (const [k, v] of Object.entries(permalinks.patterns)) {
      if (typeof v === 'string' && validatePermalinkPattern(v).length === 0) patterns[k] = v
    }
  }
  return {
    ...data,
    general: { ...DEFAULT_SETTINGS.general, ...general },
    reading: {
      ...rd,
      ...reading,
      feed: { ...rd.feed, ...(reading.feed ?? {}) },
      markdown: { ...rd.markdown, ...(reading.markdown ?? {}) },
      relatedPosts: { ...rd.relatedPosts, ...(reading.relatedPosts ?? {}) }
    },
    media: {
      imageFormat: validFormat
        ? (media.imageFormat as SiteSettings['media']['imageFormat'])
        : DEFAULT_SETTINGS.media.imageFormat,
      imageLqip:
        typeof media.imageLqip === 'boolean'
          ? media.imageLqip
          : DEFAULT_SETTINGS.media.imageLqip
    },
    identity: {
      ...id,
      ...identity,
      entityType: validEntity
        ? (identity.entityType as SiteSettings['identity']['entityType'])
        : id.entityType,
      socialProfiles: Array.isArray(identity.socialProfiles)
        ? identity.socialProfiles.filter(
            (s): s is string => typeof s === 'string'
          )
        : id.socialProfiles
    },
    permalinks: {
      patterns,
      uncategorized:
        typeof permalinks.uncategorized === 'string' && validSlug.test(permalinks.uncategorized)
          ? permalinks.uncategorized
          : DEFAULT_SETTINGS.permalinks.uncategorized
    }
  }
}
