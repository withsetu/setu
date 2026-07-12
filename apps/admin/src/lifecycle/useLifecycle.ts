import type {
  DeployInfo,
  Draft,
  EntryRef,
  GitPort,
  Lifecycle
} from '@setu/core'
import {
  contentPath,
  deployedSnapshotFor,
  deriveLifecycle,
  serializeMdoc,
  tiptapToMarkdoc
} from '@setu/core'

/** Compose an entry's lifecycle from the draft (memory) + Git HEAD + the server's
 *  deploy truth (#208 — deployed sha + changed-path set). */
export async function lifecycleFor(
  ref: EntryRef,
  draft: Draft | null,
  git: GitPort,
  deploy: DeployInfo
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
    deployed: deployedSnapshotFor(deploy, path, committed)
  })
}
