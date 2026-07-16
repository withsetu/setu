import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import nodeFs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import * as git from 'isomorphic-git'
import { createLocalGitAdapter } from '../src/index'

/** Run the real git CLI against the repo — an out-of-band writer the adapter
 *  does not know about (a user running `git commit`/`git gc` directly in the
 *  content repo between adapter operations is a supported scenario). */
function cli(dir: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=CLI', '-c', 'user.email=cli@x.com', ...args],
    { cwd: dir, stdio: 'pipe' }
  )
    .toString()
    .trim()
}

function cliCommit(dir: string, path: string, content: string): string {
  const full = join(dir, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
  cli(dir, 'add', path)
  cli(dir, 'commit', '-q', '-m', `cli: ${path}`)
  return cli(dir, 'rev-parse', 'HEAD')
}

describe('git-local adapter (on-disk)', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
      dir = undefined
    }
  })

  it('persists a commit readable by a fresh adapter on the same repo', async () => {
    dir = mkdtempSync(join(tmpdir(), 'setu-git-'))
    await git.init({ fs: nodeFs, dir, defaultBranch: 'main' })

    const a = createLocalGitAdapter({ dir })
    const { sha } = await a.commitFile({
      path: 'content/hello.mdoc',
      content: '# Hi',
      message: 'add hello',
      author: { name: 'Ed', email: 'ed@x.com' }
    })
    expect(sha).toMatch(/^[0-9a-f]{40}$/)

    const b = createLocalGitAdapter({ dir })
    expect(await b.headSha()).toBe(sha)
    expect(await b.readFile('content/hello.mdoc')).toBe('# Hi')
  })

  it('rejects a path that escapes the repository root', async () => {
    dir = mkdtempSync(join(tmpdir(), 'setu-git-'))
    await git.init({ fs: nodeFs, dir, defaultBranch: 'main' })
    const a = createLocalGitAdapter({ dir })
    await expect(
      a.commitFile({
        path: '../escape.mdoc',
        content: 'X',
        message: 'm',
        author: { name: 'E', email: 'e@x.com' }
      })
    ).rejects.toThrow(/escape/i)
  })

  it('serializes concurrent commits to different paths without cross-contamination', async () => {
    dir = mkdtempSync(join(tmpdir(), 'setu-git-'))
    await git.init({ fs: nodeFs, dir, defaultBranch: 'main' })
    const a = createLocalGitAdapter({ dir })
    await Promise.all([
      a.commitFile({
        path: 'x.mdoc',
        content: 'X',
        message: 'mx',
        author: { name: 'E', email: 'e@x.com' }
      }),
      a.commitFile({
        path: 'y.mdoc',
        content: 'Y',
        message: 'my',
        author: { name: 'E', email: 'e@x.com' }
      })
    ])
    expect(await a.readFile('x.mdoc')).toBe('X')
    expect(await a.readFile('y.mdoc')).toBe('Y')
  })

  // #504: readFile/readFileAt resolve paths through the adapter's
  // content-addressed tree memo. These pin parity with isomorphic-git's own
  // readBlob({ oid, filepath }) semantics for the odd inputs (probed against
  // the pre-#504 adapter): directory path / path through a blob → throws
  // ObjectTypeError; leading or trailing slash → throws InvalidFilepathError;
  // a '.' segment → null (never a real tree-entry name).
  describe('path-resolution parity (#504)', () => {
    const PATH = 'content/post/en/a.mdoc'

    async function seeded() {
      dir = mkdtempSync(join(tmpdir(), 'setu-git-'))
      await git.init({ fs: nodeFs, dir, defaultBranch: 'main' })
      const a = createLocalGitAdapter({ dir })
      const { sha } = await a.commitFile({
        path: PATH,
        content: 'A',
        message: 'seed',
        author: { name: 'E', email: 'e@x.com' }
      })
      return { a, sha }
    }

    it('throws on a directory path (a tree is not a blob)', async () => {
      const { a, sha } = await seeded()
      await expect(a.readFile('content/post')).rejects.toThrow(/blob/i)
      await expect(a.readFileAt!(sha, 'content/post')).rejects.toThrow(/blob/i)
    })

    it('throws when a path segment crosses THROUGH a blob', async () => {
      const { a } = await seeded()
      await expect(a.readFile(`${PATH}/x`)).rejects.toThrow(/blob/i)
    })

    it('throws on leading or trailing directory separators', async () => {
      const { a } = await seeded()
      await expect(a.readFile(`/${PATH}`)).rejects.toThrow(/separator/i)
      await expect(a.readFile(`${PATH}/`)).rejects.toThrow(/separator/i)
    })

    it("returns null for a '.' segment (not a tree-entry name)", async () => {
      const { a } = await seeded()
      expect(await a.readFile('content/./post/en/a.mdoc')).toBeNull()
    })

    it('resolves the same path repeatedly and across revisions (memo correctness)', async () => {
      const { a, sha: v1 } = await seeded()
      const { sha: v2 } = await a.commitFile({
        path: PATH,
        content: 'B',
        message: 'edit',
        author: { name: 'E', email: 'e@x.com' }
      })
      // repeated reads (memo warm) and historical reads must not cross-talk
      expect(await a.readFile(PATH)).toBe('B')
      expect(await a.readFile(PATH)).toBe('B')
      expect(await a.readFileAt!(v1, PATH)).toBe('A')
      expect(await a.readFileAt!(v2, PATH)).toBe('B')
      expect(await a.readFileAt!(v1, PATH)).toBe('A')
    })
  })

  // #504: the adapter keeps a long-lived isomorphic-git cache. These cases pin
  // the freshness contract that makes that safe: refs are NEVER served from the
  // cache (isomorphic-git's resolveRef takes no cache; only immutable
  // content-addressed pack data and the stat-revalidated .git/index are), so a
  // commit the adapter did not make — git CLI, another process — must be
  // visible on the very next call.
  describe('stays fresh after out-of-band commits (#504)', () => {
    const PATH = 'content/post/en/a.mdoc'

    async function warmAdapter() {
      dir = mkdtempSync(join(tmpdir(), 'setu-git-'))
      await git.init({ fs: nodeFs, dir, defaultBranch: 'main' })
      const a = createLocalGitAdapter({ dir })
      const { sha } = await a.commitFile({
        path: PATH,
        content: 'v1',
        message: 'seed',
        author: { name: 'E', email: 'e@x.com' }
      })
      // Warm every read path so any cached state exists before the CLI writes.
      expect(await a.headSha()).toBe(sha)
      expect(await a.readFile(PATH)).toBe('v1')
      expect(await a.list('content/')).toEqual([PATH])
      expect(await a.readFileAt!(sha, PATH)).toBe('v1')
      expect((await a.log!(PATH)).map((e) => e.sha)).toEqual([sha])
      return { a, seeded: sha }
    }

    it('headSha and readFile reflect a git-CLI commit made after warm reads', async () => {
      const { a } = await warmAdapter()
      const cliSha = cliCommit(dir!, PATH, 'v2-from-cli')
      expect(await a.headSha()).toBe(cliSha)
      expect(await a.readFile(PATH)).toBe('v2-from-cli')
    })

    it('list and readFile see a NEW file committed via the git CLI', async () => {
      const { a } = await warmAdapter()
      cliCommit(dir!, 'content/post/en/new.mdoc', 'brand new')
      expect([...(await a.list('content/'))].sort()).toEqual([
        PATH,
        'content/post/en/new.mdoc'
      ])
      expect(await a.readFile('content/post/en/new.mdoc')).toBe('brand new')
    })

    it('diffPaths spans an out-of-band commit', async () => {
      const { a, seeded } = await warmAdapter()
      const cliSha = cliCommit(dir!, PATH, 'v2-from-cli')
      expect(await a.diffPaths(seeded, cliSha)).toEqual([
        { path: PATH, status: 'modified' }
      ])
    })

    it('log and readFileAt include the out-of-band revision', async () => {
      const { a, seeded } = await warmAdapter()
      const cliSha = cliCommit(dir!, PATH, 'v2-from-cli')
      expect((await a.log!(PATH)).map((e) => e.sha)).toEqual([cliSha, seeded])
      expect(await a.readFileAt!(cliSha, PATH)).toBe('v2-from-cli')
      expect(await a.readFileAt!(seeded, PATH)).toBe('v1')
    })

    it('survives an out-of-band `git gc` (loose objects repacked) and still sees later commits', async () => {
      const { a, seeded } = await warmAdapter()
      cli(dir!, 'gc', '--quiet', '--aggressive', '--prune=now')
      // Reads after the repack: same content, now served from a packfile.
      expect(await a.readFile(PATH)).toBe('v1')
      expect(await a.headSha()).toBe(seeded)
      // A commit AFTER the repack must be visible too.
      const cliSha = cliCommit(dir!, PATH, 'v2-after-gc')
      expect(await a.headSha()).toBe(cliSha)
      expect(await a.readFile(PATH)).toBe('v2-after-gc')
      expect(await a.diffPaths(seeded, cliSha)).toEqual([
        { path: PATH, status: 'modified' }
      ])
    })

    it('the adapter can still commit ON TOP of an out-of-band commit', async () => {
      const { a } = await warmAdapter()
      const cliSha = cliCommit(dir!, PATH, 'v2-from-cli')
      const { sha } = await a.commitFile({
        path: PATH,
        content: 'v3-from-adapter',
        message: 'back to the adapter',
        author: { name: 'E', email: 'e@x.com' }
      })
      expect(sha).not.toBe(cliSha)
      expect(await a.headSha()).toBe(sha)
      expect(await a.readFile(PATH)).toBe('v3-from-adapter')
      expect(cli(dir!, 'rev-parse', `${sha}^`)).toBe(cliSha) // parented on the CLI commit
    })
  })
})
