import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { createGitApi } from '../src/app'
import { createMemoryGitPort } from '@setu/git-memory'
import { resolveConfig } from '@setu/core'
import type { GitPort, CommitInput, CommitFilesInput } from '@setu/core'
import type { ResolvedActor } from '../src/auth/resolve-actor'

const author = { name: 'T', email: 't@x.com' }

const config = resolveConfig({
  collections: [
    {
      name: 'product',
      fields: z.object({
        sku: z.string(),
        category: z.enum(['resin', 'machine'])
      })
    }
  ]
})

/** Records every commit the ROUTE actually reached the port with. A rejected write must leave
 *  this empty — asserting on the port rather than on a later read avoids the #623 trap, where
 *  `GET /git/file` resolves at HEAD and can look clean while the adapter already wrote to disk. */
function spyCommits(git: GitPort): { port: GitPort; calls: string[][] } {
  const calls: string[][] = []
  const port: GitPort = {
    ...git,
    commitFile(input: CommitInput) {
      calls.push([input.path])
      return git.commitFile(input)
    },
    commitFiles(input: CommitFilesInput) {
      calls.push(input.changes.map((ch) => ch.path))
      return git.commitFiles(input)
    }
  }
  return { port, calls }
}

const admin = (): ResolvedActor => ({ id: 'local', role: 'admin' })

function api(actor: () => ResolvedActor = admin) {
  const { port, calls } = spyCommits(createMemoryGitPort())
  return { app: createGitApi(port, actor, { getConfig: () => config }), calls }
}

const commitFiles = (
  app: ReturnType<typeof createGitApi>,
  changes: unknown[]
) =>
  app.fetch(
    new Request('http://x/git/commit-files', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ changes, message: 'm', author })
    })
  )

const mdoc = (frontmatter: string) => `---\n${frontmatter}\n---\n\nBody.\n`

