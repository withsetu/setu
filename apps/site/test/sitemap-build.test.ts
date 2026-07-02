import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const dist = (f: string) => join(appDir, 'dist', f)

let sitemap = ''
let robots = ''
beforeAll(() => {
  execSync('pnpm build', {
    cwd: appDir,
    stdio: 'inherit',
    env: { ...process.env, SETU_SITE_URL: 'https://example.com' },
  })
  sitemap = existsSync(dist('sitemap.xml')) ? readFileSync(dist('sitemap.xml'), 'utf8') : ''
  robots = existsSync(dist('robots.txt')) ? readFileSync(dist('robots.txt'), 'utf8') : ''
})

describe('sitemap.xml (#225)', () => {
  it('is served, valid, and lists absolute published URLs', () => {
    expect(sitemap).toContain('<urlset')
    expect(sitemap).toContain('<loc>https://example.com/</loc>')
    expect(sitemap).toMatch(/<loc>https:\/\/example\.com\/post\/astro-on-the-edge\/<\/loc>/)
  })
  it('excludes published:false entries', () => {
    // unpublished-demo.mdoc has published:false
    expect(sitemap).not.toContain('/post/unpublished-demo/')
  })
})

describe('robots.txt (#226)', () => {
  it('is served and references the sitemap', () => {
    expect(robots).toContain('User-agent: *')
    expect(robots).toContain('Sitemap: https://example.com/sitemap.xml')
  })
})
