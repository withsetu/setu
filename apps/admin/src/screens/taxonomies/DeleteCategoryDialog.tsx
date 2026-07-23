import { TaxonomyError, type CategoryNode } from '@setu/core'
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
import { connectionError } from '../../ui/error-message'

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
      const { skippedCount } = await remove(node.slug)
      // #713/#714b: the category IS gone, but an entry the serializer could not
      // rewrite still carries its slug. Reporting an unqualified success there
      // would hide a dangling reference the user is the only one who can fix.
      if (skippedCount > 0)
        notify.error(
          `Category deleted, but ${skippedCount} ${skippedCount === 1 ? 'entry' : 'entries'} could not be updated and still reference it — see the content list for entries needing attention.`
        )
    } catch (e) {
      // #852: TaxonomyError (e.g. the slug vanished under us) carries a meaningful
      // message; otherwise it's a transport failure — curate it.
      notify.error(
        e instanceof TaxonomyError
          ? e.message
          : connectionError('delete the category')
      )
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
