// Runs once before Playwright's webServer processes start (globalSetup fires
// before webServer — see https://playwright.dev/docs/test-global-setup-teardown).
// Resets the `e2e` content sandbox and the e2e media upload dir so every run
// starts from the same seeded state, without touching the `dev` sandbox a
// running `pnpm dev` stack may still be using.
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resetSandbox } from '../scripts/content-sandbox.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const SANDBOX_NAME = 'e2e'
const mediaDir = path.join(repoRoot, '.setu', 'e2e-uploads')

export default function globalSetup() {
  resetSandbox(repoRoot, SANDBOX_NAME)

  rmSync(mediaDir, { recursive: true, force: true })
  mkdirSync(mediaDir, { recursive: true })
  if (!existsSync(mediaDir)) throw new Error(`failed to create ${mediaDir}`)
}
