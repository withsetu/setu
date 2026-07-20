import type { DataPort } from '../data/data-port'
import type { GitPort } from '../git/git-port'
import type { GitAuthor, FileChange } from '../git/types'
import type { EntryRef } from '../data/types'
import type { ReadService } from '../read/types'
import type { TiptapDoc } from '../markdoc/types'
import { contentPath } from '../publish/content-path'
import { rawFrontmatterOf, serializeMdoc } from '../markdoc/frontmatter'
import { tiptapToMarkdoc } from '../markdoc/to-markdoc'

/** Why one entry of a batch was not applied. `absent` = no draft and no committed
 *  file. `error` = the entry could not be derived at all (#713/#714b): its stored
 *  body has a node/mark `tiptapToMarkdoc` refuses to serialize, or its ref has a
 *  segment `contentPath` refuses to mint a path from. Both throws are correct — what
 *  they must not do is take the other N-1 entries down with them, so they are caught
 *  per entry and reported here. */
export interface BulkSkip {
  ref: EntryRef
  reason: 'absent' | 'error'
  /** The failure message, for `reason: 'error'` only. */
  message?: string
}

export interface BulkResult {
  /** The one commit's sha, or null when nothing was committed. */
  committedSha: string | null
  applied: EntryRef[]
  skipped: BulkSkip[]
}

export interface BulkDeps {
  data: DataPort
  git: GitPort
  read: ReadService
  author: GitAuthor
}

export interface BulkService {
  /** Apply `mutate` to each entry's metadata and commit all in ONE commit. */
  applyMetadata(
    refs: EntryRef[],
    mutate: (meta: Record<string, unknown>) => Record<string, unknown>,
    message?: string
  ): Promise<BulkResult>
  /** Delete entries: remove committed files (one commit) + their drafts. */
  deleteEntries(refs: EntryRef[], message?: string): Promise<BulkResult>
}

export function createBulkService(deps: BulkDeps): BulkService {
  const { data, git, read, author } = deps

  return {
    async applyMetadata(refs, mutate, message) {
      const applied: EntryRef[] = []
      const skipped: BulkSkip[] = []
      const changes: FileChange[] = []
      const pending: {
        ref: EntryRef
        content: TiptapDoc
        next: Record<string, unknown>
        serialized: string
      }[] = []

      for (const ref of refs) {
        const loaded = await read.loadForEdit(ref)
        if (loaded.source === 'absent') {
          skipped.push({ ref, reason: 'absent' })
          continue
        }
        const draft = loaded.draft
        // #713/#714b: one unserializable stored draft, or one non-canonical ref, used
        // to abort the ENTIRE batch — nothing was committed and the user got a raw
        // error instead of the N-1 entries they asked to change. Scope it to the entry.
        let next: Record<string, unknown>
        let serialized: string
        let path: string
        try {
          next = mutate(draft.metadata)
          serialized = serializeMdoc({
            frontmatter: next,
            body: tiptapToMarkdoc(draft.content),
            // #666: keep every key this bulk mutation did not touch byte-identical.
            rawFrontmatter: rawFrontmatterOf(draft.baseContent)
          })
          path = contentPath(ref)
        } catch (err) {
          skipped.push({
            ref,
            reason: 'error',
            message: err instanceof Error ? err.message : String(err)
          })
          continue
        }
        changes.push({ path, content: serialized })
        pending.push({ ref, content: draft.content, next, serialized })
        applied.push(ref)
      }

      if (changes.length === 0) return { committedSha: null, applied, skipped }

      const { sha } = await git.commitFiles({
        changes,
        message:
          message ??
          `Bulk update ${applied.length} entr${applied.length === 1 ? 'y' : 'ies'}`,
        author
      })

      for (const p of pending) {
        await data.saveDraft({
          ...p.ref,
          content: p.content,
          metadata: p.next,
          baseSha: sha,
          baseContent: p.serialized
        })
      }

      return { committedSha: sha, applied, skipped }
    },

    async deleteEntries(refs, message) {
      const applied: EntryRef[] = []
      const skipped: BulkSkip[] = []
      const changes: FileChange[] = []

      for (const ref of refs) {
        // #714b: `contentPath` throws on a non-canonical ref, which used to abort the
        // batch before ANY entry was deleted. Skip rather than delete-anyway: a ref
        // whose path cannot be minted is exactly the case where we cannot tell what
        // committed file (if any) belongs to it, and dropping the draft on that guess
        // would be unrecoverable. A skipped entry survives and is reported.
        let path: string
        try {
          path = contentPath(ref)
        } catch (err) {
          skipped.push({
            ref,
            reason: 'error',
            message: err instanceof Error ? err.message : String(err)
          })
          continue
        }
        const committed = await git.readFile(path)
        if (committed !== null) changes.push({ path, delete: true })
        await data.deleteDraft(ref)
        applied.push(ref)
      }

      let committedSha: string | null = null
      if (changes.length > 0) {
        const { sha } = await git.commitFiles({
          changes,
          message:
            message ??
            `Bulk delete ${changes.length} entr${changes.length === 1 ? 'y' : 'ies'}`,
          author
        })
        committedSha = sha
      }

      return { committedSha, applied, skipped }
    }
  }
}
