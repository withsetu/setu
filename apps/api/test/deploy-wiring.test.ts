import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { devServerHolding } from '../src/deploy-wiring'

let siteDir: string

beforeEach(() => {
  siteDir = mkdtempSync(join(tmpdir(), 'setu-sitedir-'))
})
afterEach(() => {
  rmSync(siteDir, { recursive: true, force: true })
})

/** Write an Astro dev lockfile with the shape astro/dist/core/dev/lockfile.js produces. */
function writeLock(body: unknown): void {
  mkdirSync(join(siteDir, '.astro'), { recursive: true })
  writeFileSync(
    join(siteDir, '.astro', 'dev.json'),
    typeof body === 'string' ? body : JSON.stringify(body)
  )
}

const live = (pid: number) => ({
  pid,
  port: 4321,
  url: 'http://localhost:4321',
  background: false,
  startedAt: new Date().toISOString()
})

describe('devServerHolding (#1087)', () => {
  it('names the holder when the lockfile points at a live process', () => {
    writeLock(live(process.pid))
    const reason = devServerHolding(siteDir)
    expect(reason).not.toBeNull()
    expect(reason).toContain(String(process.pid))
  })

  it('never puts the site path in the reason — it is served to the admin UI', () => {
    writeLock(live(process.pid))
    expect(devServerHolding(siteDir)).not.toContain(siteDir)
  })

  it('degrades OPEN with no lockfile — a real deployment has none, and must still build', () => {
    expect(devServerHolding(siteDir)).toBeNull()
  })

  it('degrades open on a dead pid, and does not leave the build blocked forever', () => {
    // A pid that cannot be running: 2^22 + 1 is above every platform's pid_max.
    writeLock(live(4_194_305))
    expect(devServerHolding(siteDir)).toBeNull()
  })

  it('degrades open on a lockfile it cannot read as one', () => {
    writeLock('{ not json')
    expect(devServerHolding(siteDir)).toBeNull()
    writeLock({ port: 4321 })
    expect(devServerHolding(siteDir)).toBeNull()
    writeLock({ pid: '123' })
    expect(devServerHolding(siteDir)).toBeNull()
  })

  it('never signals the process it finds — pid 0 would signal our own group', () => {
    // `process.kill(0, 0)` targets the whole process group on POSIX. Guard it explicitly:
    // a lockfile is a file anyone with repo access can write, and a liveness probe must not
    // become a way to aim a signal.
    writeLock(live(0))
    expect(devServerHolding(siteDir)).toBeNull()
    writeLock(live(-1))
    expect(devServerHolding(siteDir)).toBeNull()
  })

  it('is null for a null site dir — nothing can hold a dir that is not configured', () => {
    expect(devServerHolding(null)).toBeNull()
  })
})
