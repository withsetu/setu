// scripts/gen-relations.mjs
// Build-time codegen: scan the content dir, compute the related-posts graph via
// @setu/core, and write a static O(1) lookup map for the site's <RelatedReading>
// widget. Pure build-time => zero per-visitor cost. Mirrors gen-blocks.mjs (jiti
// imports @setu/core as TS). Exports buildRelationsGraph(dir) for tests; writes the
// cache file when run directly as a CLI.
import {
  existsSync,
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createJiti } from 'jiti'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DEFAULT_CONTENT_DIR = process.env.SETU_CONTENT_DIR ?? path.join(ROOT, 'content')
const OUT = path.join(ROOT, 'apps', 'site', '.setu', 'cache', 'relations.json')

// @setu/core (+ /node) and zod are not hoisted to the repo root under pnpm strict
// hoisting; resolve them from packages/core where they ARE installed. (Same trick as
// gen-blocks.mjs.)
const coreReq = createRequire(path.join(ROOT, 'packages', 'core', 'package.json'))
const jiti = createJiti(import.meta.url, {
  alias: {
    '@setu/core': coreReq.resolve('@setu/core'),
    '@setu/core/node': coreReq.resolve('@setu/core/node'),
    zod: coreReq.resolve('zod'),
  },
})
const { parseMdoc, normalizeTags, entryUrlPath, selectRelatedPosts } =
  await jiti.import('@setu/core')

/** Recursively collect every .mdoc file under dir (absolute paths). */
function walk(dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (name.endsWith('.mdoc')) out.push(full)
  }
  return out
}

const asStringArray = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [])

/** Turn one .mdoc file into a RelatedRow keyed by its Astro entry id. */
function toRow(file, contentDir) {
  const id = path.relative(contentDir, file).replace(/\\/g, '/').replace(/\.mdoc$/, '')
  const [collection = '', locale = '', ...rest] = id.split('/')
  const slug = rest.join('/')
  const { frontmatter } = parseMdoc(readFileSync(file, 'utf8'))
  const title = typeof frontmatter.title === 'string' ? frontmatter.title : slug
  const tags = normalizeTags(asStringArray(frontmatter.tags))
  const categories = asStringArray(frontmatter.categories)
  const dateRaw = frontmatter.date ?? frontmatter.updatedAt ?? frontmatter.pubDate
  const parsed = dateRaw != null ? Date.parse(String(dateRaw)) : Number.NaN
  const updatedAt = Number.isNaN(parsed) ? statSync(file).mtimeMs : parsed
  return { key: id, collection, locale, slug, title, tags, categories, updatedAt }
}

/** Build the related-posts graph for a content dir: entry-id -> {title, href}[]. */
export function buildRelationsGraph(contentDir) {
  const rows = walk(contentDir).map((f) => toRow(f, contentDir))
  const graph = selectRelatedPosts(rows, { k: 4, categoryBoost: 0.25 })
  const out = {}
  for (const [id, refs] of Object.entries(graph)) {
    out[id] = refs.map((r) => ({
      title: r.title,
      href: '/' + entryUrlPath({ collection: r.collection, locale: r.locale, slug: r.slug }),
    }))
  }
  return out
}

// CLI: write the cache file for the default content dir.
const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const out = buildRelationsGraph(DEFAULT_CONTENT_DIR)
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n')
  const n = Object.keys(out).length
  console.log(`gen-relations: ${n} graph key${n === 1 ? '' : 's'} -> apps/site/.setu/cache/relations.json`)
}
