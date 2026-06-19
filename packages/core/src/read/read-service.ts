import { markdocToTiptap } from '../markdoc/to-tiptap'
import { contentPath } from '../publish/content-path'
import { parseMdoc } from '../markdoc/frontmatter'
import type { ReadDeps, ReadService } from './types'

/** Read-from-Git: materialize an editable draft for an entry (PRD §2). The
 *  read half of the round-trip — the write half is the publish service. */
export function createReadService(deps: ReadDeps): ReadService {
  const { data, git, knownBlockTags } = deps

  return {
    async loadForEdit(ref) {
      const existing = await data.getDraft(ref)
      if (existing !== null) return { source: 'draft', draft: existing }

      const published = await git.readFile(contentPath(ref))
      if (published === null) return { source: 'absent' }

      // Git → Tiptap: split YAML frontmatter from the Markdoc body, restoring
      // both metadata and content (the read half of the round-trip).
      const { frontmatter, body } = parseMdoc(published)
      const content = markdocToTiptap(body, knownBlockTags ? { knownBlockTags } : {})
      const head = await git.headSha()
      const draft = await data.saveDraft({ ...ref, content, metadata: frontmatter, baseSha: head })
      return { source: 'forked', draft }
    },
  }
}
