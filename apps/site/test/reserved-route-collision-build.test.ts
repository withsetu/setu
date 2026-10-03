import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const appDir = fileURLToPath(new URL('..', import.meta.url))

// #1122: under the one-click "Post name" preset (`:slug`), a page named `posts` resolves to
// `/posts` — the archive route's own output. Astro would silently let one overwrite the other,
// so the build must refuse, naming the entry, its permalink and the route it collides with.
let root: string
let result: { status: number | null; output: string }

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'setu-reserved-route-'))
  const content = join(root, 'content')
  const write = (rel: string, body: string): void => {
    const full = join(content, rel)
    mkdirSync(join(full, '..'), { recursive: true })
    // Per-run frontmatter key: Astro's glob loader reuses a digest-identical cached entry
    // without re-checking its (deleted temp) path — see entry-id-parity.test.ts.
    writeFileSync(
      full,
      body.replace(/^---\n/, `---\nfixtureRun: ${basename(root)}\n`)
    )
  }
  writeFileSync(
    join(root, 'settings.json'),
    JSON.stringify({ permalinks: { patterns: { page: ':slug' } } })
  )
  write('page/en/home.mdoc', '---\ntitle: Home\n---\n\nHome.\n')
  write('page/en/posts.mdoc', '---\ntitle: My Posts Page\n---\n\nPosts page.\n')
  // An unpublished entry gets no route, so it must NOT fail the build.
  write(
    'page/en/rss.xml.mdoc',
    '---\ntitle: Draft\npublished: false\n---\n\nDraft.\n'
  )
  const run = spawnSync('pnpm', ['build'], {
    cwd: appDir,
    env: { ...process.env, SETU_CONTENT_DIR: content },
    encoding: 'utf8'
  })
  result = { status: run.status, output: `${run.stdout}\n${run.stderr}` }
}, 180_000)

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('a permalink that collides with a site route fails the build', () => {
  it('exits non-zero', () => {
    expect(result.status).not.toBe(0)
  })

  it('names the entry, its permalink and the route it collides with', () => {
    expect(result.output).toContain(
      `entry "page/en/posts" resolves to "/posts", which is the site's own route "/posts/[...page]"`
    )
  })

  it('does not report an unpublished entry (it gets no route)', () => {
    expect(result.output).not.toContain('page/en/rss.xml')
  })
})
