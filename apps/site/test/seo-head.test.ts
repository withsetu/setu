import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const page = (route: string): string => readFileSync(join(appDir, 'dist', route, 'index.html'), 'utf8')
const head = (html: string): string => html.slice(0, html.indexOf('</head>'))

let post = ''
let home = ''
let override = ''
beforeAll(() => {
  // A fixed site URL makes canonical / og:url deterministic.
  execSync('pnpm build', {
    cwd: appDir,
    stdio: 'inherit',
    env: { ...process.env, SETU_SITE_URL: 'https://example.com' },
  })
  post = head(page('post/astro-on-the-edge'))
  home = head(page(''))
  override = head(page('page/seo-override-demo'))
})

describe('SEO head emitters (#71)', () => {
  it('emits an absolute canonical + og:url for a post (mirrors the served trailing-slash URL)', () => {
    expect(post).toContain('<link rel="canonical" href="https://example.com/post/astro-on-the-edge/">')
    expect(post).toMatch(/<meta property="og:url" content="https:\/\/example\.com\/post\/astro-on-the-edge\/">/)
  })
  it('marks a post as og:type article (pages/home are website)', () => {
    expect(post).toMatch(/<meta property="og:type" content="article">/)
    expect(home).toMatch(/<meta property="og:type" content="website">/)
  })
  it('emits the generator + robots directives', () => {
    expect(post).toMatch(/<meta name="generator" content="https:\/\/setu\.build\/\?v=[^"]+">/)
    expect(post).toMatch(/<meta name="robots" content="index, follow">/)
  })
  it('emits og + twitter card tags', () => {
    expect(post).toMatch(/<meta property="og:title" content="[^"]+">/)
    expect(post).toMatch(/<meta property="og:site_name" content="[^"]+">/)
    expect(post).toMatch(/<meta name="twitter:card" content="(summary|summary_large_image)">/)
    expect(post).toMatch(/<meta name="twitter:title" content="[^"]+">/)
  })
  it('homepage title is the bare site name (no "· ") and canonical is the root', () => {
    expect(home).toContain('<link rel="canonical" href="https://example.com/">')
    const title = home.match(/<title>([^<]*)<\/title>/)?.[1] ?? ''
    expect(title).not.toContain('·')
  })
  it('per-page seo: overrides win — title, description, noindex, canonical (#73)', () => {
    expect(override).toMatch(/<title>Custom SEO Title[^<]*<\/title>/)
    expect(override).toMatch(/<meta property="og:title" content="Custom SEO Title[^"]*">/)
    expect(override).toContain('<meta name="description" content="A hand-written meta description for search.">')
    // noindex override applies even though the site is search-visible
    expect(override).toMatch(/<meta name="robots" content="noindex, nofollow">/)
    // canonical override replaces the derived URL
    expect(override).toContain('<link rel="canonical" href="https://example.com/canonical-target">')
  })
  it('still ships zero JS from the head changes', () => {
    expect(post).not.toMatch(/<script[\s>]/)
  })
})
