import type { TagRow } from './TagList'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog'
import { useTags } from '../../data/tags-store'
import { useNotify } from '../../ui/notify'

export function DeleteTagDialog({ row, onClose }: { row: TagRow | null; onClose: () => void }) {
  const { remove } = useTags()
  const notify = useNotify()
  const confirm = async () => {
    if (!row) return
    try { await remove(row.tag) } catch (e) { notify.error(e instanceof Error ? e.message : String(e)) }
    onClose()
  }
  return (
    <AlertDialog open={row !== null} onOpenChange={(o) => { if (!o) onClose() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete "{row?.tag}"?</AlertDialogTitle>
          <AlertDialogDescription>
            {row ? `Used by ${row.count} ${row.count === 1 ? 'entry' : 'entries'} — this removes the tag from ${row.count === 1 ? 'that entry' : 'them'}.` : ''}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => void confirm()}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
