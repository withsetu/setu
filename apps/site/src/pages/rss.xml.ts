import rss from '@astrojs/rss'
import { getCollection } from 'astro:content'
import type { APIContext } from 'astro'
import { DEFAULT_LOCALE } from '@setu/core'
import { loadSiteSettings } from '../lib/site-settings'
import { getFeedPosts } from '../lib/feed'
import { buildFeed } from '../lib/rss-xml'
import { permalinkMap } from '../lib/permalinks'

export const prerender = true

export async function GET(context: APIContext) {
  const settings = loadSiteSettings()
  if (!settings.reading.feed.enabled) {
    return new Response(null, { status: 404 })
  }
  const entries = await getCollection('entries')
  const map = await permalinkMap()
  const items = getFeedPosts(
    entries.map((e) => ({
      id: e.id,
      data: e.data as Record<string, unknown>,
      body: e.body,
      filePath: e.filePath
    })),
    settings.reading.feed.items,
    DEFAULT_LOCALE,
    (id) => map.get(id) ?? ''
  )
  return rss(
    buildFeed({
      title: settings.general.title,
      description:
        settings.general.description ||
        settings.general.tagline ||
        settings.general.title,
      site: context.site,
      locale: DEFAULT_LOCALE,
      feedPath: 'rss.xml',
      items
    })
  )
}
