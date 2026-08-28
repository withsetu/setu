import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

export interface PublishConflict {
  /** The commit this draft forked from — null for an entry that had no committed file. */
  baseSha: string | null
  /** The repo's current HEAD. */
  headSha: string
}

export interface PublishConflictDialogProps {
  conflict: PublishConflict | null
  /** Re-fork the draft onto the current published version, keeping the author's edits.
   *  Does NOT publish — see the note on `rebaseDraft` in packages/core. */
  onKeepMine: () => void
  /** Throw the author's edits away and reload from the published version. */
  onDiscard: () => void
  /** Dismiss and carry on editing. */
  onDismiss: () => void
  /** True while the re-fork is in flight, so the action cannot be double-fired. */
  busy?: boolean
}

const short = (sha: string | null) => (sha === null ? 'none' : sha.slice(0, 7))

/**
 * What a publish conflict offers the author (#1019).
 *
 * The guard that produces this conflict is correct and worth keeping: it fires only when THIS
 * entry's committed file changed since the draft forked from it, and it protects the other
 * version from being clobbered. What was wrong was the way out. The conflict used to surface as
 * a single toast — "The published version moved — reload to continue." — which named no cause,
 * offered no choice, and instructed the author to perform the one action that destroys unsaved
 * work. For a CMS whose cardinal rule is never lose content, that made the conflict path a
 * content-loss path.
 *
 * So the ordering here is deliberate:
 *  - Keeping the author's work is the primary action, and it is NOT destructive to anyone: it
 *    re-forks the draft onto the current published version and stops. Publishing stays a separate,
 *    deliberate act, because auto-publishing would trade the author's loss for whoever moved the
 *    file — the same defect wearing the other hat.
 *  - Discarding is offered, but it is never the only option and never the default.
 *  - Dismissing leaves the editor exactly as it was, with the edits still in it.
 *
 * Enforced by apps/admin/test/editor-publish-conflict.test.tsx, which asserts the draft still
 * exists after a conflict and that a reload-only path is not the sole offer.
 */
export function PublishConflictDialog({
  conflict,
  onKeepMine,
  onDiscard,
  onDismiss,
  busy = false
}: PublishConflictDialogProps) {
  return (
    <AlertDialog
      open={conflict !== null}
      onOpenChange={(open) => {
        if (!open) onDismiss()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            This entry changed since you started editing
          </AlertDialogTitle>
          <AlertDialogDescription>
            The published version of this entry moved in Git while you were
            working, so publishing now would overwrite that change without
            showing it to you.
            <br />
            <br />
            <strong>Your edits are safe.</strong> They are still open in the
            editor and nothing has been thrown away.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {conflict !== null && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-md border bg-muted/40 p-4 text-sm">
            <dt className="text-muted-foreground">You started from</dt>
            <dd className="font-mono">{short(conflict.baseSha)}</dd>
            <dt className="text-muted-foreground">Published version now</dt>
            <dd className="font-mono">{short(conflict.headSha)}</dd>
          </dl>
        )}

        <AlertDialogFooter className="gap-2 sm:gap-2">
          <AlertDialogCancel disabled={busy}>Keep editing</AlertDialogCancel>
          <Button variant="outline" onClick={onDiscard} disabled={busy}>
            Discard my changes
          </Button>
          <AlertDialogAction
            onClick={(e) => {
              // Keep the dialog mounted while the re-fork runs; the handler closes it on
              // success and leaves it open (with an error toast) on failure, so a failed
              // recovery can never look like a successful one.
              e.preventDefault()
              onKeepMine()
            }}
            disabled={busy}
          >
            {busy ? 'Keeping…' : 'Keep my changes'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
