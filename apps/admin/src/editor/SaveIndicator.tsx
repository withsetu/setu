import { Check, Loader2, Lock } from 'lucide-react'
import type { SaveStatus } from './useAutosave'

/** Quiet save-state indicator for the editor strip center. Shows ONLY persistence
 *  state — lifecycle status lives in the strip Badge, not here. */
export function SaveIndicator({ status, readonly }: { status: SaveStatus; readonly: boolean }) {
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
        <Check className="size-3.5 text-success" /> Saved
      </span>
    )
  }
  return null
}
