import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  renameSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseGitLogDates,
  gitDateSweep,
  primeGitDateSweep,
  resetGitDateSweepForTests,
  resolvePostDate
} from '../src/lib/post-date'

/** One `git` call in a fixture repo (test setup + per-file ground truth). */
const git = (cwd: string, args: string[], env: Record<string, string> = {}) =>
  execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@t',
      ...env
    }
  }).trim()

const commit = (cwd: string, msg: string, isoDate: string) =>
  git(cwd, ['commit', '-q', '--no-verify', '-m', msg], {
    GIT_AUTHOR_DATE: isoDate,
    GIT_COMMITTER_DATE: isoDate
  })

/** The exact per-file behavior the sweep must reproduce (see gitCommitDate). */
const perFileDate = (cwd: string, file: string) =>
  git(cwd, ['log', '-1', '--format=%cI', '--', file])

describe('parseGitLogDates', () => {
  const RS = '\x1e'
  it('takes the FIRST (newest) occurrence per path', () => {
    const out = [
      `${RS}2024-01-01T10:00:00Z\n\nM\tcontent/a.mdoc\n`,
      `${RS}2020-01-01T10:00:00Z\n\nA\tcontent/a.mdoc\nA\tcontent/b.mdoc\n`
    ].join('')
    const map = parseGitLogDates(out)
    expect(map.get('content/a.mdoc')).toBe('2024-01-01T10:00:00Z')
    expect(map.get('content/b.mdoc')).toBe('2020-01-01T10:00:00Z')
  })
  it('maps BOTH sides of a rename line to the rename commit date', () => {
    const out = `${RS}2022-03-03T10:00:00Z\n\nR100\told.mdoc\tnew.mdoc\n`
    const map = parseGitLogDates(out)
    expect(map.get('new.mdoc')).toBe('2022-03-03T10:00:00Z')
    expect(map.get('old.mdoc')).toBe('2022-03-03T10:00:00Z')
  })
  it('handles combined-diff merge status (MM) and file-less commits', () => {
    const out = [
      `${RS}2024-06-01T00:00:00Z\n\n`, // clean merge — no file lines
      `${RS}2024-05-01T00:00:00Z\n\nMM\tconflict.mdoc\n`,
      `${RS}2024-04-01T00:00:00Z\n\nD\tgone.mdoc\n`
    ].join('')
    const map = parseGitLogDates(out)
    expect(map.get('conflict.mdoc')).toBe('2024-05-01T00:00:00Z')
    expect(map.get('gone.mdoc')).toBe('2024-04-01T00:00:00Z')
    expect(map.size).toBe(2)
  })
  it('tolerates empty input', () => {
    expect(parseGitLogDates('').size).toBe(0)
  })
})

describe('git date sweep — parity with per-file `git log -1` on a fixture repo', () => {
  let repo = ''
  const rel = (f: string) => `content/post/en/${f}`
  const abs = (f: string) => join(repo, rel(f))

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'sweep-'))
    mkdirSync(join(repo, 'content/post/en'), { recursive: true })
    git(repo, ['init', '-q'])
    // a.mdoc: two commits — the sweep must report the SECOND (newest) date.
    writeFileSync(abs('a.mdoc'), 'one')
    git(repo, ['add', '-A'])
    commit(repo, 'c1', '2020-01-01T10:00:00+00:00')
    writeFileSync(abs('a.mdoc'), 'two')
    writeFileSync(abs('b.mdoc'), 'b')
    git(repo, ['add', '-A'])
    commit(repo, 'c2', '2021-02-02T10:00:00+00:00')
    // b.mdoc → c.mdoc rename (git log -1 does NOT --follow; both paths date to the rename).
    git(repo, ['mv', rel('b.mdoc'), rel('c.mdoc')])
    commit(repo, 'c3 rename', '2022-03-03T10:00:00+00:00')
    // side branch + clean --no-ff merge: per-file reports the BRANCH commit, never the merge.
    git(repo, ['branch', 'side'])
    writeFileSync(abs('a.mdoc'), 'main-edit')
    git(repo, ['add', '-A'])
    commit(repo, 'c4', '2023-01-01T10:00:00+00:00')
    git(repo, ['switch', '-q', 'side'])
    writeFileSync(abs('e.mdoc'), 'e')
    git(repo, ['add', '-A'])
    commit(repo, 'side1', '2023-06-01T10:00:00+00:00')
    git(repo, ['switch', '-q', '-'])
    git(repo, ['merge', '-q', '--no-ff', '-m', 'merge', 'side'], {
      GIT_AUTHOR_DATE: '2024-01-01T10:00:00+00:00',
      GIT_COMMITTER_DATE: '2024-01-01T10:00:00+00:00'
    })
    // d.mdoc: never committed — must be MISSING from the sweep (fallback territory).
    writeFileSync(abs('d.mdoc'), 'uncommitted')
  })

  afterAll(() => {
    resetGitDateSweepForTests()
    rmSync(repo, { recursive: true, force: true })
  })

  it('sweep date === `git log -1 --format=%cI -- <file>` for every committed file', () => {
    const sweep = gitDateSweep(join(repo, 'content/post/en'))
    expect(sweep).not.toBeNull()
    for (const f of ['a.mdoc', 'c.mdoc', 'e.mdoc']) {
      expect(sweep!.dates.get(rel(f)), rel(f)).toBe(perFileDate(repo, abs(f)))
    }
    // Sanity: the fixture actually exercises multi-commit, rename, and merge cases.
    expect(perFileDate(repo, abs('a.mdoc'))).toContain('2023-01-01')
    expect(perFileDate(repo, abs('c.mdoc'))).toContain('2022-03-03')
    expect(perFileDate(repo, abs('e.mdoc'))).toContain('2023-06-01')
  })

  it('uncommitted files are absent from the sweep', () => {
    const sweep = gitDateSweep(repo)
    expect(sweep!.dates.has(rel('d.mdoc'))).toBe(false)
  })

  it('sweep of a non-repo directory returns null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'norepo-'))
    try {
      expect(gitDateSweep(dir)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolvePostDate consumes a primed sweep without spawning per-file git', () => {
    primeGitDateSweep(join(repo, 'content/post/en'))
    // Disable git entirely: any per-file fallback would now fail to a recent mtime,
    // so a historical date can ONLY have come from the in-memory sweep.
    renameSync(join(repo, '.git'), join(repo, '.git-moved'))
    try {
      const d = resolvePostDate({ data: {}, filePath: abs('a.mdoc') })
      expect(d.toISOString()).toBe(
        new Date('2023-01-01T10:00:00Z').toISOString()
      )
      // Missing from the sweep → falls through (here: mtime, since git is gone).
      const fallback = resolvePostDate({ data: {}, filePath: abs('d.mdoc') })
      expect(Date.now() - fallback.getTime()).toBeLessThan(3_600_000)
    } finally {
      renameSync(join(repo, '.git-moved'), join(repo, '.git'))
    }
  })

  it('frontmatter date still beats the sweep', () => {
    primeGitDateSweep(join(repo, 'content/post/en'))
    const d = resolvePostDate({
      data: { date: '2019-05-05' },
      filePath: abs('a.mdoc')
    })
    expect(d.getUTCFullYear()).toBe(2019)
  })
})
