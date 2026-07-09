// scripts/gen-redirects.mjs
// Build-time codegen: diff the site's current URL map against the last committed snapshot and
// maintain a 301 redirect table, so renaming a slug (or changing a permalink pattern / date /
// category) never leaves a dead URL. Mirrors gen-relations.mjs (same content scan + resolver via
// buildUrlMap). Pure build-time => zero per-visitor cost; SSG emits a `_redirects` file the host
// (Cloudflare Pages / Netlify) serves. Edge/SSR runtime redirects are a follow-on (#349).
//
// Persistence (Git-tracked, at the content-repo root, like settings.json):
//   url-map.json   — id -> current URL path (the snapshot the NEXT build diffs against)
//   redirects.json — accumulated [{from,to}] 301s, chains collapsed to their terminal target
// Both are written here and ride the normal deploy/commit flow. The generated `_redirects` under
// apps/site/public/ is a disposable artifact (gitignored); astro copies public/* into dist/.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createJiti } from 'jiti'
import { buildUrlMap } from './gen-relations.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DEFAULT_CONTENT_DIR =
  process.env.SETU_CONTENT_DIR ?? path.join(ROOT, 'content')
const PUBLIC_REDIRECTS = path.join(ROOT, 'apps', 'site', 'public', '_redirects')

const coreReq = createRequire(
  path.join(ROOT, 'packages', 'core', 'package.json')
)
const jiti = createJiti(import.meta.url, {
  alias: {
    '@setu/core': coreReq.resolve('@setu/core'),
    '@setu/core/node': coreReq.resolve('@setu/core/node'),
    zod: coreReq.resolve('zod')
  }
})
const { diffRedirects } = await jiti.import('@setu/core')

/** Read a JSON file, returning `fallback` on missing/malformed (never throws — a corrupt
 *  snapshot must not break the build; worst case a redirect is missed, surfaced by the diff). */
function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

/** Serialize the redirect table to Cloudflare-Pages / Netlify `_redirects` syntax:
 *  one `<from> <to> 301` line each, sorted by `from` for a stable, diff-friendly file. */
export function redirectsToText(redirects) {
  return (
    [...redirects]
      .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
      .map((r) => `${r.from} ${r.to} 301`)
      .join('\n') + '\n'
  )
}

/** Diff current URLs against the committed snapshot; return the next snapshot + redirect table.
 *  Pure over its inputs (IO is the caller's job) so it can be unit-tested with plain objects. */
export function computeRedirectUpdate(currentMap, prevMap, existingRedirects) {
  const redirects = diffRedirects(prevMap, currentMap, existingRedirects)
  return { urlMap: currentMap, redirects }
}

/** Run the full diff for a content dir and write url-map.json, redirects.json, and the generated
 *  _redirects artifact. Returns the redirect table for logging/testing. */
export async function run(
  contentDir,
  { publicRedirects = PUBLIC_REDIRECTS } = {}
) {
  const contentRoot = path.join(contentDir, '..')
  const urlMapPath = path.join(contentRoot, 'url-map.json')
  const redirectsPath = path.join(contentRoot, 'redirects.json')

  const current = await buildUrlMap(contentDir)
  const prev = readJson(urlMapPath, {})
  const existing = readJson(redirectsPath, [])

  const { urlMap, redirects } = computeRedirectUpdate(current, prev, existing)

  // Sort keys so the committed snapshot is deterministic across platforms (readdir order is
  // not portable) — otherwise CI rebuilds would churn the file and dirty the tree.
  const sortedMap = Object.fromEntries(
    Object.keys(urlMap)
      .sort()
      .map((k) => [k, urlMap[k]])
  )
  writeFileSync(urlMapPath, JSON.stringify(sortedMap, null, 2) + '\n')
  writeFileSync(redirectsPath, JSON.stringify(redirects, null, 2) + '\n')
  mkdirSync(path.dirname(publicRedirects), { recursive: true })
  writeFileSync(publicRedirects, redirectsToText(redirects))
  return redirects
}

// CLI: diff + write for the default content dir.
const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const redirects = await run(DEFAULT_CONTENT_DIR)
  console.log(
    `gen-redirects: ${redirects.length} redirect${redirects.length === 1 ? '' : 's'} -> apps/site/public/_redirects`
  )
}
