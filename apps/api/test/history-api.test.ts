import { describe, it, expect } from 'vitest'
import { createHistoryApi } from '../src/history-api'
import { createMemoryGitPort } from '@setu/git-memory'
import type { GitPort, Role } from '@setu/core'
import type { ResolveActor } from '../src/auth/resolve-actor'

// #466 — revision history from Git. The routes are content READS (list/file,
// `content.view`) plus ONE write (restore), which must ride the SAME
// write-permission derivation as /git/commit (`writeActionForChanges`): an
// author must not gain via "restore" what they can't do via a direct commit
// (failure mode #13 — the UI-only gate). Capability posture: adapters without
// the optional log/readFileAt (git-http/git-idb today) → honest 409, the
// media-reprocess precedent.

const asRole =
  (role: Role): ResolveActor =>
  () => ({ id: 'u', role })
const unauthenticated: ResolveActor = () => null
/** A session that carries a git identity — must be stamped over the body's. */
const withGitAuthor: ResolveActor = () => ({
  id: 'u',
  role: 'admin',
  gitAuthor: { name: 'Session User', email: 'session@x.com' }
})

const alice = { name: 'Alice', email: 'alice@x.com' }
const bob = { name: 'Bob', email: 'bob@x.com' }
const bodyAuthor = { name: 'Restorer', email: 'restorer@x.com' }

const LIVE = 'content/post/en/hello.mdoc'
const liveV = (n: number) => `---\ntitle: Hello\n---\n\nBody v${n}\n`
const DRAFT = 'content/post/en/draft.mdoc'
const draftV = (n: number) =>
  `---\ntitle: Draft\npublished: false\n---\n\nDraft v${n}\n`

/** Fresh in-memory repo: LIVE has 3 revisions (Alice, Bob, Alice), DRAFT has 2
 *  (both `published: false`, so restoring it only needs `content.edit`). */
async function seededGit(): Promise<GitPort> {
  const git = createMemoryGitPort()
  await git.commitFile({
    path: LIVE,
    content: liveV(1),
    message: 'first',
    author: alice
  })
  await git.commitFile({
    path: LIVE,
    content: liveV(2),
    message: 'second',
    author: bob
  })
  await git.commitFile({
    path: LIVE,
    content: liveV(3),
    message: 'third',
    author: alice
  })
  await git.commitFile({
    path: DRAFT,
    content: draftV(1),
    message: 'draft v1',
    author: alice
  })
  await git.commitFile({
    path: DRAFT,
    content: draftV(2),
    message: 'draft v2',
    author: alice
  })
  return git
}

/** The capability-absent adapter shape (git-http/git-idb today): the optional
 *  members are simply not functions. */
const stripHistory = (git: GitPort): GitPort => ({
  ...git,
  log: undefined,
  readFileAt: undefined
})

const app = (git: GitPort, resolveActor: ResolveActor) =>
  createHistoryApi(git, resolveActor)

const get = (a: ReturnType<typeof createHistoryApi>, path: string) =>
  a.fetch(new Request(`http://x${path}`))
const post = (a: ReturnType<typeof createHistoryApi>, body: unknown) =>
  a.fetch(
    new Request('http://x/api/history/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  )

const shaOf = async (git: GitPort, path: string, subject: string) => {
  const entries = await git.log!(path)
  const hit = entries.find((e) => e.subject === subject)
  if (!hit) throw new Error(`no commit with subject ${subject}`)
  return hit.sha
}

describe('/api/history — auth gate (fail closed)', () => {
  it('401s an UNAUTHENTICATED caller on every route', async () => {
    const a = app(await seededGit(), unauthenticated)
    expect((await get(a, `/api/history?path=${LIVE}`)).status).toBe(401)
    expect(
      (await get(a, `/api/history/file?sha=${'f'.repeat(40)}&path=${LIVE}`))
        .status
    ).toBe(401)
    expect(
      (await post(a, { path: LIVE, sha: 'f'.repeat(40), author: bodyAuthor }))
        .status
    ).toBe(401)
  })
})

describe('GET /api/history — revision list (content.view)', () => {
  it('returns the path revisions newest first with author/email/subject (author role can view)', async () => {
    const a = app(await seededGit(), asRole('author'))
    const res = await get(a, `/api/history?path=${LIVE}`)
    expect(res.status).toBe(200)
    const { entries } = (await res.json()) as {
      entries: { sha: string; author: string; subject: string; date: string }[]
    }
    expect(entries).toHaveLength(3)
    expect(entries.map((e) => e.subject)).toEqual(['third', 'second', 'first'])
    expect(entries.map((e) => e.author)).toEqual(['Alice', 'Bob', 'Alice'])
  })

  it('pages with limit/offset', async () => {
    const a = app(await seededGit(), asRole('author'))
    const firstPage = (await (
      await get(a, `/api/history?path=${LIVE}&limit=2`)
    ).json()) as { entries: { subject: string }[] }
    expect(firstPage.entries.map((e) => e.subject)).toEqual(['third', 'second'])
    const secondPage = (await (
      await get(a, `/api/history?path=${LIVE}&limit=2&offset=2`)
    ).json()) as { entries: { subject: string }[] }
    expect(secondPage.entries.map((e) => e.subject)).toEqual(['first'])
  })

  it('rejects an over-limit page size with 400 (rejected, not clamped — the index-api precedent)', async () => {
    const a = app(await seededGit(), asRole('author'))
    expect((await get(a, `/api/history?path=${LIVE}&limit=60`)).status).toBe(
      400
    )
  })

  it('rejects a non-content path and a traversal path with 400', async () => {
    const a = app(await seededGit(), asRole('author'))
    expect((await get(a, '/api/history?path=settings.json')).status).toBe(400)
    expect(
      (await get(a, '/api/history?path=content/../settings.json')).status
    ).toBe(400)
    expect((await get(a, '/api/history')).status).toBe(400) // path required
  })

  it('409s with a clear body when the adapter lacks the log capability', async () => {
    const a = app(stripHistory(await seededGit()), asRole('admin'))
    const res = await get(a, `/api/history?path=${LIVE}`)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'history unavailable in this mode'
    })
  })
})

