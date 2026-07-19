import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  resolvePermalinkMap,
  resolvePermalinkConfig,
  incumbentFromUrlMap,
  parseFrontmatterDate,
  type PermalinkEntry
} from '@setu/core'
import config from '../../setu.config'
import { loadSiteSettings } from './site-settings'
import { contentRepoRoot } from './content-root'
import { strArr } from './post-row'

/** The committed `url-map.json` (cid → "/path") at the content-repo root, beside
 *  settings.json. Missing/malformed → null: no incumbency, so a first build competes
 *  purely on date exactly as before. Read fresh per call, like loadSiteSettings. */
function loadUrlMap(): Record<string, string> | null {
  try {
    return JSON.parse(
      readFileSync(join(contentRepoRoot(), 'url-map.json'), 'utf8')
    ) as Record<string, string>
  } catch {
    return null
  }
}

/** Project a raw Astro entry to what the resolver needs. Date = frontmatter date/pubDate
 *  ONLY (never updatedAt/git/mtime — an edit must not move a URL). */
export function toPermalinkEntry(entry: {
  id: string
  data: Record<string, unknown>
}): PermalinkEntry {
  const [collection = '', locale = '', ...rest] = entry.id.split('/')
  return {
    id: entry.id,
    collection,
    locale,
    slug: rest.join('/'),
    date: parseFrontmatterDate(entry.data),
    categories: strArr(entry.data['categories'])
  }
}

async function build(): Promise<Map<string, string>> {
  // Dynamic import (not a static module-level import): `astro:content` only resolves inside
  // Astro's own Vite pipeline. A static import would make this whole module — including the
  // pure `toPermalinkEntry` — unloadable under plain vitest (see feed.test.ts, which never
  // imports astro:content either). Deferring the import to call-time keeps `toPermalinkEntry`
  // unit-testable without a running Astro build.
  const { getCollection } = await import('astro:content')
  const entries = await getCollection('entries')
  const settings = loadSiteSettings()
  // Incumbency (#657): an id already holding a URL in the committed snapshot keeps it, so
  // adding a back-dated entry cannot evict a live page. Must match scripts/gen-relations.mjs
  // exactly — the routing scan and the redirect scan have to agree byte for byte.
  const incumbent = incumbentFromUrlMap(
    loadUrlMap(),
    entries.map((e) => ({
      id: e.id,
      cid:
        typeof (e.data as Record<string, unknown>)['cid'] === 'string'
          ? ((e.data as Record<string, unknown>)['cid'] as string)
          : null
    }))
  )
  const { paths, warnings } = resolvePermalinkMap(
    entries.map((e) =>
      toPermalinkEntry({ id: e.id, data: e.data as Record<string, unknown> })
    ),
    (collection) =>
      resolvePermalinkConfig(collection, config, settings).pattern,
    { uncategorized: settings.permalinks.uncategorized, incumbent }
  )
  for (const w of warnings) console.warn(`[setu] permalinks: ${w}`)
  // The home entry and the configured homepage are served at the root, not their pattern URL.
  paths.set('page/en/home', '')
  if (settings.reading.homepage) paths.set(settings.reading.homepage, '')
  return paths
}

let cached: Promise<Map<string, string>> | null = null

/** The site-wide id → URL-path map (collision-aware). Memoized for the build; recomputed
 *  per call in dev so settings/config edits show up on refresh (mirrors loadSiteSettings). */
export function permalinkMap(): Promise<Map<string, string>> {
  if (import.meta.env.PROD) return (cached ??= build())
  return build()
}
