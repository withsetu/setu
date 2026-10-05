/** CLI default-directory resolution (#512), mirroring how `pnpm dev` wires the
 *  stack (scripts/dev-lanes.mjs `laneEnv`):
 *
 *    SETU_REPO_DIR=<root>/.content-sandbox/dev   SETU_MEDIA_DIR=<SETU_REPO_DIR>/.setu/uploads
 *
 *  Env vars win (an explicitly pointed-at instance), then the defaults — the
 *  same precedence scripts/auth-login-link.mjs uses. The repo root is found by
 *  walking up to `pnpm-workspace.yaml` (the CLI runs with cwd =
 *  packages/demo-data under `pnpm --filter`). */
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { resolveMediaDir } from '@setu/storage-local'

export function resolveRepoRoot(start = process.cwd()): string {
  let dir = path.resolve(start)
  for (;;) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return path.resolve(start)
    dir = parent
  }
}

export function defaultSandboxDir(
  root: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  return env['SETU_REPO_DIR'] ?? path.join(root, '.content-sandbox', 'dev')
}

/** The api's media dir for `sandboxDir` — the shared rule (`resolveMediaDir`, #1161), so seeded
 *  images land where the api serves and the site reads them. Before #1161 this defaulted to the
 *  REPO ROOT's `.setu/uploads`, a directory nothing else reads. Pinned by
 *  packages/demo-data/test/engine/resolve-dirs.test.ts. */
export function defaultMediaDir(
  sandboxDir: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  return resolveMediaDir(env, sandboxDir)
}

/** Locate an already-fetched AIC source under `root`: prefer the extracted
 *  dump (repo-root `.demo-data/`, then the package-local one the CLI's cwd
 *  produces), fall back to a sampled `.jsonl`. Returns `null` when nothing is
 *  fetched yet — callers decide whether that means "offer the download"
 *  (#513's panel) or "fail with instructions" (the CLI). Never downloads
 *  implicitly — fetching the ~115 MiB dump is always an explicit action. */
export async function detectAicSource(
  root = resolveRepoRoot()
): Promise<string | null> {
  const candidates = [
    path.join(root, '.demo-data', 'artic-api-data', 'json', 'artworks'),
    path.join(
      root,
      'packages',
      'demo-data',
      '.demo-data',
      'artic-api-data',
      'json',
      'artworks'
    ),
    path.join(root, '.demo-data', 'aic-sample.jsonl'),
    path.join(root, 'packages', 'demo-data', '.demo-data', 'aic-sample.jsonl')
  ]
  for (const candidate of candidates) {
    if (
      await stat(candidate).then(
        () => true,
        () => false
      )
    )
      return candidate
  }
  return null
}
