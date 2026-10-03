import { describe, it, expect } from 'vitest'
import {
  createGitApi,
  isCanonicalRepoPath,
  writablePathAction,
  WRITABLE_REPO_PATHS
} from '../src/app'
import { createMemoryGitPort } from '@setu/git-memory'
import { HEALTH_STATE_PATH, TAXONOMY_PATH } from '@setu/core'
import type { Role } from '@setu/core'
import type { ResolveActor } from '../src/auth/resolve-actor'

// #1154: the git write routes accept only the repo paths the CMS itself writes. Every other path
// is refused with 400 for EVERY role, admin included — the allowlist is about what the CMS is,
// not about who is asking. Each allowlisted shape maps to the action it requires.

const asRole =
  (role: Role): ResolveActor =>
  () => ({ id: 'u', role })
const author = { name: 'T', email: 't@x.com' }
const ROLES: Role[] = ['author', 'editor', 'maintainer', 'admin']

/** Paths outside the allowlist. VCS internals (every case spelling), executed config, and an
 *  arbitrary unknown top-level path. */
const REFUSED = [
  '.git/config',
  '.git/hooks/pre-commit',
  '.GIT/x',
  '.Git/HEAD',
  'content/.git/en/x.mdoc', // entry-shaped, but inside a VCS-directory segment
  'setu.config.ts',
  'package.json',
  'astro.config.mjs',
  'unknown-top-level.txt',
  'scripts/build.mjs',
  'content/post/en/x.md', // wrong extension
  'content/post/x.mdoc', // wrong depth
  'content/post/en/sub/x.mdoc',
  'Settings.json', // case variant of an allowlisted root file
  'taxonomy/Categories.yaml',
  'taxonomy/other.yaml',
  'url-map.json', // build output, written by the site build — never by the CMS
  'redirects.json'
]

const DRAFT = '---\npublished: false\n---\nbody\n'

const write = (
  a: ReturnType<typeof createGitApi>,
  route: string,
  body: unknown
) =>
  a.fetch(
    new Request(`http://x${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  )

const single = (path: string, content = 'X') => ({
  path,
  content,
  message: 'm',
  author
})
const multi = (paths: string[], content = 'X') => ({
  changes: paths.map((path) => ({ path, content })),
  message: 'm',
  author
})

describe('git write allowlist (#1154)', () => {
  for (const role of ROLES)
    it(`refuses ${role} on every non-allowlisted path with 400, and nothing lands`, async () => {
      for (const path of REFUSED) {
        const git = createMemoryGitPort()
        const app = createGitApi(git, asRole(role))
        const one = await write(app, '/git/commit', single(path))
        expect(one.status, `${role} POST /git/commit ${path}`).toBe(400)
        const many = await write(app, '/git/commit-files', multi([path]))
        expect(many.status, `${role} POST /git/commit-files ${path}`).toBe(400)
        expect(await git.list(), `tree after ${path}`).toEqual([])
      }
    })

  it('refuses a deletion of a non-allowlisted path', async () => {
    const git = createMemoryGitPort()
    await git.commitFile(single('package.json', '{}'))
    const app = createGitApi(git, asRole('admin'))
    const res = await write(app, '/git/commit-files', {
      changes: [{ path: 'package.json', delete: true }],
      message: 'm',
      author
    })
    expect(res.status).toBe(400)
    expect(await git.readFile('package.json')).toBe('{}')
  })

  it('refuses a whole batch when ONE change is off the allowlist', async () => {
    const git = createMemoryGitPort()
    const app = createGitApi(git, asRole('admin'))
    const res = await write(
      app,
      '/git/commit-files',
      multi(['content/post/en/ok.mdoc', '.git/config'], DRAFT)
    )
    expect(res.status).toBe(400)
    expect(await git.list()).toEqual([])
  })

  it('names the refusal clearly (not a generic forbidden)', async () => {
    const app = createGitApi(createMemoryGitPort(), asRole('admin'))
    const res = await write(app, '/git/commit', single('setu.config.ts'))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'path is not writable through the CMS'
    })
  })

  it('still 401s an unauthenticated caller before any path check', async () => {
    const app = createGitApi(createMemoryGitPort(), () => null)
    expect(
      (await write(app, '/git/commit', single('.git/config'))).status
    ).toBe(401)
  })

  it('admits an author on a content entry draft', async () => {
    const git = createMemoryGitPort()
    const app = createGitApi(git, asRole('author'))
    const res = await write(
      app,
      '/git/commit',
      single('content/post/en/hello.mdoc', DRAFT)
    )
    expect(res.status).toBe(200)
    expect(await git.readFile('content/post/en/hello.mdoc')).toBe(DRAFT)
  })

  it('admits an author on the taxonomy file and the health-state file (content.edit)', async () => {
    for (const path of [TAXONOMY_PATH, HEALTH_STATE_PATH]) {
      const git = createMemoryGitPort()
      const app = createGitApi(git, asRole('author'))
      const res = await write(app, '/git/commit', single(path, 'x: 1\n'))
      expect(res.status, path).toBe(200)
    }
  })

  it('settings.json needs settings.manage: author/editor/maintainer 403, admin 200', async () => {
    for (const role of ROLES) {
      const git = createMemoryGitPort()
      const app = createGitApi(git, asRole(role))
      const res = await write(app, '/git/commit', single('settings.json', '{}'))
      expect(res.status, role).toBe(role === 'admin' ? 200 : 403)
    }
  })

  it('theme-options.json needs theme.manage: author/editor 403, maintainer/admin 200', async () => {
    for (const role of ROLES) {
      const git = createMemoryGitPort()
      const app = createGitApi(git, asRole(role))
      const res = await write(
        app,
        '/git/commit',
        single('theme-options.json', '{}')
      )
      expect(res.status, role).toBe(
        role === 'admin' || role === 'maintainer' ? 200 : 403
      )
    }
  })
})

describe('isCanonicalRepoPath refuses VCS-directory segments (#1154)', () => {
  it.each([
    '.git/config',
    '.GIT/x',
    'content/.git/en/x.mdoc',
    'content/post/en/.Git',
    'git~1/config'
  ])('refuses %j', (p) => {
    expect(isCanonicalRepoPath(p)).toBe(false)
  })

  it.each(['content/post/en/hello.mdoc', 'settings.json', '.github/x.yml'])(
    'still admits %j',
    (p) => {
      expect(isCanonicalRepoPath(p)).toBe(true)
    }
  )
})

describe('WRITABLE_REPO_PATHS — the single source of truth (#1154)', () => {
  it('maps each allowlisted shape to its required action', () => {
    expect(writablePathAction('content/post/en/a.mdoc')).toBe('content.edit')
    expect(writablePathAction(TAXONOMY_PATH)).toBe('content.edit')
    expect(writablePathAction(HEALTH_STATE_PATH)).toBe('content.edit')
    expect(writablePathAction('settings.json')).toBe('settings.manage')
    expect(writablePathAction('theme-options.json')).toBe('theme.manage')
    for (const p of REFUSED) expect(writablePathAction(p), p).toBeNull()
  })

  it('lists every shape exactly once', () => {
    const shapes = WRITABLE_REPO_PATHS.map((r) => r.shape)
    expect(new Set(shapes).size).toBe(shapes.length)
  })
})