describe('GET /api/history/file — content at a revision (content.view)', () => {
  it('returns the historical content for a known sha', async () => {
    const git = await seededGit()
    const a = app(git, asRole('author'))
    const sha = await shaOf(git, LIVE, 'first')
    const res = await get(a, `/api/history/file?sha=${sha}&path=${LIVE}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ content: liveV(1) })
  })

  it('rejects a malformed sha with 400', async () => {
    const a = app(await seededGit(), asRole('author'))
    expect(
      (await get(a, `/api/history/file?sha=not-a-sha&path=${LIVE}`)).status
    ).toBe(400)
  })

  it('404s an unknown (well-formed) sha and a path absent at that commit', async () => {
    const git = await seededGit()
    const a = app(git, asRole('author'))
    expect(
      (await get(a, `/api/history/file?sha=${'f'.repeat(40)}&path=${LIVE}`))
        .status
    ).toBe(404)
    // DRAFT did not exist yet at LIVE's first revision.
    const early = await shaOf(git, LIVE, 'first')
    expect(
      (await get(a, `/api/history/file?sha=${early}&path=${DRAFT}`)).status
    ).toBe(404)
  })

  it('409s when the adapter lacks the readFileAt capability', async () => {
    const a = app(stripHistory(await seededGit()), asRole('admin'))
    const res = await get(
      a,
      `/api/history/file?sha=${'f'.repeat(40)}&path=${LIVE}`
    )
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'history unavailable in this mode'
    })
  })
})

describe('POST /api/history/restore — same write derivation as /git/commit', () => {
  it('403s an AUTHOR restoring a LIVE post (matrix: author lacks content.publish; the committed state is live, so writeActionForChanges derives content.publish)', async () => {
    const git = await seededGit()
    const a = app(git, asRole('author'))
    const sha = await shaOf(git, LIVE, 'first')
    const res = await post(a, { path: LIVE, sha, author: bodyAuthor })
    expect(res.status).toBe(403)
    // and nothing was committed
    expect(await git.readFile(LIVE)).toBe(liveV(3))
  })

  it('allows an AUTHOR to restore a DRAFT (published: false at both ends -> content.edit, which authors hold)', async () => {
    const git = await seededGit()
    const a = app(git, asRole('author'))
    const sha = await shaOf(git, DRAFT, 'draft v1')
    const res = await post(a, { path: DRAFT, sha, author: bodyAuthor })
    expect(res.status).toBe(200)
    expect(await git.readFile(DRAFT)).toBe(draftV(1))
  })

  it('restores for an EDITOR (content.publish): commits the historical content and returns the new head sha', async () => {
    const git = await seededGit()
    const a = app(git, asRole('editor'))
    const sha = await shaOf(git, LIVE, 'first')
    const res = await post(a, { path: LIVE, sha, author: bodyAuthor })
    expect(res.status).toBe(200)
    const { sha: newSha } = (await res.json()) as { sha: string }
    expect(await git.headSha()).toBe(newSha)
    expect(await git.readFile(LIVE)).toBe(liveV(1))
    const [latest] = await git.log!(LIVE, { limit: 1 })
    expect(latest?.sha).toBe(newSha)
    expect(latest?.subject).toBe(`Restore ${LIVE} to ${sha.slice(0, 7)}`)
  })

  it('stamps the SESSION git identity over the body author (#382 — never trust the client for who committed)', async () => {
    const git = await seededGit()
    const a = app(git, withGitAuthor)
    const sha = await shaOf(git, LIVE, 'first')
    expect(
      (await post(a, { path: LIVE, sha, author: bodyAuthor })).status
    ).toBe(200)
    const [latest] = await git.log!(LIVE, { limit: 1 })
    expect(latest?.author).toBe('Session User')
  })

  it('400s when neither the session nor the body carries an author identity', async () => {
    const git = await seededGit()
    const a = app(git, asRole('editor')) // no gitAuthor on the actor
    const sha = await shaOf(git, LIVE, 'first')
    expect((await post(a, { path: LIVE, sha })).status).toBe(400)
  })

  it('rejects a malformed sha and a traversal/non-content path with 400', async () => {
    const a = app(await seededGit(), asRole('editor'))
    expect(
      (await post(a, { path: LIVE, sha: 'nope', author: bodyAuthor })).status
    ).toBe(400)
    expect(
      (
        await post(a, {
          path: 'content/../settings.json',
          sha: 'f'.repeat(40),
          author: bodyAuthor
        })
      ).status
    ).toBe(400)
    expect(
      (
        await post(a, {
          path: 'settings.json',
          sha: 'f'.repeat(40),
          author: bodyAuthor
        })
      ).status
    ).toBe(400)
  })

  it('404s an unknown (well-formed) sha', async () => {
    const a = app(await seededGit(), asRole('editor'))
    expect(
      (await post(a, { path: LIVE, sha: 'f'.repeat(40), author: bodyAuthor }))
        .status
    ).toBe(404)
  })

  it('409s when the adapter lacks the readFileAt capability', async () => {
    const a = app(stripHistory(await seededGit()), asRole('admin'))
    const res = await post(a, {
      path: LIVE,
      sha: 'f'.repeat(40),
      author: bodyAuthor
    })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'history unavailable in this mode'
    })
  })
})
