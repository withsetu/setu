import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dev } from 'astro'

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
 */
const appDir = fileURLToPath(new URL('..', import.meta.url))

let origin = ''
let server: Awaited<ReturnType<typeof dev>> | undefined

beforeAll(async () => {
  // Mirror the `predev` script: the markdoc block map (which points at ../../blocks/*) and the
  // relations cache are generated artifacts the dev server reads at startup.
  execSync(
    'node ../../scripts/gen-blocks.mjs && node ../../scripts/gen-relations.mjs',
    { cwd: appDir, stdio: 'pipe' }
  )

  server = await dev({
    root: appDir,
    logLevel: 'error',
    // Port 0 → the OS picks a free port, so this can never collide with a developer's
    // running `pnpm dev` (4321) or another suite.
    server: { port: 0 }
  })
  // `address` may be a wildcard or a bare IPv6 host (`::1`), neither of which is a legal URL
  // authority as-is — the port is the only part we need, so always dial localhost.
  origin = `http://localhost:${server.address.port}`
}, 120_000)

afterAll(async () => {
  await server?.stop()
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
