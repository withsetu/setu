/** The origin `astro.config.mjs` uses for `site` when SETU_SITE_URL is unset. Correct for
 *  `astro dev` / `astro sync` / `astro preview`; never correct in a built site. */
export const DEV_SITE_URL = 'http://localhost:4321'

/**
 * Check the build's canonical site URL (#1118). `site` feeds every absolute URL the built site
 * emits — canonical, og:url, JSON-LD @id, sitemap `<loc>`, RSS links, hreflang — so a production
 * build without SETU_SITE_URL would silently ship all of them pointing at localhost. Only
 * `astro build` is gated: dev/sync/preview keep the localhost default. Exported for unit tests.
 *
 * @param {'dev' | 'build' | 'preview' | 'sync'} command the Astro CLI command
 * @param {string | undefined} raw `process.env.SETU_SITE_URL`
 * @returns {string | undefined} an error message when the build must stop, else undefined
 */
export function siteUrlProblem(command, raw) {
  if (command !== 'build') return undefined
  const value = raw?.trim() ?? ''
  if (value === '')
    return (
      'SETU_SITE_URL is not set. `astro build` needs the public origin the site will be served ' +
      'from, because every canonical link, og:url, JSON-LD @id, sitemap <loc>, RSS link and ' +
      `hreflang href is built from it — without it they would all point at ${DEV_SITE_URL}. ` +
      'Set it for this build, e.g. `SETU_SITE_URL=https://www.example.com pnpm build`. ' +
      '(`astro dev` does not need it.)'
    )
  let url
  try {
    url = new URL(value)
  } catch {
    url = undefined
  }
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:'))
    return (
      `SETU_SITE_URL must be an absolute http(s) URL such as https://www.example.com — got ` +
      `${JSON.stringify(value)}.`
    )
  return undefined
}

/**
 * Astro integration: stop `astro build` at config time (before any page renders) when
 * SETU_SITE_URL is missing or not an absolute http(s) URL. Enforced by
 * apps/site/test/require-site-url.test.ts (unit + a real `astro build` that must fail).
 */
export function requireSiteUrl() {
  return {
    name: 'setu:require-site-url',
    hooks: {
      'astro:config:setup': ({ command }) => {
        const problem = siteUrlProblem(command, process.env.SETU_SITE_URL)
        if (problem) throw new Error(problem)
      }
    }
  }
}
