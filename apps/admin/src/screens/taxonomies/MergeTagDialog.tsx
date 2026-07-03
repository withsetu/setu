import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction
} from '@/components/ui/alert-dialog'
import { useTags } from '../../data/tags-store'
import { useNotify } from '../../ui/notify'

export type PendingMerge = {
  from: string
  to: string
  fromCount: number
  toCount: number
}

export function MergeTagDialog({
  pending,
  onClose
}: {
  pending: PendingMerge | null
  onClose: () => void
}) {
  const { rename } = useTags()
  const notify = useNotify()
  const confirm = async () => {
    if (!pending) return
    try {
      const { applied } = await rename(pending.from, pending.to)
      notify.success(
        `Merged "${pending.from}" into "${pending.to}" across ${applied} ${applied === 1 ? 'entry' : 'entries'}`
      )
    } catch (e) {
      notify.error(e instanceof Error ? e.message : String(e))
    }
    onClose()
  }
  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Merge into "{pending?.to}"?</AlertDialogTitle>
          <AlertDialogDescription>
            {pending
              ? `"${pending.to}" already exists (${pending.toCount} ${pending.toCount === 1 ? 'entry' : 'entries'}). Renaming "${pending.from}" (${pending.fromCount}) merges them — this can't be auto-undone.`
              : ''}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => void confirm()}>
            Merge
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
