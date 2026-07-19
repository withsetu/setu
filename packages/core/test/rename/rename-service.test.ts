import { describe, expect, it } from 'vitest'
import { createMemoryDataPort } from '@setu/db-memory'
import { createMemoryGitPort } from '@setu/git-memory'
import {
  contentPath,
  createRenameService,
  serializeMdoc
} from '../../src/index'
import type { EntryRef, TiptapDoc } from '../../src/index'

const author = { name: 'T', email: 't@x.com' }
const doc = (t: string): TiptapDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }]
})
const ref = (slug: string): EntryRef => ({
  collection: 'post',
  locale: 'en',
  slug
})

function setup(
  seedCommitted: {
    ref: EntryRef
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
  const rename = createRenameService({ data, git, author })
  return { git, data, rename }
}

describe('renameService.renameSlug — refusals', () => {
  it('refuses an unchanged slug', async () => {
    const { rename } = setup([
      { ref: ref('a'), frontmatter: { title: 'A' }, body: 'x' }
    ])
    expect(await rename.renameSlug(ref('a'), 'a')).toEqual({
      renamed: false,
      committedSha: null,
      reason: 'unchanged'
    })
  })

  it('refuses a non-canonical slug (anything entrySlugify would change)', async () => {
    const { rename } = setup([
      { ref: ref('a'), frontmatter: { title: 'A' }, body: 'x' }
    ])
    for (const bad of [
      'Has Caps',
      'sp ace',
      'slash/y',
      '',
      'Über-Uns', // uppercase Unicode — canonical form is 'über-uns'
      '-leading',
      'trailing-',
      'under_score',
      'double--hyphen'
    ]) {
      const r = await rename.renameSlug(ref('a'), bad)
      expect(r).toEqual({
        renamed: false,
        committedSha: null,
        reason: 'invalid-slug'
      })
    }
  })

  it('accepts Unicode slugs — the same vocabulary minting uses (slugify keeps \\p{L})', async () => {
    const { rename, data, git } = setup()
    await data.saveDraft({
      ...ref('ueber'),
      content: doc('hallo'),
      metadata: { title: 'Über uns' },
      baseSha: null
    })
    const r = await rename.renameSlug(ref('ueber'), 'über-uns')
    expect(r).toEqual({ renamed: true, committedSha: null })
    expect(await data.getDraft(ref('über-uns'))).not.toBeNull()
    expect(await git.headSha()).toBeNull()
  })

  it("refuses the reserved 'new' sentinel", async () => {
    const { rename } = setup([
      { ref: ref('a'), frontmatter: { title: 'A' }, body: 'x' }
    ])
    expect((await rename.renameSlug(ref('a'), 'new')).reason).toBe(
      'invalid-slug'
    )
  })

  it('refuses when the target slug has a committed file', async () => {
    const { rename } = setup([
      { ref: ref('a'), frontmatter: { title: 'A' }, body: 'x' },
      { ref: ref('b'), frontmatter: { title: 'B' }, body: 'y' }
    ])
    expect((await rename.renameSlug(ref('a'), 'b')).reason).toBe(
      'target-exists'
    )
  })

  // #654: the `target-exists` guard was `git.readFile(newPath)` — a BYTE-EXACT git-tree lookup —
  // while the write goes to the FILESYSTEM, which case-FOLDS on APFS/NTFS. Minting can no longer
  // produce a fold-unstable slug, but a file committed BEFORE that fix can still be sitting in
  // the tree, and renaming onto its folded form would overwrite it with no warning. The guard
  // must compare folded, not byte-exact. (The end-to-end proof against a real repo lives in
  // packages/git-local/test/rename-fold-collision.test.ts.)
  it('refuses when an EXISTING committed file folds onto the target slug (#654)', async () => {
    for (const legacySlug of [
      'ﬁle', // U+FB01 — folds onto 'file'
      'FILE', // case-only variant of the same inode
      'cafe\u0301' // NFD (e + U+0301) — the same inode as the NFC 'café'
    ]) {
      const target = legacySlug === 'cafe\u0301' ? 'café' : 'file'
      const { rename } = setup([
        { ref: ref('a'), frontmatter: { title: 'A' }, body: 'x' },
        { ref: ref(legacySlug), frontmatter: { title: 'Victim' }, body: 'v' }
      ])
      expect(
        (await rename.renameSlug(ref('a'), target)).reason,
        `renameSlug(a → ${JSON.stringify(target)}) with ${JSON.stringify(legacySlug)} committed`
      ).toBe('target-exists')
    }
  })

  it('refuses when the target slug has a draft', async () => {
    const { rename, data } = setup([
      { ref: ref('a'), frontmatter: { title: 'A' }, body: 'x' }
    ])
    await data.saveDraft({
      ...ref('b'),
      content: doc('draft b'),
      metadata: { title: 'B' },
      baseSha: null
    })
    expect((await rename.renameSlug(ref('a'), 'b')).reason).toBe(
      'target-exists'
    )
  })

  it('refuses when the source entry is absent everywhere', async () => {
    const { rename } = setup()
    expect((await rename.renameSlug(ref('ghost'), 'other')).reason).toBe(
      'absent'
    )
  })
})

describe('renameService.renameSlug — draft-only rename', () => {
  it('re-keys the draft without committing anything', async () => {
    const { rename, data, git } = setup()
    await data.saveDraft({
      ...ref('old'),
      content: doc('hello'),
      metadata: { title: 'Hello' },
      baseSha: null
    })
    const r = await rename.renameSlug(ref('old'), 'fresh')
    expect(r).toEqual({ renamed: true, committedSha: null })
    expect(await git.headSha()).toBeNull()
    expect(await data.getDraft(ref('old'))).toBeNull()
    const moved = await data.getDraft(ref('fresh'))
    expect(moved?.content).toEqual(doc('hello'))
    expect(moved?.metadata).toEqual({ title: 'Hello' })
    expect(moved?.baseSha).toBeNull()
  })

  it('preserves the old baseSha/baseContent when nothing is committed at the old path', async () => {
    const { rename, data } = setup()
    await data.saveDraft({
      ...ref('old'),
      content: doc('hello'),
      metadata: { title: 'Hello' },
      baseSha: 'sha-before',
      baseContent: 'fork-base'
    })
    await rename.renameSlug(ref('old'), 'fresh')
    const moved = await data.getDraft(ref('fresh'))
    expect(moved?.baseSha).toBe('sha-before')
    expect(moved?.baseContent).toBe('fork-base')
  })
})

describe('renameService.renameSlug — committed rename', () => {
  it('moves the file byte-verbatim in ONE commit and deletes the old path', async () => {
    const { rename, git } = setup([
      {
        ref: ref('old'),
        frontmatter: {
          title: 'Hello',
          cid: 'b3b8f7a2-1111-4222-8333-444455556666'
        },
        body: 'the body'
      }
    ])
    const before = (await git.readFile(contentPath(ref('old'))))!
    const r = await rename.renameSlug(ref('old'), 'fresh')
    expect(r.renamed).toBe(true)
    expect(typeof r.committedSha).toBe('string')
    expect(await git.headSha()).toBe(r.committedSha)
    expect(await git.readFile(contentPath(ref('old')))).toBeNull()
    // byte-identical move — the cid travels with the file untouched
    const after = await git.readFile(contentPath(ref('fresh')))
    expect(after).toBe(before)
    expect(after).toContain('b3b8f7a2-1111-4222-8333-444455556666')
  })

  it('commits write+delete atomically in one commitFiles call with the rename message', async () => {
    const { git, data } = setup([
      { ref: ref('old'), frontmatter: { title: 'Hello' }, body: 'x' }
    ])
    const calls: { changes: unknown[]; message: string }[] = []
    const spyGit = {
      ...git,
      commitFiles: async (input: Parameters<typeof git.commitFiles>[0]) => {
        calls.push({ changes: input.changes, message: input.message })
        return git.commitFiles(input)
      }
    }
    const rename = createRenameService({ data, git: spyGit, author })
    await rename.renameSlug(ref('old'), 'fresh')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.changes).toHaveLength(2)
    expect(calls[0]?.message).toBe('Rename post/en/old → fresh')
    // and the source really is gone afterwards
    expect((await rename.renameSlug(ref('old'), 'other')).reason).toBe('absent')
  })

  it('re-keys an edited draft onto the move commit (baseSha = move sha, baseContent = committed)', async () => {
    const { rename, git, data } = setup([
      {
        ref: ref('old'),
        frontmatter: { title: 'Hello' },
        body: 'committed body'
      }
    ])
    const committed = (await git.readFile(contentPath(ref('old'))))!
    await data.saveDraft({
      ...ref('old'),
      content: doc('edited beyond the commit'),
      metadata: { title: 'Hello edited' },
      baseSha: 'stale-sha',
      baseContent: committed
    })
    const r = await rename.renameSlug(ref('old'), 'fresh')
    expect(await data.getDraft(ref('old'))).toBeNull()
    const moved = await data.getDraft(ref('fresh'))
    expect(moved?.content).toEqual(doc('edited beyond the commit'))
    expect(moved?.metadata).toEqual({ title: 'Hello edited' })
    expect(moved?.baseSha).toBe(r.committedSha)
    expect(moved?.baseContent).toBe(committed)
  })
})

describe('renameService.renameSlug — lock transfer', () => {
  it('moves the lock to the new ref preserving holder and time', async () => {
    const { rename, data } = setup([
      { ref: ref('old'), frontmatter: { title: 'Hello' }, body: 'x' }
    ])
    await data.putLock({ ...ref('old'), lockedBy: 'editor-1', lockedAt: 1234 })
    await rename.renameSlug(ref('old'), 'fresh')
    expect(await data.getLock(ref('old'))).toBeNull()
    expect(await data.getLock(ref('fresh'))).toEqual({
      ...ref('fresh'),
      lockedBy: 'editor-1',
      lockedAt: 1234
    })
  })
})
