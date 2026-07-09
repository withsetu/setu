import { Check, Loader2, Lock } from 'lucide-react'
import type { SaveStatus } from './useAutosave'

/** Quiet save-state indicator for the editor strip center. Shows ONLY persistence
 *  state — lifecycle status lives in the strip Badge, not here.
 *
 *  The settled state reads "Backed up on this device", not "Saved": autosave only
 *  writes to this browser's IndexedDB (per-device, per-browser — nothing team-visible
 *  and nothing in Git). "Saved" implied a durability/visibility it never had and misled
 *  owner UAT. With #382, committing to Git is an explicit action (Save draft / Publish)
 *  — this indicator must not be read as "my team can see this now". */
export function SaveIndicator({
  status,
  readonly
}: {
  status: SaveStatus
  readonly: boolean
}) {
  if (readonly) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <Lock className="size-3.5" /> Read-only
      </span>
    )
  }
  if (status === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Saving…
      </span>
    )
  }
  if (status === 'saved') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <Check className="size-3.5 text-success" /> Backed up on this device
      </span>
    )
  }
  return null
}
