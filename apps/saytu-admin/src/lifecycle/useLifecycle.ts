import type { Draft, EntryRef, GitPort, Lifecycle } from '@saytu/core'
import { contentPath, deriveLifecycle, serializeMdoc, tiptapToMarkdoc } from '@saytu/core'

/** Compose an entry's lifecycle from the draft (in memory) + Git HEAD. `deployed`
 *  is null until the Deploy slice — so statuses are draft/staged here. */
export async function lifecycleFor(ref: EntryRef, draft: Draft | null, git: GitPort): Promise<Lifecycle> {
  const draftStr = draft ? serializeMdoc({ frontmatter: draft.metadata, body: tiptapToMarkdoc(draft.content) }) : null
  const committed = await git.readFile(contentPath(ref))
  return deriveLifecycle({ draft: draftStr, committed, deployed: null })
}
