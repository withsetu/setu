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

// passthrough keeps unknown future top-level groups (forward-compat on read/save).
const settingsSchema = z.object({ general: generalSchema.optional() }).passthrough()

/** Parse a raw settings value and deep-merge over DEFAULT_SETTINGS. Malformed or
 *  missing input → defaults (never throws). Unknown future top-level groups are
 *  preserved on the returned object so an older admin won't clobber a newer file. */
export function parseSettings(raw: unknown): SiteSettings {
  const parsed = settingsSchema.safeParse(raw)
  const data: Record<string, unknown> = parsed.success ? parsed.data : {}
  const general = (data.general ?? {}) as Partial<SiteSettings['general']>
  return {
    ...data,
    general: { ...DEFAULT_SETTINGS.general, ...general },
  } as SiteSettings
}
