import { execSync } from 'node:child_process'
import {
  cpSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, it } from 'vitest'
import {
  siteAppDir,
  startDevServer,
  waitForResponse,
  type DevServer
} from './lib/dev-server'

/**
 * The #1018 guard: `astro dev` must reflect content changes WITHOUT a restart.
 *
 * `SETU_CONTENT_DIR` points outside the Astro project root, so Vite's watcher never saw it and
 * the dev server served a boot-time snapshot — publishing an entry 404'd, and editing one showed
 * stale text, with a success toast either way. An honest publish was indistinguishable from a
 * failed one.
 *
 * This suite runs against a THROWAWAY copy of the content repo (never the tracked `content/`),
 * mutates it the way the publish path does, and asserts the running server reflects it. The
 * failure mode being guarded is silence, so every assertion here waits for a change to ARRIVE
 * and fails on the timeout — a test that only asserted "no error" would pass against the bug.
 */
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

let server: DevServer | undefined
let contentDir = ''
let tmpRoot = ''

const PAGE = 'watch-probe'

beforeAll(async () => {
  // Mirror the `predev` script: the markdoc block map and relations cache are generated
  // artifacts the dev server reads at startup.
  execSync(
    'node ../../scripts/gen-blocks.mjs && node ../../scripts/gen-relations.mjs',
    { cwd: siteAppDir, stdio: 'pipe' }
  )

  // Astro persists the content layer in `apps/site/.astro/` (`data-store.json`, plus
  // `content-modules.mjs`, which holds ABSOLUTE paths to every entry file). Pointing a dev
  // server at a temp content dir therefore writes temp paths into a cache that outlives this
  // suite — and once the temp dir is deleted, the next dev server (another suite, or a
  // developer's `pnpm dev`) 500s on every content page with "Cannot find module
  // astro:content-layer-deferred-module?...". Clear it on the way IN so a crashed previous run
  // cannot break us, and on the way OUT so we cannot break anyone else. Astro regenerates it.
  rmSync(join(siteAppDir, '.astro'), { recursive: true, force: true })

  // A throwaway content repo: `content/` plus the siblings contentRepoRoot expects.
  tmpRoot = mkdtempSync(join(tmpdir(), 'setu-content-watch-'))
  cpSync(join(repoRoot, 'content'), join(tmpRoot, 'content'), {
    recursive: true
  })
  cpSync(join(repoRoot, 'taxonomy'), join(tmpRoot, 'taxonomy'), {
    recursive: true
  })
  contentDir = join(tmpRoot, 'content')

  server = await startDevServer({ SETU_CONTENT_DIR: contentDir })
  await waitForResponse(
    `${server.origin}/page/about`,
    (res) => res.status === 200,
    {
      describe: 'the dev server to come up and serve a seeded page',
      timeoutMs: 90_000,
      log: server.log
    }
  )
}, 180_000)

afterAll(async () => {
  await server?.stop()
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true })
  // See the note in beforeAll: leaving temp paths in Astro's cache breaks the NEXT dev server.
  rmSync(join(siteAppDir, '.astro'), { recursive: true, force: true })
})

describe('astro dev: content changes propagate without a restart (#1018)', () => {
  it('shows an edit to an existing entry', async () => {
    const file = join(contentDir, 'page', 'en', 'about.mdoc')
    const marker = `probe-edit-${Date.now()}`
    writeFileSync(file, `${readFileSync(file, 'utf8')}\n\n${marker}\n`)

    await waitForResponse(
      `${server!.origin}/page/about`,
      (res, body) => res.status === 200 && body.includes(marker),
      {
        describe: `the edited body text (${marker})`,
        log: server!.log
      }
    )
  })

  it('routes a NEW entry — the published-then-404 case', async () => {
    writeFileSync(
      join(contentDir, 'page', 'en', `${PAGE}.mdoc`),
      `---\ntitle: Watch Probe\n---\n\nA page created while the dev server was already running.\n`
    )

    await waitForResponse(
      `${server!.origin}/page/${PAGE}`,
      (res) => res.status === 200,
      {
        describe: 'the newly created entry to become routable',
        log: server!.log
      }
    )
  })

  it('drops the route when an entry is deleted', async () => {
    // Assert the precondition rather than inheriting it from the previous case. A 404 is the
    // pass condition here, and a route that never existed is trivially 404 — so without this
    // the test would pass against a server that senses nothing at all. (Caught by kill-shot:
    // decoying the content dir left this case green while the other two correctly failed.)
    await waitForResponse(
      `${server!.origin}/page/${PAGE}`,
      (res) => res.status === 200,
      {
        describe: 'the entry to be routable BEFORE deleting it',
        log: server!.log
      }
    )

    rmSync(join(contentDir, 'page', 'en', `${PAGE}.mdoc`))

    await waitForResponse(
      `${server!.origin}/page/${PAGE}`,
      (res) => res.status === 404,
      {
        describe: 'the deleted entry to stop being routable',
        log: server!.log
      }
    )
  })
})
