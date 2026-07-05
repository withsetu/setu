import { execSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const appDir = fileURLToPath(new URL('..', import.meta.url))

// Fixture content root: root/content/<collection>/<locale>/<slug>.mdoc + root/settings.json,
// same layout as site-settings.test.ts / theme-options-source.test.ts, but built for real
// (astro build) rather than unit-loaded — this is the end-to-end proof for the whole chain:
// settings-driven per-collection patterns -> collision-aware map -> routes/feed/archives.
let root: string

function write(relPath: string, contents: string): void {
  const full = join(root, 'content', relPath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, contents)
}

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
  root = mkdtempSync(join(tmpdir(), 'setu-permalinks-build-'))

  writeFileSync(
    join(root, 'settings.json'),
    JSON.stringify({
      permalinks: {
        patterns: { post: 'blog/:year/:slug', page: ':slug' },
        uncategorized: 'misc'
      },
      // rss.xml.ts 404s unless reading.feed.enabled — default is false, so this fixture opts in
      // to exercise the rss <-> route agreement assertion.
      reading: { feed: { enabled: true } }
    })
  )

  // post/en/hello-world: dated -> exercises the :year/:slug pattern.
  write(
    'post/en/hello-world.mdoc',
    '---\ntitle: Hello World\ndate: 2026-06-20\ncategories: [recipes]\n---\n\nHello world body.\n'
  )
  // post/en/no-date: no date -> pattern has date tokens, so the resolver falls back to bare :slug.
  write(
    'post/en/no-date.mdoc',
    '---\ntitle: No Date\n---\n\nA post with no date.\n'
  )
  // post/en/about + page/en/about: both date-less, both resolve to "about" under their patterns
  // (post falls back to :slug on no date; page's own pattern is bare :slug) -> collision. The
  // id tiebreak (page/en/about < post/en/about, alphabetically) gives the page the clean URL.
  write(
    'post/en/about.mdoc',
    '---\ntitle: About (post)\n---\n\nPost about body.\n'
  )
  write(
    'page/en/about.mdoc',
    '---\ntitle: About (page)\n---\n\nPage about body.\n'
  )

  // gen-relations runs in prebuild and reads the same content dir — must see the same env.
  const env = { ...process.env, SETU_CONTENT_DIR: join(root, 'content') }
  execSync('pnpm build', { cwd: appDir, stdio: 'inherit', env })
}, 180_000)

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('permalink patterns: real astro build', () => {
  it('post lands at its date-patterned URL', () => {
    expect(exists('blog/2026/hello-world')).toBe(true)
  })

  it('date-less post falls back to bare :slug', () => {
    expect(exists('no-date')).toBe(true)
  })

  it('collision resolves deterministically: page keeps the clean URL (id tiebreak), post gets -2', () => {
    expect(exists('about')).toBe(true)
    expect(page('about')).toContain('About (page)')
    expect(exists('about-2')).toBe(true)
    expect(page('about-2')).toContain('About (post)')
  })

  it('rss links agree with the served route', () => {
    const xml = readFileSync(join(appDir, 'dist', 'rss.xml'), 'utf8')
    expect(xml).toContain('/blog/2026/hello-world')
  })

  it('archive card hrefs agree', () => {
    expect(page('posts')).toContain('href="/blog/2026/hello-world"')
  })

  it('legacy default URLs are gone', () => {
    expect(exists('post/hello-world')).toBe(false)
  })
})