describe('POST /git/commit-files — collection field validation', () => {
  it('rejects an entry whose frontmatter violates the declared schema, and commits nothing', async () => {
    const { app, calls } = api()
    const res = await commitFiles(app, [
      {
        path: 'content/product/en/polygrout.mdoc',
        content: mdoc('title: Polygrout\ncategory: sealant')
      }
    ])
    expect(res.status).toBe(422)
    const body = (await res.json()) as {
      error: string
      issues: { path: string; field: string; message: string }[]
    }
    expect(body.issues.map((i) => i.field).sort()).toEqual(['category', 'sku'])
    expect(body.issues[0]?.path).toBe('content/product/en/polygrout.mdoc')
    expect(calls).toEqual([])
  })

  it('accepts an entry that satisfies the declared schema', async () => {
    const { app, calls } = api()
    const res = await commitFiles(app, [
      {
        path: 'content/product/en/polygrout.mdoc',
        content: mdoc('title: Polygrout\nsku: PG-100\ncategory: resin')
      }
    ])
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
  })

  it('rejects a whole mixed commit when any one entry is invalid', async () => {
    const { app, calls } = api()
    const res = await commitFiles(app, [
      {
        path: 'content/product/en/a.mdoc',
        content: mdoc('title: A\nsku: A-1\ncategory: resin')
      },
      { path: 'content/product/en/b.mdoc', content: mdoc('title: B') }
    ])
    expect(res.status).toBe(422)
    expect(calls).toEqual([])
  })

  // A repo may hold content under a collection the config never declares (`content/blog/…`
  // in the git-authz-* suites is a live example). Those writes pass this gate untouched —
  // it only claims that fields match a DECLARED schema. Failing closed here would lock an
  // existing site out of its own content on upgrade, with no safety gain.
  it('leaves an undeclared collection unvalidated rather than failing closed', async () => {
    const { app, calls } = api()
    const res = await commitFiles(app, [
      { path: 'content/widget/en/x.mdoc', content: mdoc('title: X') }
    ])
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
  })

  // ...and the permission gate still covers it, so pass-through is not a hole.
  it('still applies the authz gate to an undeclared collection', async () => {
    const { app, calls } = api(() => ({ id: 'a', role: 'author' }))
    const res = await commitFiles(app, [
      {
        path: 'content/widget/en/x.mdoc',
        content: mdoc('title: X\npublished: true')
      }
    ])
    expect(res.status).toBe(403)
    expect(calls).toEqual([])
  })

  it('leaves post and page writes working exactly as before', async () => {
    const { app, calls } = api()
    const res = await commitFiles(app, [
      {
        path: 'content/post/en/hello.mdoc',
        content: mdoc('title: Hello\ntags:\n  - a')
      },
      { path: 'content/page/en/about.mdoc', content: mdoc('title: About') }
    ])
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
  })

  it('ignores paths that are not content entries', async () => {
    const { app, calls } = api()
    const res = await commitFiles(app, [
      { path: 'settings.json', content: '{"general":{"title":"S"}}' }
    ])
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
  })

  it('ignores deletions', async () => {
    const { app, calls } = api()
    const res = await commitFiles(app, [
      { path: 'content/product/en/gone.mdoc', delete: true }
    ])
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
  })

  // `parseMdoc` never throws: a body-only file and one with malformed YAML both yield `{}`,
  // and they are indistinguishable from each other. So the gate validates that `{}` like any
  // other metadata rather than special-casing it. For a collection with no required fields
  // that is a no-op — the pre-existing behaviour for every body-only post.
  it('accepts a body-only entry in a collection with no required fields', async () => {
    const { app, calls } = api()
    const res = await commitFiles(app, [
      { path: 'content/post/en/broken.mdoc', content: 'no frontmatter here' }
    ])
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
  })

  it('reports every required field of a body-only entry in a collection that declares them', async () => {
    const { app, calls } = api()
    const res = await commitFiles(app, [
      { path: 'content/product/en/broken.mdoc', content: 'no frontmatter here' }
    ])
    expect(res.status).toBe(422)
    const body = (await res.json()) as { issues: { field: string }[] }
    expect(body.issues.map((i) => i.field).sort()).toEqual(['category', 'sku'])
    expect(calls).toEqual([])
  })

  // Rejecting malformed *Markdoc body* at save is a settled non-goal — this gate reads
  // frontmatter fields only and never inspects the body.
  it('accepts an entry whose body is arbitrary text, when its fields are valid', async () => {
    const { app, calls } = api()
    const res = await commitFiles(app, [
      {
        path: 'content/product/en/ok.mdoc',
        content: `---\ntitle: OK\nsku: S-1\ncategory: resin\n---\n\n{% unclosed %} <<< ???\n`
      }
    ])
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
  })

  // Ordering matters: an actor who may not write at all must not learn the field schema from a
  // 422. The payload here is BOTH forbidden (an author publishing — they lack content.publish)
  // AND invalid (no sku, no category), so the status is a real discriminator: 403 means authz
  // ran first, 422 means validation did. A payload that only one gate rejects would pass under
  // either order and assert nothing (the #638 vacuous-stub trap — this test was written that
  // way first and the kill-shot caught it).
  it('403s the wrong actor before validating, not 422', async () => {
    const { app, calls } = api(() => ({ id: 'a', role: 'author' }))
    const res = await commitFiles(app, [
      {
        path: 'content/product/en/x.mdoc',
        content: mdoc('title: X\npublished: true')
      }
    ])
    expect(res.status).toBe(403)
    expect(calls).toEqual([])
  })

  it('validates the single-file /git/commit route too', async () => {
    const { port, calls } = spyCommits(createMemoryGitPort())
    const app = createGitApi(port, admin, { getConfig: () => config })
    const res = await app.fetch(
      new Request('http://x/git/commit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          path: 'content/product/en/x.mdoc',
          content: mdoc('title: X'),
          message: 'm',
          author
        })
      })
    )
    expect(res.status).toBe(422)
    expect(calls).toEqual([])
  })
})

describe('POST /git/commit-files — without a config seam', () => {
  it('falls back to the default collections and still writes post/page', async () => {
    const { port, calls } = spyCommits(createMemoryGitPort())
    const app = createGitApi(port, admin)
    const res = await app.fetch(
      new Request('http://x/git/commit-files', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          changes: [
            {
              path: 'content/post/en/hello.mdoc',
              content: mdoc('title: Hello')
            }
          ],
          message: 'm',
          author
        })
      })
    )
    expect(res.status).toBe(200)
    expect(calls).toHaveLength(1)
  })
})
