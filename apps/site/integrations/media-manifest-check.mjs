import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Drop trailing `/`s from a URL base with a linear scan (no `\/+$` regex — polynomial, #340). */
function stripTrailingSlashes(s) {
  let end = s.length
  while (end > 0 && s.charCodeAt(end - 1) === 47) end--
  return s.slice(0, end)
}

const IMG_SRC = /<img\b[^>]*?\ssrc="([^"]*)"/gi

/**
 * How many built pages carry an `<img>` whose src is a Setu media path — root-relative
 * `/media/…`, or `/media/…` under the configured PUBLIC_SETU_MEDIA base. An external image that
 * merely has `/media/` in its path is not ours and is not counted. Exported for unit tests.
 *
 * @param {string[]} pages built HTML, one string per page
 * @param {string | undefined} publicMediaBase `process.env.PUBLIC_SETU_MEDIA`
 */
export function countMediaImagePages(pages, publicMediaBase) {
  const base = stripTrailingSlashes(publicMediaBase?.trim() ?? '')
  const prefixes = ['/media/', ...(base ? [`${base}/media/`] : [])]
  let n = 0
  for (const html of pages) {
    for (const m of html.matchAll(IMG_SRC)) {
      const src = m[1] ?? ''
      if (prefixes.some((p) => src.startsWith(p))) {
        n++
        break
      }
    }
  }
  return n
}

/**
 * The warning for a build whose images cannot be responsive, or undefined when there is none
 * (#1161). The site reads variant manifests ONLY from SETU_MEDIA_DIR
 * (packages/image-astro/src/lib/media-manifest.ts); without it every uploaded image renders as a
 * bare `<img>` — no srcset, no `<picture>`, no width/height — and nothing else says so. A
 * warning, not a failure: the pages are still correct, only unoptimised, and a site whose media
 * is served from elsewhere may legitimately have no manifests. Exported for unit tests.
 *
 * @param {{ mediaDir: string | undefined, dirExists: boolean, pages: number }} args
 */
export function mediaManifestProblem({ mediaDir, dirExists, pages }) {
  if (pages === 0) return undefined
  const what = `${pages} page${pages === 1 ? '' : 's'} reference${pages === 1 ? 's' : ''} uploaded /media/ images`
  const consequence =
    'so those images were built WITHOUT responsive variants (no srcset, no <picture>, no ' +
    'width/height). Point SETU_MEDIA_DIR at the api media dir (default ' +
    '`<content repo>/.setu/uploads`) and rebuild.'
  const dir = mediaDir?.trim() ?? ''
  if (dir === '')
    return `SETU_MEDIA_DIR is not set, but ${what}, ${consequence}`
  if (!dirExists)
    return `SETU_MEDIA_DIR (${dir}) does not exist, but ${what}, ${consequence}`
  return undefined
}

async function htmlFiles(root) {
  const out = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const p = join(root, entry.name)
    if (entry.isDirectory()) out.push(...(await htmlFiles(p)))
    else if (entry.name.endsWith('.html')) out.push(p)
  }
  return out
}

/**
 * Astro integration: at `astro:build:done`, warn when built pages reference `/media/` images but
 * no manifest dir is configured (#1161). Build-only; never fails the build. Enforced by
 * apps/site/test/media-manifest-check.test.ts.
 *
 * @param {{ env?: Record<string, string | undefined> }} [opts] env override for tests
 */
export function mediaManifestCheck(opts = {}) {
  return {
    name: 'setu:media-manifest-check',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const env = opts.env ?? process.env
        const mediaDir = env.SETU_MEDIA_DIR
        const dirExists =
          mediaDir !== undefined && mediaDir.trim() !== ''
            ? existsSync(mediaDir.trim())
            : false
        // Cheap exit: a configured, present dir needs no scan.
        if (dirExists) return
        const files = await htmlFiles(fileURLToPath(dir))
        const pages = await Promise.all(files.map((f) => readFile(f, 'utf8')))
        const problem = mediaManifestProblem({
          mediaDir,
          dirExists,
          pages: countMediaImagePages(pages, env.PUBLIC_SETU_MEDIA)
        })
        if (problem) logger.warn(problem)
      }
    }
  }
}
