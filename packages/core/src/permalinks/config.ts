import { DEFAULT_PERMALINK_PATTERN, validatePermalinkPattern } from './pattern'

/** The admin-editable settings group (settings.json → "permalinks"). */
export interface PermalinksSettings {
  /** collection → pattern; a collection absent here falls through to setu.config, then the default. */
  patterns: Record<string, string>
  /** Slug used when a pattern has :category but the entry has none. */
  uncategorized: string
}

export interface ResolvedPermalinkConfig {
  pattern: string
  uncategorized: string
}

const valid = (p: string | undefined): string | undefined =>
  p !== undefined && validatePermalinkPattern(p).length === 0 ? p : undefined

/** Settings override > setu.config default > ':collection/:slug'. Invalid patterns are
 *  skipped (fail-open to the next source) so a bad hand-edited settings.json can't 404 a site. */
export function resolvePermalinkConfig(
  collection: string,
  config?: { permalinks?: Record<string, string> },
  settings?: { permalinks?: PermalinksSettings }
): ResolvedPermalinkConfig {
  return {
    pattern:
      valid(settings?.permalinks?.patterns?.[collection]) ??
      valid(config?.permalinks?.[collection]) ??
      DEFAULT_PERMALINK_PATTERN,
    uncategorized: settings?.permalinks?.uncategorized || 'uncategorized'
  }
}
