// Foreground `astro dev` for the #613 root-block guard, run in a DEDICATED Node process.
//
// Why a separate process instead of importing `dev()` directly in the vitest suite (#699):
// astro 7.1 restructured the content-layer data store (the `collectionStorage` refactor,
// withastro/astro#17296). The in-memory store is populated by the sync pass and read back by
// the dev SSR request handler. Under vitest the suite's `import { dev } from 'astro'` and
// astro's own SSR module runner resolve into two different vite-node module graphs, so the
// store the request handler reads is a distinct, EMPTY instance from the one the sync
// populated — `getCollection('entries')` returns nothing, `getStaticPaths` emits no route,
// and every content page 404s. Running `dev()` here, in a clean Node module graph, is the
// same code path the real `astro dev` CLI uses (minus its 7.1 daemon wrapper) and resolves
// the store correctly. The suite spawns this file, reads `PORT=<n>` from stdout, and drives
// it over HTTP.
import { dev } from 'astro'
import { fileURLToPath } from 'node:url'

// This file lives in apps/site/test/, so the Astro project root is one level up.
const root = fileURLToPath(new URL('..', import.meta.url))

const server = await dev({
  root,
  logLevel: 'error',
  // Port 0 → the OS picks a free port, so this can never collide with a developer's running
  // `pnpm dev` (4321), another suite, or an astro 7.1 background dev server.
  server: { port: 0 }
})

// Hand the chosen port back to the parent suite.
process.stdout.write(`PORT=${server.address.port}\n`)

const shutdown = async () => {
  try {
    await server.stop()
  } finally {
    process.exit(0)
  }
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
