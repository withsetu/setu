import { describe, it, expect, afterEach } from 'vitest'
import nodeFs from 'node:fs'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import type { PromiseFsClient } from 'isomorphic-git'
import { createLocalGitAdapter } from '../src/index'

// #1155: a batch that fails AFTER disk writes begin must leave the working tree exactly at HEAD —
// the site build reads the working tree, so a half-applied batch would ship uncommitted content.

function cli(dir: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=CLI', '-c', 'user.email=cli@x.com', ...args],
    { cwd: dir, stdio: 'pipe' }
  )
    .toString()
    .trim()
}

const status = (dir: string): string =>
  cli(dir, 'status', '--porcelain', '--untracked-files=all')

type Op = 'readFile' | 'writeFile' | 'unlink' | 'mkdir' | 'lstat' | 'stat'
/** Return an Error to throw INSTEAD of performing the op, or undefined to let it through. */
type Fault = (
  op: Op,
  path: string,
  args: unknown[]
) => Promise<Error | undefined>

/** node:fs with a fault hook in front of every fs.promises call isomorphic-git or the adapter
 *  makes, so a failure can be injected at a precise stage of a real commit. */
function faultyFs(fault: { current: Fault | undefined }): PromiseFsClient {
  const real = nodeFs.promises as unknown as Record<
    string,
    (...a: unknown[]) => Promise<unknown>
  >
  const promises = new Proxy(real, {
    get(target, key: string) {
      const fn = target[key]
      if (typeof fn !== 'function') return fn
      return async (...args: unknown[]) => {
        const f = fault.current
        if (f !== undefined && typeof args[0] === 'string') {
          const err = await f(key as Op, args[0], args)
          if (err !== undefined) throw err
        }
        return fn.apply(target, args)
      }
    }
  })
  return { promises } as unknown as PromiseFsClient
}

const ioError = (code: string, msg: string): Error =>
  Object.assign(new Error(msg), { code })

const AUTHOR = { name: 'E', email: 'e@x.com' }
const EXISTING = 'content/post/en/existing.mdoc'
const DOOMED = 'content/post/en/doomed.mdoc'
const FRESH = 'content/page/en/fresh.mdoc' // its whole directory is new

