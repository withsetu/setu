import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_BUILD_TIMEOUT_MS,
  buildTimeoutMs,
  devServerHolding,
  makeBuildRunner
} from '../src/deploy-wiring'

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

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('makeBuildRunner — the build deadline (#1157)', () => {
  /** A "build" that never exits, and starts a grandchild that never exits either — the shape of
   *  `pnpm build` → sh → astro. The grandchild records its pid so the test can prove the whole
   *  tree died, not just the direct child. */
  function hangingBuild(): {
    env: NodeJS.ProcessEnv
    grandchildPid: () => number
  } {
    const pidFile = join(siteDir, 'grandchild.pid')
    const script = join(siteDir, 'hang.mjs')
    writeFileSync(
      script,
      [
        "import { spawn } from 'node:child_process'",
        "import { writeFileSync } from 'node:fs'",
        "const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })",
        `writeFileSync(${JSON.stringify(pidFile)}, String(g.pid))`,
        "console.log('building forever')",
        'setInterval(() => {}, 1000)'
      ].join('\n')
    )
    return {
      env: {
        ...process.env,
        SETU_BUILD_COMMAND: `${process.execPath} ${script}`
      },
      grandchildPid: () => Number(readFileSync(pidFile, 'utf-8'))
    }
  }

  it('fails a build that never exits at the deadline, and kills its whole process tree', async () => {
    const { env, grandchildPid } = hangingBuild()
    const run = makeBuildRunner({
      siteDir,
      repoDir: siteDir,
      env,
      timeoutMs: 1_500
    })
    const started = Date.now()
    const err = (await run().then(
      () => null,
      (e: unknown) => e
    )) as (Error & { logTail?: string }) | null
    expect(err).toBeInstanceOf(Error)
    expect(err?.message).toMatch(/timed out after/i)
    expect(err?.logTail).toContain('building forever')
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(existsSync(join(siteDir, 'grandchild.pid'))).toBe(true)
    const g = grandchildPid()
    await vi.waitFor(() => expect(alive(g)).toBe(false), { timeout: 8_000 })
  }, 20_000)

  it('a build that finishes inside the deadline still succeeds', async () => {
    const run = makeBuildRunner({
      siteDir,
      repoDir: siteDir,
      env: {
        ...process.env,
        SETU_BUILD_COMMAND: `${process.execPath} --version`
      },
      timeoutMs: 10_000
    })
    await expect(run()).resolves.toBeUndefined()
  })

  it('a failing build still reports its exit code, not a timeout', async () => {
    const script = join(siteDir, 'fail.mjs')
    writeFileSync(script, "console.error('kaboom'); process.exit(3)")
    const run = makeBuildRunner({
      siteDir,
      repoDir: siteDir,
      env: {
        ...process.env,
        SETU_BUILD_COMMAND: `${process.execPath} ${script}`
      },
      timeoutMs: 10_000
    })
    await expect(run()).rejects.toThrow('build exited with code 3')
  })
})

describe('buildTimeoutMs (#1157)', () => {
  it('defaults when unset or not a positive integer', () => {
    expect(buildTimeoutMs({})).toBe(DEFAULT_BUILD_TIMEOUT_MS)
    expect(buildTimeoutMs({ SETU_BUILD_TIMEOUT_MS: '' })).toBe(
      DEFAULT_BUILD_TIMEOUT_MS
    )
    expect(buildTimeoutMs({ SETU_BUILD_TIMEOUT_MS: 'soon' })).toBe(
      DEFAULT_BUILD_TIMEOUT_MS
    )
    expect(buildTimeoutMs({ SETU_BUILD_TIMEOUT_MS: '0' })).toBe(
      DEFAULT_BUILD_TIMEOUT_MS
    )
    expect(buildTimeoutMs({ SETU_BUILD_TIMEOUT_MS: '-5' })).toBe(
      DEFAULT_BUILD_TIMEOUT_MS
    )
  })
  it('honours a positive override', () => {
    expect(buildTimeoutMs({ SETU_BUILD_TIMEOUT_MS: '60000' })).toBe(60_000)
  })
})
