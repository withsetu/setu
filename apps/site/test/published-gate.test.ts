import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const dist = join(appDir, 'dist')

// Every emitted HTML file under dist, relative paths.
function htmlFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...htmlFiles(p))
    else if (name.endsWith('.html')) out.push(p)
  }
  return out
}

beforeAll(() => {
  execSync('pnpm build', {
    cwd: appDir,
    stdio: 'inherit',
    env: { ...process.env, SETU_SITE_URL: 'https://example.com' }
  })
})

// #165: committed-but-unpublished (`published: false`) is Setu's only "hidden" signal.
// The block/archive/feed/sitemap surfaces already filter it; this suite pins the one
// surface that leaked — the entry's OWN page route. A draft must not get a rendered
// permalink at all, on any collection, and its content must not appear in any built page.
describe('published:false gate — entry page routes (#165)', () => {
  it('emits no route for the published:false fixture (direct-URL draft leak)', () => {
    expect(existsSync(join(dist, 'post', 'unpublished-demo'))).toBe(false)
  })

  it('no built HTML carries the draft title anywhere', () => {
    const leaks = htmlFiles(dist).filter((f) =>
      readFileSync(f, 'utf8').includes('Unpublished Demo')
    )
    expect(leaks).toEqual([])
  })

  it('still emits published entries (no over-filtering)', () => {
    expect(existsSync(join(dist, 'post', 'kitchen-sink', 'index.html'))).toBe(
      true
    )
  })
})
