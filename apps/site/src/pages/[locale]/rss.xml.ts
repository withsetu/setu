import rss from '@astrojs/rss'
import { getCollection } from 'astro:content'
import type { APIContext } from 'astro'
import { DEFAULT_LOCALE } from '@setu/core'
import { loadSiteSettings } from '../../lib/site-settings'
import { getFeedPosts, feedLocales } from '../../lib/feed'

export const prerender = true

export async function getStaticPaths() {
  const entries = await getCollection('entries')
  return feedLocales(entries.map((e) => ({ id: e.id, data: e.data as Record<string, unknown> })))
    .filter((locale) => locale !== DEFAULT_LOCALE)
    .map((locale) => ({ params: { locale } }))
}

export async function GET(context: APIContext) {
  const settings = loadSiteSettings()
  if (!settings.reading.feed.enabled) return new Response(null, { status: 404 })
  const locale = context.params.locale as string
  const entries = await getCollection('entries')
  const items = getFeedPosts(
    entries.map((e) => ({
      id: e.id,
      data: e.data as Record<string, unknown>,
      body: e.body,
      filePath: e.filePath,
    })),
    settings.reading.feed.items,
    locale,
  )
  return rss({
    title: `${settings.general.title} (${locale.toUpperCase()})`,
    description:
      settings.general.description || settings.general.tagline || settings.general.title,
    site: context.site ?? 'http://localhost:4321',
    items,
  })
}
