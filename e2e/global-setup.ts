// Runs once before the test run, but AFTER Playwright's webServer processes
// have already started and gone healthy — verified against the installed
// playwright@1.61.1 source: `createGlobalSetupTasks()` sequences output-dir
// cleanup -> webServer plugin setup -> user globalSetup LAST. So anything the
// api/admin processes read *at boot* must not live here (see the sandbox
// reset, moved into the api's `webServer.command` in playwright.config.ts so
// it runs before the api starts serving `/git/head`).
//
// The e2e media upload dir is safe here: `createLocalStorage` (used by
// apps/api/src/server.ts) never touches SETU_MEDIA_DIR at construction or
// server startup — every fs op (`put`/`get`/`exists`/`list`) is lazy and
// per-request, and `put` itself `mkdir -p`s the dir on first write. The
// earliest anything reads this dir is a test's own request, which can't
// happen until this globalSetup has already returned. Wipes the dir so every
// run starts clean, without touching the `dev` sandbox's uploads a running
// `pnpm dev` stack may still be using.
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const mediaDir = path.join(repoRoot, '.setu', 'e2e-uploads')

export default function globalSetup() {
  rmSync(mediaDir, { recursive: true, force: true })
  mkdirSync(mediaDir, { recursive: true })
  if (!existsSync(mediaDir)) throw new Error(`failed to create ${mediaDir}`)
}
