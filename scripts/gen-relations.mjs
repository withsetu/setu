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
  mkdirSync
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createJiti } from 'jiti'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DEFAULT_CONTENT_DIR =
  process.env.SETU_CONTENT_DIR ?? path.join(ROOT, 'content')
const OUT = path.join(ROOT, 'apps', 'site', '.setu', 'cache', 'relations.json')

// @setu/core (+ /node) and zod are not hoisted to the repo root under pnpm strict
// hoisting; resolve them from packages/core where they ARE installed. (Same trick as
// gen-blocks.mjs.)
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
const {
  parseMdoc,
  normalizeTags,
  selectRelatedPosts,
  resolvePermalinkMap,
  resolvePermalinkConfig,
  parseFrontmatterDate,
  parseSettings
} = await jiti.import('@setu/core')

const SITE_CONFIG_PATH = path.join(ROOT, 'apps', 'site', 'setu.config.ts')

/** settings.json lives at the content-repo root (sibling of the content dir). Missing/malformed
 *  → defaults, mirroring apps/site/src/lib/site-settings.ts. */
function loadSettings(contentDir) {
  const settingsPath = path.join(contentDir, '..', 'settings.json')
  try {
    return parseSettings(JSON.parse(readFileSync(settingsPath, 'utf8')))
  } catch {
    return parseSettings(undefined)
  }
}

/** The site's setu.config.ts default export (permalink pattern overrides). Missing → undefined,
 *  which resolvePermalinkConfig treats as "no config source". */
async function loadSiteConfig() {
  if (!existsSync(SITE_CONFIG_PATH)) return undefined
  const mod = await jiti.import(SITE_CONFIG_PATH)
  return mod?.default ?? mod
}

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

const asStringArray = (v) =>
  Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []

/** Turn one .mdoc file into a RelatedRow keyed by its Astro entry id. */
function toRow(file, contentDir) {
  const id = path
    .relative(contentDir, file)
    .replace(/\\/g, '/')
    .replace(/\.mdoc$/, '')
  const [collection = '', locale = '', ...rest] = id.split('/')
  const slug = rest.join('/')
  const { frontmatter } = parseMdoc(readFileSync(file, 'utf8'))
  const title = typeof frontmatter.title === 'string' ? frontmatter.title : slug
  const tags = normalizeTags(asStringArray(frontmatter.tags))
  const categories = asStringArray(frontmatter.categories)
  const dateRaw =
    frontmatter.date ?? frontmatter.updatedAt ?? frontmatter.pubDate
  const parsed = dateRaw != null ? Date.parse(String(dateRaw)) : Number.NaN
  const updatedAt = Number.isNaN(parsed) ? statSync(file).mtimeMs : parsed
  const featuredImage =
    typeof frontmatter.featuredImage === 'string'
      ? frontmatter.featuredImage
      : undefined
  const relatedOverride =
    frontmatter.related === false
      ? false
      : Array.isArray(frontmatter.related)
        ? frontmatter.related.filter((x) => typeof x === 'string')
        : undefined
  // `date`/`pubDate` are carried alongside the RelatedRow shape (as `permalinkDate`) purely so
  // the permalink map can be built from the same scan without re-parsing every file.
  return {
    key: id,
    collection,
    locale,
    slug,
    title,
    tags,
    categories,
    updatedAt,
    featuredImage,
    relatedOverride,
    // `published !== false` is the ONLY published-ness signal (#165): drafts are
    // committed-but-hidden and must never enter the related graph in any direction.
    published: frontmatter.published !== false,
    // Stable content id (#389): survives a slug rename, so the redirect map keys on it.
    cid: typeof frontmatter.cid === 'string' ? frontmatter.cid : undefined,
    // Frontmatter date ?? pubDate ONLY — never updatedAt/mtime — matching
    // apps/site/src/lib/permalinks.ts's toPermalinkEntry exactly (an edit must not move a URL).
    permalinkDate: parseFrontmatterDate(frontmatter)
  }
}

