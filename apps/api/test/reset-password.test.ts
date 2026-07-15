import { afterEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openSqliteDb } from '@setu/db-sqlite'
import { createAuth, type AuthEvent } from '@setu/auth'
import { resetPassword, resolveDbFile } from '../src/scripts/reset-password'

const NEW_PASSWORD = 'a-brand-new-password-123'
const OLD_PASSWORD = 'the-previous-password-99'

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn()
})

/** Real, temp-file-backed auth DB (mirrors users-credential-status.test.ts's makeApp): the script
 *  opens the SAME sqlite file the server would, so a real file — not :memory: — is the honest
 *  fixture. Rate limiting is disabled on the harness auth so repeated signInEmail probes in one
 *  test can't trip better-auth's 3/10s sign-in rule. */
function makeDb() {
  const dir = mkdtempSync(join(tmpdir(), 'reset-password-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  const dbFile = join(dir, 'submissions.db')
  const db = openSqliteDb(dbFile)
  const auth = createAuth({
    db,
    secret: 'test-secret-32-chars-minimum!!!!',
    baseURL: 'http://localhost:4444',
    trustedOrigins: ['http://localhost:5173'],
    rateLimit: { enabled: false }
  })
  return { dir, dbFile, auth }
}

async function makeUser(
  auth: ReturnType<typeof createAuth>,
  opts: { email: string; password?: string }
) {
  const ctx = await auth.$context
  const user = await ctx.internalAdapter.createUser({
    email: opts.email,
    name: 'Someone',
    role: 'admin',
    emailVerified: true
  })
  if (opts.password) {
    const hashed = await ctx.password.hash(opts.password)
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password: hashed
    })
  }
  return user
}

async function signInStatus(
  auth: ReturnType<typeof createAuth>,
  email: string,
  password: string
): Promise<number> {
  const res = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true
  })
  return res.status
}

describe('resetPassword', () => {
  it('links a credential account for a passwordless user; the new password then signs in', async () => {
    const { dbFile, auth } = makeDb()
    const user = await makeUser(auth, { email: 'owner@test.com' })

    const result = await resetPassword({
      dbFile,
      email: 'owner@test.com',
      password: NEW_PASSWORD
    })
    expect(result.userId).toBe(user.id)
    expect(result.created).toBe(true)

    expect(await signInStatus(auth, 'owner@test.com', NEW_PASSWORD)).toBe(200)
  })

  it("REPLACES an existing credential's password — old fails, new works", async () => {
    const { dbFile, auth } = makeDb()
    await makeUser(auth, { email: 'owner@test.com', password: OLD_PASSWORD })

    const result = await resetPassword({
      dbFile,
      email: 'owner@test.com',
      password: NEW_PASSWORD
    })
    expect(result.created).toBe(false)

    expect(await signInStatus(auth, 'owner@test.com', OLD_PASSWORD)).toBe(401)
    expect(await signInStatus(auth, 'owner@test.com', NEW_PASSWORD)).toBe(200)
  })

  it('unknown email → clear error', async () => {
    const { dbFile } = makeDb()
    await expect(
      resetPassword({
        dbFile,
        email: 'nobody@test.com',
        password: NEW_PASSWORD
      })
    ).rejects.toThrow(/no user with email nobody@test\.com/)
  })

  it('too-short password → rejected before any write', async () => {
    const { dbFile, auth } = makeDb()
    const user = await makeUser(auth, { email: 'owner@test.com' })

    await expect(
      resetPassword({ dbFile, email: 'owner@test.com', password: 'short' })
    ).rejects.toThrow(/at least 8/)

    // Nothing was written: still no credential account.
    const ctx = await auth.$context
    const accounts = await ctx.internalAdapter.findAccounts(user.id)
    expect(accounts.some((a) => a.providerId === 'credential')).toBe(false)
  })

  it('missing DB file → clear error, and the file is NOT created as a side effect', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reset-password-nodb-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const dbFile = join(dir, '.setu', 'submissions.db')

    await expect(
      resetPassword({ dbFile, email: 'owner@test.com', password: NEW_PASSWORD })
    ).rejects.toThrow(/no auth database/)
    expect(existsSync(dbFile)).toBe(false)
  })

  it('emits owner.password-reset with the target user id through the event seam', async () => {
    const { dbFile, auth } = makeDb()
    const user = await makeUser(auth, { email: 'owner@test.com' })

    const events: AuthEvent[] = []
    await resetPassword({
      dbFile,
      email: 'owner@test.com',
      password: NEW_PASSWORD,
      onAuthEvent: (e) => events.push(e)
    })

    expect(events).toEqual([
      { type: 'owner.password-reset', targetId: user.id }
    ])
    // The event must never carry the password (see packages/auth/src/events.ts meta contract).
    expect(JSON.stringify(events)).not.toContain(NEW_PASSWORD)
  })
})

describe('resolveDbFile', () => {
  it('SETU_SUBMISSIONS_DB wins outright', () => {
    expect(
      resolveDbFile(
        { SETU_SUBMISSIONS_DB: '/x/auth.db', SETU_REPO_DIR: '/y' },
        '/cwd'
      )
    ).toBe('/x/auth.db')
  })

  it('SETU_REPO_DIR → <dir>/.setu/submissions.db', () => {
    expect(resolveDbFile({ SETU_REPO_DIR: '/y' }, '/cwd')).toBe(
      join('/y', '.setu', 'submissions.db')
    )
  })

  it('no env, inside a pnpm workspace with a dev sandbox DB → the sandbox DB (what `pnpm dev` runs against)', () => {
    const root = mkdtempSync(join(tmpdir(), 'reset-password-ws-'))
    cleanups.push(() => rmSync(root, { recursive: true, force: true }))
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n')
    const sandboxDb = join(
      root,
      '.content-sandbox',
      'dev',
      '.setu',
      'submissions.db'
    )
    mkdirSync(join(root, '.content-sandbox', 'dev', '.setu'), {
      recursive: true
    })
    writeFileSync(sandboxDb, '')
    // cwd = the package dir `pnpm --filter @setu/api run` uses, not the repo root.
    const cwd = join(root, 'apps', 'api')
    mkdirSync(cwd, { recursive: true })
    expect(resolveDbFile({}, cwd)).toBe(sandboxDb)
  })

  it('no env, no workspace/sandbox → <cwd>/.setu/submissions.db (server.ts default)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'reset-password-cwd-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    expect(resolveDbFile({}, dir)).toBe(join(dir, '.setu', 'submissions.db'))
  })
})
