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

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
const refresh = args.includes('--refresh')
const name = args.find((a) => !a.startsWith('--')) ?? 'recipes'

const SANDBOX = path.join(ROOT, '.content-sandbox', name)
const CACHE = path.join(SANDBOX, '.cache', 'meals.json')
const OUT_DIR = path.join(SANDBOX, 'content', 'post', 'en')
const API = 'https://www.themealdb.com/api/json/v1/1/search.php?f='
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('')

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

async function loadMeals() {
  if (!refresh && existsSync(CACHE)) {
    const meals = JSON.parse(readFileSync(CACHE, 'utf8'))
    console.log(
      `seed-recipes: using cached ${meals.length} meals (${path.relative(ROOT, CACHE)})`
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
  mkdirSync(path.dirname(CACHE), { recursive: true })
  writeFileSync(CACHE, JSON.stringify(meals))
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

async function main() {
  const meals = await loadMeals()

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
  for (const meal of meals) {
    let slug = slugify(meal.strMeal) || `meal-${meal.idMeal}`
    if (used.has(slug)) slug = `${slug}-${meal.idMeal}`
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

await main()
