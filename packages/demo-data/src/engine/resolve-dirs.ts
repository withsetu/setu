/** CLI default-directory resolution (#512), mirroring how `pnpm dev` actually
 *  wires the stack (root package.json, verified):
 *
 *    SETU_REPO_DIR=$PWD/.content-sandbox/dev   SETU_MEDIA_DIR=$PWD/.setu/uploads
 *
 *  Env vars win (an explicitly pointed-at instance), then the repo-root
 *  defaults — the same precedence scripts/auth-login-link.mjs uses. The repo
 *  root is found by walking up to `pnpm-workspace.yaml` (the CLI runs with
 *  cwd = packages/demo-data under `pnpm --filter`). */
import { existsSync } from 'node:fs'
import path from 'node:path'

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

export function defaultMediaDir(
  root: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  return env['SETU_MEDIA_DIR'] ?? path.join(root, '.setu', 'uploads')
}
