import { z } from 'zod'
import { DEFAULT_SETTINGS } from './defaults'
import type { SiteSettings } from './types'

const generalSchema = z
  .object({
    title: z.string(),
    tagline: z.string(),
    description: z.string(),
    timezone: z.string(),
    dateFormat: z.string(),
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
      .object({ mode: z.enum(['off', 'index', 'pages']), style: z.enum(['raw', 'rendered']) })
      .partial(),
    relatedPosts: z
      .object({
        enabled: z.boolean(),
        heading: z.string(),
        count: z.number(),
        showImage: z.boolean(),
      })
      .partial(),
  })
  .partial()

const mediaSchema = z
  .object({
    imageFormat: z.enum(['webp', 'avif', 'both']),
    imageLqip: z.boolean(),
  })
  .partial()

// passthrough keeps unknown future top-level groups (forward-compat on read/save).
const settingsSchema = z
  .object({
    general: generalSchema.optional(),
    reading: readingSchema.optional(),
    media: mediaSchema.optional(),
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
  const rd = DEFAULT_SETTINGS.reading
  const validFormat = (['webp', 'avif', 'both'] as const).includes(
    media.imageFormat as SiteSettings['media']['imageFormat'],
  )
  return {
    ...data,
    general: { ...DEFAULT_SETTINGS.general, ...general },
    reading: {
      ...rd,
      ...reading,
      feed: { ...rd.feed, ...(reading.feed ?? {}) },
      markdown: { ...rd.markdown, ...(reading.markdown ?? {}) },
      relatedPosts: { ...rd.relatedPosts, ...(reading.relatedPosts ?? {}) },
    },
    media: {
      imageFormat: validFormat
        ? (media.imageFormat as SiteSettings['media']['imageFormat'])
        : DEFAULT_SETTINGS.media.imageFormat,
      imageLqip:
        typeof media.imageLqip === 'boolean'
          ? media.imageLqip
          : DEFAULT_SETTINGS.media.imageLqip,
    },
  } as SiteSettings
}
