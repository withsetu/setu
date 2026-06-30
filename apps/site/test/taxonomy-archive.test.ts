import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const page = (route: string): string => readFileSync(join(appDir, 'dist', route, 'index.html'), 'utf8')
const exists = (route: string): boolean => {
  try { page(route); return true } catch { return false }
}

beforeAll(() => {
  // 2 posts/page forces the 3 recipes posts onto two category pages.
  execSync('pnpm build', { cwd: appDir, stdio: 'inherit', env: { ...process.env, SETU_ARCHIVE_PER_PAGE: '2' } })
}, 180_000)

describe('category archive', () => {
  it('page 1 at /category/recipes shows the human name + first page of posts', () => {
    const p = page('category/recipes')
    expect(p).toContain('Category: Recipes')
    expect(p).toContain('setu-posts--grid')
    expect(p).toContain('>Kitchen Sink<')
    expect(p).toContain('>Featured Demo<')
    expect(p).not.toContain('>Astro on the Edge<') // pushed to page 2 by pageSize 2
  })
  it('paginates to /category/recipes/2 with the remaining post', () => {
    const p = page('category/recipes/2')
    expect(p).toContain('>Astro on the Edge<')
    expect(p).toMatch(/rel="prev"/)
  })
  it('does not generate a page for an unknown category', () => {
    expect(exists('category/nope')).toBe(false)
  })
  it('ships zero JS', () => {
    const p = page('category/recipes')
    expect(p).not.toContain('astro-island')
    expect(p).not.toMatch(/<script[\s>]/)
  })
})
