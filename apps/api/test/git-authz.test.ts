import { describe, it, expect } from 'vitest'
import { createGitApi } from '../src/app'
import { createMemoryGitPort } from '@setu/git-memory'
import type { Role } from '@setu/core'
import type { ResolveActor } from '../src/auth/resolve-actor'

// #362 — /git/* is the repository write API and had NO authz gate (OWASP A01): an anonymous POST
// /git/commit could rewrite any file in the content repo. WRITES now require `content.edit`. With
// the read-only viewer role removed (#379) every staff role holds content.edit, so the only deny
// path left is the unauthenticated one (no actor → 401). READS (head/file/list) stay ungated on
// purpose: the admin bootstrap reads git.headSha() before a session exists, so gating reads would hang the app on
// "Loading…" (caught in live UAT) — read-gating is deferred to #110 (bootstrap must defer its read).
// The server is the enforcement boundary; the admin's HttpGitPort carries the session cookie
// (credentials: 'include' via apiFetch — see apps/admin/src/data/Bootstrap.tsx).

const asRole = (role: Role): ResolveActor => () => ({ id: 'u', role })
const unauthenticated: ResolveActor = () => null
const author = { name: 'T', email: 't@x.com' }

const commitBody = JSON.stringify({ path: 'p.mdoc', content: 'X', message: 'm', author })
const commitFilesBody = JSON.stringify({ changes: [{ path: 'p.mdoc', content: 'X' }], message: 'm', author })

const WRITE_ROUTES: Array<[string, string]> = [
  ['/git/commit', commitBody],
  ['/git/commit-files', commitFilesBody],
]
const READ_ROUTES = ['/git/head', '/git/file?path=p.mdoc', '/git/list']

function app(resolveActor: ResolveActor) {
  return createGitApi(createMemoryGitPort(), resolveActor)
}
const write = (a: ReturnType<typeof createGitApi>, path: string, body: string) =>
  a.fetch(new Request(`http://x${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body }))
const read = (a: ReturnType<typeof createGitApi>, path: string) => a.fetch(new Request(`http://x${path}`))

describe('createGitApi — authz enforcement (#362, the Git-write hole)', () => {
  it('rejects an UNAUTHENTICATED caller on WRITES with 401', async () => {
    const a = app(unauthenticated)
    for (const [path, body] of WRITE_ROUTES) expect((await write(a, path, body)).status, `POST ${path}`).toBe(401)
  })

  it('leaves READS ungated — even an unauthenticated caller gets 200 (bootstrap reads pre-session; see #110)', async () => {
    const a = app(unauthenticated)
    for (const path of READ_ROUTES) expect((await read(a, path)).status, `GET ${path}`).toBe(200)
  })

  it('allows an AUTHOR to write (content.edit) — commit succeeds', async () => {
    const a = app(asRole('author'))
    const res = await write(a, '/git/commit', commitBody)
    expect(res.status).toBe(200)
    expect((await res.json() as { sha: string }).sha).toBeTypeOf('string')
  })

  it('allows a MAINTAINER to write — commit-files succeeds', async () => {
    const a = app(asRole('maintainer'))
    expect((await write(a, '/git/commit-files', commitFilesBody)).status).toBe(200)
  })
})
