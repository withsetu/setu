import { describe, it, expect } from 'vitest'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import type { DraftInput, TiptapDoc } from '../src/index'
import { createPublishService, createReadService } from '../src/index'

const doc = (t: string): TiptapDoc => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })
const author = { name: 'Me', email: 'me@example.com' }
const seed: DraftInput[] = [
  { collection: 'post', locale: 'en', slug: 'a', content: doc('A'), metadata: { title: 'A' } },
  { collection: 'post', locale: 'en', slug: 'b', content: doc('B'), metadata: { title: 'B' } },
]
const refA = { collection: 'post', locale: 'en', slug: 'a' }
const refB = { collection: 'post', locale: 'en', slug: 'b' }

describe('per-file publish conflict guard', () => {
  it('publishing B does NOT block re-publishing A (A untouched)', async () => {
    const data = createMemoryDataPort(seed)
    const git = createMemoryGitPort()
    const publish = createPublishService({ data, git })
    expect((await publish.publish({ ref: refA, author })).status).toBe('published')
    expect((await publish.publish({ ref: refB, author })).status).toBe('published')
    // A's committed file was never touched by publishing B → must still publish.
    expect((await publish.publish({ ref: refA, author })).status).toBe('published')
  })

  it('still conflicts when THIS file changed externally since the fork', async () => {
    const data = createMemoryDataPort()
    const git = createMemoryGitPort()
    const read = createReadService({ data, git })
    const publish = createPublishService({ data, git })
    // Pre-existing committed file for slug a.
    await git.commitFile({ path: 'content/post/en/a.mdoc', content: '---\ntitle: A\n---\nold', message: 'seed', author })
    // Fork it into a draft (baseContent = the committed content).
    const r = await read.loadForEdit(refA)
    expect(r.source).toBe('forked')
    // Someone else changes the committed file out from under us.
    await git.commitFile({ path: 'content/post/en/a.mdoc', content: '---\ntitle: A\n---\nEXTERNAL', message: 'external', author })
    // Our publish must detect the external change.
    expect((await publish.publish({ ref: refA, author })).status).toBe('conflict')
  })
})
