import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const read = (f: string) =>
  existsSync(join(appDir, 'dist', f))
    ? readFileSync(join(appDir, 'dist', f), 'utf8')
    : ''

let index = ''
let postmap = ''
let pagemap = ''
let robots = ''
let xslExists = false
beforeAll(() => {
  execSync('pnpm build', {
    cwd: appDir,
    stdio: 'inherit',
    env: { ...process.env, SETU_SITE_URL: 'https://example.com' }
  })
  index = read('sitemap.xml')
  // The post sitemap now shards at the 50k cap (#859); the first (only, here) shard is -1.
  postmap = read('post-sitemap-1.xml')
  pagemap = read('page-sitemap.xml')
  robots = read('robots.txt')
  xslExists = existsSync(join(appDir, 'dist', 'sitemap.xsl'))
})

describe('sitemap index (#225)', () => {
  it('/sitemap.xml is a styled sitemap index referencing the sub-sitemaps', () => {
    expect(index).toContain('<sitemapindex')
    expect(index).toContain(
      '<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>'
    )
    // Post section is sharded (#859): the index lists post-sitemap-1.xml, not the old single file.
    expect(index).toContain('<loc>https://example.com/post-sitemap-1.xml</loc>')
    expect(index).not.toContain('/post-sitemap.xml<')
    expect(index).toContain('<loc>https://example.com/page-sitemap.xml</loc>')
  })
  it('ships the XSL stylesheet with the setu.build backlink', () => {
    expect(xslExists).toBe(true)
    const xsl = read('sitemap.xsl')
    expect(xsl).toContain('https://setu.build')
  })
})

describe('sub-sitemaps', () => {
  it('post-sitemap-1.xml lists published posts and excludes published:false', () => {
    expect(postmap).toContain('<urlset')
    expect(postmap).toMatch(
      /<loc>https:\/\/example\.com\/post\/astro-on-the-edge\/<\/loc>/
    )
    expect(postmap).not.toContain('/post/unpublished-demo/')
  })
  it('emits <image:image> entries for posts with a featured image (#321)', () => {
    // featured-demo.mdoc has featuredImage: /media/2026/06/test-cat.jpg
    expect(postmap).toContain(
      'xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"'
    )
    expect(postmap).toMatch(
      /<image:loc>[^<]*\/media\/2026\/06\/test-cat\.jpg<\/image:loc>/
    )
  })
  it('page-sitemap.xml has the homepage and excludes a seo.noindex page', () => {
    expect(pagemap).toContain('<loc>https://example.com/</loc>')
    // seo-override-demo.mdoc sets seo.noindex → must not be advertised
    expect(pagemap).not.toContain('/page/seo-override-demo/')
  })
  it('emits <video:video> entries for pages with a video embed (#367)', () => {
    // embed-demo.mdoc has a {% embed mediaType="video" %} (YouTube)
    expect(pagemap).toContain(
      'xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"'
    )
    expect(pagemap).toContain('<video:video>')
    expect(pagemap).toMatch(
      /<video:player_loc>https:\/\/www\.youtube\.com\/embed\/[^<]*<\/video:player_loc>/
    )
    expect(pagemap).toMatch(/<video:thumbnail_loc>[^<]+<\/video:thumbnail_loc>/)
  })
})

describe('robots.txt (#226)', () => {
  it('references the sitemap index', () => {
    expect(robots).toContain('Sitemap: https://example.com/sitemap.xml')
  })
})
