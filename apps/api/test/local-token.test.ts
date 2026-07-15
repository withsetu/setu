// Unit tests for the REAL local-token provider (#386 rotation + self-healing persistence),
// exercising buildLocalTokenOptions directly — the exact object server.ts hands to createAuth,
// not a test-local stub. The end-to-end exchange behavior (through better-auth's real handler)
// lives in local-token-exchange.test.ts, which constructs its harness via this same builder.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildLocalTokenOptions } from '../src/local-token'
import { writeHandshakeFile } from '../src/handshake-file'

const ADMIN_ORIGIN = 'http://localhost:5173'
const IDENTITY = { email: 'owner@local.test', name: 'Local Owner' }

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn()
  vi.restoreAllMocks()
})

function makeDir() {
  const dir = mkdtempSync(join(tmpdir(), 'local-token-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function readHandshake(dir: string) {
  return readFileSync(join(dir, '.setu', 'handshake-url'), 'utf8').trim()
}

function build(dir: string, persist?: (dir: string, url: string) => void) {
  return buildLocalTokenOptions({
    dir,
    adminOrigin: ADMIN_ORIGIN,
    // localUserId is never invoked in these tests — the builder must not touch auth at build time
    // (server.ts hands it a forward reference that is undefined until boot finishes).
    getAuth: () => {
      throw new Error('getAuth must not be called outside an exchange')
    },
    identity: IDENTITY,
    ...(persist ? { persist } : {})
  })
}

describe('buildLocalTokenOptions (real provider wiring)', () => {
  it('persistUrl() writes the current handshake URL; consume() rotates synchronously and rewrites it', () => {
    const dir = makeDir()
    const opts = build(dir)

    opts.persistUrl() // boot write (server.ts calls this once at startup)
    const boot = opts.getToken()
    expect(boot).toBe(opts.token)
    expect(readHandshake(dir)).toBe(`${ADMIN_ORIGIN}/#setu-token=${boot}`)

    opts.consume()
    const rotated = opts.getToken()
    expect(rotated).not.toBe(boot)
    // The file follows the rotation immediately — the on-disk link is never the dead token.
    expect(readHandshake(dir)).toBe(`${ADMIN_ORIGIN}/#setu-token=${rotated}`)
  })

  it('persist failure: consume() still rotates (never throws), the file stays stale, and the NEXT getToken() heals it', () => {
    const dir = makeDir()
    let failNext = false
    const persist = (d: string, url: string) => {
      if (failNext) {
        failNext = false
        throw new Error('disk hiccup')
      }
      writeHandshakeFile(d, url)
    }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const opts = build(dir, persist)

    opts.persistUrl() // boot write succeeds
    const boot = opts.getToken()

    failNext = true
    // Rotation must survive the write failure: the exchange that triggered it already burned the
    // old token, so throwing here would turn a successful exchange into a 500 after the fact.
    expect(() => opts.consume()).not.toThrow()
    expect(errorSpy).toHaveBeenCalled()
    // The file is now STALE — it still holds the consumed (dead) boot token.
    expect(readHandshake(dir)).toBe(`${ADMIN_ORIGIN}/#setu-token=${boot}`)

    // Self-healing: getToken() runs at the start of EVERY exchange attempt (including ones that
    // will 401 on the dead token), so the locked-out owner's own retry rewrites the file once the
    // disk condition clears.
    const current = opts.getToken()
    expect(current).not.toBe(boot)
    expect(readHandshake(dir)).toBe(`${ADMIN_ORIGIN}/#setu-token=${current}`)

    // Healed means healed: a subsequent getToken() is a plain read, no further writes needed.
    const writesSoFar = readHandshake(dir)
    expect(opts.getToken()).toBe(current)
    expect(readHandshake(dir)).toBe(writesSoFar)
  })

  it('persist failure that persists: getToken() keeps retrying (pending flag survives a failed heal)', () => {
    const dir = makeDir()
    let failing = true
    const persist = (d: string, url: string) => {
      if (failing) throw new Error('still down')
      writeHandshakeFile(d, url)
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const opts = build(dir, persist)

    opts.consume() // rotation ok, persist fails
    opts.getToken() // heal attempt also fails — must not clear the pending flag
    failing = false
    const current = opts.getToken() // now it heals
    expect(readHandshake(dir)).toBe(`${ADMIN_ORIGIN}/#setu-token=${current}`)
  })
})
