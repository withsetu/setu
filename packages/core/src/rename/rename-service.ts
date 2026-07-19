import type { DataPort } from '../data/data-port'
import type { EntryRef } from '../data/types'
import type { GitPort } from '../git/git-port'
import type { GitAuthor } from '../git/types'
import { contentPath } from '../publish/content-path'
import { isValidEntrySlug, unicodeCaseFold } from './slug'

export interface RenameDeps {
  data: DataPort
  git: GitPort
  author: GitAuthor
}

export type RenameRefusal =
  | 'invalid-slug'
  | 'target-exists'
  | 'absent'
  | 'unchanged'

export interface RenameResult {
  renamed: boolean
  /** Sha of the move commit, null when the rename was draft-only. */
  committedSha: string | null
  reason?: RenameRefusal
}

export interface RenameService {
  /** Move an entry to a new slug: committed file (byte-verbatim, ONE commit —
   *  the frontmatter `cid` travels with it, powering auto-301 redirects), the
   *  draft (re-forked onto the move commit), and the edit lock. */
  renameSlug(ref: EntryRef, newSlug: string): Promise<RenameResult>
}

const refuse = (reason: RenameRefusal): RenameResult => ({
  renamed: false,
  committedSha: null,
  reason
})

/** Slug rename over the ports: pure logic, edge-safe. UI validates too — this is
 *  defense in depth so no caller can mint an invalid or colliding identity. */
export function createRenameService(deps: RenameDeps): RenameService {
  const { data, git, author } = deps

  return {
    async renameSlug(ref, newSlug) {
      if (newSlug === ref.slug) return refuse('unchanged')
      // Fixed-point validation against THE minting vocabulary (rename/slug.ts):
      // Unicode slugs minting can produce ('über-uns') must rename cleanly here too.
      if (!isValidEntrySlug(newSlug)) return refuse('invalid-slug')

      const newRef: EntryRef = {
        collection: ref.collection,
        locale: ref.locale,
        slug: newSlug
      }
      const oldPath = contentPath(ref)
      const newPath = contentPath(newRef)

      if (
        (await data.getDraft(newRef)) !== null ||
        (await git.readFile(newPath)) !== null
      )
        return refuse('target-exists')

      // #654: the check above is a BYTE-EXACT git-tree lookup, but the write lands on the
      // FILESYSTEM, and a case-folding one (APFS/NTFS) resolves fold-variant names to the SAME
      // INODE. The two disagreed, and the disagreement was silent data loss: renaming onto
      // `ﬁle` (U+FB01) reported `renamed: true`, wrote nothing at `ﬁle.mdoc`, and replaced a
      // published `file.mdoc`'s bytes with the moved entry's — git HEAD still holding the
      // victim, so index and working tree diverged and the site build (which reads the working
      // tree) served the defacement.
      //
      // `isValidEntrySlug` now rejects fold-unstable slugs, so minting can no longer CREATE
      // that collision — this is the guard for content committed BEFORE that fix, which is
      // still sitting in the tree and would still be overwritten. Compare folded, over the one
      // directory the write can land in (bounded: one collection+locale, admin-volume, and
      // renames are rare).
      const dirPrefix = newPath.slice(0, newPath.lastIndexOf('/') + 1)
      const foldedTarget = unicodeCaseFold(newPath)
      const existing = await git.list(dirPrefix)
      if (existing.some((p) => unicodeCaseFold(p) === foldedTarget))
        return refuse('target-exists')

      const draft = await data.getDraft(ref)
      const committed = await git.readFile(oldPath)
      if (draft === null && committed === null) return refuse('absent')

      // Move the committed file byte-verbatim in ONE atomic commit so the
      // frontmatter (including `cid`) is untouched by the rename.
      let sha: string | null = null
      if (committed !== null) {
        const result = await git.commitFiles({
          changes: [
            { path: newPath, content: committed },
            { path: oldPath, delete: true }
          ],
          message: `Rename ${ref.collection}/${ref.locale}/${ref.slug} → ${newSlug}`,
          author
        })
        sha = result.sha
      }

      // Re-key the draft: fork it onto the move commit when one was made,
      // otherwise carry the old fork point along unchanged.
      //
      // Cross-store failure mode (parity with publish-service): if the commit
      // above lands but a step below throws, Git (canonical) holds the moved
      // file while the DB still has the old-ref draft with a now-stale
      // baseContent — a later publish of that draft fails CLOSED as a conflict
      // (per-file guard), never lossy. Re-running the rename refuses with
      // 'target-exists'/'absent' rather than double-moving.
      if (draft !== null) {
        await data.saveDraft({
          ...newRef,
          content: draft.content,
          metadata: draft.metadata,
          baseSha: sha ?? draft.baseSha,
          baseContent: committed ?? draft.baseContent ?? null
        })
        await data.deleteDraft(ref)
      }

      // Carry the edit lock (holder + time) so the rename can't drop or reset
      // another session's claim mid-edit.
      const lock = await data.getLock(ref)
      if (lock !== null) {
        await data.putLock({
          ...newRef,
          lockedBy: lock.lockedBy,
          lockedAt: lock.lockedAt
        })
        await data.deleteLock(ref)
      }

      return { renamed: true, committedSha: sha }
    }
  }
}
