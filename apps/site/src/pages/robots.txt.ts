import type { APIContext } from 'astro'
import { loadSiteSettings } from '../lib/site-settings'
import { buildRobotsTxt } from '../lib/sitemap'

export const prerender = true

const SITE_FALLBACK = 'http://localhost:4321'

export function GET(context: APIContext) {
  const settings = loadSiteSettings()
  const siteUrl = context.site?.href ?? SITE_FALLBACK
  const body = buildRobotsTxt(settings.reading.searchEngineVisible, siteUrl)
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  })
}
