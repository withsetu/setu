import { markdocToTiptap } from '../markdoc/to-tiptap'
import { contentPath } from '../publish/content-path'
import type { ReadDeps, ReadService } from './types'

/** Read-from-Git: materialize an editable draft for an entry (PRD §2). The
 *  read half of the round-trip — the write half is the publish service. */
export function createReadService(deps: ReadDeps): ReadService {
  const { data, git } = deps

  return {
    async loadForEdit(ref) {
      const existing = await data.getDraft(ref)
      if (existing !== null) return { source: 'draft', draft: existing }

      const published = await git.readFile(contentPath(ref))
      if (published === null) return { source: 'absent' }

      // Git → Tiptap (the read half of the round-trip). Body only for now;
      // metadata ↔ frontmatter is a later increment, so a forked draft starts
      // with empty metadata.
      const content = markdocToTiptap(published)
      const head = await git.headSha()
      const draft = await data.saveDraft({ ...ref, content, metadata: {}, baseSha: head })
      return { source: 'forked', draft }
    },
  }
}