describe('git-local: a failed batch restores the working tree to HEAD (#1155)', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  const seed = (): { dir: string; head: string } => {
    const d = mkdtempSync(join(tmpdir(), 'setu-git-restore-'))
    cli(d, 'init', '-q', '-b', 'main')
    for (const [p, c] of [
      [EXISTING, 'existing v1\n'],
      [DOOMED, 'doomed v1\n']
    ] as const) {
      mkdirSync(dirname(join(d, p)), { recursive: true })
      writeFileSync(join(d, p), c)
    }
    cli(d, 'add', '.')
    cli(d, 'commit', '-q', '-m', 'seed')
    return { dir: d, head: cli(d, 'rev-parse', 'HEAD') }
  }

  // Mixed batch: delete an existing file, overwrite another, create a file in a new directory.
  const batch = {
    changes: [
      { path: DOOMED, delete: true as const },
      { path: EXISTING, content: 'existing v2 — never committed\n' },
      { path: FRESH, content: 'fresh — never committed\n' }
    ],
    message: 'mixed',
    author: AUTHOR
  }

  const expectAtHead = (d: string, head: string): void => {
    expect(status(d)).toBe('')
    expect(cli(d, 'rev-parse', 'HEAD')).toBe(head)
    expect(nodeFs.readFileSync(join(d, EXISTING), 'utf8')).toBe('existing v1\n')
    expect(nodeFs.readFileSync(join(d, DOOMED), 'utf8')).toBe('doomed v1\n')
    expect(nodeFs.existsSync(join(d, FRESH))).toBe(false)
    expect(nodeFs.existsSync(join(d, 'content/page'))).toBe(false)
  }

  /** A bounded fault: fails the first `times` matching calls, then lets everything through, so
   *  the restore itself runs against a healthy filesystem. isomorphic-git retries a failed
   *  write once after creating its parent directory, so a write fault needs `times: 2`. */
  const failing = (
    match: (op: Op, path: string) => boolean,
    err: Error,
    times = Infinity
  ): Fault => {
    let left = times
    return async (op, path) => {
      if (left <= 0 || !match(op, path)) return undefined
      left--
      return err
    }
  }

  const stages: Array<{ name: string; fault: (d: string) => Fault }> = [
    {
      name: 'mid-write (disk full after a partial write of the new file)',
      fault: (d) => {
        let fired = false
        return async (op, path, args) => {
          if (fired || op !== 'writeFile' || path !== join(d, FRESH))
            return undefined
          fired = true
          // Simulate ENOSPC part-way through: some bytes land, then the write fails.
          await nodeFs.promises.writeFile(path, String(args[1]).slice(0, 5))
          return ioError('ENOSPC', 'ENOSPC: no space left on device')
        }
      }
    },
    {
      name: 'at remove (index write fails after the unlink)',
      fault: (d) =>
        failing(
          (op, p) => op === 'writeFile' && p === join(d, '.git', 'index'),
          ioError('EIO', 'EIO: index write failed'),
          2
        )
    },
    {
      name: 'at add (reading the written file back fails)',
      fault: (d) =>
        failing(
          (op, p) =>
            (op === 'readFile' || op === 'lstat') && p === join(d, FRESH),
          ioError('EIO', 'EIO: add failed'),
          1
        )
    },
    {
      name: 'at commit (ref update fails)',
      fault: (d) =>
        failing(
          (op, p) =>
            op === 'writeFile' &&
            p.startsWith(join(d, '.git', 'refs', 'heads')),
          ioError('EACCES', 'EACCES: ref locked')
        )
    }
  ]

  it.each(stages)(
    'leaves `git status` clean and every file at HEAD when the batch fails $name',
    async ({ fault }) => {
      const s = seed()
      dir = s.dir
      const hook: { current: Fault | undefined } = { current: fault(s.dir) }
      const a = createLocalGitAdapter({ dir: s.dir, fs: faultyFs(hook) })

      const thrown = await a.commitFiles(batch).then(
        () => undefined,
        (e: unknown) => e
      )
      // The ORIGINAL error is rethrown, untouched.
      expect(thrown).toBeInstanceOf(Error)
      expect(thrown).not.toBeInstanceOf(AggregateError)
      expect((thrown as Error).message).toMatch(/ENOSPC|EIO|EACCES/)
      hook.current = undefined
      expectAtHead(s.dir, s.head)

      // The index is clean too: the next commit carries ONLY its own change.
      await a.commitFile({
        path: 'content/post/en/next.mdoc',
        content: 'next\n',
        message: 'next',
        author: AUTHOR
      })
      expect(cli(s.dir, 'show', '--name-status', '--format=', 'HEAD')).toBe(
        'A\tcontent/post/en/next.mdoc'
      )
      expect(status(s.dir)).toBe('')
    }
  )

  it('single-file commitFile also restores on failure (it shares the batch path)', async () => {
    const s = seed()
    dir = s.dir
    const hook: { current: Fault | undefined } = {
      current: failing(
        (op, p) =>
          op === 'writeFile' &&
          p.startsWith(join(s.dir, '.git', 'refs', 'heads')),
        ioError('EACCES', 'EACCES: ref locked')
      )
    }
    const a = createLocalGitAdapter({ dir: s.dir, fs: faultyFs(hook) })
    await expect(
      a.commitFile({
        path: EXISTING,
        content: 'v2\n',
        message: 'm',
        author: AUTHOR
      })
    ).rejects.toThrow(/EACCES/)
    hook.current = undefined
    expectAtHead(s.dir, s.head)
  })

  it('surfaces BOTH errors when restoring the working tree also fails', async () => {
    const s = seed()
    dir = s.dir
    let commitFailed = false
    const original = ioError('EACCES', 'EACCES: ref locked')
    const hook: { current: Fault | undefined } = {
      current: async (op, p) => {
        // Every ref write fails (isomorphic-git retries once), always with the same instance.
        if (
          op === 'writeFile' &&
          p.startsWith(join(s.dir, '.git', 'refs', 'heads'))
        ) {
          commitFailed = true
          return original
        }
        // Once the commit has failed, the restore's rewrite of EXISTING fails as well.
        if (commitFailed && op === 'writeFile' && p === join(s.dir, EXISTING))
          return ioError('EROFS', 'EROFS: read-only file system')
        return undefined
      }
    }
    const a = createLocalGitAdapter({ dir: s.dir, fs: faultyFs(hook) })
    const thrown = await a.commitFiles(batch).then(
      () => undefined,
      (e: unknown) => e
    )
    expect(thrown).toBeInstanceOf(AggregateError)
    const agg = thrown as AggregateError
    expect(agg.cause).toBe(original)
    expect(agg.errors[0]).toBe(original)
    expect(agg.errors.some((e: Error) => /EROFS/.test(e.message))).toBe(true)
    expect(agg.message).toContain(EXISTING)
    expect(agg.message).toMatch(/restor/i)
    // Every path that COULD be restored still was.
    hook.current = undefined
    expect(nodeFs.readFileSync(join(s.dir, DOOMED), 'utf8')).toBe('doomed v1\n')
    expect(nodeFs.existsSync(join(s.dir, FRESH))).toBe(false)
  })

  it('a batch on an unborn HEAD (empty repo) that fails removes everything it wrote', async () => {
    const d = mkdtempSync(join(tmpdir(), 'setu-git-restore-'))
    dir = d
    cli(d, 'init', '-q', '-b', 'main')
    const hook: { current: Fault | undefined } = {
      current: failing(
        (op, p) =>
          op === 'writeFile' && p.startsWith(join(d, '.git', 'refs', 'heads')),
        ioError('EACCES', 'EACCES: ref locked')
      )
    }
    const a = createLocalGitAdapter({ dir: d, fs: faultyFs(hook) })
    await expect(
      a.commitFiles({
        changes: [
          { path: 'a.mdoc', content: 'A' },
          { path: 'deep/er/b.mdoc', content: 'B' }
        ],
        message: 'm',
        author: AUTHOR
      })
    ).rejects.toThrow(/EACCES/)
    hook.current = undefined
    expect(status(d)).toBe('')
    expect(nodeFs.readdirSync(d)).toEqual(['.git'])
  })
})
