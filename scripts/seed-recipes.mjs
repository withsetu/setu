// scripts/seed-recipes.mjs
//
// One-time test-content seeder: pull the full free TheMealDB recipe DB and write each
// meal as a Setu `.mdoc` into a gitignored content sandbox, so we can exercise the
// related-posts widget against ~600 real entries with rich tags + categories WITHOUT
// hitting the API on every run.
//
// - Cache-first: the raw API payload is saved to <sandbox>/.cache/meals.json. Re-runs read
//   the cache and make ZERO network calls. Pass `--refresh` to refetch from the API.
// - Reuses @setu/core (serializeMdoc, normalizeTags) via jiti — same pattern as gen-blocks.mjs
//   — so frontmatter is valid YAML and tags are canonicalized exactly like published content.
//
// Usage:
//   node scripts/seed-recipes.mjs              # seed .content-sandbox/recipes (cache-first)
//   node scripts/seed-recipes.mjs --refresh    # force refetch from TheMealDB
//   node scripts/seed-recipes.mjs <name>       # seed .content-sandbox/<name>
//   node scripts/seed-recipes.mjs --count=10000 <name>  # scale test (#465): cycle the meal
//                                              # set until N posts exist (repeat slugs get a
//                                              # numeric suffix). Omitted = one post per meal.
//
// Then view the widget against it:
//   SETU_CONTENT_DIR=$PWD/.content-sandbox/recipes/content pnpm --filter @setu/site build
//   (gen-relations + the site both honor SETU_CONTENT_DIR)

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  cpSync
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createJiti } from 'jiti'

import { isDirectInvocation } from './auth-login-link.mjs'
import { sandboxPath } from './content-sandbox.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const API = 'https://www.themealdb.com/api/json/v1/1/search.php?f='
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('')

/** CLI args → `{ refresh, name, count }`. Pure and exported so the argv shape is testable
 *  without running the seeder (which rewrites a sandbox's whole content tree). */
export function parseSeedArgs(argv) {
  const refresh = argv.includes('--refresh')
  const name = argv.find((a) => !a.startsWith('--')) ?? 'recipes'
  const countArg = argv.find((a) => a.startsWith('--count='))
  const count = countArg
    ? Number.parseInt(countArg.slice('--count='.length), 10)
    : null
  if (count !== null && (!Number.isFinite(count) || count < 1))
    throw new Error(`--count must be a positive integer, got ${countArg}`)
  return { refresh, name, count }
}

/** Sandbox paths for `name`, routed through content-sandbox.mjs's `sandboxPath` so the SAME name
 *  validation guards this script's `rmSync` as guards `content:reset` (#814): unvalidated, `name`
 *  = '..' made the rmSync below delete the canonical `content/` tree. Enforced by the shared
 *  refusal-case table in content-sandbox.test.mjs plus the routing test in seed-recipes.test.mjs. */
export function seedPaths(root, name) {
  const sandbox = sandboxPath(root, name)
  return {
    sandbox,
    cache: path.join(sandbox, '.cache', 'meals.json'),
    outDir: path.join(sandbox, 'content', 'post', 'en')
  }
}

// Reuse core's frontmatter serializer + tag normalizer (jiti imports the TS source).
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
const { serializeMdoc, normalizeTags } = await jiti.import('@setu/core')

// Very common ingredients carry no "relatedness" signal — drop them so the graph reflects
// cuisine + distinctive ingredients, not "everything shares salt".
const STOPLIST = new Set(
  normalizeTags([
    'salt',
    'water',
    'oil',
    'olive oil',
    'sugar',
    'butter',
    'garlic',
    'onion',
    'onions',
    'pepper',
    'black pepper',
    'flour',
    'plain flour',
    'egg',
    'eggs',
    'milk',
    'vegetable oil'
  ])
)

async function loadMeals({ refresh, cache }) {
  if (!refresh && existsSync(cache)) {
    const meals = JSON.parse(readFileSync(cache, 'utf8'))
    console.log(
      `seed-recipes: using cached ${meals.length} meals (${path.relative(ROOT, cache)})`
    )
    return meals
  }
  console.log('seed-recipes: fetching from TheMealDB (a–z)…')
  const byId = new Map()
  for (const letter of LETTERS) {
    const res = await fetch(API + letter)
    if (!res.ok) throw new Error(`fetch ${letter} failed: ${res.status}`)
    const { meals } = await res.json()
    for (const m of meals ?? []) if (!byId.has(m.idMeal)) byId.set(m.idMeal, m)
    process.stdout.write(`  ${letter}:${(meals ?? []).length} `)
  }
  const meals = [...byId.values()]
  console.log(`\nseed-recipes: fetched ${meals.length} unique meals`)
  mkdirSync(path.dirname(cache), { recursive: true })
  writeFileSync(cache, JSON.stringify(meals))
  return meals
}

