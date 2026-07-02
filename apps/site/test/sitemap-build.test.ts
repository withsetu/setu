import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const read = (f: string) => (existsSync(join(appDir, 'dist', f)) ? readFileSync(join(appDir, 'dist', f), 'utf8') : '')

let index = ''
let postmap = ''
let pagemap = ''
let robots = ''
let xslExists = false
beforeAll(() => {
  execSync('pnpm build', {
    cwd: appDir,
    stdio: 'inherit',
    env: { ...process.env, SETU_SITE_URL: 'https://example.com' },
  })
  index = read('sitemap.xml')
  postmap = read('post-sitemap.xml')
  pagemap = read('page-sitemap.xml')
  robots = read('robots.txt')
  xslExists = existsSync(join(appDir, 'dist', 'sitemap.xsl'))
})

describe('sitemap index (#225)', () => {
  it('/sitemap.xml is a styled sitemap index referencing the sub-sitemaps', () => {
    expect(index).toContain('<sitemapindex')
    expect(index).toContain('<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>')
    expect(index).toContain('<loc>https://example.com/post-sitemap.xml</loc>')
    expect(index).toContain('<loc>https://example.com/page-sitemap.xml</loc>')
  })
  it('ships the XSL stylesheet with the setu.build backlink', () => {
    expect(xslExists).toBe(true)
    const xsl = read('sitemap.xsl')
    expect(xsl).toContain('https://setu.build')
  })
})

describe('sub-sitemaps', () => {
  it('post-sitemap.xml lists published posts and excludes published:false', () => {
    expect(postmap).toContain('<urlset')
    expect(postmap).toMatch(/<loc>https:\/\/example\.com\/post\/astro-on-the-edge\/<\/loc>/)
    expect(postmap).not.toContain('/post/unpublished-demo/')
  })
  it('page-sitemap.xml has the homepage and excludes a seo.noindex page', () => {
    expect(pagemap).toContain('<loc>https://example.com/</loc>')
    // seo-override-demo.mdoc sets seo.noindex → must not be advertised
    expect(pagemap).not.toContain('/page/seo-override-demo/')
  })
})

describe('robots.txt (#226)', () => {
  it('references the sitemap index', () => {
    expect(robots).toContain('Sitemap: https://example.com/sitemap.xml')
  })
})
