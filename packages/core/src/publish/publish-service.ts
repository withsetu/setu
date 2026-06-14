import { tiptapToMarkdoc } from '../markdoc/to-markdoc'
import { contentPath } from './content-path'
import type { PublishDeps, PublishInput, PublishResult, PublishService } from './types'

/** Compile a draft to Markdoc and commit it to Git (PRD §2). */
export function createPublishService(deps: PublishDeps): PublishService {
  const { data, git } = deps

  return {
    async publish({ ref, author, message }: PublishInput): Promise<PublishResult> {
      const draft = await data.getDraft(ref)
      if (draft === null) return { status: 'nothing' }

      const headSha = await git.headSha()
      const path = contentPath(ref)

      if (draft.baseSha !== null) {
        // Forked from a commit: block if the repo HEAD advanced since (HEAD-level
        // guard — coarse but never silently overwrites an external commit).
        if (headSha !== null && draft.baseSha !== headSha) {
          return { status: 'conflict', baseSha: draft.baseSha, headSha }
        }
      } else if (headSha !== null) {
        // New entry (never forked): block if the target file already exists, so we
        // never clobber pre-existing published content for this slug.
        const existing = await git.readFile(path)
        if (existing !== null) {
          return { status: 'conflict', baseSha: null, headSha }
        }
      }

      // NOTE: this compiles the body only. The draft's `metadata` is not yet
      // serialized to YAML frontmatter in the .mdoc — frontmatter write/parse is
      // a later increment (it needs a matching parser in markdocToTiptap too).
      const content = tiptapToMarkdoc(draft.content)
      const commitMessage = message ?? `Publish ${ref.collection}/${ref.locale}/${ref.slug}`
      const { sha } = await git.commitFile({ path, content, message: commitMessage, author })

      // Advance the draft's base to the new commit so continued editing forks from
      // the just-published state. NOTE: if this saveDraft throws after the commit
      // already succeeded, the draft keeps its old baseSha and a later publish
      // returns { status: 'conflict' } until the draft is re-forked from the new
      // HEAD (the reload flow) — never lossy, the commit is durable.
      await data.saveDraft({
        ...ref,
        content: draft.content,
        metadata: draft.metadata,
        baseSha: sha,
      })

      return { status: 'published', sha, path }
    },
  }
}
