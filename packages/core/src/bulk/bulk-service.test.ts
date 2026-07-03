import { describe, expect, it } from 'vitest'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import { createBulkService } from './bulk-service'
import { createReadService } from '../read/read-service'
import { addCategory } from './mutations'
import { contentPath } from '../publish/content-path'
import { serializeMdoc } from '../markdoc/frontmatter'
import { parseMdoc } from '../markdoc/frontmatter'
import type { TiptapDoc } from '../markdoc/types'

const author = { name: 'T', email: 't@x.com' }
const doc = (t: string): TiptapDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }]
})

function setup(
  seedCommitted: {
    ref: { collection: string; locale: string; slug: string }
    frontmatter: Record<string, unknown>
    body: string
  }[] = []
) {
  const git = createMemoryGitPort(
    seedCommitted.map((s) => ({
      path: contentPath(s.ref),
      content: serializeMdoc({ frontmatter: s.frontmatter, body: s.body })
    }))
  )
  const data = createMemoryDataPort()
  const read = createReadService({ data, git })
  const bulk = createBulkService({ data, git, read, author })
  return { git, data, read, bulk }
}

const ref = (slug: string) => ({ collection: 'post', locale: 'en', slug })

describe('bulkService.applyMetadata', () => {
  it('applies a mutation to several entries in ONE commit', async () => {
    const { git, bulk } = setup([
      { ref: ref('a'), frontmatter: { title: 'A' }, body: 'a body' },
      { ref: ref('b'), frontmatter: { title: 'B' }, body: 'b body' }
    ])
    const r = await bulk.applyMetadata([ref('a'), ref('b')], (m) =>
      addCategory(m, 'news')
    )
    expect(r.applied).toHaveLength(2)
    expect(r.skipped).toEqual([])
    expect(typeof r.committedSha).toBe('string')
    expect(await git.headSha()).toBe(r.committedSha)
    const a = parseMdoc((await git.readFile(contentPath(ref('a'))))!)
    expect(a.frontmatter.categories).toEqual(['news'])
    const b = parseMdoc((await git.readFile(contentPath(ref('b'))))!)
    expect(b.frontmatter.categories).toEqual(['news'])
  })

  it('skips and reports an absent entry', async () => {
    const { bulk } = setup([
      { ref: ref('a'), frontmatter: { title: 'A' }, body: 'x' }
    ])
    const r = await bulk.applyMetadata([ref('a'), ref('ghost')], (m) =>
      addCategory(m, 'news')
    )
    expect(r.applied.map((x) => x.slug)).toEqual(['a'])
    expect(r.skipped).toEqual([{ ref: ref('ghost'), reason: 'absent' }])
  })

  it('advances the draft base so a re-edit forks from the new commit', async () => {
    const { data, bulk } = setup([
      { ref: ref('a'), frontmatter: { title: 'A' }, body: 'x' }
    ])
    const r = await bulk.applyMetadata([ref('a')], (m) =>
      addCategory(m, 'news')
    )
    const draft = await data.getDraft(ref('a'))
    expect(draft?.baseSha).toBe(r.committedSha)
    expect((draft?.metadata as { categories?: string[] }).categories).toEqual([
      'news'
    ])
  })
})

describe('bulkService.deleteEntries', () => {
  it('removes committed files + drafts in one commit', async () => {
    const { git, data, bulk } = setup([
      { ref: ref('a'), frontmatter: { title: 'A' }, body: 'x' },
      { ref: ref('b'), frontmatter: { title: 'B' }, body: 'y' }
    ])
    const r = await bulk.deleteEntries([ref('a'), ref('b')])
    expect(r.applied).toHaveLength(2)
    expect(await git.readFile(contentPath(ref('a')))).toBeNull()
    expect(await git.readFile(contentPath(ref('b')))).toBeNull()
    expect(await data.getDraft(ref('a'))).toBeNull()
  })

  it('deletes a draft-only entry without committing', async () => {
    const { git, data, bulk } = setup()
    await data.saveDraft({
      ...ref('d'),
      content: doc('x'),
      metadata: { title: 'D' },
      baseSha: null
    })
    const r = await bulk.deleteEntries([ref('d')])
    expect(r.committedSha).toBeNull()
    expect(await data.getDraft(ref('d'))).toBeNull()
    expect(await git.headSha()).toBeNull()
  })
})
