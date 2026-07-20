import { spawn, execSync, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Guards the DEV-server path for repo-root `blocks/` (#613).
 *
 * Every other suite in apps/site/test exercises `astro build`, which bundles the whole SSR
 * graph and therefore always resolves the bare `@setu/*` imports inside repo-root
 * `blocks/<tag>/*.astro`. `astro dev` does NOT: it externalizes bare specifiers in the SSR
 * environment, so Node resolves them from the IMPORTER's location — repo-root `blocks/`,
 * whose nearest node_modules has no `@setu/blocks`. That asymmetry let a completely broken
 * dev server sit behind a fully green CI lane.
 *
 * `/page/section-demo` renders `{% callout %}` — a repo-root block whose .astro imports
 * `@setu/blocks` — so a 200 here proves the bare specifier resolved through Vite in dev.
 *
 * The dev server runs in a DEDICATED child Node process (`dev-root-block.server.mjs`), spawned
 * with the vitest/vite-injected env vars stripped, NOT via an in-suite
 * `import { dev } from 'astro'` (#699). Astro 7.1's dev content-layer branches on
 * `process.env.VITEST`: when it is set, the in-memory content store is not populated for the
 * SSR request handler, so `getCollection('entries')` comes back empty, `getStaticPaths` emits
 * no route, and every content page 404s. Astro 7.0.2 had no such branch, which is why the old
 * in-process suite was green. The real `astro dev` CLI serves the page fine at 7.1 — this is a
 * harness artifact of vitest's environment, not a regression in the root-block feature or the
 * site's content wiring. Running `dev()` in a child process with a real-dev environment
 * resolves the store correctly, and tears down as a single process group (astro 7.1's CLI
 * wrapper daemonizes; the programmatic `dev()` this helper uses does not).
 */
const appDir = fileURLToPath(new URL('..', import.meta.url))
const serverEntry = fileURLToPath(
  new URL('./dev-root-block.server.mjs', import.meta.url)
)

// Env keys vitest/vite inject into this process that must NOT leak into the child dev server:
// `VITEST` flips astro 7.1's dev content-layer into the mode that leaves the SSR store empty
// (see the suite docstring); the vite `import.meta.env` mirror (DEV/PROD/SSR/MODE/BASE_URL),
// the other VITEST_*/TINYPOOL markers, and vitest's NODE_PATH override are stripped too so the
// child sees exactly the environment a developer's `astro dev` would.
const VITEST_ENV_KEYS = [
  'VITEST',
  'VITEST_MODE',
  'VITEST_POOL_ID',
  'VITEST_WORKER_ID',
  'TINYPOOL_WORKER_ID',
  'TEST',
  'DEV',
  'PROD',
  'SSR',
  'MODE',
  'BASE_URL',
  'NODE_PATH'
]

function devServerEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const k of VITEST_ENV_KEYS) delete env[k]
  return env
}

let origin = ''
let child: ChildProcess | undefined
let childLog = ''

beforeAll(async () => {
  // Mirror the `predev` script: the markdoc block map (which points at ../../blocks/*) and the
  // relations cache are generated artifacts the dev server reads at startup.
  execSync(
    'node ../../scripts/gen-blocks.mjs && node ../../scripts/gen-relations.mjs',
    { cwd: appDir, stdio: 'pipe' }
  )

  // `detached` puts the child in its own process group so teardown can reap the whole tree
  // (Vite's esbuild service, etc.) with a single group-signal.
  child = spawn(process.execPath, [serverEntry], {
    cwd: appDir,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: devServerEnv()
  })

  const port = await new Promise<number>((resolve, reject) => {
    const deadline = setTimeout(
      () => reject(new Error(`dev server never reported a port:\n${childLog}`)),
      90_000
    )
    child!.stdout?.on('data', (d) => {
      childLog += d.toString()
      const m = childLog.match(/PORT=(\d+)/)
      if (m) {
        clearTimeout(deadline)
        resolve(Number(m[1]))
      }
    })
    child!.stderr?.on('data', (d) => (childLog += d.toString()))
    child!.on('exit', (code) => {
      clearTimeout(deadline)
      reject(new Error(`dev server exited early (${code}):\n${childLog}`))
    })
  })
  origin = `http://localhost:${port}`

  // `dev()` resolves when the server is listening, but the content-layer sync + first-request
  // compile can lag the first HTTP accept, so wait (bounded) for the route to actually resolve
  // instead of racing startup. A genuinely broken dev server (bare-specifier 500, empty store
  // 404) never reaches 200 and the timeout surfaces it with the captured child log.
  const deadline = Date.now() + 60_000
  for (;;) {
    try {
      const res = await fetch(`${origin}/page/section-demo`)
      if (res.status === 200) break
    } catch {
      /* not listening yet */
    }
    if (Date.now() > deadline) {
      throw new Error(
        `dev server never served /page/section-demo:\n${childLog}`
      )
    }
    await new Promise((r) => setTimeout(r, 300))
  }
}, 120_000)

afterAll(async () => {
  if (child?.pid && child.exitCode === null) {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      /* already gone */
    }
    await new Promise((r) => setTimeout(r, 300))
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      /* reaped */
    }
  }
})

describe('astro dev: repo-root blocks/', () => {
  it('renders a page whose root block imports @setu/blocks (#613)', async () => {
    const res = await fetch(`${origin}/page/section-demo`)

    // Before the ssr.noExternal fix this was a 500: the bare `@setu/blocks` import inside
    // blocks/callout/callout.astro was externalized and handed to Node's resolver.
    expect(res.status).toBe(200)

    const html = await res.text()
    // Not just a 200 — the callout must actually have rendered. `callout-body` is the wrapper
    // blocks/callout/callout.astro puts around its slot, and the Callout component that emits
    // the surrounding markup is the thing imported from @setu/blocks.
    expect(html).toContain('callout-body')
  }, 60_000)
})
