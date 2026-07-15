// `pnpm auth:reset-password <email>` — out-of-band owner password recovery (#386).
//
// Sets (or replaces) a user's credential password directly in the api's sqlite auth DB. The
// trust bar is HOST ACCESS: anyone who can run this already owns the DB file, so no session or
// role check applies — this is the recovery path for a locked-out admin on a hosted instance
// with no email adapter configured (where `request-password-reset` can't send anything).
//
// The password is read from STDIN (piped, or typed at a hidden prompt) and NEVER accepted as a
// CLI argument: argv leaks into shell history and `ps` output on any shared host — exactly the
// hosts this command exists for. Email is argv (it's not a secret).
//
// Runs through better-auth's own machinery — `openSqliteDb` (the same handle + migrations the
// server uses), then `openInternalAuthContext` (@setu/auth — the shared host-side bootstrap this
// script and e2e/lib/seed-users.ts both use) → `internalAdapter` + `ctx.password.hash` (scrypt,
// secret-independent), the exact seeding path the server's own admin-invite uses, so the running
// api verifies the new password unchanged. The upsert shape (existing credential row →
// updatePassword, none → linkAccount) mirrors better-auth 1.6.23's own reset-password callback
// route (dist/api/routes/password.mjs lines 150-158).

import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { openSqliteDb } from '@setu/db-sqlite'
import { openInternalAuthContext, type AuthEvent } from '@setu/auth'

export interface ResetPasswordOptions {
  /** Path to the api's sqlite auth DB (the SETU_SUBMISSIONS_DB file). */
  dbFile: string
  email: string
  password: string
  /** Audit seam (#248 Task 9) — the CLI wires the same `[auth-event]` console line server.ts
   *  uses; tests inject a collector. Defaults to a no-op, matching createAuth's own contract. */
  onAuthEvent?: (event: AuthEvent) => void
}

export interface ResetPasswordResult {
  userId: string
  /** true → the user had NO credential account and one was linked; false → replaced. */
  created: boolean
}

/** Upsert the credential-account password for the user with `email` in `dbFile`.
 *  Throws (before writing anything) on: missing DB file, too-short password, unknown email. */
export async function resetPassword(
  opts: ResetPasswordOptions
): Promise<ResetPasswordResult> {
  const { dbFile, email, password } = opts
  const emit = opts.onAuthEvent ?? (() => {})
  // Existence check BEFORE opening: openSqliteDb would happily create-and-migrate an empty DB at
  // a mistyped path, and "reset succeeded" against a fresh empty file is the worst failure mode.
  if (!existsSync(dbFile)) {
    throw new Error(
      `no auth database at ${dbFile} — the api creates it on first boot. ` +
        'Point SETU_REPO_DIR (or SETU_SUBMISSIONS_DB) at the same directory the api runs ' +
        'against, or start it once (`pnpm dev` here) so the file exists.'
    )
  }
  const db = openSqliteDb(dbFile)
  // Shared host-side bootstrap (same one e2e/lib/seed-users.ts uses) — the throwaway
  // secret/baseURL rationale lives on openInternalAuthContext itself.
  const ctx = await openInternalAuthContext(db)
  // Enforce the SAME minimum better-auth's own password routes enforce — read from the built
  // context (`emailAndPassword.minPasswordLength || 8`, better-auth 1.6.23
  // dist/context/create-context.mjs line 185) rather than hardcoded, and checked BEFORE any
  // lookup/hash/write so a too-short password can never half-apply.
  const min = ctx.password.config.minPasswordLength
  if (password.length < min) {
    throw new Error(`password too short — must be at least ${min} characters`)
  }
  const found = await ctx.internalAdapter.findUserByEmail(email)
  if (!found) {
    throw new Error(
      `no user with email ${email} in ${dbFile} — check the address (and that this is the ` +
        'DB the api actually runs against)'
    )
  }
  const userId = found.user.id
  const hashed = await ctx.password.hash(password)
  const accounts = await ctx.internalAdapter.findAccounts(userId)
  const hasCredential = accounts.some((a) => a.providerId === 'credential')
  if (hasCredential) {
    await ctx.internalAdapter.updatePassword(userId, hashed)
  } else {
    await ctx.internalAdapter.linkAccount({
      userId,
      providerId: 'credential',
      accountId: userId,
      password: hashed
    })
  }
  emit({ type: 'owner.password-reset', targetId: userId })
  return { userId, created: !hasCredential }
}

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
async function readPassword(): Promise<string> {
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

async function main(argv: string[]): Promise<void> {
  const [email, ...rest] = argv
  if (!email || rest.length > 0) {
    // Extra args are refused loudly rather than ignored: the likeliest second argument is the
    // password itself, which must never travel via argv.
    throw new Error(
      'usage: pnpm auth:reset-password <email>\n' +
        'The new password is read from stdin (prompt or pipe) — NEVER pass it as an argument.'
    )
  }
  const dbFile = resolveDbFile(process.env, process.cwd())
  const password = await readPassword()
  const { userId, created } = await resetPassword({
    dbFile,
    email,
    password,
    // Same structured audit line server.ts's logAuthEvent emits — the script IS the host-side
    // actor here, so its own stdout is the audit channel.
    onAuthEvent: (event) => console.info('[auth-event]', JSON.stringify(event))
  })
  console.log(
    created
      ? `credential created for ${email} (user ${userId}) — they can now sign in with the new password`
      : `password replaced for ${email} (user ${userId})`
  )
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

if (isDirectInvocation(process.argv[1], import.meta.url)) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
