import { execSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const page = (route: string): string =>
  readFileSync(join(appDir, 'dist', route, 'index.html'), 'utf8')
const exists = (route: string): boolean => {
  try {
    page(route)
    return true
  } catch {
    return false
  }
}

beforeAll(() => {
  // 2 posts/page forces the 3 recipes posts onto two category pages.
  execSync('pnpm build', {
    cwd: appDir,
    stdio: 'inherit',
    env: { ...process.env, SETU_ARCHIVE_PER_PAGE: '2' }
  })
}, 180_000)

describe('category archive', () => {
  it('page 1 at /category/recipes shows the human name + first page of posts', () => {
    const p = page('category/recipes')
    expect(p).toContain('Category: Recipes')
    expect(p).toContain('setu-posts--grid')
    expect(p).toContain('>Astro on the Edge<')
    expect(p).toContain('>Featured Demo<')
    expect(p).not.toContain('>Kitchen Sink<') // pushed to page 2 by pageSize 2
  })
  it('paginates to /category/recipes/2 with the remaining post', () => {
    const p = page('category/recipes/2')
    expect(p).toContain('>Kitchen Sink<')
    expect(p).toMatch(/rel="prev"/)
  })
  it('excludes published:false posts from the archive (drafts do not leak)', () => {
    // unpublished-demo.mdoc has `categories: [recipes]` + `published: false`; it must never appear
    // on the category archive, on any page — consistent with /posts hiding it.
    expect(page('category/recipes')).not.toContain('>Unpublished Demo<')
    expect(page('category/recipes/2')).not.toContain('>Unpublished Demo<')
  })
  it('does not generate a page for an unknown category', () => {
    expect(exists('category/nope')).toBe(false)
  })
  it('ships zero JS', () => {
    const p = page('category/recipes')
    expect(p).not.toContain('astro-island')
    expect(p).not.toMatch(/<script(?![^>]*type="application\/ld\+json")[\s>]/)
  })
})

describe('tag archive', () => {
  it('/tag/astro lists posts tagged astro with the tag heading', () => {
    const p = page('tag/astro')
    expect(p).toContain('Tag: astro')
    expect(p).toContain('>Kitchen Sink<')
    expect(p).toContain('>Astro on the Edge<')
  })
  it('does not generate a page for an unknown tag', () => {
    expect(exists('tag/nope')).toBe(false)
  })
  it('ships zero JS (JSON-LD aside)', () => {
    const p = page('tag/astro')
    expect(p).not.toContain('astro-island')
    expect(p).not.toMatch(/<script(?![^>]*type="application\/ld\+json")[\s>]/)
  })
})

describe('post page taxonomy chips (#860 BLOCK-4)', () => {
  it('links a post to its category (by name) and tag archives, trailing-slash form', () => {
    const p = page('post/kitchen-sink')
    // Trailing slash matches the directory-format served route (was `/category/recipes` — a
    // needless redirect hop) and agrees with the sitemap <loc> spelling.
    expect(p).toMatch(/href="\/category\/recipes\/"[^>]*>\s*Recipes\s*</)
    expect(p).toContain('href="/tag/astro/"')
    expect(p).toContain('href="/tag/cms/"')
  })

  it('chip href == generated route path == sitemap loc (three-way agreement)', () => {
    // The chip advertises `/tag/astro/`; the route actually builds that directory; the sitemap
    // lists the same path. One spelling everywhere — the whole point of #860.
    const chipHref = '/tag/astro/'
    expect(page('post/kitchen-sink')).toContain(`href="${chipHref}"`)
    expect(exists('tag/astro')).toBe(true) // dist/tag/astro/index.html — the served route
    const tagmap = readFileSync(join(appDir, 'dist', 'tag-sitemap.xml'), 'utf8')
    expect(tagmap).toContain(`<loc>https://example.com${chipHref}</loc>`)
  })
})

// #1114: per-locale taxonomy archives. Fixture: content/post/fr/bonjour.mdoc carries the fr-only tag
// `voyage`; content/post/fr/kitchen-sink.mdoc is the fr translation carrying recipes/astro/cms.
describe('per-locale taxonomy archives (#1114)', () => {
  it('a fr-only tag emits /fr/tag/<slug>/ listing the fr post — and no unprefixed archive', () => {
    const p = page('fr/tag/voyage')
    expect(p).toContain('Tag: voyage')
    expect(p).toContain('>Bonjour<')
    expect(p).toContain('href="/fr/post/bonjour/"')
    expect(p).toMatch(/<html[^>]*lang="fr"/)
    expect(p).toContain(
      '<link rel="canonical" href="https://example.com/fr/tag/voyage/"'
    )
    // Single-locale term → no hreflang cluster.
    expect(p).not.toContain('hreflang=')
    expect(exists('tag/voyage')).toBe(false)
  })

  it('a localized archive lists only that locale’s posts', () => {
    const fr = page('fr/category/recipes')
    expect(fr).toContain('Category: Recipes')
    expect(fr).toContain('>Évier de Cuisine<')
    expect(fr).not.toContain('>Astro on the Edge<')
    expect(fr).not.toContain('>Featured Demo<')
    // and the default-locale archive still lists no fr post (unchanged behaviour)
    expect(page('category/recipes')).not.toContain('Évier de Cuisine')
    expect(page('category/recipes/2')).not.toContain('Évier de Cuisine')
  })

  it('hreflang pairs the locale variants of the same term where both exist', () => {
    for (const route of ['tag/astro', 'fr/tag/astro']) {
      const p = page(route)
      expect(p).toContain('hreflang="en" href="https://example.com/tag/astro/"')
      expect(p).toContain(
        'hreflang="fr" href="https://example.com/fr/tag/astro/"'
      )
      expect(p).toContain(
        'hreflang="x-default" href="https://example.com/tag/astro/"'
      )
    }
    // page 2 of a paginated archive is not a translation of anything
    expect(page('category/recipes/2')).not.toContain('hreflang=')
  })

  it('chips on a fr post link to the fr archives', () => {
    const p = page('fr/post/kitchen-sink')
    expect(p).toMatch(/href="\/fr\/category\/recipes\/"[^>]*>\s*Recipes\s*</)
    expect(p).toContain('href="/fr/tag/astro/"')
    expect(p).toContain('href="/fr/tag/cms/"')
    expect(p).not.toContain('href="/tag/astro/"')
    expect(page('fr/post/bonjour')).toContain('href="/fr/tag/voyage/"')
  })

  it('the tag/category sitemaps list the per-locale archive URLs', () => {
    const tags = readFileSync(join(appDir, 'dist', 'tag-sitemap.xml'), 'utf8')
    expect(tags).toContain('<loc>https://example.com/fr/tag/voyage/</loc>')
    expect(tags).toContain('<loc>https://example.com/fr/tag/astro/</loc>')
    expect(tags).toContain('<loc>https://example.com/tag/astro/</loc>')
    expect(tags).not.toContain('<loc>https://example.com/tag/voyage/</loc>')
    const cats = readFileSync(
      join(appDir, 'dist', 'category-sitemap.xml'),
      'utf8'
    )
    expect(cats).toContain(
      '<loc>https://example.com/fr/category/recipes/</loc>'
    )
  })

  it('every taxonomy chip href in the built site resolves to an emitted archive (durable guard)', () => {
    // Walk every built HTML page, collect each chip href, and require dist/<href>/index.html. This
    // is the guard that would have caught #1114 for ANY locale, term or future chip placement.
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
        d.isDirectory()
          ? walk(join(dir, d.name))
          : d.name.endsWith('.html')
            ? [join(dir, d.name)]
            : []
      )
    const hrefs = new Set<string>()
    for (const file of walk(join(appDir, 'dist'))) {
      const html = readFileSync(file, 'utf8')
      for (const m of html.matchAll(
        /<a[^>]*class="setu-chip[^"]*"[^>]*href="([^"]+)"|<a[^>]*href="([^"]+)"[^>]*class="setu-chip/g
      ))
        hrefs.add(m[1] ?? m[2])
    }
    expect(hrefs.size).toBeGreaterThan(0)
    expect(hrefs).toContain('/fr/tag/voyage/')
    const missing = [...hrefs].filter(
      (h) => !exists(decodeURI(h).replace(/^\/|\/$/g, ''))
    )
    expect(missing).toEqual([])
  })
})