/** Project a scanned row to what resolvePermalinkMap needs. */
function toPermalinkEntry(row) {
  return {
    id: row.key,
    collection: row.collection,
    locale: row.locale,
    slug: row.slug,
    date: row.permalinkDate,
    categories: row.categories
  }
}

/** Build the site-wide id -> URL-path map the same way apps/site/src/lib/permalinks.ts does:
 *  resolvePermalinkMap over every scanned entry, then the two home overrides. */
async function buildPermalinkMap(rows, contentDir) {
  const settings = loadSettings(contentDir)
  const config = await loadSiteConfig()
  const entries = rows.map(toPermalinkEntry)
  const { paths, warnings } = resolvePermalinkMap(
    entries,
    (collection) =>
      resolvePermalinkConfig(collection, config, settings).pattern,
    { uncategorized: settings.permalinks.uncategorized }
  )
  for (const w of warnings) console.warn(`[gen-relations] permalinks: ${w}`)
  paths.set('page/en/home', '')
  if (settings.reading.homepage) paths.set(settings.reading.homepage, '')
  return paths
}

/** The site-wide **cid -> URL-path** map, leading-slash-normalized (home → '/'), for redirect
 *  diffing (#252). Keyed by the stable content id (#389), not the slug-derived Astro id, so a
 *  slug rename keeps the key and the diff sees a path change (→ a 301) instead of a delete+add.
 *  Entries without a cid (not yet backfilled) are skipped — untracked until stamped. Same scan +
 *  resolver the routing and related graph use, so a URL here is byte-identical to what ships. */
export async function buildUrlMap(contentDir) {
  const rows = walk(contentDir).map((f) => toRow(f, contentDir))
  const idMap = await buildPermalinkMap(rows, contentDir)
  const out = {}
  for (const row of rows) {
    if (!row.cid) continue
    const p = idMap.get(row.key)
    if (p === undefined) continue
    out[row.cid] = p === '' ? '/' : '/' + p
  }
  return out
}

/** Build the related-posts graph for a content dir: entry-id -> {title, href, featuredImage?}[]. */
export async function buildRelationsGraph(contentDir) {
  const rows = walk(contentDir).map((f) => toRow(f, contentDir))
  // Drafts (`published: false`, #165) are excluded from the graph in BOTH directions:
  // not candidates (targets), not sources (their page never builds), and an explicit
  // `related:` override naming a draft resolves to nothing. The permalink map still
  // sees every row — URLs must stay byte-identical to the routing scan.
  const pool = rows.filter((r) => r.published)
  const byKey = new Map(pool.map((r) => [r.key, r]))
  const graph = selectRelatedPosts(pool, { k: 6, categoryBoost: 0.25 })
  const map = await buildPermalinkMap(rows, contentDir)

  // `r` may be a full row (has `.key`, from an override lookup) or a bare RelatedRef
  // (collection/locale/slug/title only, from selectRelatedPosts) — id is reconstructed
  // either way so the permalink map lookup always hits.
  const refOf = (r) => {
    const id = r.key ?? `${r.collection}/${r.locale}/${r.slug}`
    return {
      title: r.title,
      href: '/' + (map.get(id) ?? ''),
      ...(r.featuredImage ? { featuredImage: r.featuredImage } : {})
    }
  }

  const out = {}
  for (const row of pool) {
    if (row.relatedOverride === false) {
      out[row.key] = []
    } else if (Array.isArray(row.relatedOverride)) {
      out[row.key] = row.relatedOverride
        .map((slug) => byKey.get(`${row.collection}/${row.locale}/${slug}`))
        .filter(Boolean)
        .map(refOf)
    } else {
      out[row.key] = (graph[row.key] ?? []).map((ref) => {
        const full = byKey.get(`${ref.collection}/${ref.locale}/${ref.slug}`)
        return refOf(full ?? ref)
      })
    }
  }
  return out
}

// CLI: write the cache file for the default content dir.
const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const out = await buildRelationsGraph(DEFAULT_CONTENT_DIR)
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n')
  const n = Object.keys(out).length
  console.log(
    `gen-relations: ${n} graph key${n === 1 ? '' : 's'} -> apps/site/.setu/cache/relations.json`
  )
}
