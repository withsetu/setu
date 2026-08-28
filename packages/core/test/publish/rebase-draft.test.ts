import { describe, it, expect } from 'vitest'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import type { TiptapDoc } from '../../src/index'
import { createPublishService } from '../../src/index'

const doc = (t: string): TiptapDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }]
})
const author = { name: 'Me', email: 'me@example.com' }
const ref = { collection: 'post', locale: 'en', slug: 'a' }
const path = 'content/post/en/a.mdoc'

/** Reproduce the #1019 situation: a draft whose file moved in Git underneath it. */
async function conflicted() {
  const data = createMemoryDataPort()
  const git = createMemoryGitPort()
  const publish = createPublishService({ data, git })

  await git.commitFile({
    path,
    content: '---\ntitle: A\n---\n\noriginal\n',
    message: 'seed',
    author
  })
  // The author forked from the seed and has been editing ever since.
  await data.saveDraft({
    ...ref,
    content: doc('MY UNSAVED WORK'),
    metadata: { title: 'A' },
    baseSha: await git.headSha(),
    baseContent: '---\ntitle: A\n---\n\noriginal\n'
  })
  // Meanwhile the file moved in Git.
  await git.commitFile({
    path,
    content: '---\ntitle: A\n---\n\nsomeone else\n',
    message: 'external',
    author
  })
  return { data, git, publish }
}

describe('rebaseDraft — the non-destructive way out of a publish conflict (#1019)', () => {
  it('the situation really does conflict first', async () => {
    const { publish } = await conflicted()
    expect((await publish.publish({ ref, author })).status).toBe('conflict')
  })

  it("re-forks onto HEAD and KEEPS the author's work", async () => {
    const { data, git, publish } = await conflicted()

    const result = await publish.rebaseDraft({ ref })
    expect(result.status).toBe('rebased')

    // The whole point: the draft survives, with the author's content intact.
    const draft = await data.getDraft(ref)
    expect(draft).not.toBeNull()
    expect(draft?.content).toEqual(doc('MY UNSAVED WORK'))
    expect(draft?.metadata).toEqual({ title: 'A' })

    // And it now forks from current HEAD, so it is publishable again.
    expect(draft?.baseSha).toBe(await git.headSha())
    expect(draft?.baseContent).toBe(await git.readFile(path))
  })

  it("a publish after rebasing succeeds and commits the author's text", async () => {
    const { git, publish } = await conflicted()
    await publish.rebaseDraft({ ref })

    const r = await publish.publish({ ref, author })
    expect(r.status).toBe('published')
    expect(await git.readFile(path)).toContain('MY UNSAVED WORK')
  })

  it('rebasing does NOT publish — the author still decides', async () => {
    const { git, publish } = await conflicted()
    const before = await git.headSha()

    await publish.rebaseDraft({ ref })

    // No commit was made: HEAD is untouched and the other side's text still stands.
    expect(await git.headSha()).toBe(before)
    expect(await git.readFile(path)).toContain('someone else')
  })

  it('reports nothing when there is no draft to rebase', async () => {
    const data = createMemoryDataPort()
    const git = createMemoryGitPort()
    const publish = createPublishService({ data, git })
    expect((await publish.rebaseDraft({ ref })).status).toBe('nothing')
  })
})
