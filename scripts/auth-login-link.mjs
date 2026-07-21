// Print the current admin sign-in (handshake) link — the lockout-recovery command (#386).
//
// In local mode the api process keeps ONE valid, unused handshake token and persists its full
// URL to `${dir}/.setu/handshake-url` (0600, trailing newline) at boot and on every rotation —
// see apps/api/src/handshake-file.ts. This script reads that file back so a locked-out owner
// runs `pnpm auth:login-link` instead of restarting the api and grepping its logs.
//
// Where `dir` is depends on how the api was started (server.ts: `SETU_REPO_DIR ?? cwd`), so the
// lookup order here mirrors the ways this repo actually runs it — verified against the root
// package.json `dev` script, which starts the api with `SETU_REPO_DIR=$PWD/.content-sandbox/dev`:
//   1. $SETU_REPO_DIR                — an explicitly pointed-at instance (env var first)
//   2. <root>/.content-sandbox/dev  — the `pnpm dev` sandbox default, so a plain
//                                      `pnpm auth:login-link` matches the running dev api
//   3. <root>                        — a bare api run from the content repo itself (cwd fallback)
//
// Kept dependency-free (node builtins only), same pattern as content-sandbox.mjs.
//
// Usage:  node scripts/auth-login-link.mjs           (or `pnpm auth:login-link` from the repo root)
//         node scripts/auth-login-link.mjs --open   (also open it in the default browser, #779)

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { platform } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { sandboxPath } from './content-sandbox.mjs'

/** Resolve and read the current handshake URL for the api rooted at/under `rootDir`.
 *  Returns `{ url, file }` (url trimmed, file = the path it came from); throws with a
 *  topology-honest, actionable message when no non-empty handshake file exists anywhere
 *  in the lookup order above. `env` is injectable for tests. */
export function readLoginLink(rootDir, env = process.env) {
  const candidates = env.SETU_REPO_DIR
    ? [env.SETU_REPO_DIR, sandboxPath(rootDir), rootDir]
    : [sandboxPath(rootDir), rootDir]
  const checked = []
  for (const dir of [...new Set(candidates)]) {
    const file = path.join(dir, '.setu', 'handshake-url')
    checked.push(file)
    let raw
    try {
      raw = readFileSync(file, 'utf8')
    } catch {
      continue // missing/unreadable → try the next candidate
    }
    // An existing-but-empty file is treated like a missing one (a truncated write, or a file
    // created by something else): keep scanning, and fail with the same guidance if nothing else
    // has a link.
    const url = raw.trim()
    if (url) return { url, file }
  }
  throw new Error(
    `no handshake link found — checked:\n${checked.map((f) => `  ${f}`).join('\n')}\n` +
      'The link file is written by the api in LOCAL mode, at boot and on every sign-in. ' +
      'If the api is not running (or predates this feature), start the dev stack with ' +
      '`pnpm dev` and re-run this command. On self-hosted/edge topologies there is no local ' +
      'handshake link — sign in with email + password, or recover with `pnpm auth:reset-password`.'
  )
}

/** CLI flags. `--open`/`-o` opts into launching the browser; anything else is ignored so the
 *  no-flag invocation keeps its exact existing behaviour (#779). */
export function parseArgs(argv) {
  return { open: argv.includes('--open') || argv.includes('-o') }
}

/** The platform's "open this URL in the default browser" command, or null where there isn't a
 *  standard one — the caller then prints the URL and says why it did not open, rather than
 *  failing or pretending. */
export function openCommandFor(plat) {
  if (plat === 'darwin') return { cmd: 'open', args: [] }
  if (plat === 'linux') return { cmd: 'xdg-open', args: [] }
  return null
}

function main(argv = []) {
  const { open } = parseArgs(argv)
  try {
    const { url, file } = readLoginLink(process.cwd())
    // The note goes to stderr so stdout stays exactly one URL (pipe/copy friendly).
    console.error(`(from ${file})`)
    console.log(url)
    if (open) {
      const opener = openCommandFor(platform())
      if (!opener) {
        console.error(
          `(--open: no known browser opener on ${platform()} — open the URL above manually)`
        )
        return
      }
      try {
        // The URL is read from our own 0600 handshake file and passed as an argv element to
        // execFileSync — no shell, so nothing in it can be interpreted as a command.
        execFileSync(opener.cmd, [...opener.args, url], { stdio: 'ignore' })
        console.error(`(opened with ${opener.cmd})`)
      } catch {
        console.error(
          `(--open: \`${opener.cmd}\` failed — open the URL above manually)`
        )
      }
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
}

/** True when `metaUrl` (import.meta.url) is the module Node was launched with (`argv1`).
 *  Compares FILESYSTEM PATHS via fileURLToPath — never a string-built `file://${argv1}` template,
 *  which fails on any path with URL-special characters (a space becomes %20 in import.meta.url)
 *  and would silently turn a direct run into a no-op exit 0 — the worst failure mode for a
 *  recovery command. Same in-tree pattern as gen-blocks.mjs. */
export function isDirectInvocation(argv1, metaUrl) {
  if (!argv1) return false
  return path.resolve(argv1) === fileURLToPath(metaUrl)
}

if (isDirectInvocation(process.argv[1], import.meta.url))
  main(process.argv.slice(2))
