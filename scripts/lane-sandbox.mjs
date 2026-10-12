// Which content sandbox do the `pnpm dev` lanes read? — the ONE answer every tool uses (#1200).
//
// Since #1053 every lane (the main checkout and each worktree) shares `<main>/.content-sandbox/dev`
// unless the operator points `SETU_REPO_DIR` elsewhere in the main checkout's `.env`. Before this
// module, the launcher knew that but the other tools resolved the sandbox from their own cwd, so
// from a worktree `pnpm content:reset` reset a sandbox no lane reads, `pnpm auth:login-link`
// looked for the handshake file in the wrong place, and `pnpm dev:status` flagged every correctly
// wired worktree lane as "cross-wired". dev.mjs, content-sandbox.mjs, auth-login-link.mjs and
// dev-status.mjs now all resolve through here. Pinned by scripts/lane-sandbox.test.mjs.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { MAIN_LANE } from './dev-lanes.mjs'
import { parseDotenv } from './dotenv.mjs'

/** The main checkout, resolved from ANY worktree. `--git-common-dir` points at the shared `.git`,
 *  whose parent is the main checkout — which is why this works without a "cd to the root" rule.
 *  Throws outside a git repo. */
export function mainCheckout(cwd = process.cwd(), env = process.env) {
  const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
    env
  }).trim()
  return path.dirname(path.resolve(cwd, common))
}

/** `.env` lives ONCE, at the main checkout, and every lane reads it. */
export function readDotenvAt(root) {
  const file = path.join(root, '.env')
  if (!existsSync(file)) return {}
  return parseDotenv(readFileSync(file, 'utf8'))
}

/** The sandbox the lanes read, given the main checkout and its `.env`. `owned` is false when the
 *  operator chose the directory: the launcher never seeds it and the sandbox tools never reset
 *  it, because a silent write into somebody else's directory is a surprise. */
export function laneSandbox(mainRoot, dotenv = readDotenvAt(mainRoot)) {
  const operator = dotenv.SETU_REPO_DIR
  if (typeof operator === 'string' && operator.trim() !== '')
    return { dir: operator, owned: false }
  return {
    dir: path.join(mainRoot, '.content-sandbox', MAIN_LANE),
    owned: true
  }
}

/** laneSandbox for whatever checkout `cwd` is inside. Outside a git repo (a bare content repo, a
 *  temp dir in a test) there is no main checkout to find, so `cwd` itself stands in for it.
 *  `gitCeiling` bounds git's upward search — tests use it so a temp dir under a checkout cannot
 *  resolve to that checkout. */
export function laneSandboxFor(cwd = process.cwd(), { gitCeiling } = {}) {
  let mainRoot
  try {
    mainRoot = mainCheckout(
      cwd,
      gitCeiling
        ? { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(gitCeiling) }
        : process.env
    )
  } catch {
    mainRoot = path.resolve(cwd)
  }
  return { ...laneSandbox(mainRoot), mainRoot }
}
