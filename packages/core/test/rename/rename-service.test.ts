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

  // #742 — the same fold-blindness family as #731/#742's API half, in the SELECTION step rather
  // than the comparison. The #654 guard above folds correctly, but it only ever sees
  // `git.list(dirPrefix)` where `dirPrefix` is the LITERALLY-cased
  // `content/<collection>/<locale>/`. Every adapter implements that prefix as a literal
  // `startsWith`, so a committed path whose ROOT, COLLECTION or LOCALE segment differs by case or
  // fold is not in the listed set at all — and its fold-collision with the rename target is
  // therefore never seen. Narrower than the API half (collection and locale are constrained by the
  // ref, and the slug segment was already covered because it lives INSIDE the listed directory),
  // but the same root cause and the same consequence: `renameSlug` reports success and the write
  // lands on the victim's inode on a case-folding checkout.
  //
  // The fix asks the fold relation for the prefix too:
  // `unicodeCaseFold(p).startsWith(unicodeCaseFold(dirPrefix))` over an unfiltered listing. Unlike
  // the SLUG segment, the directory segments admit no fold-not-case witness here: `content` is
  // ASCII (enumerated the BMP+SMP — nothing non-ASCII folds onto any of its letters), and the
  // collection/locale segments come from the ref. Folding both sides is still correct — one
  // relation, and it can only ever be wider — it just is not separately observable, so these
  // victims are case-variants and the comment says so rather than implying more.
  it('refuses when the committed fold-collision differs in a DIRECTORY segment (#742)', async () => {
    // Every segment ABOVE the slug, which is what the literal `dirPrefix` filter excluded.
    const victims = [
      'Content/post/en/file.mdoc', // root segment
      'CONTENT/post/en/file.mdoc', // root segment
      'content/Post/en/file.mdoc', // collection segment
      'content/post/EN/file.mdoc', // locale segment
      'Content/Post/EN/file.mdoc' // every directory segment at once
    ]
    for (const victim of victims) {
      const git = createMemoryGitPort([
        {
          path: contentPath(ref('a')),
          content: serializeMdoc({ frontmatter: { title: 'A' }, body: 'x' })
        },
        {
          path: victim,
          content: serializeMdoc({
            frontmatter: { title: 'Victim' },
            body: 'v'
          })
        }
      ])
      const rename = createRenameService({
        data: createMemoryDataPort(),
        git,
        author
      })
      expect(
        (await rename.renameSlug(ref('a'), 'file')).reason,
        `renameSlug(a → "file") with ${JSON.stringify(victim)} committed`
      ).toBe('target-exists')
    }
  })

  // The discrimination half: widening the listed set must not refuse renames that collide with
  // NOTHING. These are real neighbours an author must keep being able to rename past — a different
  // slug, and paths outside the content tree entirely.
  it('still allows a rename whose fold-neighbours are genuinely different files (#742)', async () => {
    const git = createMemoryGitPort([
      {
        path: contentPath(ref('a')),
        content: serializeMdoc({ frontmatter: { title: 'A' }, body: 'x' })
      },
      {
        path: 'content/post/en/other.mdoc',
        content: serializeMdoc({ frontmatter: { title: 'O' }, body: 'o' })
      },
      {
        path: 'Content/post/de/file.mdoc', // different LOCALE — not a collision
        content: serializeMdoc({ frontmatter: { title: 'D' }, body: 'd' })
      },
      {
        path: 'docs/post/en/file.mdoc', // outside the content tree — not a collision
        content: serializeMdoc({ frontmatter: { title: 'X' }, body: 'x' })
      },
      {
        path: 'contents/post/en/file.mdoc', // `contents/` is not `content/`
        content: serializeMdoc({ frontmatter: { title: 'X' }, body: 'x' })
      }
    ])
    const rename = createRenameService({
      data: createMemoryDataPort(),
      git,
      author
    })
    expect((await rename.renameSlug(ref('a'), 'file')).renamed).toBe(true)
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
