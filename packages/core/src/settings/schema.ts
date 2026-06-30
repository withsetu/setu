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

// passthrough keeps unknown future top-level groups (forward-compat on read/save).
const settingsSchema = z
  .object({ general: generalSchema.optional(), reading: readingSchema.optional() })
  .passthrough()

/** Parse a raw settings value and deep-merge over DEFAULT_SETTINGS. Malformed or
 *  missing input → defaults (never throws). Unknown future top-level groups are
 *  preserved on the returned object so an older admin won't clobber a newer file. */
export function parseSettings(raw: unknown): SiteSettings {
  const parsed = settingsSchema.safeParse(raw)
  const data: Record<string, unknown> = parsed.success ? parsed.data : {}
  const general = (data.general ?? {}) as Partial<SiteSettings['general']>
  const reading = (data.reading ?? {}) as Partial<SiteSettings['reading']>
  const rd = DEFAULT_SETTINGS.reading
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
  } as SiteSettings
}
