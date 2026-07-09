import { writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { defaultSecurityHeaders, toCloudflareHeadersFile } from '@setu/core'

/**
 * The `img-src` extra origin for the CSP: only when media is served from a DIFFERENT origin
 * than the site (e.g. `PUBLIC_SETU_MEDIA=https://media.example.com/media`). A relative media
 * path or a same-origin URL needs nothing — `'self'` already covers it. Exported for unit tests.
 *
 * @param {string | undefined} mediaUrl `PUBLIC_SETU_MEDIA` (absolute URL or site-relative path)
 * @param {string | undefined} siteUrl `SETU_SITE_URL` (the build's canonical site origin)
 * @returns {string | undefined} the media origin to allow, or undefined when not needed
 */
export function mediaOriginFor(mediaUrl, siteUrl) {
  if (!mediaUrl) return undefined
  let media
  try {
    media = new URL(mediaUrl)
  } catch {
    return undefined // relative path → same-origin by definition
  }
  try {
    if (siteUrl && new URL(siteUrl).origin === media.origin) return undefined
  } catch {
    /* unparseable site URL → keep the explicit media origin (safe: only ADDS an allowed host) */
  }
  return media.origin
}

/**
 * Write the default `_headers` file into a built dist, unless the user shipped their own
 * (`public/_headers` — Astro copies public/ into dist before build:done, so a pre-existing
 * file there is the user's and WINS). Exported for unit tests.
 *
 * @param {string} distRoot absolute path to the build output directory
 * @param {{ mediaOrigin?: string, logger?: { info: (msg: string) => void } }} [opts]
 * @returns {Promise<boolean>} true if the default file was written, false if the user's won
 */
export async function emitDefaultHeaders(distRoot, opts = {}) {
  const target = join(distRoot, '_headers')
  if (existsSync(target)) {
    opts.logger?.info(
      'user _headers present — skipping default emission (your file wins)'
    )
    return false
  }
  await writeFile(
    target,
    toCloudflareHeadersFile(
      defaultSecurityHeaders({ mediaOrigin: opts.mediaOrigin })
    )
  )
  opts.logger?.info(
    'wrote default security _headers (report-only CSP; see #289)'
  )
  return true
}

/**
 * Astro integration: default security headers for the published site (#289).
 *
 * On `astro:build:done`, emits `dist/_headers` (the Cloudflare Pages / Netlify static-hosting
 * header format) from core's `defaultSecurityHeaders` vocabulary. The CSP ships REPORT-ONLY by
 * design — the enforce flip is a later settings toggle. Hosts that don't read `_headers` simply
 * ignore one small extra file; self-hosted/nginx guidance is a follow-up.
 */
export function securityHeaders() {
  return {
    name: 'setu:security-headers',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        await emitDefaultHeaders(fileURLToPath(dir), {
          mediaOrigin: mediaOriginFor(
            process.env.PUBLIC_SETU_MEDIA,
            process.env.SETU_SITE_URL
          ),
          logger
        })
      }
    }
  }
}
