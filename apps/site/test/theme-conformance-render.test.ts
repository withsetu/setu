import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CONTRACT_REF, discoverWorkspaceThemes } from './lib/theme-conformance'

// Theme conformance, render half (#1297, epic #342): build the site through EVERY workspace theme
// (discovered, not listed — see ./lib/theme-conformance.ts) against one fixed fixture site, and
// check each standard page renders what the site handed the theme. The static half is
// theme-conformance.test.ts.
//
// Each theme builds into its own temp outDir, so this suite never disturbs the shared dist/ the
// other suites read. SETU_TEST_THEME selects the theme for one build (apps/site/astro.config.mjs).

const appDir = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const SITE = 'https://example.com'
const themes = discoverWorkspaceThemes(repoRoot)

/** The fixture site: one of each standard page, plus a named category so the chip's label comes
 *  from taxonomy/categories.yaml rather than the slug. */
const FIXTURE: Record<string, string> = {
  'content/page/en/home.mdoc':
    '---\ntitle: Home\n---\n\nConformance home body.\n',
  'content/page/en/about.mdoc':
    '---\ntitle: About Conformance\n---\n\nConformance page body.\n',
  'content/post/en/hello.mdoc':
    "---\ntitle: Hello Conformance\ndate: 2026-06-20\ncategories: ['news']\ntags: ['conformance']\n---\n\nConformance post body.\n",
  'taxonomy/categories.yaml': '- slug: news\n  name: Newsroom\n  parent: null\n'
}

/** Astro caches the content layer with ABSOLUTE entry paths (`.astro/content-modules.mjs`,
 *  `node_modules/.astro/data-store.json`). Built against a temp content dir, that cache outlives
 *  the dir and breaks the next build or dev server (the same hazard content-watch-dev.test.ts
 *  documents), so it is cleared before each build and after the suite. Astro regenerates it. */
const clearContentCache = () => {
  rmSync(join(appDir, '.astro'), { recursive: true, force: true })
  rmSync(join(appDir, 'node_modules', '.astro'), {
    recursive: true,
    force: true
  })
}

const roots: string[] = []
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
  clearContentCache()
})

function buildThrough(theme: string): string {
  const root = mkdtempSync(join(tmpdir(), 'setu-theme-render-'))
  roots.push(root)
  for (const [rel, body] of Object.entries(FIXTURE)) {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), body)
  }
  const outDir = join(root, 'dist')
  clearContentCache()
  const run = spawnSync('pnpm', ['build', '--outDir', outDir], {
    cwd: appDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      SETU_SITE_URL: SITE,
      SETU_CONTENT_DIR: join(root, 'content'),
      // Same seam as #1294's render-smoke: honoured only when VITEST is set, which it is here.
      SETU_TEST_THEME: theme
    }
  })
  if (run.status !== 0)
    throw new Error(
      `[${theme}] the site does not build through this theme. A workspace theme must be a ` +
        `dependency of apps/site to be built. ${CONTRACT_REF}\n` +
        `--- last build output ---\n${`${run.stdout}\n${run.stderr}`.split('\n').slice(-40).join('\n')}`
    )
  return outDir
}

describe.each(themes)('the standard pages render through $name', ({ name }) => {
  let outDir = ''
  const page = (rel: string): string => {
    const file = join(outDir, rel, 'index.html')
    if (!existsSync(file))
      throw new Error(
        `[${name}] the build emitted no ${rel || '/'} page. ${CONTRACT_REF}`
      )
    return readFileSync(file, 'utf8')
  }

  beforeAll(() => {
    outDir = buildThrough(name)
  }, 240_000)

  it('page: PageLayout renders the content, the page title, the locale and the SEO head', () => {
    const html = page('page/about')
    expect(html, 'PageLayout must render its slot').toContain(
      'Conformance page body.'
    )
    expect(html, 'PageLayout must set <html lang> from `lang`').toMatch(
      /<html[^>]* lang="en"/
    )
    expect(html, '`seo.title` must reach <title>').toMatch(
      /<title>[^<]*About Conformance[^<]*<\/title>/
    )
    expect(html, '`seo.canonical` must reach <link rel="canonical">').toContain(
      `<link rel="canonical" href="${SITE}/page/about/">`
    )
  })

  it('every standard page carries the theme-options override Setu writes (#1294)', () => {
    for (const rel of [
      '',
      'page/about',
      'post/hello',
      'posts',
      'tag/conformance'
    ])
      expect(page(rel), `${rel || '/'} has no :root:root override`).toContain(
        ':root:root {'
      )
  })

  it('homepage: PageLayout renders the configured homepage entry', () => {
    expect(page('')).toContain('Conformance home body.')
  })

  it('post: PostLayout renders the content, and TaxonomyChips links each category and tag to its archive', () => {
    const html = page('post/hello')
    expect(html, 'PostLayout must render its slot').toContain(
      'Conformance post body.'
    )
    expect(html, 'TaxonomyChips must link each category, by name').toMatch(
      /<a[^>]+href="\/category\/news\/"[^>]*>\s*Newsroom\s*<\/a>/
    )
    expect(html, 'TaxonomyChips must link each tag').toMatch(
      /<a[^>]+href="\/tag\/conformance\/"/
    )
  })

  it('archive: ArchiveList renders the heading and links every post on the page', () => {
    const html = page('posts')
    expect(html).toContain('Posts')
    expect(html, 'ArchiveList must link each post to its URL').toMatch(
      /<a[^>]+href="\/post\/hello\/"[^>]*>\s*Hello Conformance\s*<\/a>/
    )
  })

  it('taxonomy: the tag and category archives render through ArchiveList', () => {
    const tag = page('tag/conformance')
    expect(tag).toContain('Tag: conformance')
    expect(tag).toMatch(/<a[^>]+href="\/post\/hello\/"/)
    const category = page('category/news')
    expect(category).toContain('Category: Newsroom')
    expect(category).toMatch(/<a[^>]+href="\/post\/hello\/"/)
  })

  // apps/site has no 404 route today, so no theme component renders one and there is nothing to
  // check. Follow-up: #1304.
  it.todo('404: the not-found page renders through the theme')
})
