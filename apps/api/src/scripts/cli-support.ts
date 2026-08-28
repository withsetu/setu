// Shared plumbing for the host-side auth CLIs (`auth:reset-password` #386,
// `auth:create-owner` #1053).
//
// Extracted so the two commands cannot drift apart on the parts that carry the security
// properties — chiefly that the password is read from stdin and NEVER from argv. A second copy of
// a hidden-prompt reader is exactly the kind of thing that quietly grows an echo.
//
// Moved verbatim from reset-password.ts, whose tests (apps/api/test/reset-password.test.ts) still
// exercise `resolveDbFile` and `isDirectInvocation` through that module's re-exports.

import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/** Resolve the api's auth DB file the same way server.ts does (`SETU_SUBMISSIONS_DB ??
 *  ${SETU_REPO_DIR ?? cwd}/.setu/submissions.db`), plus ONE extra dev-ergonomics step: with no
 *  env set, `pnpm --filter @setu/api run …` executes from apps/api, but the root `pnpm dev`
 *  script starts the api with `SETU_REPO_DIR=$PWD/.content-sandbox/dev` (see root package.json)
 *  — so if we're inside a pnpm workspace whose dev sandbox DB exists, that's the instance a dev
 *  user means. Order: env file → env dir → workspace dev sandbox → cwd. */
export function resolveDbFile(env: NodeJS.ProcessEnv, cwd: string): string {
  if (env.SETU_SUBMISSIONS_DB) return env.SETU_SUBMISSIONS_DB
  if (env.SETU_REPO_DIR)
    return join(env.SETU_REPO_DIR, '.setu', 'submissions.db')
  const root = findWorkspaceRoot(cwd)
  if (root) {
    const sandboxDb = join(
      root,
      '.content-sandbox',
      'dev',
      '.setu',
      'submissions.db'
    )
    if (existsSync(sandboxDb)) return sandboxDb
  }
  return join(cwd, '.setu', 'submissions.db')
}

/** Nearest ancestor of `cwd` (inclusive) containing pnpm-workspace.yaml, or null. */
function findWorkspaceRoot(cwd: string): string | null {
  let dir = cwd
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** Read the password from stdin — piped (`printf '%s' "$PW" | pnpm auth:reset-password a@b`)
 *  takes the first line; a TTY gets a hidden (no-echo) prompt. Never argv — see file doc. */
export async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    let data = ''
    process.stdin.setEncoding('utf8')
    for await (const chunk of process.stdin) data += String(chunk)
    return (data.split('\n', 1)[0] ?? '').replace(/\r$/, '')
  }
  return promptHidden('New password: ')
}

/** Minimal raw-mode no-echo prompt (dependency-free; readline echoes by default and muting it
 *  means poking its private _writeToOutput, so read raw bytes instead). Backspace edits, Enter
 *  submits, Ctrl-C aborts. */
function promptHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ctrlC = '\u0003'
    const del = '\u007f' // what most terminals send for Backspace in raw mode
    const stdin = process.stdin
    process.stderr.write(prompt)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let buf = ''
    const cleanup = () => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.off('data', onData)
      process.stderr.write('\n')
    }
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === ctrlC) {
          cleanup()
          reject(new Error('aborted'))
          return
        }
        if (ch === '\r' || ch === '\n') {
          cleanup()
          resolve(buf)
          return
        }
        if (ch === del || ch === '\b') {
          buf = buf.slice(0, -1)
          continue
        }
        buf += ch
      }
    }
    stdin.on('data', onData)
  })
}

/** True when `metaUrl` (import.meta.url) is the module Node was launched with (`argv1`).
 *  Compares FILESYSTEM PATHS via fileURLToPath — never a string-built `file://${argv1}` template,
 *  which fails on any path with URL-special characters (a space becomes %20 in import.meta.url)
 *  and would silently turn a direct run into a no-op exit 0 — the worst failure mode for a
 *  recovery command. Same in-tree pattern as scripts/gen-blocks.mjs. */
export function isDirectInvocation(
  argv1: string | undefined,
  metaUrl: string
): boolean {
  if (!argv1) return false
  return resolve(argv1) === fileURLToPath(metaUrl)
}
