import type { DataPort } from '../data/data-port'
import type { EntryRef } from '../data/types'
import type { GitPort } from '../git/git-port'
import type { GitAuthor } from '../git/types'
import { contentPath } from '../publish/content-path'

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

/** Lowercase letters, digits, hyphens only — the slug vocabulary shared with the
 *  permalink settings screen. `new` is reserved (the admin's compose route). */
const VALID_SLUG = /^[a-z0-9-]+$/
const RESERVED_SLUG = 'new'

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
      if (!VALID_SLUG.test(newSlug) || newSlug === RESERVED_SLUG)
        return refuse('invalid-slug')

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
