import { parseMdoc } from '../markdoc/frontmatter'

export type LifecycleState = 'draft' | 'staged' | 'live' | 'unpublished'
export type LifecyclePending = 'edited' | 'staged' | 'unpublishing'

export interface Lifecycle {
  state: LifecycleState
  pending?: LifecyclePending
}

/** A serialized .mdoc whose frontmatter `published` is explicitly false. */
function hidden(s: string | null): boolean {
  if (s === null) return false
  return parseMdoc(s).frontmatter['published'] === false
}

/** Derive an entry's lifecycle from three serialized .mdoc snapshots:
 *  - `draft`: the working copy (DB), serialized; null if no draft
 *  - `committed`: the content at Git HEAD; null if never committed
 *  - `deployed`: the content in the live snapshot; null if never deployed
 *  Pure — no IO. */
export function deriveLifecycle(snap: {
  draft: string | null
  committed: string | null
  deployed: string | null
}): Lifecycle {
  const { draft, committed, deployed } = snap
  const aheadEdited = draft !== null && draft !== committed
  const liveOnSite = deployed !== null && !hidden(deployed)
  const takenDown = deployed !== null && hidden(deployed)

  if (liveOnSite) {
    if (aheadEdited) return { state: 'live', pending: 'edited' }
    if (committed !== deployed) return { state: 'live', pending: hidden(committed) ? 'unpublishing' : 'staged' }
    return { state: 'live' }
  }
  if (takenDown) {
    if (aheadEdited) return { state: 'unpublished', pending: 'edited' }
    if (committed !== deployed) return { state: 'unpublished', pending: 'staged' }
    return { state: 'unpublished' }
  }
  // never deployed
  if (committed !== null) {
    const state: LifecycleState = hidden(committed) ? 'draft' : 'staged'
    return aheadEdited ? { state, pending: 'edited' } : { state }
  }
  return { state: 'draft' }
}
