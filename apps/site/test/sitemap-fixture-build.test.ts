import { execSync } from 'node:child_process'
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

// The sitemap's edge-of-contract cases (#1120) built for real against throwaway content roots —
// sitemap-build.test.ts only ever builds the seeded fixture (default homepage, ASCII slugs, every
// section on), which is exactly why these four defects shipped green. Two builds, sequential:
//   A. `reading.homepage: page/en/landing` with `seo.noindex`, an ordinary page/en/home, and a
//      post tagged `web dev` (a space — tags are never slugified).
//   B. every `reading.sitemap` section switched off, search engines still allowed.

const appDir = fileURLToPath(new URL('..', import.meta.url))
const SITE = 'https://example.com'
const distFile = (f: string) => join(appDir, 'dist', f)
const read = (f: string) =>
  existsSync(distFile(f)) ? readFileSync(distFile(f), 'utf8') : ''

function buildFixture(
  settings: Record<string, unknown>,
  files: Record<string, string>
): string {
  const root = mkdtempSync(join(tmpdir(), 'setu-sitemap-fixture-'))
  writeFileSync(join(root, 'settings.json'), JSON.stringify(settings))
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, 'content', rel)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, body)
  }
  // gen-relations/gen-redirects (prebuild) read the same content dir — same env for both.
  execSync('pnpm build', {
    cwd: appDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      SETU_SITE_URL: SITE,
      SETU_CONTENT_DIR: join(root, 'content')
    }
  })
  return root
}

const roots: string[] = []
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

describe('A: non-default noindex homepage + spaced tag', () => {
  let pagemap = ''
  let tagmap = ''
  let postHtml = ''
  let tagHtml = ''
  let rootHtml = ''
  beforeAll(() => {
    roots.push(
      buildFixture(
        { reading: { homepage: 'page/en/landing' } },
        {
          'page/en/landing.mdoc':
            '---\ntitle: Landing\nseo:\n  noindex: true\n---\n\nLanding body.\n',
          'page/en/home.mdoc': '---\ntitle: Home\n---\n\nHome body.\n',
          'post/en/tagged.mdoc':
            "---\ntitle: Tagged\ndate: 2026-06-20\ntags: ['web dev']\n---\n\nBody.\n"
        }
      )
    )
    pagemap = read('page-sitemap.xml')
    tagmap = read('tag-sitemap.xml')
    postHtml = read('post/tagged/index.html')
    tagHtml = read('tag/web dev/index.html')
    rootHtml = read('index.html')
  }, 180_000)

  it('the root serves the configured homepage and is noindex…', () => {
    expect(rootHtml).toContain('Landing body.')
    expect(rootHtml).toMatch(/<meta name="robots" content="noindex/)
  })
  it('…so page-sitemap.xml does not advertise the root', () => {
    expect(pagemap).toContain('<urlset')
    expect(pagemap).not.toContain(`<loc>${SITE}/</loc>`)
  })
  it('page/en/home is an ordinary page here: built at /page/home/ AND listed', () => {
    expect(read('page/home/index.html')).toContain('Home body.')
    expect(pagemap).toContain(`<loc>${SITE}/page/home/</loc>`)
  })
  it('a spaced tag: sitemap <loc> == archive canonical == post chip href, all %20-encoded', () => {
    const loc = `${SITE}/tag/web%20dev/`
    expect(tagmap).toContain(`<loc>${loc}</loc>`)
    expect(tagmap).not.toContain('web dev')
    expect(tagHtml).toContain(`<link rel="canonical" href="${loc}"`)
    expect(postHtml).toContain('href="/tag/web%20dev/"')
  })
})

describe('B: every sitemap section disabled', () => {
  beforeAll(() => {
    roots.push(
      buildFixture(
        {
          reading: {
            searchEngineVisible: true,
            sitemap: {
              posts: false,
              pages: false,
              categories: false,
              tags: false
            }
          }
        },
        {
          'page/en/home.mdoc': '---\ntitle: Home\n---\n\nHome body.\n',
          'post/en/a.mdoc':
            "---\ntitle: A\ndate: 2026-06-20\ntags: ['x']\n---\n\nBody.\n"
        }
      )
    )
  }, 180_000)

  it('emits no sitemap.xml (no schema-invalid empty <sitemapindex>), like the leaf routes', () => {
    expect(existsSync(distFile('sitemap.xml'))).toBe(false)
    expect(existsSync(distFile('page-sitemap.xml'))).toBe(false)
    expect(existsSync(distFile('post-sitemap-1.xml'))).toBe(false)
  })
  it('robots.txt allows crawling but does not advertise a sitemap that does not exist', () => {
    const robots = read('robots.txt')
    expect(robots).toContain('Allow: /')
    expect(robots).not.toContain('Sitemap:')
  })
})
