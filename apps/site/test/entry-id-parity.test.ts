import { execSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// The codegen scan under test: the same module `prebuild` runs to key relations.json and
// url-map.json. Imported directly so its id → URL map can be compared against what the
// real Astro build (the routing scan) actually emitted.
import {
  buildEntryPathMap,
  buildUrlMap
} from '../../../scripts/gen-relations.mjs'

const appDir = fileURLToPath(new URL('..', import.meta.url))

// #1117 — the routing scan (Astro's glob loader + generateId) and the codegen scan
// (scripts/gen-relations.mjs) must derive the SAME entry id from every file. The fixture
// carries exactly the shapes on which Astro's default id and the raw path disagree:
//  - a frontmatter `slug:` (Astro's default would use it as the WHOLE id),
//  - an `index.mdoc` (Astro's default strips the trailing /index),
//  - a mixed-case dotted filename (Astro's default github-slugs each segment),
//  - a dot-prefixed file (the loader's glob skips it; the codegen walk must too).
let root: string
let contentDir: string

// Every file carries this run's temp-dir name in its frontmatter. Astro's glob loader reuses a
// cached entry whose content digest is unchanged WITHOUT checking that its file path still
// matches, so re-running this suite with byte-identical fixtures in a fresh temp dir resolves
// the previous (deleted) temp paths and the build fails. A per-run key makes every digest new.
function write(relPath: string, contents: string): void {
  const full = join(contentDir, relPath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(
    full,
    contents.replace(/^---\n/, `---\nfixtureRun: ${basename(root)}\n`)
  )
}

const distFile = (urlPath: string): string =>
  join(appDir, 'dist', urlPath, 'index.html')
const page = (urlPath: string): string =>
  readFileSync(distFile(urlPath), 'utf8')

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'setu-entry-id-parity-'))
  contentDir = join(root, 'content')
  writeFileSync(join(root, 'settings.json'), JSON.stringify({}))

  write(
    'post/en/hello.mdoc',
    '---\ntitle: Hello Slugged\ncid: cid-hello\nslug: hello-world\ndate: 2026-01-02\ntags: [shared]\n---\n\nHello body.\n'
  )
  write(
    'post/en/V1.2-Release.mdoc',
    '---\ntitle: Release Notes Mixed\ncid: cid-release\ndate: 2026-01-03\ntags: [shared]\n---\n\nRelease body.\n'
  )
  write(
    'page/en/docs/index.mdoc',
    '---\ntitle: Docs Index Page\ncid: cid-docs\n---\n\nDocs body.\n'
  )
  // The configured homepage (default `page/en/home`) owns the site root; present so every id
  // in the codegen map is a real file.
  write(
    'page/en/home.mdoc',
    '---\ntitle: Home Fixture\ncid: cid-home\n---\n\nHome.\n'
  )
  write(
    'post/en/.hidden.mdoc',
    '---\ntitle: Hidden Dotfile\ncid: cid-hidden\n---\n\nNever loaded.\n'
  )

  const env = { ...process.env, SETU_CONTENT_DIR: contentDir }
  execSync('pnpm build', { cwd: appDir, stdio: 'inherit', env })
}, 180_000)

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('entry ids: routing scan and codegen scan agree (real astro build)', () => {
  it('derives ids verbatim from the path — slug: ignored, index kept, case/dots kept, dotfiles skipped', async () => {
    const map: Map<string, string> = await buildEntryPathMap(contentDir)
    expect([...map.keys()].sort()).toEqual([
      'page/en/docs/index',
      'page/en/home',
      'post/en/V1.2-Release',
      'post/en/hello'
    ])
  })

  it('every URL the codegen scan computes is a page the build emitted, with that entry on it', async () => {
    const map: Map<string, string> = await buildEntryPathMap(contentDir)
    const titles: Record<string, string> = {
      'post/en/hello': 'Hello Slugged',
      'post/en/V1.2-Release': 'Release Notes Mixed',
      'page/en/docs/index': 'Docs Index Page',
      'page/en/home': 'Home Fixture'
    }
    for (const [id, urlPath] of map) {
      expect(existsSync(distFile(urlPath)), `${id} → /${urlPath}`).toBe(true)
      expect(page(urlPath)).toContain(titles[id])
    }
  })

  it('the redirect map (url-map.json source) records only URLs the site serves', async () => {
    const urlMap: Record<string, string> = await buildUrlMap(contentDir)
    expect(Object.keys(urlMap).sort()).toEqual([
      'cid-docs',
      'cid-hello',
      'cid-home',
      'cid-release'
    ])
    for (const url of Object.values(urlMap))
      expect(existsSync(distFile(url)), url).toBe(true)
  })

  it('frontmatter slug: does not drop the post out of its collection (listed on /posts)', () => {
    const archive = page('posts')
    expect(archive).toContain('Hello Slugged')
    expect(archive).toContain('Release Notes Mixed')
  })

  it('relations.json is keyed by the ids the page route looks up (Read Next renders)', () => {
    // post/en/hello and post/en/V1.2-Release share a tag, so each relates to the other —
    // but only if gen-relations' key equals the Astro entry.id [...path].astro looks up.
    expect(page('post/hello')).toContain('href="/post/V1.2-Release/"')
    expect(page('post/V1.2-Release')).toContain('href="/post/hello/"')
  })
})
