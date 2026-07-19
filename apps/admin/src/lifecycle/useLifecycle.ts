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
  rawFrontmatterOf,
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
        // #666: must match the publish path's serialization exactly, or an entry with
        // retained raw frontmatter would show 'edited' forever after publishing.
        frontmatter: draft.metadata,
        body: tiptapToMarkdoc(draft.content),
        rawFrontmatter: rawFrontmatterOf(draft.baseContent)
      })
    : null
  const committed = await git.readFile(path)
  return deriveLifecycle({
    draft: draftStr,
    committed,
    deployed: deployedSnapshotFor(deploy, path, committed)
  })
}
