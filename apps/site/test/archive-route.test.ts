import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const page = (route: string): string =>
  readFileSync(join(appDir, 'dist', route, 'index.html'), 'utf8')

let p1 = ''
let p2 = ''
beforeAll(() => {
  // 2 posts/page forces the 3 en-locale fixtures into two pages so we can exercise paging.
  execSync('pnpm build', {
    cwd: appDir,
    stdio: 'inherit',
    env: { ...process.env, SETU_ARCHIVE_PER_PAGE: '2' }
  })
  p1 = page('posts')
  p2 = page('posts/2')
})

describe('static archive route', () => {
  it('page 1 lives at /posts and lists the first page of posts', () => {
    expect(p1).toContain('setu-posts--grid')
    expect(p1).toContain('>Astro on the Edge<')
    expect(p1).toContain('>Featured Demo<')
    // page size is 2 → the third post is NOT on page 1
    expect(p1).not.toContain('>Kitchen Sink<')
  })

  it('page 2 lives at /posts/2 with the remaining posts', () => {
    expect(p2).toContain('>Kitchen Sink<')
    expect(p2).not.toContain('>Astro on the Edge<')
  })

  it('renders a numbered pager wired across pages', () => {
    // page 1: a Next link, current page = 1
    expect(p1).toMatch(/rel="next"/)
    expect(p1).toMatch(/aria-current="page"[^>]*>\s*1\s*</)
    // page 2: a Prev link, current page = 2
    expect(p2).toMatch(/rel="prev"/)
    expect(p2).toMatch(/aria-current="page"[^>]*>\s*2\s*</)
  })

  it('emits head <link rel=next/prev> across paginated pages (#74)', () => {
    // page 1 (first): a rel=next head link → page 2, and NO rel=prev
    expect(p1).toMatch(/<link rel="next" href="[^"]*\/posts\/2\/?"/)
    expect(p1).not.toMatch(/<link rel="prev"/)
    // page 2 (last): a rel=prev head link → the base, and NO rel=next
    expect(p2).toMatch(/<link rel="prev" href="[^"]*\/posts\/?"/)
    expect(p2).not.toMatch(/<link rel="next"/)
  })

  it('excludes other-locale posts (fr Bonjour) from the archive', () => {
    expect(p1).not.toContain('Bonjour')
    expect(p2).not.toContain('Bonjour')
  })

  it('excludes posts marked published:false (#128)', () => {
    expect(p1).not.toContain('Unpublished Demo')
    expect(p2).not.toContain('Unpublished Demo')
  })

  it('ships zero JS', () => {
    expect(p1).not.toContain('astro-island')
    expect(p1).not.toMatch(/<script(?![^>]*type="application\/ld\+json")[\s>]/)
  })
})
