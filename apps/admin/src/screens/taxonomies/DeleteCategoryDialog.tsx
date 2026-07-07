import type { CategoryNode } from '@setu/core'
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
import { useTaxonomy } from '../../data/taxonomy-store'
import { useNotify } from '../../ui/notify'

export function DeleteCategoryDialog({
  node,
  onClose
}: {
  node: CategoryNode | null
  onClose: () => void
}) {
  const { counts, remove } = useTaxonomy()
  const notify = useNotify()
  const used = node ? (counts[node.slug] ?? 0) : 0
  const hasChildren = node ? node.children.length > 0 : false

  const confirm = async () => {
    if (!node) return
    try {
      await remove(node.slug)
    } catch (e) {
      notify.error(e instanceof Error ? e.message : String(e))
    }
    onClose()
  }

  return (
    <AlertDialog
      open={node !== null}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete &quot;{node?.name}&quot;?</AlertDialogTitle>
          <AlertDialogDescription>
            {used > 0
              ? `Used by ${used} ${used === 1 ? 'entry' : 'entries'} — deleting removes it from ${used === 1 ? 'that entry' : 'them'}.`
              : "This category isn't used by any content."}
            {hasChildren ? ' Child categories move up one level.' : ''}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => void confirm()}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
