// `pnpm auth:create-owner <email>` — first-run account bootstrap for a proxied install (#1053).
//
// A Setu reached through a reverse proxy or tunnel has no other way to create its first account.
// The only path to a first session is the local-token handshake, and it is unreachable off
// loopback BY DESIGN: `/local/exchange` requires a loopback `Host`, a proxy forwards the real
// hostname, and the exchange correctly 403s. `ensureLocalOwner` only ever runs from that
// handshake's `localUserId()` callback, so until one completes the `user` table stays empty —
// and `auth:reset-password` cannot help, because it needs a user to reset. Deadlock.
//
// This breaks it WITHOUT weakening the loopback guard. That matters: the alternative operators
// reach for is spoofing `Host: localhost` at the proxy (cloudflared's `httpHostHeader`), which
// defeats a real control permanently and puts a live handshake token on the wire. A host-side
// CLI adds no network surface at all.
//
// Trust bar is HOST ACCESS, identical to `auth:reset-password`: anyone who can run this already
// owns the DB file, so no session or role check applies. Password is read from STDIN and NEVER
// accepted as a CLI argument — argv leaks into shell history and `ps` on any shared host.
//
// Runs through better-auth's own machinery (`openInternalAuthContext` → `internalAdapter` +
// `ctx.password.hash`), the same path `ensureLocalOwner`, admin-invite and e2e/lib/seed-users.ts
// use. Never hand-forged DB rows.

import { existsSync } from 'node:fs'
import process from 'node:process'
import { openSqliteDb } from '@setu/db-sqlite'
import { openInternalAuthContext, type AuthEvent } from '@setu/auth'
import { isDirectInvocation, readPassword, resolveDbFile } from './cli-support'

export interface CreateOwnerOptions {
  /** Path to the api's sqlite auth DB (the SETU_SUBMISSIONS_DB file). */
  dbFile: string
  email: string
  password: string
  /** Display name for the new account. Defaults to 'Owner', matching `ensureLocalOwner`'s
   *  fallback — it is cosmetic and the user can change it once signed in. */
  name?: string
  /** Audit seam — the CLI wires the same `[auth-event]` console line server.ts uses; tests
   *  inject a collector. Defaults to a no-op, matching createAuth's own contract. */
  onAuthEvent?: (event: AuthEvent) => void
}

export interface CreateOwnerResult {
  userId: string
  email: string
  role: 'admin'
}

/** Create the first admin account in `dbFile`, with a credential password it can sign in with.
 *
 *  Throws (before writing anything) on: missing DB file, too-short password, or an email that
 *  already exists. Refusing a duplicate rather than upserting is deliberate — a bootstrap command
 *  that silently replaced an existing admin's password would be an account-takeover primitive for
 *  anyone with host access, which is a strictly larger capability than "create the first account".
 *  Replacing a known account's password is `auth:reset-password`'s job, and it says so.
 *
 *  Behaviour is covered by apps/api/test/create-owner.test.ts. */
export async function createOwner(
  opts: CreateOwnerOptions
): Promise<CreateOwnerResult> {
  const { dbFile, email, password } = opts
  const emit = opts.onAuthEvent ?? (() => {})
  // Existence check BEFORE opening: openSqliteDb would create-and-migrate an empty DB at a
  // mistyped path, and "owner created" against a fresh file nobody serves is the worst outcome.
  if (!existsSync(dbFile)) {
    throw new Error(
      `no auth database at ${dbFile} — the api creates it on first boot. ` +
        'Start the api once against this instance, or point SETU_REPO_DIR (or ' +
        'SETU_SUBMISSIONS_DB) at the directory it runs against.'
    )
  }
  const db = openSqliteDb(dbFile)
  const ctx = await openInternalAuthContext(db)
  // Same minimum better-auth's own password routes enforce, read from the built context rather
  // than hardcoded, and checked BEFORE any lookup or write so a rejected password can never
  // leave a half-created passwordless user behind.
  const min = ctx.password.config.minPasswordLength
  if (password.length < min) {
    throw new Error(`password too short — must be at least ${min} characters`)
  }
  if (await ctx.internalAdapter.findUserByEmail(email)) {
    throw new Error(
      `a user with email ${email} already exists in ${dbFile} — this command only ` +
        'bootstraps the FIRST account and will not take over an existing one. ' +
        `To set that account's password instead, run: pnpm auth:reset-password ${email}`
    )
  }
  const hashed = await ctx.password.hash(password)
  // `emailVerified: false` matches ensureLocalOwner: nothing has verified this address, and
  // saying otherwise in the audit trail would be a lie told by the bootstrap itself.
  const user = await ctx.internalAdapter.createUser({
    email,
    name: opts.name ?? 'Owner',
    emailVerified: false,
    role: 'admin'
  })
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: 'credential',
    accountId: user.id,
    password: hashed
  })
  emit({ type: 'owner.created', targetId: user.id })
  return { userId: user.id, email, role: 'admin' }
}

async function main(argv: string[]): Promise<void> {
  const [email, ...rest] = argv
  if (!email || rest.length > 0) {
    // Extra args are refused loudly rather than ignored: the likeliest second argument is the
    // password itself, which must never travel via argv.
    throw new Error(
      'usage: pnpm auth:create-owner <email>\n' +
        'The password is read from stdin (prompt or pipe) — NEVER pass it as an argument.'
    )
  }
  const dbFile = resolveDbFile(process.env, process.cwd())
  const password = await readPassword()
  const { userId } = await createOwner({
    dbFile,
    email,
    password,
    onAuthEvent: (event) => console.info('[auth-event]', JSON.stringify(event))
  })
  console.log(
    `admin created for ${email} (user ${userId}) — sign in at your admin URL with this password`
  )
}

if (isDirectInvocation(process.argv[1], import.meta.url)) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
