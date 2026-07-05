import type { Draft, EntryRef, GitPort, Lifecycle } from '@setu/core'
import {
  contentPath,
  deriveLifecycle,
  serializeMdoc,
  tiptapToMarkdoc
} from '@setu/core'

/** Compose an entry's lifecycle from the draft (memory) + Git HEAD + the live
 *  (deployed) snapshot. `deployedAt(path)` returns the live content or null. */
export async function lifecycleFor(
  ref: EntryRef,
  draft: Draft | null,
  git: GitPort,
  deployedAt: (path: string) => string | null
): Promise<Lifecycle> {
  const path = contentPath(ref)
  const draftStr = draft
    ? serializeMdoc({
        frontmatter: draft.metadata,
        body: tiptapToMarkdoc(draft.content)
      })
    : null
  const committed = await git.readFile(path)
  return deriveLifecycle({
    draft: draftStr,
    committed,
    deployed: deployedAt(path)
  })
}
