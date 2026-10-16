import { defineMiddleware } from 'astro:middleware'
import { optionsToCss, type ThemeOption } from '@setu/core'
import { themeOptions } from 'setu:theme-options'
import { loadThemeOptions } from './site-config'
import { withThemeOverride } from './theme-override'

// Registered by integrations/theme-options.mjs for every route — prerendered pages at build time,
// and on-demand ones (the dev preview route) per request — so the override reaches every page the
// theme renders without the theme taking part (#1294). Non-HTML responses (rss.xml, sitemaps,
// robots.txt) pass through untouched.
const declaration = themeOptions as ThemeOption[]

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next()
  if (!declaration.length) return response
  // A redirect's body is a stub nobody styles (and Astro's carries no <head>).
  if (response.status >= 300 && response.status < 400) return response
  if (!response.headers.get('content-type')?.startsWith('text/html'))
    return response
  // Read fresh per request, like the pages do, so `astro dev` picks up a newly published file.
  const css = optionsToCss(declaration, loadThemeOptions())
  const html = withThemeOverride(
    await response.text(),
    css,
    context.url.pathname
  )
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
})
