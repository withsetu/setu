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
      // HEAD-level base-SHA guard (§2): block if the repo advanced since the
      // draft forked. Never silently overwrites an external commit.
      if (draft.baseSha !== null && headSha !== null && draft.baseSha !== headSha) {
        return { status: 'conflict', baseSha: draft.baseSha, headSha }
      }

      const path = contentPath(ref)
      const content = tiptapToMarkdoc(draft.content)
      const commitMessage = message ?? `Publish ${ref.collection}/${ref.locale}/${ref.slug}`
      const { sha } = await git.commitFile({ path, content, message: commitMessage, author })

      // Advance the draft's base to the new commit so continued editing forks
      // from the just-published state and the next conflict check is correct.
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
