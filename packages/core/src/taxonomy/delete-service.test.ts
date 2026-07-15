import { describe, expect, it } from 'vitest'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { createMemoryIndexPort } from '@setu/db-memory'
import { createReadService } from '../read/read-service'
import { createIndexService } from '../index-port/index-service'
import { serializeCategories } from './parse'
import { createCategoryDeleter } from './delete-service'
import type { TiptapDoc } from '../markdoc/types'

const author = { name: 'T', email: 't@x.dev' }
const doc = (t: string): TiptapDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }]
})

async function setup() {
  // Seed entries as drafts — both have 'news'; only 'a' has 'eng'
  const data = createMemoryDataPort([
    {
      collection: 'post',
      locale: 'en',
      slug: 'a',
      content: doc('a'),
      metadata: { title: 'A', categories: ['eng', 'news'] }
    },
    {
      collection: 'post',
      locale: 'en',
      slug: 'b',
      content: doc('b'),
      metadata: { title: 'B', categories: ['news'] }
    }
  ])
  const git = createMemoryGitPort()
  const index = createMemoryIndexPort()
  const read = createReadService({
    data,
    git,
    knownBlockTags: new Set<string>()
  })
  const idx = createIndexService({
    data,
    git,
    index,
    deploy: () => ({ deployedSha: null, changed: [] })
  })

  // Seed the categories.yaml using the real serializer so parseCategories can read it
  const catsYaml = serializeCategories([
    { slug: 'eng', name: 'Engineering', parent: null },
    { slug: 'news', name: 'News', parent: null }
  ])
  await git.commitFile({
    path: 'taxonomy/categories.yaml',
    content: catsYaml,
    message: 'seed categories',
    author
  })

  // Build the index AFTER seeding data so entriesByCategory finds the entries
  await idx.rebuild()

  return { data, git, index, read, idx }
}

describe('createCategoryDeleter', () => {
  it('strips the slug from referencing entries, removes the definition, one commit', async () => {
    const { data, git, read, idx } = await setup()

    const before = await git.headSha()
    const deleter = createCategoryDeleter({
      git,
      data,
      read,
      index: idx,
      author
    })
    const res = await deleter.remove('eng')

    // Only entry 'a' referenced 'eng'
    expect(res.strippedCount).toBe(1)

    // The returned category list no longer includes 'eng'
    expect(res.categories.find((c) => c.slug === 'eng')).toBeUndefined()

    // Exactly one new commit was made (headSha changed)
    const after = await git.headSha()
    expect(after).not.toBe(before)

    // Content of 'a' must not contain 'eng' but must still contain 'news'
    const aContent = await git.readFile('content/post/en/a.mdoc')
    expect(aContent).not.toBeNull()
    expect(aContent!).not.toContain('eng')
    expect(aContent!).toContain('news')

    // Content of 'b' is untouched (it never had 'eng')
    const bContent = await git.readFile('content/post/en/b.mdoc')
    expect(bContent).toBeNull() // 'b' was draft-only, not committed to git, so the deleter didn't touch it

    // The categories.yaml no longer contains 'eng'
    const yaml = await git.readFile('taxonomy/categories.yaml')
    expect(yaml).not.toContain('eng')
    // 'news' definition is still present
    expect(yaml).toContain('news')
  })

  it('updates the index so entriesByCategory no longer returns stripped entries', async () => {
    const { data, git, read, idx } = await setup()

    // Before: 'a' is in the 'eng' category
    const beforeRefs = await idx.entriesByCategory('eng')
    expect(beforeRefs).toHaveLength(1)
    expect(beforeRefs[0]).toMatchObject({
      collection: 'post',
      locale: 'en',
      slug: 'a'
    })

    const deleter = createCategoryDeleter({
      git,
      data,
      read,
      index: idx,
      author
    })
    await deleter.remove('eng')

    // After: 'a' is no longer in 'eng'
    const afterRefs = await idx.entriesByCategory('eng')
    expect(afterRefs).toHaveLength(0)

    // 'news' entries are still found
    const newsRefs = await idx.entriesByCategory('news')
    expect(newsRefs.map((r) => r.slug).sort()).toEqual(['a', 'b'])
  })

  it('marks the index synced at the delete commit so ensureBuilt does not full-rebuild on next load', async () => {
    const { git, data, read, index, idx } = await setup()
    const deleter = createCategoryDeleter({
      git,
      data,
      read,
      index: idx,
      author
    })
    await deleter.remove('eng')
    // markSyncedAt advanced the index meta to the delete commit's HEAD, so ensureBuilt's
    // out-of-band sha-gate (head !== indexedSha) is false → no spurious full rebuild.
    expect((await index.getMeta()).indexedSha).toBe(await git.headSha())
  })
})