const slugify = (s) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

function ingredientsOf(meal) {
  const out = []
  for (let i = 1; i <= 20; i++) {
    const ing = (meal[`strIngredient${i}`] ?? '').trim()
    const measure = (meal[`strMeasure${i}`] ?? '').trim()
    if (ing) out.push({ ing, measure })
  }
  return out
}

function toMdoc(meal) {
  const title = meal.strMeal
  const ingredients = ingredientsOf(meal)
  const area = (meal.strArea ?? '').trim()
  const rawTags = [
    area,
    ...(meal.strTags ?? '').split(','),
    ...ingredients.map((x) => x.ing)
  ].filter(Boolean)
  const tags = normalizeTags(rawTags).filter((t) => !STOPLIST.has(t))
  const categories = normalizeTags([meal.strCategory ?? ''].filter(Boolean))

  const frontmatter = { title, tags, categories }
  if (area) frontmatter.area = area
  if (meal.strMealThumb) {
    frontmatter.image = meal.strMealThumb
    // The recipe thumbnail doubles as the post's featured image (an external URL — the
    // render pipeline passes http(s) srcs through unchanged), so the hero + related/posts
    // card thumbnails all light up against real content.
    frontmatter.featuredImage = meal.strMealThumb
  }
  if (meal.strSource) frontmatter.source = meal.strSource

  const steps = (meal.strInstructions ?? '')
    .split(/\r?\n\r?\n|\r\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  const body = [
    // The thumbnail is the post's featured image (frontmatter), not an inline body image —
    // so the body stays clean and the image renders once, as the hero / card thumbnail.
    area && meal.strCategory ? `*${meal.strCategory} · ${area} cuisine*` : '',
    '## Ingredients',
    ingredients
      .map((x) => `- ${[x.measure, x.ing].filter(Boolean).join(' ')}`)
      .join('\n'),
    '## Instructions',
    ...steps
  ]
    .filter(Boolean)
    .join('\n\n')

  return { frontmatter, body }
}

async function main(argv) {
  const { refresh, name, count } = parseSeedArgs(argv)
  const { sandbox: SANDBOX, cache, outDir: OUT_DIR } = seedPaths(ROOT, name)
  const meals = await loadMeals({ refresh, cache })

  // Fresh content tree each run (cache is preserved).
  rmSync(path.join(SANDBOX, 'content'), { recursive: true, force: true })
  mkdirSync(OUT_DIR, { recursive: true })

  // The site's routes require the canonical baseline pages (home at '/', about) — carry the
  // repo's content/page/ tree over so the build's index.astro home entry exists.
  const pageSrc = path.join(ROOT, 'content', 'page')
  if (existsSync(pageSrc))
    cpSync(pageSrc, path.join(SANDBOX, 'content', 'page'), { recursive: true })

  const used = new Set()
  let written = 0
  const total = count ?? meals.length
  for (let i = 0; i < total; i++) {
    const meal = meals[i % meals.length]
    let slug = slugify(meal.strMeal) || `meal-${meal.idMeal}`
    if (used.has(slug)) slug = `${slug}-${meal.idMeal}`
    if (used.has(slug)) slug = `${slug}-${i}` // --count cycles the meal set; keep slugs unique
    used.add(slug)
    writeFileSync(
      path.join(OUT_DIR, `${slug}.mdoc`),
      serializeMdoc(toMdoc(meal))
    )
    written++
  }
  console.log(
    `seed-recipes: wrote ${written} .mdoc files to ${path.relative(ROOT, OUT_DIR)}`
  )
  console.log(`\nView the related-posts widget against this content:`)
  console.log(
    `  SETU_CONTENT_DIR=$PWD/.content-sandbox/${name}/content pnpm --filter @setu/site build`
  )
  console.log(
    `  SETU_CONTENT_DIR=$PWD/.content-sandbox/${name}/content pnpm --filter @setu/site preview`
  )
}

// Run only as a script, never on import: this module's main() wipes and rewrites a sandbox's
// content tree, so an ungated top-level call made any co-located unit test destructive (#814).
if (isDirectInvocation(process.argv[1], import.meta.url))
  await main(process.argv.slice(2))
