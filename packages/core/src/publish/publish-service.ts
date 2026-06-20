import { tiptapToMarkdoc } from '../markdoc/to-markdoc'
import { serializeMdoc } from '../markdoc/frontmatter'
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

      // Per-file optimistic guard: conflict only if THIS file's committed content
      // changed since the draft forked from it. Publishing OTHER entries advances
      // HEAD but never touches this file, so it no longer trips a false conflict.
      // A new entry has baseContent null, so it conflicts iff its target file
      // already exists (never clobber pre-existing content for the slug).
      if (headSha !== null) {
        const committed = await git.readFile(path)
        if (committed !== (draft.baseContent ?? null)) {
          return { status: 'conflict', baseSha: draft.baseSha, headSha }
        }
      }

      // Serialize metadata → YAML frontmatter + the compiled Markdoc body.
      const content = serializeMdoc({ frontmatter: draft.metadata, body: tiptapToMarkdoc(draft.content) })
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
        // The just-committed content becomes this file's new per-file conflict base.
        baseContent: content,
      })

      return { status: 'published', sha, path }
    },
  }
}
