import type { DataPort } from '../data/data-port'
import type { GitPort } from '../git/git-port'
import type { GitAuthor, FileChange } from '../git/types'
import type { EntryRef } from '../data/types'
import type { ReadService } from '../read/types'
import type { TiptapDoc } from '../markdoc/types'
import { contentPath } from '../publish/content-path'
import { serializeMdoc } from '../markdoc/frontmatter'
import { tiptapToMarkdoc } from '../markdoc/to-markdoc'

export interface BulkResult {
  /** The one commit's sha, or null when nothing was committed. */
  committedSha: string | null
  applied: EntryRef[]
  skipped: { ref: EntryRef; reason: 'absent' }[]
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
    message?: string,
  ): Promise<BulkResult>
  /** Delete entries: remove committed files (one commit) + their drafts. */
  deleteEntries(refs: EntryRef[], message?: string): Promise<BulkResult>
}

export function createBulkService(deps: BulkDeps): BulkService {
  const { data, git, read, author } = deps

  return {
    async applyMetadata(refs, mutate, message) {
      const applied: EntryRef[] = []
      const skipped: { ref: EntryRef; reason: 'absent' }[] = []
      const changes: FileChange[] = []
      const pending: { ref: EntryRef; content: TiptapDoc; next: Record<string, unknown>; serialized: string }[] = []

      for (const ref of refs) {
        const loaded = await read.loadForEdit(ref)
        if (loaded.source === 'absent') {
          skipped.push({ ref, reason: 'absent' })
          continue
        }
        const draft = loaded.draft
        const next = mutate(draft.metadata)
        const serialized = serializeMdoc({ frontmatter: next, body: tiptapToMarkdoc(draft.content) })
        changes.push({ path: contentPath(ref), content: serialized })
        pending.push({ ref, content: draft.content, next, serialized })
        applied.push(ref)
      }

      if (changes.length === 0) return { committedSha: null, applied, skipped }

      const { sha } = await git.commitFiles({
        changes,
        message: message ?? `Bulk update ${applied.length} entr${applied.length === 1 ? 'y' : 'ies'}`,
        author,
      })

      for (const p of pending) {
        await data.saveDraft({ ...p.ref, content: p.content, metadata: p.next, baseSha: sha, baseContent: p.serialized })
      }

      return { committedSha: sha, applied, skipped }
    },

    async deleteEntries(refs, message) {
      const applied: EntryRef[] = []
      const changes: FileChange[] = []

      for (const ref of refs) {
        const committed = await git.readFile(contentPath(ref))
        if (committed !== null) changes.push({ path: contentPath(ref), delete: true })
        await data.deleteDraft(ref)
        applied.push(ref)
      }

      let committedSha: string | null = null
      if (changes.length > 0) {
        const { sha } = await git.commitFiles({
          changes,
          message: message ?? `Bulk delete ${changes.length} entr${changes.length === 1 ? 'y' : 'ies'}`,
          author,
        })
        committedSha = sha
      }

      return { committedSha, applied, skipped: [] }
    },
  }
}

