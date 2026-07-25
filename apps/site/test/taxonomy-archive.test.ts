import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
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
    expect(tagmap).toContain(`<loc>http://localhost:4321${chipHref}</loc>`)
  })
})
