import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import nodeFs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as git from 'isomorphic-git'
import { createLocalGitAdapter } from '@setu/git-local'
import { createMemoryDataPort } from '@setu/db-memory'
import { createPublishService } from '@setu/core'
import { createHttpGitPort } from '@setu/git-http'
import { createGitApi } from '../src/app'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
  dirs.length = 0
})

const doc = (text: string) => ({
  type: 'doc' as const,
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
})

describe('end-to-end: publish over git-http → api → git-local → disk', () => {
  it('writes the compiled .mdoc to repo-relative content/ and returns published', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'setu-e2e-'))
    dirs.push(dir)
    await git.init({ fs: nodeFs, dir, defaultBranch: 'main' })

    // Server: real git-local on the temp repo, behind the real api routes.
    const app = createGitApi(createLocalGitAdapter({ dir }))

    // Client: the browser-side GitPort wired (portless) to the in-process app.
    const httpGit = createHttpGitPort({
      baseUrl: 'http://localhost',
      fetch: (input, init) =>
        Promise.resolve(app.fetch(new Request(input as string, init)))
    })

    // Drafts live in-browser (Cut A): a DataPort holding one draft to publish.
    const data = createMemoryDataPort([
      {
        collection: 'post',
        locale: 'en',
        slug: 'hello',
        content: doc('Hello world.'),
        metadata: { title: 'Hello' }
      }
    ])

    const publish = createPublishService({ data, git: httpGit })
    const result = await publish.publish({
      ref: { collection: 'post', locale: 'en', slug: 'hello' },
      author: { name: 'Ed', email: 'ed@example.com' }
    })

    expect(result.status).toBe('published')
    if (result.status !== 'published') throw new Error('expected published')
    expect(result.path).toBe('content/post/en/hello.mdoc')
    expect(typeof result.sha).toBe('string')

    // The real file is on disk in the temp repo, with the compiled body.
    const onDisk = readFileSync(join(dir, 'content/post/en/hello.mdoc'), 'utf8')
    expect(onDisk).toContain('title: Hello')
    expect(onDisk).toContain('Hello world.')
  })
})
