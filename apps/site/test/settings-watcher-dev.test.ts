import { execSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
 * The #1111 guard: the FIRST settings save must reach a running dev server.
 *
 * `settings-watcher.mjs` exists for #361 — astro dev caches the route matrix and only invalidates
 * on a watched file, and settings.json sits outside the watched content dir. It watched the FILE,
 * and bailed when that file did not exist at server-setup time. The seeded sandbox has no
 * settings.json (scripts/content-sandbox.mjs copies content/ only), so on every fresh `pnpm dev`
 * no watcher was attached at all: the owner's first settings save got a green "Saved" toast while
 * the site served defaults until the next restart.
 *
 * So this suite starts from a sandbox with NO settings.json — the state that made the bug
 * unreachable from the old test — and creates one, which is an `add`, not a `change`.
 *
 * `reading.postsPerPage` is the probe because it is route-affecting: it changes how many archive
 * pages exist, so the assertion is about the route matrix the watcher exists to invalidate, not
 * about a value that happens to be re-read per render.
 */
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

let server: DevServer | undefined
let tmpRoot = ''

beforeAll(async () => {
  execSync(
    'node ../../scripts/gen-blocks.mjs && node ../../scripts/gen-relations.mjs',
    { cwd: siteAppDir, stdio: 'pipe' }
  )
  // See content-watch-dev.test.ts: Astro's .astro cache holds ABSOLUTE entry paths, so a temp
  // content dir poisons the next dev server unless it is cleared on the way in and out.
  rmSync(join(siteAppDir, '.astro'), { recursive: true, force: true })

  tmpRoot = mkdtempSync(join(tmpdir(), 'setu-settings-watch-'))
  cpSync(join(repoRoot, 'content'), join(tmpRoot, 'content'), {
    recursive: true
  })
  cpSync(join(repoRoot, 'taxonomy'), join(tmpRoot, 'taxonomy'), {
    recursive: true
  })
  // Deliberately NO settings.json — this is what the seeded dev sandbox looks like.

  server = await startDevServer({
    SETU_CONTENT_DIR: join(tmpRoot, 'content'),
    // The archive route prefers this env over the setting, so it must be unset for the setting
    // to be the thing under test.
    SETU_ARCHIVE_PER_PAGE: ''
  })
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
  rmSync(join(siteAppDir, '.astro'), { recursive: true, force: true })
})

describe('astro dev: the FIRST settings save propagates (#1111)', () => {
  it('creating settings.json changes the archive route matrix', async () => {
    // Precondition, asserted rather than assumed: with the default page size the seeded posts fit
    // on one page, so /posts/2 is a 404. Without this the pass condition below could be satisfied
    // by a server that senses nothing — the same trap content-watch-dev.test.ts records having
    // been caught by kill-shot.
    await waitForResponse(
      `${server!.origin}/posts/2`,
      (res) => res.status === 404,
      {
        describe: '/posts/2 to be absent BEFORE settings.json exists',
        log: server!.log
      }
    )

    writeFileSync(
      join(tmpRoot, 'settings.json'),
      JSON.stringify({ reading: { postsPerPage: 1 } }, null, 2)
    )

    await waitForResponse(
      `${server!.origin}/posts/2`,
      (res) => res.status === 200,
      {
        describe:
          'the newly created settings.json to restart the server and add /posts/2',
        timeoutMs: 90_000,
        log: server!.log
      }
    )
  }, 180_000)
})
